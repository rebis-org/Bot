import { tryCatchAsync } from '@moeru/std/try-catch';
import { withRetry } from '@moeru/std/with-retry';
import { asyncRetry } from 'foxts/async-retry';
import { isObjectEmpty } from 'foxts/is-object-empty';
import type { MediaMsgtype } from '../../domain/value.ts';

export interface MatrixConfig {
  baseUrl: string,
  accessToken: string,
  userId: string,
  bypassKey?: string
}

export type { MediaMsgtype };

export interface PowerLevels {
  level(userId: string): number
}

export interface ReceiptMark {
  roomId: string,
  userId: string,
  eventId: string
}

export interface SyncResult {
  nextBatch: string,
  receipts: ReceiptMark[],
  cursors: Array<{ roomId: string, prevBatch: string | null }>
}

export interface RoomEvent {
  eventId: string,
  type: string,
  sender: string,
  ts: number,
  content: Record<string, unknown>,
  redacted: boolean
}

export interface MessagesPage {
  events: RoomEvent[],
  nextToken: string | null
}

const POWER_LEVELS_TTL_MS = 60000;
const FORMAT_HTML = 'org.matrix.custom.html';
const CS_API = '/_matrix/client/v3';
const MEDIA_API = '/_matrix/media/v3';
const REQUEST_RETRIES = 3;
const REQUEST_RETRY_WAIT_MS = 1500;
const SYNC_FILTER = encodeURIComponent(JSON.stringify({
  room: {
    timeline: { limit: 1 },
    ephemeral: { types: ['m.receipt'] },
    state: { types: [] },
    account_data: { types: [] }
  },
  presence: { types: [] }
}));

interface PowerLevelsContent {
  users?: Record<string, number>,
  users_default?: number,
  redact?: number,
  state_default?: number
}

interface SendResponse {
  event_id: string
}

interface CreateRoomResponse {
  room_id: string
}

export class MatrixError extends Error {
  constructor(
    readonly status: number,
    method: string,
    path: string,
    body: string
  ) {
    super(`${method} ${path} failed: ${String(status)} ${body}`);
    this.name = 'MatrixError';
  }
}

export class MatrixClient {
  private readonly powerLevelCache = new Map<
    string,
    { content: PowerLevelsContent, expiresAt: number }
  >();

  private constructor(
    private readonly accessToken: string,
    readonly userId: string,
    readonly baseUrl: string,
    private readonly bypassKey: string | undefined
  ) {}

  static connect(this: void, config: MatrixConfig): MatrixClient {
    return new MatrixClient(
      config.accessToken,
      config.userId,
      config.baseUrl,
      config.bypassKey
    );
  }

  async sendHtml(
    roomId: string,
    body: string,
    html: string,
    replyTo?: string
  ): Promise<string> {
    const content: Record<string, unknown> = htmlMessage('m.text', body, html);
    if (replyTo !== undefined) {
      content['m.relates_to'] = { 'm.in_reply_to': { event_id: replyTo } };
    }
    return this.send(roomId, 'm.room.message', content);
  }

  async sendEmote(
    roomId: string,
    body: string,
    html: string
  ): Promise<string> {
    return this.send(roomId, 'm.room.message', htmlMessage('m.emote', body, html));
  }

  async sendMedia(
    roomId: string,
    msgtype: MediaMsgtype,
    body: string,
    url: string
  ): Promise<string> {
    return this.send(roomId, 'm.room.message', { msgtype, body, url });
  }

  async sendReaction(roomId: string, eventId: string, key: string): Promise<void> {
    await this.send(roomId, 'm.reaction', {
      'm.relates_to': {
        rel_type: 'm.annotation',
        event_id: eventId,
        key
      }
    });
  }

