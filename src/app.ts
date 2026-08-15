import { autoRetry } from '@grammyjs/auto-retry';
import { commands as installCommands } from '@grammyjs/commands';
import { limit } from '@grammyjs/ratelimiter';
import { sequentialize } from '@grammyjs/runner';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { Bot } from 'grammy';
import { D1Store } from './infrastructure/db/store.ts';
import { parseGroupChatId, parseThreadId } from './domain/value.ts';
import { check } from './interface/commands/check.ts';
import { pin } from './interface/commands/pin.ts';
import { bind } from './interface/commands/bind.ts';
import { commands } from './interface/commands/index.ts';
import { dice, ping, poll, status } from './interface/commands/utility.ts';
import { inlineQuery } from './interface/inline.ts';
import type { Ctx } from './interface/kernel.ts';
import { isGroup, isTargetGroup } from './interface/kernel.ts';
import { groupLog } from './interface/log.ts';
import {
  remindMissingCheckIn,
  remindOpenSessions,
  sendWeeklyReport
} from './interface/scheduled.ts';
import { platforms } from './infrastructure/webhook/platforms.ts';
import type { WebhookStores } from './infrastructure/webhook/webhook.ts';

export interface App {
  bot: Bot<Ctx>,
  syncCommands: () => Promise<void>,
  purge: () => Promise<void>,
  weeklyReport: () => Promise<void>,
  remindOpen: () => Promise<void>,
  remindMissing: () => Promise<void>,
  stores: WebhookStores
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

export function build(env: Env): App {
  const store = new D1Store(env.DB);
  const chatId = parseGroupChatId(env.GROUP_CHAT_ID);
  const logThreadId = parseThreadId(env.LOG_THREAD_ID);
  const providers = platforms(env);
  const config = [
    ['BOT_TOKEN', Boolean(env.BOT_TOKEN)],
    ['SECRET_TOKEN', Boolean(env.SECRET_TOKEN)],
    ['GH_WEBHOOK_SECRET', Boolean(env.GH_WEBHOOK_SECRET)],
    ['CF_WEBHOOK_SECRET', Boolean(env.CF_WEBHOOK_SECRET)],
    ['GH_ORG', Boolean(env.GH_ORG)],
    ['CF_ACCOUNT_ID', Boolean(env.CF_ACCOUNT_ID)],
    ['GROUP_CHAT_ID', chatId !== undefined],
    ['GH_THREAD_ID', parseThreadId(env.GH_THREAD_ID) !== undefined],
    ['CF_THREAD_ID', parseThreadId(env.CF_THREAD_ID) !== undefined],
    ['LOG_THREAD_ID', logThreadId !== undefined]
  ] as const;

  const pins = pin(store);
  const cmd = commands([
    check(store),
    pins.command,
    bind(store, providers),
    dice,
    ping(store),
    status(store, config),
    poll
  ]);

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
    installCommands()
  );

  bot.on('inline_query', inlineQuery(store, chatId ?? 0));

  bot.filter(
    (c) => isTargetGroup(c, chatId),
    groupLog(logThreadId),
    pins.question.middleware(),
    pins.menu,
    cmd.group,
    cmd.unknown
  );

  bot.use(async (c, next) => {
    if (isTargetGroup(c, chatId)) {
      await next();
      return;
    }
    if (c.message?.text?.[0] === '/') {
      await c.reply(
        isGroup(c)
          ? 'This Bot is only available in the designated group.'
          : 'This Bot is for group use only.'
      );
    }
  });

  bot.catch(({ error, ctx }) => {
    console.error('grammY middleware error:', error);
    const detail = extractErrorMessage(error) ?? 'unknown error';
    void (async () => {
      try {
        await ctx.reply('Something went wrong. Please try again.');
      } catch {
        console.error('failed to send error reply');
      }
      if (chatId !== undefined && logThreadId !== undefined) {
        try {
          await bot.api.sendMessage(
            chatId,
            `Bot error: ${detail}`,
            { message_thread_id: logThreadId }
          );
        } catch {
          console.error('failed to send error log');
        }
      }
    })();
  });

  return {
    bot,
    syncCommands: () => cmd.sync(bot),
    purge: () => store.purge(),
    weeklyReport: () => sendWeeklyReport(bot, store, chatId ?? 0, logThreadId),
    remindOpen: () => remindOpenSessions(bot, store, chatId ?? 0),
    remindMissing: () => remindMissingCheckIn(bot, store, chatId ?? 0),
    stores: {
      binding: store,
      delivery: store
    }
  };
}
