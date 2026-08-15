import { extractErrorMessage } from 'foxts/extract-error-message';
import { setBit } from 'foxts/bitwise';
import type { FormattedString } from '@grammyjs/parse-mode';
import type { Bot, Context } from 'grammy';
import type { BindingStore, DeliveryStore } from '../../domain/ports.ts';
import { parseGroupChatId } from '../../domain/value.ts';

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0, len = a.length; i < len; i++) {
    if (a.charCodeAt(i) !== b.charCodeAt(i)) diff = setBit(diff, 0);
  }
  return diff === 0;
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
  const expected = 'sha256=' + Array.from(
    new Uint8Array(mac),
    (b) => b.toString(16).padStart(2, '0')
  ).join('');
  return constantTimeEqual(expected, signature);
}

export interface ParsedWebhook {
  formatted: FormattedString | null,
  bindingKey: string | undefined,
  dedupId: string | undefined,
  label: string
}

export type ParseResult =
  | ParsedWebhook
  | { error: string }
  | { unhandled: string };

export type VerifyResult =
  | 'ok'
  | { status: number, body: string };

export interface WebhookChannel {
  secret(env: Env): string | undefined,
  verify(
    request: Request,
    raw: string,
    secret: string
  ): VerifyResult | Promise<VerifyResult>,
  parse(request: Request, value: unknown): ParseResult,
  chatsFor(store: BindingStore, bindingKey: string): Promise<number[]>,
  threadId?(env: Env): number | undefined
}

export interface WebhookStores {
  binding: BindingStore,
  delivery: DeliveryStore
}

export function webhookHandler(
  channel: WebhookChannel,
  stores: WebhookStores
) {
  return <T extends Context>(
    request: Request,
    env: Env,
    bot: Bot<T>
  ): Promise<Response> => receiveWebhook(request, env, bot, channel, stores);
}

export async function receiveWebhook<T extends Context>(
  request: Request,
  env: Env,
  bot: Bot<T>,
  channel: WebhookChannel,
  stores: WebhookStores
): Promise<Response> {
  const secret = channel.secret(env);
  if (!secret) return respond('webhook secret is not configured', 500);
  if (request.method !== 'POST') return respond('method not allowed', 405);

  const raw = await request.text();
  const check = await channel.verify(request, raw, secret);
  if (check !== 'ok') return respond(check.body, check.status);

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return respond('invalid JSON body', 400);
  }

  const parsed = channel.parse(request, value);
  if ('unhandled' in parsed) return respond(`unhandled event: ${parsed.unhandled}`, 200);
  if ('error' in parsed) return respond(`invalid payload: ${parsed.error}`, 400);

  const { formatted, bindingKey, dedupId, label } = parsed;
  if (!formatted || !bindingKey) return respond(`unhandled event: ${label}`, 200);

  const at = new Date().toISOString();
  if (dedupId && !(await stores.delivery.record(dedupId, at))) {
    return respond('duplicate delivery', 200);
  }

  try {
    const groupChatId = parseGroupChatId(env.GROUP_CHAT_ID);
    const chats = (await channel.chatsFor(stores.binding, bindingKey))
      .filter((chatId) => chatId === groupChatId);
    if (chats.length === 0) {
      return respond(`no chats bound for ${bindingKey}`, 200);
    }
    const threadId = channel.threadId?.(env);
    await Promise.all(chats.map(async (chatId) => {
      await bot.api.sendMessage(chatId, formatted.text, {
        entities: formatted.entities,
        message_thread_id: threadId
      });
    }));
    return respond('ok', 200);
  } catch (err) {
    console.error('webhook forward failed:', describeError(err));
    if (dedupId) await stores.delivery.drop(dedupId);
    return respond('failed to forward delivery', 500);
  }
}

function describeError(err: unknown): string {
  return extractErrorMessage(err) ?? 'unknown error';
}

function respond(body: string, status: number): Response {
  return new Response(body, { status });
}
