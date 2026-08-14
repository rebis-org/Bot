import { bold, code, fmt } from '@grammyjs/parse-mode';
import type { FormattedString } from '@grammyjs/parse-mode';
import { setBit } from 'foxts/bitwise';
import type { Bot } from 'grammy';
import * as v from 'valibot';
import type { Ctx } from './kernel.ts';
import type { Store } from './store.ts';
import { receiveWebhook } from './webhook.ts';
import type { ParseResult, WebhookChannel } from './webhook.ts';

const MAX_BODY = 300;

const cfSchema = v.object({
  name: v.optional(v.string()),
  text: v.optional(v.string()),
  data: v.optional(v.record(v.string(), v.unknown())),
  ts: v.optional(v.number()),
  account_id: v.optional(v.string()),
  policy_id: v.optional(v.string()),
  policy_name: v.optional(v.string()),
  alert_type: v.optional(v.string()),
  alert_correlation_id: v.optional(v.string()),
  alert_event: v.optional(v.string())
});

const CLOUDFLARE_CHANNEL: WebhookChannel = {
  secret: (env) => env.CF_WEBHOOK_SECRET,
  verify(request, _raw, secret) {
    const auth = request.headers.get('cf-webhook-auth');
    if (!auth || !constantTimeEqual(auth, secret)) {
      return { status: 401, body: 'invalid cf-webhook-auth header' };
    }
    return 'ok';
  },
  parse(_request, value): ParseResult {
    const result = v.safeParse(cfSchema, value);
    if (!result.success) return { error: result.issues[0].message };
    const p = result.output;
    return {
      formatted: cloudflareText(p),
      key: p.account_id,
      dedupId: p.alert_correlation_id,
      label: p.alert_type ?? p.alert_event ?? 'cloudflare'
    };
  },
  chatsFor: (store: Store, accountId: string) => store.chatsFor('cf', accountId)
};

export function handleCloudflareWebhook(
  request: Request,
  env: Env,
  bot: Bot<Ctx>
): Promise<Response> {
  return receiveWebhook(request, env, bot, CLOUDFLARE_CHANNEL);
}

function cloudflareText(
  p: v.InferOutput<typeof cfSchema>
): FormattedString | null {
  const text = p.text?.trim();
  if (!text) return null;
  return fmt`${bold}Cloudflare ${code}${p.alert_type ?? 'notification'}${code}${bold}\n${truncate(text)}`;
}

function truncate(s: string, max = MAX_BODY): string {
  const trimmed = s.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0, len = a.length; i < len; i++) {
    if (a.charCodeAt(i) !== b.charCodeAt(i)) diff = setBit(diff, 0);
  }
  return diff === 0;
}