  async editHtml(
    roomId: string,
    eventId: string,
    body: string,
    html: string
  ): Promise<void> {
    await this.send(roomId, 'm.room.message', {
      ...htmlMessage('m.text', `* ${body}`, `* ${html}`),
      'm.new_content': htmlMessage('m.text', body, html),
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: eventId
      }
    });
  }

  async powerLevels(roomId: string): Promise<PowerLevels> {
    return toPowerLevels(await this.powerLevelsContent(roomId));
  }

  async redactLevel(roomId: string): Promise<number> {
    const content = await this.powerLevelsContent(roomId);
    return content.redact ?? content.state_default ?? 50;
  }

  async members(roomId: string): Promise<string[]> {
    const res = await this.request<{ chunk: Array<{
      type?: string,
      state_key?: string,
      content?: { membership?: string }
    }> }>('GET', `${CS_API}/rooms/${roomId}/members`);
    const ids: string[] = [];
    for (let i = 0, len = res.chunk.length; i < len; i++) {
      const event = res.chunk[i]!;
      if (event.type === 'm.room.member' && event.content?.membership === 'join' && typeof event.state_key === 'string') ids.push(event.state_key);
    }
    return ids;
  }

  async messages(
    roomId: string,
    from: string,
    limit: number
  ): Promise<MessagesPage> {
    const res = await this.request<{
      chunk?: Array<Record<string, unknown>>,
      end?: string
    }>(
      'GET',
      `${CS_API}/rooms/${roomId}/messages?dir=b&limit=${String(limit)}&from=${encodeURIComponent(from)}`
    );
    const events: RoomEvent[] = [];
    const chunk = res.chunk ?? [];
    for (let i = 0, len = chunk.length; i < len; i++) {
      const parsed = toRoomEvent(chunk[i]!);
      if (parsed !== null) events.push(parsed);
    }
    return { events, nextToken: res.end ?? null };
  }

  async syncSince(since: string | undefined): Promise<SyncResult> {
    const query = since === undefined
      ? `filter=${SYNC_FILTER}&timeout=0`
      : `filter=${SYNC_FILTER}&timeout=0&since=${encodeURIComponent(since)}`;
    const res = await asyncRetry(
      () => this.request<SyncResponse>('GET', `${CS_API}/sync?${query}`),
      {
        retries: REQUEST_RETRIES,
        factor: 1,
        minTimeout: REQUEST_RETRY_WAIT_MS,
        randomize: false,
        shouldRetry: ({ error }) => !(error instanceof MatrixError) || error.status >= 500
      }
    );
    const receipts: ReceiptMark[] = [];
    const cursors: SyncResult['cursors'] = [];
    const join = res.rooms?.join ?? {};
    const roomIds = Object.keys(join);
    for (let r = 0, rlen = roomIds.length; r < rlen; r++) {
      const roomId = roomIds[r]!;
      const room = join[roomId]!;
      const batch = room.ephemeral?.events ?? [];
      for (let i = 0, len = batch.length; i < len; i++) {
        collectReceipts(roomId, batch[i]!, receipts);
      }
      cursors.push({ roomId, prevBatch: room.timeline?.prev_batch ?? null });
    }
    return { nextBatch: res.next_batch, receipts, cursors };
  }

  async redact(roomId: string, eventId: string, reason: string): Promise<void> {
    await this.request('PUT', `${CS_API}/rooms/${roomId}/redact/${eventId}/${nextTxnId()}`, {
      reason
    });
  }

  async deleteMedia(serverName: string, mediaId: string): Promise<void> {
    await this.request('DELETE', `${MEDIA_API}/delete/${serverName}/${mediaId}`);
  }

  get serverName(): string {
    return this.userId.slice(this.userId.indexOf(':') + 1);
  }

  private async powerLevelsContent(roomId: string): Promise<PowerLevelsContent> {
    const cached = this.powerLevelCache.get(roomId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.content;
    }
    const { data } = await tryCatchAsync(() => this.request<PowerLevelsContent>(
      'GET',
      `${CS_API}/rooms/${roomId}/state/m.room.power_levels/`
    ));
    const content = data ?? {};
    this.powerLevelCache.set(roomId, {
      content,
      expiresAt: Date.now() + POWER_LEVELS_TTL_MS
    });
    return content;
  }

  async createDirectRoom(userId: string): Promise<string> {
    const res = await this.request<CreateRoomResponse>('POST', `${CS_API}/createRoom`, {
      is_direct: true,
      invite: [userId]
    });
    return res.room_id;
  }

  async fetchEvent(
    roomId: string,
    eventId: string
  ): Promise<Record<string, unknown> | undefined> {
    const { data, error } = await tryCatchAsync(
      () => this.request<Record<string, unknown>>(
        'GET',
        `${CS_API}/rooms/${roomId}/event/${eventId}`
      )
    );
    if (error !== undefined) console.error(error);
    return data;
  }

  async joinRoom(roomId: string): Promise<void> {
    await withRetry(
      () => this.request('POST', `${CS_API}/join/${roomId}`, {}),
      { retry: REQUEST_RETRIES, retryDelay: REQUEST_RETRY_WAIT_MS, retryDelayFactor: 1 }
    )();
  }

  async serverLatencyMs(): Promise<number> {
    const start = Date.now();
    await this.request('GET', '/_matrix/client/versions');
    return Date.now() - start;
  }

  async setDisplayName(name: string): Promise<void> {
    await this.request('PUT', `${CS_API}/profile/${this.userId}/displayname`, {
      displayname: name
    });
  }

  private async send(
    roomId: string,
    eventType: string,
    content: Record<string, unknown>
  ): Promise<string> {
    const res = await this.request<SendResponse>(
      'PUT',
      `${CS_API}/rooms/${roomId}/send/${eventType}/${nextTxnId()}`,
      content
    );
    return res.event_id;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        ...(this.bypassKey !== undefined && { 'x-rebis-bot': this.bypassKey }),
        ...(!(body === undefined) && { 'content-type': 'application/json' })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!res.ok) {
      throw new MatrixError(res.status, method, path, await res.text());
    }
    return res.json();
  }
}

