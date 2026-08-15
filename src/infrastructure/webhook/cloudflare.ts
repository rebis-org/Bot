import { bold, code, fmt, FormattedString, link } from '@grammyjs/parse-mode';
import * as v from 'valibot';
import type { BindingStore } from '../../domain/ports.ts';
import { kv, prettify, timeText } from '../../display/format.ts';
import { parseThreadId } from '../../domain/value.ts';
import { constantTimeEqual } from './webhook.ts';
import type { ParseResult, WebhookChannel } from './webhook.ts';

const cfSchema = v.object({
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
    const payload = result.output;
    return {
      formatted: cloudflareText(payload),
      bindingKey: payload.account_id,
      dedupId: payload.alert_correlation_id,
      label: payload.alert_type ?? payload.alert_event ?? 'cloudflare'
    };
  },
  chatsFor: (store: BindingStore, bindingKey: string) => store.chats('cf', bindingKey),
  threadId: (env) => parseThreadId(env.CF_THREAD_ID)
};

export { CLOUDFLARE_CHANNEL };

function cloudflareText(
  payload: v.InferOutput<typeof cfSchema>
): FormattedString | null {
  const account = payload.account_id;
  if (!account) return null;
  const url = `https://dash.cloudflare.com/${account}`;
  const alert = payload.alert_type ? prettify(payload.alert_type) : 'notification';
  return FormattedString.join(
    [
      fmt`${bold}Cloudflare ${code}${alert}${code}${bold}`,
      '',
      kv('Account', fmt`${link(url)}${account}${link(url)}`),
      kv('Policy', payload.policy_name ?? payload.policy_id),
      kv(
        'Time',
        payload.ts === undefined
          ? undefined
          : timeText(new Date(payload.ts * 1000).toISOString())
      )
    ],
    '\n'
  );
}
