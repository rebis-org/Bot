import { bold, code, fmt, FormattedString } from '@grammyjs/parse-mode';
import type { WorkStore } from '../../domain/ports.ts';
import { CheckInDraft, CheckOutDraft } from '../../domain/work.ts';
import type { Work } from '../../domain/work.ts';
import { durationText, formatUtc8, userDisplayName } from '../../display/format.ts';
import type { Command, GroupCtx } from '../kernel.ts';
import {
  admin,
  commandArgs,
  parseId,
  send,
  subcommands,
  usage
} from '../kernel.ts';

export const CHECK_COMMANDS = [
  { command: '/check in', desc: 'Check in' },
  { command: '/check out', desc: 'Check out' },
  {
    command: '/check retrieve [user ID]',
    desc: 'View work hours for today (administrators)'
  }
] as const;

const RE_SPACE = /\s+/;

export function check(store: WorkStore): Command {
  return {
    name: 'check',
    desc: 'Check in/out, retrieve (administrators)',
    section: 'Check-in/out',
    rows: CHECK_COMMANDS,
    handler: subcommands<GroupCtx>(
      {
        async in(c) {
          const at = new Date().toISOString();
          const ok = await store.checkIn(CheckInDraft.create({
            chatId: c.chat.id,
            userId: c.from.id,
            name: userDisplayName(c.from),
            clockInAt: at
          }));
          await send(
            c,
            ok
              ? fmt`Check-in complete. Time: ${code}${formatUtc8(at)}${code}.`
              : fmt`You are already checked in.`
          );
        },
        async out(c) {
          const session = await store.checkOut(CheckOutDraft.create({
            chatId: c.chat.id,
            userId: c.from.id,
            clockOutAt: new Date().toISOString()
          }));
          await send(
            c,
            session
              ? fmt`Check-out complete. Time: ${code}${
                formatUtc8(session.clockInAt)
              } → ${formatUtc8(session.clockOutAt)}${code}. Duration: ${code}${
                durationText(session.durationMinutes)
              }${code}.`
              : fmt`No active check-in. Send /check in first.`
          );
        },
        retrieve: admin(async (c) => {
          const userId = parseId(subcommandArg(commandArgs(c)));
          await send(
            c,
            todayReport(await store.sessions(c.chat.id, userId))
          );
        })
      },
      async (c) => {
        await send(c, usage(CHECK_COMMANDS));
      }
    ).middleware()
  };
}

export function todayReport(rows: Work[]): FormattedString {
  const lines: FormattedString[] = [
    fmt`${bold}Work hours for today (${
      new Date().toISOString().slice(0, 10)
    } UTC)${bold}`
  ];
  if (rows.length === 0) {
    lines.push(fmt`No check-in records for today.`);
    return FormattedString.join(lines, '\n');
  }
  const byUser = new Map<number, Work[]>();
  for (let i = 0, len = rows.length; i < len; i++) {
    const row = rows[i]!;
    const sessions = byUser.get(row.userId);
    if (sessions) sessions.push(row);
    else byUser.set(row.userId, [row]);
  }
  for (const [userId, sessions] of byUser) {
    lines.push(fmt`  ${sessions[0]?.name ?? userId}`);
    let total = 0;
    for (let i = 0, len = sessions.length; i < len; i++) {
      const session = sessions[i]!;
      if (session.clockOutAt !== null && session.durationMinutes !== null) {
        total += session.durationMinutes;
        lines.push(
          fmt`    ${code}${formatUtc8(session.clockInAt)} → ${
            formatUtc8(session.clockOutAt)
          }${code}, ${durationText(session.durationMinutes)}`
        );
      } else {
        lines.push(
          fmt`    ${code}${formatUtc8(session.clockInAt)}${code} → (Not checked out)`
        );
      }
    }
    lines.push(fmt`    Total: ${durationText(total)}`);
  }
  return FormattedString.join(lines, '\n');
}

function subcommandArg(args: string): string {
  return args.split(RE_SPACE).slice(1).join(' ').trim();
}
