import { tryCatchAsync } from '@moeru/std/try-catch';
import { extractErrorMessage } from 'foxts/extract-error-message';
import * as v from 'valibot';
import { attempt } from './attempt.ts';
import { D1Store } from './infrastructure/db/store.ts';
import { MatrixClient } from './infrastructure/matrix/client.ts';
import { nonEmpty, parse, parseRoomId } from './domain/value.ts';
import { escapeHtml } from './display/html.ts';
import { check } from './interface/commands/check.ts';
import { pin, pendingQuestion } from './interface/commands/pin.ts';
import { bind } from './interface/commands/bind.ts';
import { commands } from './interface/commands/index.ts';
import { dice, ping, poll, status, handleReaction } from './interface/commands/utility.ts';
import { subscribe } from './interface/commands/subscribe.ts';
import { burn } from './interface/commands/burn.ts';
import { checkSubscriptions } from './infrastructure/subscribe/check.ts';
import { burnRead } from './infrastructure/burn/burn.ts';
import {
  handleRedaction,
  recordMediaRefs,
  redactionTarget
} from './infrastructure/burn/redact.ts';
import type { Command, CommandCtx, InboundEvent } from './interface/kernel.ts';
import { checkAdmin, commandWord, makeCtx } from './interface/kernel.ts';
import { logEntry, postLog } from './interface/log.ts';
import {
  remindMissingCheckIn,
  remindOpenSessions,
  sendWeeklyReport
} from './interface/scheduled.ts';
import { platforms } from './infrastructure/webhook/platforms.ts';
import { receiveWebhook } from './infrastructure/webhook/webhook.ts';
import type { WebhookChannel, WebhookStores } from './infrastructure/webhook/webhook.ts';

export interface App {
  handleEvent: (
    event: InboundEvent,
    defer: (promise: Promise<void>) => void
  ) => Promise<void>,
  ensureProfile: () => Promise<void>,
  dedupeTransaction: (txnId: string, timestamp: string) => Promise<boolean>,
  dropTransaction: (txnId: string) => Promise<void>,
  purge: () => Promise<void>,
  weeklyReport: () => Promise<void>,
  remindOpen: () => Promise<void>,
  remindMissing: () => Promise<void>,
  checkSubscriptions: () => Promise<void>,
  burn: () => Promise<void>,
  receiveWebhook: (
    channel: WebhookChannel,
    request: Request,
    env: Env
  ) => Promise<Response>,
  stores: WebhookStores
}

const RATE_LIMIT = 20;
const REACTION_RATE_LIMIT = 30;
const RATE_FRAME_MS = 60000;
const CONFIRM = new Set(['confirm', 'yes', 'y', '1']);
const ERROR_DETAIL_MAX = 200;

const envSchema = v.looseObject({
  AS_TOKEN: nonEmpty('AS_TOKEN'),
  HS_TOKEN: nonEmpty('HS_TOKEN'),
  GH_WEBHOOK_SECRET: nonEmpty('GH_WEBHOOK_SECRET'),
  GH_ORG: nonEmpty('GH_ORG'),
  MATRIX_HS_URL: nonEmpty('MATRIX_HS_URL'),
  BOT_USER_ID: nonEmpty('BOT_USER_ID')
});

