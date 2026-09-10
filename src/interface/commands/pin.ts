import { bold, code, escapeHtml, html, join, sanitize } from '../../display/html.ts';
import type { Doc } from '../../display/html.ts';
import type { PinStore } from '../../domain/ports.ts';
import type { Pin } from '../../domain/pin.ts';
import { PinDraft } from '../../domain/pin.ts';
import type { ContentType } from '../../domain/value.ts';
import { mediaMsgtype, MSGTYPE_CONTENT_TYPES } from '../../domain/value.ts';
import { formatUtc8 } from '../../display/format.ts';
import type { MatrixClient } from '../../infrastructure/matrix/client.ts';
import type { Command, CommandCtx } from '../kernel.ts';
import { admin, subcommands, usage } from '../kernel.ts';

const CONFIRM_HINT = 'Reply "confirm" to proceed. Reply anything else to cancel.';
const QUESTION_TTL_MS = 5 * 60000;

export const PIN_COMMANDS = [
  { command: '!pin insert', desc: 'Pin the replied-to message (administrators)' },
  {
    command: '!pin delete <event ID>',
    desc: 'Unpin and delete the record (administrators, confirmation required)'
  },
  { command: '!pin retrieve [event ID]', desc: 'View pin information' },
  { command: '!pin search <text>', desc: 'Search pinned messages' }
] as const;

interface PendingQuestion {
  expiresAt: number,
  run: (ctx: CommandCtx) => Promise<void>
}

const pendingQuestions = new Map<string, PendingQuestion>();

export function pendingQuestion(
  roomId: string,
  sender: string
): PendingQuestion | undefined {
  const key = `${roomId}:${sender}`;
  const question = pendingQuestions.get(key);
  if (!question) return undefined;
  pendingQuestions.delete(key);
  if (question.expiresAt <= Date.now()) return undefined;
  return question;
}

