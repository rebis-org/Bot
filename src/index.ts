import { webhookCallback } from 'grammy';
import type { App } from './app.ts';
import { build } from './app.ts';
import { handleCloudflareWebhook } from './cloudflare.ts';
import { handleGitHubWebhook } from './github.ts';

declare global {
  interface Env {
    BOT_TOKEN: string,
    SECRET_TOKEN: string,
    GH_WEBHOOK_SECRET: string,
    CF_WEBHOOK_SECRET: string,
    CF_ACCOUNT_ID: string,
    GH_ORG: string
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
  fetch(request, env) {
    const current = ensureApp(env);
    if (
      request.method === 'POST'
      && new URL(request.url).pathname === '/webhook/github'
    ) {
      return handleGitHubWebhook(request, env, current.bot).catch((err) => {
        console.error(err);
        return new Response('internal error', { status: 500 });
      });
    }
    if (
      request.method === 'POST'
      && new URL(request.url).pathname === '/webhook/cloudflare'
    ) {
      return handleCloudflareWebhook(request, env, current.bot);
    }
    return webhookCallback(current.bot, 'cloudflare-mod', {
      secretToken: env.SECRET_TOKEN
    })(request).catch((err) => {
      console.error(err);
      return new Response(null, { status: 200 });
    });
  },
  async scheduled(_controller, env) {
    const current = ensureApp(env);
    await current.purge();
  }
} satisfies ExportedHandler<Env>;