export function build(env: Env): App {
  parse<Env>(envSchema, env);
  const store = new D1Store(env.DB);
  const client = MatrixClient.connect({
    baseUrl: env.MATRIX_HS_URL,
    accessToken: env.AS_TOKEN,
    userId: env.BOT_USER_ID,
    bypassKey: env.HS_BYPASS
  });
  const logRoomId = parseRoomId(env.LOG_ROOM_ID);
  const bindRoomIds = new Set<string>();
  const bindRoomEntries = (env.BIND_ROOM_IDS ?? '').split(',');
  for (let i = 0, len = bindRoomEntries.length; i < len; i++) {
    const entry = bindRoomEntries[i]!.trim();
    if (entry[0] === '!') bindRoomIds.add(entry);
  }
  const providers = platforms(env);
  const config = [
    ['AS_TOKEN', Boolean(env.AS_TOKEN)],
    ['HS_TOKEN', Boolean(env.HS_TOKEN)],
    ['HS_BYPASS', Boolean(env.HS_BYPASS)],
    ['GH_WEBHOOK_SECRET', Boolean(env.GH_WEBHOOK_SECRET)],
    ['GH_ORG', Boolean(env.GH_ORG)],
    ['LOG_ROOM_ID', logRoomId !== undefined],
    ['BIND_ROOM_IDS', bindRoomIds.size > 0]
  ] as const;

  let profileSet = false;

  let registry: ReturnType<typeof commands>;
  const helpCommand: Command = {
    name: 'help',
    desc: 'Show help',
    section: 'Other',
    rows: [],
    async handler(ctx) {
      const doc = registry.help();
      await ctx.reply(doc.body, doc.html);
    }
  };
  registry = commands([
    check(store),
    pin(store, client),
    bind(store, providers, bindRoomIds),
    dice,
    ping(store, client),
    poll(store),
    subscribe(store),
    burn(store),
    status(store, config),
    helpCommand
  ]);

  async function sendPlain(
    event: InboundEvent,
    text: string
  ): Promise<void> {
    await attempt(() => client.sendHtml(
      event.roomId,
      text,
      escapeHtml(text),
      event.eventId
    ));
  }

  async function handleMessage(
    event: InboundEvent,
    text: string,
    defer: (promise: Promise<void>) => void
  ) {
    if (isEdit(event)) return;

    const question = pendingQuestion(event.roomId, event.sender);
    if (question !== undefined) {
      await answerQuestion(question, event, text);
      return;
    }

    const parsed = commandWord(text);
    if (parsed === undefined) return;

    const count = await store.rateIncr(`rate:${event.sender}`, RATE_FRAME_MS);
    if (count > RATE_LIMIT) {
      await sendPlain(event, 'Too many requests. Try again later.');
      return;
    }

    const isAdmin = await checkAdmin(client, event.roomId, event.sender);
    const relates = event.content['m.relates_to'] as
      | Record<string, unknown>
      | undefined;
    const inReplyTo = relates?.['m.in_reply_to'] as
      | Record<string, unknown>
      | undefined;
    const repliedTo = typeof inReplyTo?.event_id === 'string'
      ? inReplyTo.event_id
      : undefined;
    const ctx = makeCtx(client, event, parsed.args, isAdmin, repliedTo, defer);
    const { error } = await tryCatchAsync(() => registry.dispatch(parsed.name, ctx));
    if (error !== undefined) {
      console.error('command dispatch failed:', error);
      const detail = extractErrorMessage(error) ?? 'unknown error';
      await attempt(() => ctx.reply('The command failed. Try again.'));
      await postLog(
        client,
        logRoomId,
        botErrorEntry(`Bot error: ${detail}`)
      );
    }
  }

  async function answerQuestion(
    question: { run: (ctx: CommandCtx) => Promise<void> },
    event: InboundEvent,
    text: string
  ) {
    const answer = text.trim().toLowerCase();
    if (!CONFIRM.has(answer)) {
      await sendPlain(event, 'Operation cancelled.');
      return;
    }
    const ctx = makeCtx(client, event, '', true, undefined);
    const { error } = await tryCatchAsync(() => question.run(ctx));
    if (error !== undefined) {
      console.error('question answer failed:', error);
      await attempt(() => ctx.reply('The operation failed. Try again.'));
    }
  }

  return {
    async handleEvent(event, defer) {
      if (event.sender === env.BOT_USER_ID) return;

      if (isInviteForBot(event, env.BOT_USER_ID)) {
        await attempt(() => client.joinRoom(event.roomId));
      }

      const entry = logEntry(event);
      if (entry !== null) await postLog(client, logRoomId, entry);

      if (event.type === 'm.room.redaction') {
        const target = redactionTarget(event.content, event.redacts);
        if (target !== null) {
          await handleRedaction(client, store, event.roomId, target);
        }
      }

      if (event.type === 'm.reaction') {
        const annotation = reactionAnnotation(event);
        if (annotation !== null) {
          const count = await store.rateIncr(
            `rate:reaction:${event.sender}`,
            RATE_FRAME_MS
          );
          if (count <= REACTION_RATE_LIMIT) {
            await handleReaction(client, store, event, annotation);
          }
        }
        return;
      }

      if (event.type === 'm.room.message') {
        await attempt(
          () => recordMediaRefs(client, store, event.roomId, event.eventId, event.content)
        );
        const msgtype = event.content.msgtype;
        const body = event.content.body;
        if (msgtype === 'm.text' && typeof body === 'string') {
          await handleMessage(event, body, defer);
        }
      }
    },

    async ensureProfile() {
      if (profileSet) return;
      profileSet = true;
      const { error } = await tryCatchAsync(() => client.setDisplayName('Rebis'));
      if (error !== undefined) {
        profileSet = false;
        console.error('set displayname failed:', error);
      }
    },

    purge: () => store.purge(),
    dedupeTransaction: (txnId, timestamp) => store.recordTransaction(txnId, timestamp),
    dropTransaction: (txnId) => store.dropTransaction(txnId),
    weeklyReport: () => sendWeeklyReport(client, store),
    remindOpen: () => remindOpenSessions(client, store),
    remindMissing: () => remindMissingCheckIn(client, store),
    checkSubscriptions: () => checkSubscriptions(client, store),
    burn: () => burnRead(client, store),
    receiveWebhook: (channel, request, e) => receiveWebhook(request, e, client, channel, {
      binding: store,
      delivery: store
    }),
    stores: {
      binding: store,
      delivery: store
    }
  };
}

function isEdit(event: InboundEvent): boolean {
  const relates = event.content['m.relates_to'] as
    | Record<string, unknown>
    | undefined;
  return relates?.rel_type === 'm.replace';
}

function isInviteForBot(event: InboundEvent, botUserId: string): boolean {
  return event.type === 'm.room.member'
    && event.stateKey === botUserId
    && event.content.membership === 'invite';
}

function reactionAnnotation(
  event: InboundEvent
): { eventId: string, key: string } | null {
  const relates = event.content['m.relates_to'] as
    | Record<string, unknown>
    | undefined;
  if (relates?.rel_type !== 'm.annotation') return null;
  const eventId = relates.event_id;
  const key = relates.key;
  if (typeof eventId !== 'string' || typeof key !== 'string') return null;
  return { eventId, key };
}

function botErrorEntry(detail: string): { body: string, html: string } {
  const truncated = detail.length > ERROR_DETAIL_MAX
    ? `${detail.slice(0, ERROR_DETAIL_MAX)}…`
    : detail;
  return { body: truncated, html: escapeHtml(truncated) };
}
