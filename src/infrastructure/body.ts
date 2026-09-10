import { tryCatchAsync } from '@moeru/std/try-catch';

export async function readBodyCapped(
  body: ReadableStream<Uint8Array> | null,
  declaredLength: string | null,
  maxBytes: number
): Promise<string | null> {
  const declared = Number(declaredLength ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (body === null) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      // eslint-disable-next-line no-await-in-loop
      await tryCatchAsync(() => reader.cancel());
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (let i = 0, len = chunks.length; i < len; i++) {
    merged.set(chunks[i]!, offset);
    offset += chunks[i]!.byteLength;
  }
  return new TextDecoder().decode(merged);
}
