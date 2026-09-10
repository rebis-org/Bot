import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import type { Result } from '@moeru/results';
import { isErr } from '@moeru/results/result';
import { tryCatch, tryCatchAsync } from '@moeru/std/try-catch';
import { extractErrorMessage } from 'foxts/extract-error-message';
import type { Doc } from '../../display/html.ts';
import type { BindingStore, DeliveryStore } from '../../domain/ports.ts';
import { readBodyCapped } from '../body.ts';
import type { MatrixClient } from '../matrix/client.ts';

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
  return Buffer.from(digest).toString('hex');
}

export async function secretEqual(a: string, b: string): Promise<boolean> {
  const [hashA, hashB] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  return constantTimeEqual(hashA, hashB);
}

const MAX_WEBHOOK_BODY_BYTES = 1_000_000;

export async function readRequestText(
  request: Request,
  maxBytes: number
): Promise<string | null> {
  return readBodyCapped(
    request.body,
    request.headers.get('content-length'),
    maxBytes
  );
}

export async function verifySignature(
  raw: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(raw)
  );
  const expected = `sha256=${Buffer.from(mac).toString('hex')}`;
  return constantTimeEqual(expected, signature);
}

export interface ParsedWebhook {
  formatted: Doc | null,
  bindingKey: string | undefined,
  dedupId: string | undefined,
  label: string
}

export type ParseFailure = { unhandled: string } | { error: string };

export type ParseResult = Result<ParsedWebhook, ParseFailure>;

export interface VerifyFailure { status: number, body: string }

export type VerifyResult = Result<true, VerifyFailure>;

export interface WebhookChannel {
  secret(env: Env): string | undefined,
  verify(
    request: Request,
    raw: string,
    secret: string
  ): VerifyResult | Promise<VerifyResult>,
  parse(request: Request, value: unknown): ParseResult,
  chatsFor(store: BindingStore, bindingKey: string): Promise<string[]>
}

export interface WebhookStores {
  binding: BindingStore,
  delivery: DeliveryStore
}

export async function receiveWebhook(
  request: Request,
  env: Env,
  client: MatrixClient,
  channel: WebhookChannel,
  stores: WebhookStores
): Promise<Response> {
  const secret = channel.secret(env);
  if (!secret) return respond('webhook secret is not configured', 500);
  if (request.method !== 'POST') return respond('method not allowed', 405);

  const raw = await readRequestText(request, MAX_WEBHOOK_BODY_BYTES);
  if (raw === null) return respond('payload too large', 413);
  const check = await channel.verify(request, raw, secret);
  if (isErr(check)) {
    console.warn(`webhook verification failed: ${String(check.error.status)}`);
    return respond(check.error.body, check.error.status);
  }

  const { data: value, error } = tryCatch(() => JSON.parse(raw) as unknown);
  if (error !== undefined) {
    return respond('invalid JSON body', 400);
  }

  const parsed = channel.parse(request, value);
  if (isErr(parsed)) {
    if ('unhandled' in parsed.error) {
      return respond(`unhandled event: ${parsed.error.unhandled}`, 200);
    }
    return respond(`invalid payload: ${parsed.error.error}`, 400);
  }
  const { formatted, bindingKey, dedupId, label } = parsed.value;
  if (!formatted || !bindingKey) return respond(`unhandled event: ${label}`, 200);

  const at = new Date().toISOString();
  if (dedupId && !(await stores.delivery.record(dedupId, at))) {
    return respond('duplicate delivery', 200);
  }

  const forward = await tryCatchAsync(async () => {
    const rooms = await channel.chatsFor(stores.binding, bindingKey);
    if (rooms.length === 0) return null;
    await Promise.all(rooms.map(async (roomId) => {
      await client.sendHtml(roomId, formatted.body, formatted.html);
    }));
    return true;
  });
  if (forward.error !== undefined) {
    const detail = extractErrorMessage(forward.error) ?? 'unknown error';
    console.error(`webhook forward failed: ${detail}`);
    if (dedupId) {
      const dropped = await tryCatchAsync(() => stores.delivery.drop(dedupId));
      if (dropped.error !== undefined) console.error(dropped.error);
    }
    return respond('failed to forward delivery', 500);
  }
  if (forward.data === null) return respond(`no rooms bound for ${bindingKey}`, 200);
  return respond('ok', 200);
}

function respond(body: string, status: number): Response {
  return new Response(body, { status });
}
