import type { CommandsFlavor } from '@grammyjs/commands';
import { code, fmt } from '@grammyjs/parse-mode';
import type { FormattedString, TextWithEntities } from '@grammyjs/parse-mode';
import { Router } from '@grammyjs/router';
import type { Context, Middleware, MiddlewareFn } from 'grammy';
import type { Chat, InlineKeyboardMarkup, User } from 'grammy/types';

export type Ctx = Context & CommandsFlavor;
export type GroupCtx = Ctx & { chat: Chat, from: User };

const RE_COMMAND = /^\/[a-z0-9_]+(?:@\w+)?/;
const RE_SPACE = /\s+/;
const RE_ID = /^\d+$/;

export function isGroup(c: Ctx): c is GroupCtx {
  return (
    (c.chat?.type === 'group' || c.chat?.type === 'supergroup')
    && c.from !== undefined
  );
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

export function parseId(s: string): number | undefined {
  return RE_ID.test(s) ? Number(s) : undefined;
}

export function send(
  c: Ctx,
  s: TextWithEntities | string,
  reply_markup?: InlineKeyboardMarkup
) {
  const text = typeof s === 'string' ? s : s.text;
  return c.reply(text, {
    entities: typeof s === 'string' ? undefined : s.entities,
    reply_markup
  });
}

export function usage(
  rows: ReadonlyArray<readonly [string, string]>
): FormattedString {
  const lines = rows.map(([cmd, desc]) => fmt`${code}${cmd}${code} ${desc}`);
  return fmt(['', ...lines.slice(0, -1).map(() => '\n'), ''], ...lines);
}
