import type { CommandsFlavor } from '@grammyjs/commands';
import { code, fmt, FormattedString } from '@grammyjs/parse-mode';
import type { TextWithEntities } from '@grammyjs/parse-mode';
import { Router } from '@grammyjs/router';
import type { Context, Middleware, MiddlewareFn } from 'grammy';
import type { Chat, InlineKeyboardMarkup, User } from 'grammy/types';

export type Ctx = Context & CommandsFlavor;
export type GroupCtx = Ctx & { chat: Chat, from: User };

export interface Command {
  name: string,
  desc: string,
  section: string,
  rows: readonly CommandRow[],
  handler: MiddlewareFn<GroupCtx>
}

export interface CommandRow {
  command: string,
  desc: string
}

export interface HelpSection {
  heading: string,
  rows: readonly CommandRow[]
}

const RE_COMMAND = /^\/[a-z0-9_]+(?:@\w+)?/;
const RE_SPACE = /\s+/;
const RE_ID = /^\d+$/;

export function isGroup(c: Ctx): c is GroupCtx {
  return (
    (c.chat?.type === 'group' || c.chat?.type === 'supergroup')
    && c.from !== undefined
  );
}

export function isTargetGroup(
  c: Ctx,
  chatId: number | undefined
): c is GroupCtx {
  return isGroup(c) && c.chat.id === chatId;
}

export function commandArgs(c: Ctx): string {
  return (c.msg?.text ?? '').replace(RE_COMMAND, '').trim();
}

export function subcommands<T extends Ctx>(
  handlers: Record<string, Middleware<T>>,
  fallback: Middleware<T>,
  offset = 0
): Router<T> {
  const router = new Router<T>(
    (c) => commandArgs(c).split(RE_SPACE, offset + 1)[offset] ?? ''
  );
  const entries = Object.entries(handlers);
  for (let i = 0, len = entries.length; i < len; i++) {
    const [name, handler] = entries[i]!;
    router.route(name, handler);
  }
  router.otherwise(fallback);
  return router;
}

export async function isAdmin(c: GroupCtx): Promise<boolean> {
  const member = await c.api.getChatMember(c.chat.id, c.from.id).catch((err) => {
    console.error(err);
    return null;
  });
  return member?.status === 'creator' || member?.status === 'administrator';
}

export async function requireAdmin(c: GroupCtx): Promise<boolean> {
  if (await isAdmin(c)) return true;
  await c.reply('Only administrators can use this.');
  return false;
}

export function admin(handler: MiddlewareFn<GroupCtx>): MiddlewareFn<GroupCtx> {
  return async (c, next) => {
    if (await requireAdmin(c)) await handler(c, next);
  };
}

export function parseId(text: string): number | undefined {
  const n = Number(text);
  return RE_ID.test(text) && Number.isSafeInteger(n) ? n : undefined;
}

export function send(
  c: Ctx,
  content: TextWithEntities | string,
  reply_markup?: InlineKeyboardMarkup
) {
  const text = typeof content === 'string' ? content : content.text;
  return c.reply(text, {
    entities: typeof content === 'string' ? undefined : content.entities,
    reply_markup
  });
}

export function usage(
  rows: readonly CommandRow[]
): FormattedString {
  const lines = rows.map(({ command, desc }) => fmt`${code}${command}${code} ${desc}`);
  return FormattedString.join(lines, '\n');
}
