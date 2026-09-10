import { afterEach, describe, expect, it, vi } from 'vitest';
import { asyncNoop } from 'foxts/noop';
import { MatrixClient } from '../matrix/client.ts';
import type { RoomEvent } from '../matrix/client.ts';
import { makeTestStore } from '../db/fake-d1.ts';
import { burnable, burnForce, burnRead } from './burn.ts';
import type { BurnContext } from './burn.ts';

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

const ALICE = '@alice:hs.test';
const BOB = '@bob:hs.test';

function event(overrides: Partial<RoomEvent> = {}): RoomEvent {
  return {
    eventId: '$evt',
    type: 'm.room.message',
    sender: ALICE,
    ts: NOW - 25 * HOUR,
    content: { msgtype: 'm.text', body: 'hello' },
    redacted: false,
    ...overrides
  };
}

function ctx(overrides: Partial<BurnContext> = {}): BurnContext {
  return {
    now: NOW,
    members: [ALICE, BOB],
    marks: new Map([[ALICE, NOW - 20 * HOUR], [BOB, NOW - 20 * HOUR]]),
    coverage: true,
    pinned: new Set(),
    force: false,
    ...overrides
  };
}

describe('burnable', () => {
  it('burns a 25-hour-old message every member has read', () => {
    expect(burnable(event(), ctx())).toBe(true);
  });

  it('keeps messages younger than 24 hours', () => {
    expect(burnable(event({ ts: NOW - 23 * HOUR }), ctx())).toBe(false);
  });

  it('keeps messages older than the 7-day scan window', () => {
    expect(burnable(event({ ts: NOW - 8 * 24 * HOUR }), ctx())).toBe(false);
  });

  it('keeps unread messages when coverage is partial until 48 hours', () => {
    const noCoverage = ctx({ coverage: false, marks: new Map() });
    expect(burnable(event(), noCoverage)).toBe(false);
    expect(burnable(event({ ts: NOW - 49 * HOUR }), noCoverage)).toBe(true);
  });

  it('keeps a message when any member has no read mark', () => {
    const marks = new Map([[ALICE, NOW - 20 * HOUR]]);
    expect(burnable(event(), ctx({ marks, coverage: false }))).toBe(false);
  });

  it('keeps a message when a member read only up to an older event', () => {
    const marks = new Map([[ALICE, NOW - 20 * HOUR], [BOB, NOW - 30 * HOUR]]);
    expect(burnable(event(), ctx({ marks }))).toBe(false);
  });

  it('never burns pinned, redacted, or non-message events', () => {
    const pinned = ctx({ pinned: new Set(['$evt']), force: true });
    expect(burnable(event(), pinned)).toBe(false);
    expect(burnable(event({ redacted: true }), ctx({ force: true }))).toBe(false);
    expect(burnable(event({ type: 'm.room.member' }), ctx({ force: true }))).toBe(false);
  });

  it('force burns regardless of age and read state', () => {
    const force = ctx({ force: true, coverage: false, marks: new Map() });
    expect(burnable(event({ ts: NOW - 60000 }), force)).toBe(true);
    expect(burnable(event({ ts: NOW - 30 * 24 * HOUR }), force)).toBe(true);
  });
});

const BOT = '@bot:hs.test';
const ROOM = '!room:hs.test';
const CURSOR_KEY = `burn_cursor:${ROOM}`;