export function pin(store: PinStore, client: MatrixClient): Command {
  const askDelete = (ctx: CommandCtx, eventId: string) => {
    pendingQuestions.set(`${ctx.roomId}:${ctx.sender}`, {
      expiresAt: Date.now() + QUESTION_TTL_MS,
      async run(answerCtx) {
        const removed = await store.remove(answerCtx.roomId, eventId);
        await answerCtx.reply(
          removed
            ? `Pin removed and record deleted (event #${eventId}).`
            : `No pin record found for #${eventId}.`
        );
      }
    });
    void ctx.reply(`Unpin and delete record #${eventId}?\n${CONFIRM_HINT}`);
  };

  return {
    name: 'pin',
    desc: 'Pin/unpin, retrieve, search (administrators)',
    section: 'Pins',
    rows: PIN_COMMANDS,
    handler: subcommands(
      {
        insert: admin(async (ctx) => {
          const targetId = ctx.repliedTo;
          if (targetId === undefined) {
            await ctx.reply('Reply to a message, then send !pin insert.');
            return;
          }
          const target = await client.fetchEvent(ctx.roomId, targetId);
          if (!target) {
            await ctx.reply('The replied-to event could not be fetched.');
            return;
          }
          const snap = snapshot(
            typeof target.content === 'object' && target.content !== null
              ? (target.content as Record<string, unknown>)
              : {}
          );
          const senderName = typeof target.sender === 'string'
            ? target.sender
            : ctx.sender;
          await store.upsert(PinDraft.create({
            roomId: ctx.roomId,
            eventId: targetId,
            userId: senderName,
            senderName,
            contentType: snap.contentType,
            content: snap.content,
            formatted: snap.formatted,
            mediaUrl: snap.mediaUrl,
            pinnedAt: new Date().toISOString()
          }));
          await ctx.reply(`Pin complete (event #${targetId}).`);
        }),
        delete: admin(async (ctx) => {
          const eventId = ctx.args.trim() || ctx.repliedTo;
          if (eventId === undefined) {
            await ctx.reply(
              'Reply to the pinned message, or send !pin delete <event ID>.'
            );
            return;
          }
          askDelete(ctx, eventId);
        }),
        async retrieve(ctx) {
          const eventId = ctx.args.trim();
          if (eventId !== '') {
            const row = await store.get(ctx.roomId, eventId);
            if (row) await sendPin(client, ctx, row);
            else await ctx.reply(`No pin record found for #${eventId}.`);
            return;
          }
          const doc = pinList(await store.list(ctx.roomId));
          await ctx.reply(doc.body, doc.html);
        },
        async search(ctx) {
          const query = ctx.args.trim();
          if (!query) {
            await ctx.reply('Usage: !pin search <text>');
            return;
          }
          const rows = await store.search(ctx.roomId, query, 5);
          if (rows.length === 0) {
            await ctx.reply(`No pins match "${query}".`);
            return;
          }
          const lines: Doc[] = [html`Pins matching ${code(query)}:`];
          for (let i = 0, len = rows.length; i < len; i++) {
            const pin = rows[i]!;
            lines.push(
              html`  ${code(`#${pin.eventId}`)} | ${pin.senderName} | ${
                pin.content.length > 40 ? `${pin.content.slice(0, 40)}…` : pin.content
              }`
            );
          }
          const doc = join(lines, '\n');
          await ctx.reply(doc.body, doc.html);
        }
      },
      async (ctx) => {
        const doc = usage(PIN_COMMANDS);
        await ctx.reply(doc.body, doc.html);
      }
    )
  };
}

function pinList(active: Pin[]): Doc {
  const lines: Doc[] = [
    bold(`Pinned messages (${active.length} total)`)
  ];
  if (active.length === 0) {
    lines.push(html`No pinned messages.`);
    return join(lines, '\n');
  }
  for (let i = 0, len = active.length; i < len; i++) {
    const pin = active[i]!;
    const snippet = pin.content.length > 40
      ? `${pin.content.slice(0, 40)}…`
      : pin.content;
    lines.push(
      html`  ${code(`#${pin.eventId}`)} | ${pin.senderName} | ${
        pin.contentType
      } | ${formatUtc8(pin.pinnedAt)}`
    );
    if (snippet && pin.contentType === 'text') {
      lines.push(html`    ${snippet}`);
    }
  }
  lines.push(
    html`To view a pin, send ${code('!pin retrieve <event ID>')}. To delete, send ${
      code('!pin delete <event ID>')
    } (administrators).`
  );
  return join(lines, '\n');
}

async function sendPin(client: MatrixClient, ctx: CommandCtx, pin: Pin) {
  const msgtype = mediaMsgtype(pin.contentType);
  if (msgtype !== undefined && pin.mediaUrl !== null) {
    await client.sendMedia(ctx.roomId, msgtype, pin.content || pin.eventId, pin.mediaUrl);
    return;
  }
  const formatted = replayFormatted(pin);
  const body = pin.content || `[${pin.contentType}]`;
  if (pin.contentType === 'emote') {
    await client.sendEmote(ctx.roomId, body, formatted);
    return;
  }
  await client.sendHtml(ctx.roomId, body, formatted);
}

function replayFormatted(pin: Pin): string {
  if (pin.formatted !== null) {
    const cleaned = sanitize(pin.formatted);
    if (cleaned !== '') return cleaned;
  }
  return escapeHtml(pin.content);
}

function snapshot(content: Record<string, unknown>): {
  contentType: ContentType,
  content: string,
  formatted: string | null,
  mediaUrl: string | null
} {
  const msgtype = typeof content.msgtype === 'string' ? content.msgtype : '';
  const body = typeof content.body === 'string' ? content.body : '';
  const formattedBody = typeof content.formatted_body === 'string'
    ? content.formatted_body
    : null;
  const url = typeof content.url === 'string' ? content.url : null;
  const contentType = MSGTYPE_CONTENT_TYPES[msgtype] ?? 'other';
  return {
    contentType,
    content: body,
    formatted: contentType === 'other' ? null : sanitizeFormatted(formattedBody),
    mediaUrl: contentType === 'text' || contentType === 'emote' ? null : url
  };
}

function sanitizeFormatted(formattedBody: string | null): string | null {
  if (formattedBody === null) return null;
  const cleaned = sanitize(formattedBody);
  return cleaned === '' ? null : cleaned;
}
