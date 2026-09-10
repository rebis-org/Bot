import { tryCatchAsync } from '@moeru/std/try-catch';
import { nullthrow } from 'foxts/guard';
import type { Stores } from '../../domain/ports.ts';
import { extractLocalMedia } from '../../domain/value.ts';
import type { MatrixClient, MessagesPage, RoomEvent } from '../matrix/client.ts';
import { deleteLocalMedia } from './redact.ts';

const BURN_AFTER_MS = 86_400_000;
const BURN_AFTER_SEND_MS = 2 * 86_400_000;
const SCAN_MAX_MS = 7 * 86_400_000;
const PAGE_LIMIT = 100;
const MAX_PAGES = 20;
const BURN_REASON = 'Read by all members for over 24 hours';
const FORCE_REASON = 'Force-burned by a room administrator';
const FORCE_BUDGET_MS = 25000;
const STATE_TOKEN = 'burn_sync_token';
const cursorKey = (roomId: string): string => `burn_cursor:${roomId}`;

export interface BurnContext {
  now: number,
  members: readonly string[],
  marks: ReadonlyMap<string, number>,
  coverage: boolean,
  pinned: ReadonlySet<string>,
  force: boolean
}

export function burnable(event: RoomEvent, ctx: BurnContext): boolean {
  if (event.type !== 'm.room.message' || event.redacted) return false;
  if (ctx.pinned.has(event.eventId)) return false;
  if (ctx.force) return true;
  const age = ctx.now - event.ts;
  if (age < BURN_AFTER_MS) return false;
  if (age > SCAN_MAX_MS) return false;
  if (!ctx.coverage) return age >= BURN_AFTER_SEND_MS;
  for (let i = 0, len = ctx.members.length; i < len; i++) {
    const markTs = ctx.marks.get(ctx.members[i]!);
    if (markTs === undefined || markTs < event.ts) return false;
  }
  return true;
}

export async function burnRead(
  client: MatrixClient,
  store: Stores
): Promise<void> {
  const liveStarts = await syncBurnState(client, store);
  const rooms = await store.burnRooms();
  await harvestCursors(client, store, rooms, liveStarts);
  for (let i = 0, len = rooms.length; i < len; i++) {
    const roomId = rooms[i]!;
    // eslint-disable-next-line no-await-in-loop
    const { error } = await tryCatchAsync(
      () => burnRoom(client, store, roomId, liveStarts?.get(roomId) ?? null)
    );
    if (error !== undefined) {
      console.error(`burn ${roomId} failed:`, error);
    }
  }
}

export interface ForceResult {
  burned: number,
  done: boolean
}

export async function burnForce(
  client: MatrixClient,
  store: Stores,
  roomId: string,
  onProgress: (burned: number) => Promise<void>,
  budgetMs = FORCE_BUDGET_MS
): Promise<ForceResult> {
  if (!(await canRedact(client, roomId))) {
    throw new Error('The bot does not have the power level to redact messages');
  }
  const liveStarts = await syncBurnState(client, store);
  let start = liveStarts?.get(roomId) ?? await store.stateGet(cursorKey(roomId));
  if (start === null) {
    await harvestCursors(client, store, [roomId], liveStarts);
    start = await store.stateGet(cursorKey(roomId));
  }
  const anchored = nullthrow(start, 'This room has no pagination cursor');
  const ctx: BurnContext = {
    now: Date.now(),
    members: [],
    marks: new Map(),
    coverage: false,
    pinned: new Set(await store.pinnedEventIds(roomId)),
    force: true
  };
  const result = await scanAndBurn(
    client,
    roomId,
    anchored,
    ctx,
    onProgress,
    Date.now() + budgetMs
  );
  return { burned: result.burned, done: result.done };
}

async function syncBurnState(
  client: MatrixClient,
  store: Stores
): Promise<Map<string, string> | null> {
  const token = await store.stateGet(STATE_TOKEN);
  const { data: sync, error } = await tryCatchAsync(
    () => client.syncSince(token ?? undefined)
  );
  if (sync === undefined) {
    console.error('burn sync failed:', error);
    return null;
  }
  await store.stateSet(STATE_TOKEN, sync.nextBatch);
  await absorbReceipts(client, store, sync.receipts);
  const liveStarts = new Map<string, string>();
  for (let i = 0, len = sync.cursors.length; i < len; i++) {
    const cursor = sync.cursors[i]!;
    if (cursor.prevBatch !== null) liveStarts.set(cursor.roomId, cursor.prevBatch);
  }
  return liveStarts;
}

async function harvestCursors(
  client: MatrixClient,
  store: Stores,
  rooms: readonly string[],
  liveStarts: Map<string, string> | null
): Promise<void> {
  const missing: string[] = [];
  for (let i = 0, len = rooms.length; i < len; i++) {
    const roomId = rooms[i]!;
    if (liveStarts?.has(roomId) === true) continue;
    // eslint-disable-next-line no-await-in-loop
    if ((await store.stateGet(cursorKey(roomId))) === null) missing.push(roomId);
  }
  if (missing.length === 0) return;
  const { data: sync, error } = await tryCatchAsync(() => client.syncSince(undefined));
  if (sync === undefined) {
    console.error('burn cursor harvest failed:', error);
    return;
  }
  for (let i = 0, len = sync.cursors.length; i < len; i++) {
    const cursor = sync.cursors[i]!;
    if (cursor.prevBatch === null || !missing.includes(cursor.roomId)) continue;
    // eslint-disable-next-line no-await-in-loop
    await store.stateSet(cursorKey(cursor.roomId), cursor.prevBatch);
  }
}

