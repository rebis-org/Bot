import { autoRetry } from '@grammyjs/auto-retry';
import { commands } from '@grammyjs/commands';
import { limit } from '@grammyjs/ratelimiter';
import { sequentialize } from '@grammyjs/runner';
import { Bot } from 'grammy';
import { bind } from './bind.ts';
import { check } from './check.ts';
import { commands as buildCommands } from './commands.ts';
import type { Ctx } from './kernel.ts';
import { isGroup } from './kernel.ts';
import { pin } from './pin.ts';
import { Store } from './store.ts';

export interface App {
  bot: Bot<Ctx>,
  syncCommands: () => Promise<void>,
  purge: () => Promise<void>
}

class RateStore {
  private readonly hits = new Map<
    string,
    { count: number, expiresAt: number }
  >();

  constructor(private readonly frame: number) {}

  incr(key: string): Promise<number> {
    const now = Date.now();
    const hit = this.hits.get(key);
    if (!hit || hit.expiresAt <= now) {
      this.hits.set(key, { count: 1, expiresAt: now + this.frame });
      return Promise.resolve(1);
    }
    hit.count += 1;
    return Promise.resolve(hit.count);
  }

  pexpire(key: string, milliseconds: number): Promise<number> {
    const hit = this.hits.get(key);
    if (hit) hit.expiresAt = Date.now() + milliseconds;
    return Promise.resolve(1);
  }
}

export function build(
  env: Pick<Env, 'BOT_TOKEN' | 'BOT_INFO' | 'DB' | 'CF_ACCOUNT_ID' | 'GH_ORG'>
): App {
  const store = new Store(env.DB);
  const pins = pin(store);
  const bindings = bind(store, [
    {
      id: 'gh',
      label: 'GitHub',
      targetLabel: 'organization',
      targetLabelPlural: 'organizations',
      value: env.GH_ORG.toLowerCase()
    },
    {
      id: 'cf',
      label: 'Cloudflare',
      targetLabel: 'account',
      targetLabelPlural: 'accounts',
      value: env.CF_ACCOUNT_ID
    }
  ]);
  const cmd = buildCommands({
    check: check(store).middleware(),
    pin: pins.router.middleware(),
    bind: bindings.middleware()
  });
  const bot = new Bot<Ctx>(env.BOT_TOKEN, { botInfo: env.BOT_INFO });

  bot.api.config.use(autoRetry({ maxRetryAttempts: 1, maxDelaySeconds: 3 }));

  bot.use(
    async (c, next) => {
      console.log({ update: c.update });
      await next();
    },
    sequentialize((c) => {
      const chat = c.chat;
      const from = c.from;
      return chat && from ? `${chat.id}:${from.id}` : undefined;
    }),
    limit({
      timeFrame: 60000,
      limit: 20,
      storageClient: new RateStore(60000),
      async onLimitExceeded(c) {
        await c.reply('Too many requests. Try again later.');
      }
    }),
    commands()
  );

  bot.filter(
    isGroup,
    pins.question.middleware(),
    pins.menu,
    cmd.group,
    cmd.unknown
  );

  bot.use(async (c, next) => {
    if (isGroup(c)) {
      await next();
      return;
    }
    if (c.message?.text?.[0] === '/') {
      await c.reply('This Bot is for group use only.');
    }
  });

  bot.catch((err) => {
    console.error('grammY middleware error:', err.error);
  });

  return {
    bot,
    syncCommands: () => cmd.group.setCommands(bot),
    purge: () => store.purge()
  };
}
