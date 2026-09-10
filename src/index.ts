import { tryCatchAsync } from '@moeru/std/try-catch';
import type { App } from './app.ts';
import { build } from './app.ts';
import { attempt } from './attempt.ts';
import { secretEqual } from './infrastructure/webhook/webhook.ts';
import type { InboundEvent } from './interface/kernel.ts';
import { platforms } from './infrastructure/webhook/platforms.ts';

declare global {
  interface Env {
    AS_TOKEN: string,
    HS_TOKEN: string,
    HS_BYPASS?: string,
    GH_WEBHOOK_SECRET: string,
    GH_ORG: string,
    LOG_ROOM_ID?: string,
    BIND_ROOM_IDS?: string,
    MATRIX_HS_URL: string,
    BOT_USER_ID: string
  }
}

let app: App | undefined;

function ensureApp(env: Env): App {
  if (!app) app = build(env);
  return app;
}

const TXN_PATTERNS = [
  new URLPattern({ pathname: '/transactions/:txnId' }),
  new URLPattern({ pathname: '/_matrix/:prefix(appservice|app)/v1/transactions/:txnId' })
];
const USER_PATTERNS = [
  new URLPattern({ pathname: '/users/:userId' }),
  new URLPattern({ pathname: '/_matrix/:prefix(appservice|app)/v1/users/:userId' })
];
const ROOM_PATTERNS = [
  new URLPattern({ pathname: '/rooms/:roomId' }),
  new URLPattern({ pathname: '/_matrix/:prefix(appservice|app)/v1/rooms/:roomId' })
];

function matchPath(
  patterns: readonly URLPattern[],
  url: URL
): URLPatternResult | null {
  for (let i = 0, len = patterns.length; i < len; i++) {
    const result = patterns[i]!.exec(url);
    if (result !== null) return result;
  }
  return null;
}

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

async function authorized(url: URL, env: Env): Promise<boolean> {
  const token = url.searchParams.get('access_token');
  return token !== null && await secretEqual(token, env.HS_TOKEN);
}

async function handleTransaction(
  request: Request,
  env: Env,
  txnId: string,
  runtime: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  if (!(await authorized(url, env))) {
    console.warn('transaction auth failed');
    return json({ error: 'invalid access token' }, 401);
  }
  if (request.method !== 'PUT') {
    return json({ error: 'method not allowed' }, 405);
  }
  const { data: value, error } = await tryCatchAsync(() => request.json());
  if (error !== undefined) {
    return json({ error: 'invalid JSON body' }, 400);
  }
  const events = (value as { events?: unknown }).events;
  if (!Array.isArray(events)) {
    return json({ error: 'missing events' }, 400);
  }
  const current = ensureApp(env);
  void attempt(() => current.ensureProfile());
  const at = new Date().toISOString();
  if (!(await current.dedupeTransaction(txnId, at))) {
    return json({}, 200);
  }
  const processed = await tryCatchAsync(async () => {
    for (let i = 0, len = events.length; i < len; i++) {
      const event = toInbound(events[i]);
      if (event !== undefined) {
        // eslint-disable-next-line no-await-in-loop
        await current.handleEvent(event, (promise) => {
          runtime.waitUntil(promise);
        });
      }
    }
  });
  if (processed.error === undefined) return json({}, 200);
  console.error('transaction processing failed:', processed.error);
  const dropped = await tryCatchAsync(() => current.dropTransaction(txnId));
  if (dropped.error !== undefined) console.error(dropped.error);
  return json({ error: 'processing failed' }, 500);
}

function toInbound(value: unknown): InboundEvent | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const event = value as Record<string, unknown>;
  if (
    typeof event.room_id !== 'string'
    || typeof event.event_id !== 'string'
    || typeof event.sender !== 'string'
    || typeof event.type !== 'string'
    || typeof event.content !== 'object'
    || event.content === null
  ) {
    return undefined;
  }
  const inbound: InboundEvent = {
    roomId: event.room_id,
    eventId: event.event_id,
    sender: event.sender,
    type: event.type,
    content: event.content as Record<string, unknown>
  };
  if (typeof event.state_key === 'string') inbound.stateKey = event.state_key;
  if (typeof event.redacts === 'string') inbound.redacts = event.redacts;
  return inbound;
}

export default {
  async fetch(request, env, runtime) {
    const current = ensureApp(env);
    const url = new URL(request.url);
    const path = url.pathname;

    const txn = matchPath(TXN_PATTERNS, url);
    if (txn) {
      return handleTransaction(
        request,
        env,
        decodeURIComponent(txn.pathname.groups.txnId!),
        runtime
      );
    }

    const userQuery = request.method === 'GET'
      ? matchPath(USER_PATTERNS, url)
      : null;
    if (userQuery) {
      if (!(await authorized(url, env))) {
        return json({ error: 'invalid access token' }, 401);
      }
      const userId = decodeURIComponent(userQuery.pathname.groups.userId!);
      return json({}, userId === env.BOT_USER_ID ? 200 : 404);
    }

    const roomQuery = request.method === 'GET'
      ? matchPath(ROOM_PATTERNS, url)
      : null;
    if (roomQuery) {
      if (!(await authorized(url, env))) {
        return json({ error: 'invalid access token' }, 401);
      }
      return json({}, 200);
    }

    const platform = platforms(env).find(
      (candidate) => request.method === 'POST' && path === candidate.route
    );
    if (platform) {
      const received = await tryCatchAsync(
        () => current.receiveWebhook(platform.channel, request, env)
      );
      if (received.data !== undefined) return received.data;
      console.error(received.error);
      return new Response('internal error', { status: 500 });
    }

    return json({ error: 'not found' }, 404);
  },
  async scheduled(_controller, env) {
    const current = ensureApp(env);
    await current.checkSubscriptions();
    await current.burn();
    const utc8 = new Date(Date.now() + 8 * 3_600_000);
    const hour = utc8.getUTCHours();
    const day = utc8.getUTCDay();
    if (hour === 11) {
      await current.purge();
    }
    if (hour === 9) {
      await current.remindMissing();
    }
    if (hour === 21) {
      await current.remindOpen();
      if (day === 0) await current.weeklyReport();
    }
  }
} satisfies ExportedHandler<Env>;