async function absorbReceipts(
  client: MatrixClient,
  store: Stores,
  receipts: Array<{ roomId: string, userId: string, eventId: string }>
): Promise<void> {
  const now = new Date().toISOString();
  for (let i = 0, len = receipts.length; i < len; i++) {
    const receipt = receipts[i]!;
    if (receipt.userId === client.userId) continue;
    // eslint-disable-next-line no-await-in-loop
    const event = await client.fetchEvent(receipt.roomId, receipt.eventId);
    const ts = event?.origin_server_ts;
    if (typeof ts !== 'number') continue;
    // eslint-disable-next-line no-await-in-loop
    await store.upsertReadMark(
      {
        roomId: receipt.roomId,
        userId: receipt.userId,
        eventId: receipt.eventId,
        eventTs: ts
      },
      now
    );
  }
}

async function burnRoom(
  client: MatrixClient,
  store: Stores,
  roomId: string,
  liveStart: string | null
): Promise<void> {
  const start = liveStart ?? await store.stateGet(cursorKey(roomId));
  if (start === null) {
    console.error(`burn ${roomId} skipped: no pagination cursor`);
    return;
  }
  if (!(await canRedact(client, roomId))) {
    console.error(`burn ${roomId} skipped: power level below redact threshold`);
    return;
  }
  const members = await roomMembers(client, roomId);
  if (members.length === 0) return;
  const marks = new Map<string, number>();
  const rows = await store.readMarks(roomId);
  let coverage = true;
  for (let i = 0, len = rows.length; i < len; i++) {
    marks.set(rows[i]!.userId, rows[i]!.eventTs);
  }
  for (let i = 0, len = members.length; i < len; i++) {
    if (!marks.has(members[i]!)) coverage = false;
  }
  const result = await scanAndBurn(client, roomId, start, {
    now: Date.now(),
    members,
    marks,
    coverage,
    pinned: new Set(await store.pinnedEventIds(roomId)),
    force: false
  });
  if (result.rejected) {
    console.error(`burn ${roomId} stopped: redaction rejected`);
    return;
  }
  await store.stateSet(cursorKey(roomId), start);
}

async function canRedact(client: MatrixClient, roomId: string): Promise<boolean> {
  const level = await client.powerLevels(roomId);
  const threshold = await client.redactLevel(roomId);
  return level.level(client.userId) >= threshold;
}

async function roomMembers(
  client: MatrixClient,
  roomId: string
): Promise<string[]> {
  const members = await client.members(roomId);
  const others: string[] = [];
  for (let i = 0, len = members.length; i < len; i++) {
    if (members[i] !== client.userId) others.push(members[i]!);
  }
  return others;
}

interface ScanResult {
  burned: number,
  done: boolean,
  rejected: boolean
}

async function scanAndBurn(
  client: MatrixClient,
  roomId: string,
  start: string,
  ctx: BurnContext,
  onProgress?: (burned: number) => Promise<void>,
  deadline?: number
): Promise<ScanResult> {
  const expired = (): boolean => deadline !== undefined && Date.now() > deadline;
  let burned = 0;
  let token = start;
  for (let page = 0; page < MAX_PAGES; page++) {
    if (expired()) return { burned, done: false, rejected: false };
    // eslint-disable-next-line no-await-in-loop
    const batch: MessagesPage = await client.messages(roomId, token, PAGE_LIMIT);
    token = batch.nextToken ?? token;
    let oldest = Number.POSITIVE_INFINITY;
    for (let i = 0, len = batch.events.length; i < len; i++) {
      if (expired()) return { burned, done: false, rejected: false };
      const event = batch.events[i]!;
      if (event.ts < oldest) oldest = event.ts;
      if (!burnable(event, ctx)) continue;
      // eslint-disable-next-line no-await-in-loop
      const ok = await burn(client, roomId, event, ctx.force);
      if (!ok) return { burned, done: false, rejected: true };
      burned++;
    }
    if (onProgress !== undefined) {
      // eslint-disable-next-line no-await-in-loop
      await onProgress(burned);
    }
    if (batch.nextToken === null) return { burned, done: true, rejected: false };
    if (!ctx.force && Date.now() - oldest > SCAN_MAX_MS) {
      return { burned, done: true, rejected: false };
    }
  }
  return { burned, done: false, rejected: false };
}

async function burn(
  client: MatrixClient,
  roomId: string,
  event: RoomEvent,
  force: boolean
): Promise<boolean> {
  const { error } = await tryCatchAsync(
    () => client.redact(roomId, event.eventId, force ? FORCE_REASON : BURN_REASON)
  );
  if (error !== undefined) {
    console.error(`burn ${roomId} ${event.eventId} failed:`, error);
    return false;
  }
  await deleteLocalMedia(
    client,
    extractLocalMedia(event.content, client.serverName),
    `burn ${roomId} ${event.eventId}`
  );
  return true;
}