function nextTxnId(): string {
  return crypto.randomUUID();
}

function htmlMessage(
  msgtype: 'm.text' | 'm.emote',
  body: string,
  html: string
): Record<string, unknown> {
  return {
    msgtype,
    body,
    format: FORMAT_HTML,
    formatted_body: html
  };
}

function toPowerLevels(content: PowerLevelsContent): PowerLevels {
  return {
    level(userId: string): number {
      return content.users?.[userId] ?? content.users_default ?? 0;
    }
  };
}

interface SyncResponse {
  next_batch: string,
  rooms?: {
    join?: Record<string, {
      ephemeral?: { events?: SyncEphemeral[] },
      timeline?: { prev_batch?: string }
    }>
  }
}

interface SyncEphemeral {
  type?: string,
  content?: Record<string, Record<string, Record<string, unknown>>>
}

function collectReceipts(
  roomId: string,
  event: SyncEphemeral,
  receipts: ReceiptMark[]
): void {
  if (event.type !== 'm.receipt' || event.content === undefined) return;
  const events = Object.entries(event.content);
  for (let e = 0, elen = events.length; e < elen; e++) {
    const [eventId, byUser] = events[e]!;
    const readers = Object.entries(byUser);
    for (let u = 0, ulen = readers.length; u < ulen; u++) {
      const [userId, receipt] = readers[u]!;
      const ts = (receipt['m.read'] as { ts?: unknown } | null | undefined)?.ts;
      if (typeof ts === 'number') receipts.push({ roomId, userId, eventId });
    }
  }
}

function toRoomEvent(raw: Record<string, unknown>): RoomEvent | null {
  if (typeof raw.event_id !== 'string' || typeof raw.type !== 'string') return null;
  if (typeof raw.sender !== 'string' || typeof raw.origin_server_ts !== 'number') {
    return null;
  }
  const content = typeof raw.content === 'object' && raw.content !== null
    ? raw.content as Record<string, unknown>
    : {};
  const unsigned = typeof raw.unsigned === 'object' && raw.unsigned !== null
    ? raw.unsigned as Record<string, unknown>
    : {};
  return {
    eventId: raw.event_id,
    type: raw.type,
    sender: raw.sender,
    ts: raw.origin_server_ts,
    content,
    redacted: 'redacted_because' in unsigned || isObjectEmpty(content)
  };
}