function makeClient(): MatrixClient {
  return MatrixClient.connect({
    baseUrl: 'https://hs.test',
    accessToken: 'token',
    userId: BOT
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function messageEvent(eventId: string, ts: number): Record<string, unknown> {
  return {
    event_id: eventId,
    type: 'm.room.message',
    sender: ALICE,
    origin_server_ts: ts,
    content: { msgtype: 'm.text', body: 'hello' }
  };
}

function syncResponse(
  join: Record<string, { prev_batch?: string }>,
  nextBatch: string
): Record<string, unknown> {
  const rooms: Record<string, unknown> = {};
  const ids = Object.keys(join);
  for (let i = 0, len = ids.length; i < len; i++) {
    rooms[ids[i]!] = { timeline: { prev_batch: join[ids[i]!]!.prev_batch } };
  }
  return { next_batch: nextBatch, rooms: { join: rooms } };
}

interface BurnFetchLog {
  syncCalls: number,
  messagesFrom: string[],
  redacted: string[]
}

function stubBurnFetch(
  syncReplies: Array<Response | (() => Response)>,
  messagesChunk: Array<Record<string, unknown>>,
  membersChunk: Array<Record<string, unknown>> = []
): BurnFetchLog {
  const log: BurnFetchLog = { syncCalls: 0, messagesFrom: [], redacted: [] };
  const fetchMock = vi.fn().mockImplementation(
    (url: string, init?: { method?: string }) => {
      if (url.includes('/sync?')) {
        const reply = syncReplies[Math.min(log.syncCalls, syncReplies.length - 1)]!;
        log.syncCalls++;
        return Promise.resolve(typeof reply === 'function' ? reply() : reply.clone());
      }
      if (url.includes('/state/m.room.power_levels')) {
        return Promise.resolve(jsonResponse({ users: { [BOT]: 100 } }));
      }
      if (url.includes('/members')) {
        return Promise.resolve(jsonResponse({ chunk: membersChunk }));
      }
      if (url.includes('/messages?')) {
        log.messagesFrom.push(new URL(url).searchParams.get('from') ?? '');
        return Promise.resolve(jsonResponse({ chunk: messagesChunk, end: null }));
      }
      if (init?.method === 'PUT' && url.includes('/redact/')) {
        log.redacted.push(url);
        return Promise.resolve(jsonResponse({}));
      }
      return Promise.resolve(jsonResponse({}, 404));
    }
  );
  vi.stubGlobal('fetch', fetchMock);
  return log;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('burnForce resilience', () => {
  it('falls back to the stored cursor when the sync fails', { timeout: 20000 }, async () => {
    const store = makeTestStore();
    await store.stateSet(CURSOR_KEY, 'stored-tok');
    const log = stubBurnFetch(
      [() => jsonResponse('error code: 523', 523)],
      [messageEvent('$m1', NOW - 60000)]
    );
    const result = await burnForce(makeClient(), store, ROOM, asyncNoop);
    expect(result).toEqual({ burned: 1, done: true });
    expect(log.syncCalls).toBe(4);
    expect(log.messagesFrom).toEqual(['stored-tok']);
    expect(log.redacted).toHaveLength(1);
  });

  it('harvests a cursor from a full sync for a quiet room', async () => {
    const store = makeTestStore();
    const log = stubBurnFetch(
      [
        jsonResponse(syncResponse({}, 'nb1')),
        jsonResponse(syncResponse({ [ROOM]: { prev_batch: 'live-tok' } }, 'nb2'))
      ],
      [messageEvent('$m1', NOW - 60000)]
    );
    const result = await burnForce(makeClient(), store, ROOM, asyncNoop);
    expect(result).toEqual({ burned: 1, done: true });
    expect(log.syncCalls).toBe(2);
    expect(log.messagesFrom).toEqual(['live-tok']);
    expect(await store.stateGet(CURSOR_KEY)).toBe('live-tok');
  });

  it('still fails when no cursor exists anywhere', async () => {
    const store = makeTestStore();
    stubBurnFetch([jsonResponse(syncResponse({}, 'nb1'))], []);
    await expect(burnForce(makeClient(), store, ROOM, asyncNoop))
      .rejects
      .toThrow('This room has no pagination cursor');
  });
});

describe('burnRead resilience', () => {
  it('continues with stored cursors when the sync fails', { timeout: 20000 }, async () => {
    const store = makeTestStore();
    await store.burnEnable(ROOM, new Date().toISOString());
    await store.stateSet(CURSOR_KEY, 'stored-tok');
    const log = stubBurnFetch(
      [() => jsonResponse('error code: 523', 523)],
      [messageEvent('$m1', NOW - 25 * HOUR)],
      [{ type: 'm.room.member', state_key: ALICE, content: { membership: 'join' } }]
    );
    await expect(burnRead(makeClient(), store)).resolves.toBeUndefined();
    expect(log.syncCalls).toBe(4);
    expect(log.messagesFrom).toEqual(['stored-tok']);
    expect(log.redacted).toHaveLength(0);
  });

  it('skips the harvest sync when every room has a cursor', async () => {
    const store = makeTestStore();
    await store.burnEnable(ROOM, new Date().toISOString());
    const log = stubBurnFetch(
      [jsonResponse(syncResponse({ [ROOM]: { prev_batch: 'live-tok' } }, 'nb1'))],
      []
    );
    await burnRead(makeClient(), store);
    expect(log.syncCalls).toBe(1);
    expect(log.messagesFrom).toHaveLength(0);
  });
});

describe('sync retry policy', () => {
  it('bails on permanent 4xx sync failures without retrying', async () => {
    const store = makeTestStore();
    await store.stateSet(CURSOR_KEY, 'stored-tok');
    const log = stubBurnFetch(
      [() => jsonResponse({ errcode: 'M_UNKNOWN' }, 400)],
      [messageEvent('$m1', NOW - 60000)]
    );
    const result = await burnForce(makeClient(), store, ROOM, asyncNoop);
    expect(result).toEqual({ burned: 1, done: true });
    expect(log.syncCalls).toBe(1);
    expect(log.messagesFrom).toEqual(['stored-tok']);
  });

  it('retries 5xx sync failures until success', async () => {
    const store = makeTestStore();
    const log = stubBurnFetch(
      [
        () => jsonResponse('error code: 523', 523),
        jsonResponse(syncResponse({ [ROOM]: { prev_batch: 'live-tok' } }, 'nb1'))
      ],
      [messageEvent('$m1', NOW - 60000)]
    );
    const result = await burnForce(makeClient(), store, ROOM, asyncNoop);
    expect(result).toEqual({ burned: 1, done: true });
    expect(log.syncCalls).toBe(2);
    expect(log.messagesFrom).toEqual(['live-tok']);
  });
});

describe('burnForce time budget', () => {
  it('stops at the deadline and reports the run as incomplete', async () => {
    const store = makeTestStore();
    const log = stubBurnFetch(
      [jsonResponse(syncResponse({ [ROOM]: { prev_batch: 'live-tok' } }, 'nb1'))],
      [messageEvent('$m1', NOW - 60000)]
    );
    const result = await burnForce(makeClient(), store, ROOM, asyncNoop, -1);
    expect(result).toEqual({ burned: 0, done: false });
    expect(log.messagesFrom).toHaveLength(0);
    expect(log.redacted).toHaveLength(0);
  });
});
