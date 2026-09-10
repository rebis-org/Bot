import { describe, expect, it } from 'vitest';
import { makeTestStore } from './fake-d1.ts';
import { PinDraft } from '../../domain/pin.ts';
import { CheckInDraft } from '../../domain/work.ts';

const ROOM = '!room:server.test';
const ALICE = '@alice:server.test';
const NOW = new Date().toISOString();
const OLD = new Date(Date.now() - 91 * 86_400_000).toISOString();
const SINCE = '2000-01-01T00:00:00.000Z';

function draftPin(eventId: string, content: string) {
  return PinDraft.create({
    roomId: ROOM,
    eventId,
    userId: ALICE,
    senderName: ALICE,
    contentType: 'text',
    content,
    formatted: null,
    mediaUrl: null,
    pinnedAt: NOW
  });
}

describe('pin hard delete', () => {
  it('deletes the row and drops the FTS match', async () => {
    const store = makeTestStore();
    await store.upsert(draftPin('$evt1', 'hello world'));
    expect(await store.list(ROOM)).toHaveLength(1);
    expect(await store.search(ROOM, 'hello', 5)).toHaveLength(1);
    expect(await store.remove(ROOM, '$evt1')).toBe(true);
    expect(await store.list(ROOM)).toHaveLength(0);
    expect(await store.get(ROOM, '$evt1')).toBeUndefined();
    expect(await store.search(ROOM, 'hello', 5)).toHaveLength(0);
    expect(await store.remove(ROOM, '$evt1')).toBe(false);
  });

  it('allows re-pinning a deleted event', async () => {
    const store = makeTestStore();
    await store.upsert(draftPin('$evt1', 'first version'));
    expect(await store.remove(ROOM, '$evt1')).toBe(true);
    await store.upsert(draftPin('$evt1', 'second version'));
    const rows = await store.search(ROOM, 'second', 5);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.content).toBe('second version');
    expect(await store.search(ROOM, 'first', 5)).toHaveLength(0);
  });

  it('lists pinned event ids per room', async () => {
    const store = makeTestStore();
    await store.upsert(draftPin('$evt1', 'one'));
    await store.upsert(draftPin('$evt2', 'two'));
    const pinned = await store.pinnedEventIds(ROOM);
    expect(pinned).toHaveLength(2);
    expect(pinned).toContain('$evt1');
    expect(pinned).toContain('$evt2');
    expect(await store.pinnedEventIds('!other:server.test')).toHaveLength(0);
    await store.remove(ROOM, '$evt1');
    expect(await store.pinnedEventIds(ROOM)).toEqual(['$evt2']);
  });
});

describe('media refs', () => {
  it('saves, reads, and upserts urls per room and event', async () => {
    const store = makeTestStore();
    await store.saveMediaRef({
      roomId: ROOM,
      eventId: '$evt1',
      urls: ['mxc://server.test/a1'],
      ts: NOW
    });
    expect(await store.mediaRefUrls(ROOM, '$evt1'))
      .toEqual(['mxc://server.test/a1']);
    await store.saveMediaRef({
      roomId: ROOM,
      eventId: '$evt1',
      urls: ['mxc://server.test/b1', 'mxc://server.test/b2'],
      ts: NOW
    });
    expect(await store.mediaRefUrls(ROOM, '$evt1'))
      .toEqual(['mxc://server.test/b1', 'mxc://server.test/b2']);
    expect(await store.mediaRefUrls(ROOM, '$evt2')).toBeNull();
    expect(await store.mediaRefUrls('!other:server.test', '$evt1')).toBeNull();
  });

  it('drops media refs', async () => {
    const store = makeTestStore();
    await store.saveMediaRef({
      roomId: ROOM,
      eventId: '$evt1',
      urls: ['mxc://server.test/a1'],
      ts: NOW
    });
    await store.dropMediaRef(ROOM, '$evt1');
    expect(await store.mediaRefUrls(ROOM, '$evt1')).toBeNull();
  });

  it('purges media refs older than 7 days', async () => {
    const store = makeTestStore();
    await store.saveMediaRef({
      roomId: ROOM,
      eventId: '$old',
      urls: ['mxc://server.test/old'],
      ts: OLD
    });
    await store.saveMediaRef({
      roomId: ROOM,
      eventId: '$new',
      urls: ['mxc://server.test/new'],
      ts: NOW
    });
    await store.purge();
    expect(await store.mediaRefUrls(ROOM, '$old')).toBeNull();
    expect(await store.mediaRefUrls(ROOM, '$new'))
      .toEqual(['mxc://server.test/new']);
  });
});

describe('purge', () => {
  it('hard-deletes works older than 90 days and keeps recent rows', async () => {
    const store = makeTestStore();
    await store.checkIn(CheckInDraft.create({
      roomId: ROOM,
      userId: '@old:server.test',
      name: '@old:server.test',
      clockInAt: OLD
    }));
    await store.checkIn(CheckInDraft.create({
      roomId: ROOM,
      userId: '@new:server.test',
      name: '@new:server.test',
      clockInAt: NOW
    }));
    await store.purge();
    const rows = await store.sessions(ROOM, undefined, SINCE);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe('@new:server.test');
  });

  it('drops aged deliveries, transactions, and polls', async () => {
    const store = makeTestStore();
    await store.record('delivery-old', OLD);
    await store.record('delivery-new', NOW);
    await store.recordTransaction('txn-old', OLD);
    await store.recordTransaction('txn-new', NOW);
    await store.pollCreate(ROOM, '$poll', 'question', ['a', 'b'], OLD);
    await store.purge();
    const deliveries = await store.deliveries(10);
    expect(deliveries.map((row) => row.deliveryId)).toEqual(['delivery-new']);
    expect(await store.recordTransaction('txn-new', NOW)).toBe(false);
    expect(await store.recordTransaction('txn-old', NOW)).toBe(true);
    expect(await store.pollVote(ROOM, '$poll', 0, ALICE)).toBeNull();
  });
});
