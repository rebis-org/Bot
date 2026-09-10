import { noop } from 'foxts/noop';
import { attempt } from '../attempt.ts';
import { code, escapeHtml, html, join } from '../display/html.ts';
import type { Doc } from '../display/html.ts';
import type { MatrixClient } from '../infrastructure/matrix/client.ts';

export interface InboundEvent {
  roomId: string,
  eventId: string,
  sender: string,
  type: string,
  content: Record<string, unknown>,
  stateKey?: string,
  redacts?: string
}

export interface CommandCtx {
  roomId: string,
  sender: string,
  eventId: string,
  repliedTo: string | undefined,
  args: string,
  client: MatrixClient,
  isAdmin: boolean,
  reply(body: string, htmlBody?: string): Promise<string>,
  defer(promise: Promise<void>): void
}

export interface Command {
  name: string,
  desc: string,
  section: string,
  rows: readonly CommandRow[],
  handler: (ctx: CommandCtx) => Promise<void>
}

export interface CommandRow {
  command: string,
  desc: string
}

export interface HelpSection {
  heading: string,
  rows: readonly CommandRow[]
}

const RE_COMMAND = /^!(\w+)/;
const RE_SPACE = /\s+/;

export function commandWord(text: string): { name: string, args: string } | undefined {
  const match = RE_COMMAND.exec(text);
  if (match?.index !== 0) return undefined;
  const name = match[1]!.toLowerCase();
  return { name, args: text.slice(match[0].length).trim() };
}

export function subcommands(
  handlers: Record<string, (ctx: CommandCtx) => Promise<void>>,
  fallback: (ctx: CommandCtx) => Promise<void>
): (ctx: CommandCtx) => Promise<void> {
  return async (ctx) => {
    const head = ctx.args.split(RE_SPACE, 1)[0] ?? '';
    const handler = handlers[head];
    if (handler === undefined) {
      await fallback(ctx);
      return;
    }
    await handler({ ...ctx, args: ctx.args.slice(head.length).trim() });
  };
}

export function makeCtx(
  client: MatrixClient,
  event: InboundEvent,
  args: string,
  isAdmin: boolean,
  repliedTo: string | undefined,
  defer: (promise: Promise<void>) => void = noop
): CommandCtx {
  return {
    roomId: event.roomId,
    sender: event.sender,
    eventId: event.eventId,
    repliedTo,
    args,
    client,
    isAdmin,
    defer,
    async reply(body, htmlBody) {
      return client.sendHtml(
        event.roomId,
        body,
        htmlBody ?? escapeHtml(body),
        event.eventId
      );
    }
  };
}

export async function checkAdmin(
  client: MatrixClient,
  roomId: string,
  sender: string
): Promise<boolean> {
  const levels = await client.powerLevels(roomId);
  return levels.level(sender) >= 50;
}

export function requireAdmin(ctx: CommandCtx): boolean {
  if (ctx.isAdmin) return true;
  void attempt(() => ctx.reply('Only administrators can use this.'));
  return false;
}

export function admin(
  handler: (ctx: CommandCtx) => Promise<void>
): (ctx: CommandCtx) => Promise<void> {
  return async (ctx) => {
    if (requireAdmin(ctx)) await handler(ctx);
  };
}

export function usage(rows: readonly CommandRow[]): Doc {
  const lines: Doc[] = [];
  for (let i = 0, len = rows.length; i < len; i++) {
    const row = rows[i]!;
    lines.push(html`${code(row.command)} ${row.desc}`);
  }
  return join(lines, '\n');
}

export function suggestCommand(
  text: string,
  names: readonly string[]
): string | undefined {
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0, len = names.length; i < len; i++) {
    const distance = editDistance(text, names[i]!);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = names[i]!;
    }
  }
  return best !== undefined && bestDistance <= 2 ? best : undefined;
}

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev: number[] = [];
  for (let j = 0; j <= n; j++) prev.push(j);
  for (let i = 1; i <= m; i++) {
    const current: number[] = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current.push(Math.min(
        prev[j]! + 1,
        current[j - 1]! + 1,
        prev[j - 1]! + cost
      ));
    }
    prev = current;
  }
  return prev[n]!;
}
