import { tryCatchAsync } from '@moeru/std/try-catch';
import type { Stores } from '../../domain/ports.ts';
import { extractLocalMedia, mxcString, parseMxcUrl } from '../../domain/value.ts';
import type { MxcUrl } from '../../domain/value.ts';
import type { MatrixClient } from '../matrix/client.ts';

export function redactionTarget(
  content: Record<string, unknown>,
  redacts: unknown
): string | null {
  if (typeof content.redacts === 'string' && content.redacts !== '') {
    return content.redacts;
  }
  return typeof redacts === 'string' && redacts !== '' ? redacts : null;
}

export async function recordMediaRefs(
  client: MatrixClient,
  store: Stores,
  roomId: string,
  eventId: string,
  content: Record<string, unknown>
): Promise<void> {
  const refs = extractLocalMedia(content, client.serverName);
  if (refs.length === 0) return;
  await store.saveMediaRef({
    roomId,
    eventId,
    urls: refs.map(mxcString),
    ts: new Date().toISOString()
  });
}

export async function deleteLocalMedia(
  client: MatrixClient,
  refs: readonly MxcUrl[],
  logPrefix: string
): Promise<void> {
  for (let i = 0, len = refs.length; i < len; i++) {
    const ref = refs[i]!;
    // eslint-disable-next-line no-await-in-loop
    const { error } = await tryCatchAsync(
      () => client.deleteMedia(ref.serverName, ref.mediaId)
    );
    if (error !== undefined) {
      console.error(`${logPrefix} media ${ref.mediaId} failed:`, error);
    }
  }
}

export async function handleRedaction(
  client: MatrixClient,
  store: Stores,
  roomId: string,
  redactedEventId: string
): Promise<void> {
  const { data: urls, error } = await tryCatchAsync(
    () => store.mediaRefUrls(roomId, redactedEventId)
  );
  if (error !== undefined) {
    console.error(`redaction index ${roomId} ${redactedEventId} failed:`, error);
  }
  if (urls !== null && urls !== undefined) {
    const refs: MxcUrl[] = [];
    for (let i = 0, len = urls.length; i < len; i++) {
      const parsed = parseMxcUrl(urls[i]);
      if (parsed !== null) refs.push(parsed);
    }
    await deleteLocalMedia(client, refs, 'redaction');
  }
  const removed = await tryCatchAsync(() => store.remove(roomId, redactedEventId));
  if (removed.error !== undefined) {
    console.error(`redaction pin ${roomId} ${redactedEventId} failed:`, removed.error);
  }
  const dropped = await tryCatchAsync(() => store.dropMediaRef(roomId, redactedEventId));
  if (dropped.error !== undefined) {
    console.error(`redaction index drop ${roomId} ${redactedEventId} failed:`, dropped.error);
  }
}
