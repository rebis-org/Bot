import type { FormattedString } from '@grammyjs/parse-mode';
import type { Bot } from 'grammy';
import type { Ctx } from './kernel.ts';
import { Store } from './store.ts';

export interface ParsedWebhook {
  formatted: FormattedString | null,
  key: string | undefined,
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
  chatsFor(store: Store, key: string): Promise<number[]>
}

export async function receiveWebhook(
  request: Request,
  env: Env,
  bot: Bot<Ctx>,
  channel: WebhookChannel
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

  const { formatted, key, dedupId, label } = parsed;
  if (!formatted || !key) return respond(`unhandled event: ${label}`, 200);

  const store = new Store(env.DB);
  const at = new Date().toISOString();
  if (dedupId && !(await store.recordDelivery(dedupId, at))) {
    return respond('duplicate delivery', 200);
  }

  try {
    const chats = await channel.chatsFor(store, key);
    if (chats.length === 0) return respond(`no chats bound for ${key}`, 200);
    await Promise.all(chats.map((chatId) => bot.api.sendMessage(
      chatId,
      formatted.text,
      {
        entities: formatted.entities
      }
    )));
    return respond('ok', 200);
  } catch (err) {
    console.error('webhook forward failed:', err);
    if (dedupId) await store.dropDelivery(dedupId);
    return respond('failed to forward delivery', 500);
  }
}

function respond(body: string, status: number): Response {
  return new Response(body, { status });
}
