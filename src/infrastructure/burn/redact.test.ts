import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixClient } from '../matrix/client.ts';
import { makeTestStore } from '../db/fake-d1.ts';
import { PinDraft } from '../../domain/pin.ts';
import { handleRedaction, recordMediaRefs, redactionTarget } from './redact.ts';

const ROOM = '!room:hs.test';
const ALICE = '@alice:hs.test';
const NOW = new Date().toISOString();

function makeClient(): MatrixClient {
  return MatrixClient.connect({
    baseUrl: 'https://hs.test',
    accessToken: 'token',
    userId: '@bot:hs.test'
  });
}

function draftPin(eventId: string) {
  return PinDraft.create({
    roomId: ROOM,
    eventId,
    userId: ALICE,
    senderName: ALICE,
    contentType: 'text',
    content: 'pinned message',
    formatted: null,
    mediaUrl: null,
    pinnedAt: NOW
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('redactionTarget', () => {
  it('prefers content.redacts over the top-level field', () => {
    expect(redactionTarget({ redacts: '$a' }, '$b')).toBe('$a');
  });

  it('falls back to the top-level redacts field', () => {
    expect(redactionTarget({}, '$b')).toBe('$b');
  });

  it.each([
    [{ redacts: 42 }, null],
    [{ redacts: '' }, ''],
    [{}, undefined],
    [{}, null],
    [{}, 42]
  ])('rejects %o with %s', (content, redacts) => {
    expect(redactionTarget(content, redacts)).toBeNull();
  });
});

describe('recordMediaRefs', () => {
  it('stores local mxc urls of media messages', async () => {
    const store = makeTestStore();
    await recordMediaRefs(makeClient(), store, ROOM, '$evt1', {
      msgtype: 'm.image',
      url: 'mxc://hs.test/a1',
      info: { thumbnail_url: 'mxc://hs.test/t1' }
    });
    expect(await store.mediaRefUrls(ROOM, '$evt1'))
      .toEqual(['mxc://hs.test/a1', 'mxc://hs.test/t1']);
  });

  it('is a no-op for text and remote-only media', async () => {
    const store = makeTestStore();
    await recordMediaRefs(makeClient(), store, ROOM, '$evt1', {
      msgtype: 'm.text',
      body: 'hello'
    });
    await recordMediaRefs(makeClient(), store, ROOM, '$evt2', {
      msgtype: 'm.image',
      url: 'mxc://remote.test/a1'
    });
    expect(await store.mediaRefUrls(ROOM, '$evt1')).toBeNull();
    expect(await store.mediaRefUrls(ROOM, '$evt2')).toBeNull();
  });
});

describe('handleRedaction', () => {
  it('deletes indexed media, the pin row, and the index row', async () => {
    const store = makeTestStore();
    await store.saveMediaRef({
      roomId: ROOM,
      eventId: '$evt1',
      urls: ['mxc://hs.test/a1', 'mxc://hs.test/t1'],
      ts: NOW
    });
    await store.upsert(draftPin('$evt1'));
    const fetchMock = vi.fn().mockImplementation(
      () => Promise.resolve(new Response('{}', { status: 200 }))
    );
    vi.stubGlobal('fetch', fetchMock);
    await handleRedaction(makeClient(), store, ROOM, '$evt1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]![0])
      .toBe('https://hs.test/_matrix/media/v3/delete/hs.test/a1');
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'DELETE' });
    expect(fetchMock.mock.calls[1]![0])
      .toBe('https://hs.test/_matrix/media/v3/delete/hs.test/t1');
    expect(await store.get(ROOM, '$evt1')).toBeUndefined();
    expect(await store.mediaRefUrls(ROOM, '$evt1')).toBeNull();
  });

  it('swallows media deletion failures and still cleans up', async () => {
    const store = makeTestStore();
    await store.saveMediaRef({
      roomId: ROOM,
      eventId: '$evt1',
      urls: ['mxc://hs.test/a1'],
      ts: NOW
    });
    await store.upsert(draftPin('$evt1'));
    const fetchMock = vi.fn().mockRejectedValue(new Error('404 not found'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(handleRedaction(makeClient(), store, ROOM, '$evt1'))
      .resolves
      .toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await store.get(ROOM, '$evt1')).toBeUndefined();
    expect(await store.mediaRefUrls(ROOM, '$evt1')).toBeNull();
  });

  it('ignores events without an index row', async () => {
    const store = makeTestStore();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(handleRedaction(makeClient(), store, ROOM, '$missing'))
      .resolves
      .toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
