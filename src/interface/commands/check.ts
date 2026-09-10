import { bold, code, html, join } from '../../display/html.ts';
import type { Doc } from '../../display/html.ts';
import type { WorkStore } from '../../domain/ports.ts';
import { CheckInDraft, CheckOutDraft } from '../../domain/work.ts';
import type { Work } from '../../domain/work.ts';
import { durationText, formatUtc8 } from '../../display/format.ts';
import type { Command } from '../kernel.ts';
import { admin, subcommands, usage } from '../kernel.ts';

export const CHECK_COMMANDS = [
  { command: '!check in', desc: 'Check in' },
  { command: '!check out', desc: 'Check out' },
  {
    command: '!check retrieve [user ID]',
    desc: 'View work hours for today (administrators)'
  }
] as const;

export function check(store: WorkStore): Command {
  return {
    name: 'check',
    desc: 'Check in/out, retrieve (administrators)',
    section: 'Check-in/out',
    rows: CHECK_COMMANDS,
    handler: subcommands(
      {
        async in(ctx) {
          const at = new Date().toISOString();
          const ok = await store.checkIn(CheckInDraft.create({
            roomId: ctx.roomId,
            userId: ctx.sender,
            name: ctx.sender,
            clockInAt: at
          }));
          if (ok) {
            const doc = html`Check-in complete. Time: ${code(formatUtc8(at))}.`;
            await ctx.reply(doc.body, doc.html);
          } else {
            await ctx.reply('You are already checked in.');
          }
        },
        async out(ctx) {
          const session = await store.checkOut(CheckOutDraft.create({
            roomId: ctx.roomId,
            userId: ctx.sender,
            clockOutAt: new Date().toISOString()
          }));
          if (session) {
            const doc = html`Check-out complete. Time: ${
              code(`${formatUtc8(session.clockInAt)} → ${formatUtc8(session.clockOutAt)}`)
            }. Duration: ${code(durationText(session.durationMinutes))}.`;
            await ctx.reply(doc.body, doc.html);
          } else {
            await ctx.reply('No active check-in. Send !check in first.');
          }
        },
        retrieve: admin(async (ctx) => {
          const userId = ctx.args.trim();
          const report = todayReport(
            await store.sessions(ctx.roomId, userId === '' ? undefined : userId)
          );
          await ctx.reply(report.body, report.html);
        })
      },
      async (ctx) => {
        const doc = usage(CHECK_COMMANDS);
        await ctx.reply(doc.body, doc.html);
      }
    )
  };
}

export function todayReport(rows: Work[]): Doc {
  const lines: Doc[] = [
    bold(`Work hours for today (${new Date().toISOString().slice(0, 10)} UTC)`)
  ];
  if (rows.length === 0) {
    lines.push(html`No check-in records for today.`);
    return join(lines, '\n');
  }
  const byUser = new Map<string, Work[]>();
  for (let i = 0, len = rows.length; i < len; i++) {
    const row = rows[i]!;
    const sessions = byUser.get(row.userId);
    if (sessions) sessions.push(row);
    else byUser.set(row.userId, [row]);
  }
  for (const [userId, sessions] of byUser) {
    lines.push(html`  ${sessions[0]?.name ?? userId}`);
    let total = 0;
    for (let i = 0, len = sessions.length; i < len; i++) {
      const session = sessions[i]!;
      if (session.clockOutAt !== null && session.durationMinutes !== null) {
        total += session.durationMinutes;
        lines.push(
          html`    ${
            code(`${formatUtc8(session.clockInAt)} → ${formatUtc8(session.clockOutAt)}`)
          }, ${durationText(session.durationMinutes)}`
        );
      } else {
        lines.push(
          html`    ${code(formatUtc8(session.clockInAt))} → (not checked out)`
        );
      }
    }
    lines.push(html`    Total: ${durationText(total)}`);
  }
  return join(lines, '\n');
}
