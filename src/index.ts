import { webhookCallback } from 'grammy';
import type { App } from './app.ts';
import { build } from './app.ts';
import { platforms } from './infrastructure/webhook/platforms.ts';
import { webhookHandler } from './infrastructure/webhook/webhook.ts';

declare global {
  interface Env {
    BOT_TOKEN: string,
    SECRET_TOKEN: string,
    GH_WEBHOOK_SECRET: string,
    CF_WEBHOOK_SECRET: string,
    CF_ACCOUNT_ID: string,
    GH_ORG: string,
    GROUP_CHAT_ID?: string,
    GH_THREAD_ID?: string,
    CF_THREAD_ID?: string,
    LOG_THREAD_ID?: string
  }
}

let app: App | undefined;
let synced = false;

function ensureApp(env: Env): App {
  if (!app) app = build(env);
  const current = app;
  if (!synced) {
    synced = true;
    void current.syncCommands().catch((err) => {
      console.error('setCommands failed:', err);
      synced = false;
    });
  }
  return current;
}

export default {
  async fetch(request, env) {
    const current = ensureApp(env);
    const platform = platforms(env).find(
      (candidate) => request.method === 'POST'
        && new URL(request.url).pathname === candidate.route
    );
    if (platform) {
      try {
        return await webhookHandler(platform.channel, current.stores)(
          request,
          env,
          current.bot
        );
      } catch (err) {
        console.error(err);
        return new Response('internal error', { status: 500 });
      }
    }
    try {
      return await webhookCallback(current.bot, 'cloudflare-mod', {
        secretToken: env.SECRET_TOKEN
      })(request);
    } catch (err) {
      console.error(err);
      return new Response(null, { status: 200 });
    }
  },
  async scheduled(_controller, env) {
    const current = ensureApp(env);
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
