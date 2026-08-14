import { bold, code, fmt, FormattedString } from '@grammyjs/parse-mode';
import type { Router } from '@grammyjs/router';
import type { Work } from './domain.ts';
import { CheckInDraft, CheckOutDraft } from './domain.ts';
import { durationText, formatUtcCn, userDisplayName } from './format.ts';
import type { GroupCtx } from './kernel.ts';
import {
  admin,
  commandArgs,
  parseId,
  send,
  subcommands,
  usage
} from './kernel.ts';
import type { Store } from './store.ts';

const USAGE = usage([
  ['/check in', 'Check in'],
  ['/check out', 'Check out'],
  ['/check retrieve [user ID]', 'View work hours for today (administrators)']
]);

const RE_SPACE = /\s+/;

export function check(store: Store): Router<GroupCtx> {
  return subcommands<GroupCtx>(
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
            ? fmt`Check-in complete. Time: ${code}${formatUtcCn(at)}${code}.`
            : fmt`You are already checked in.`
        );
      },
      async out(c) {
        const out = await store.checkOut(CheckOutDraft.create({
          chatId: c.chat.id,
          userId: c.from.id,
          clockOutAt: new Date().toISOString()
        }));
        await send(
          c,
          out
            ? fmt`Check-out complete. Time: ${code}${
              formatUtcCn(out.clockInAt)
            } → ${formatUtcCn(out.clockOutAt)}${code}. Duration: ${code}${
              durationText(out.durationMinutes)
            }${code}.`
            : fmt`No active check-in. Send /check in first.`
        );
      },
      retrieve: admin(async (c) => {
        const userId = parseId(subcommandArg(commandArgs(c)));
        await send(
          c,
          todayReport(
            await store.todaySessions(c.chat.id, userId)
          )
        );
      })
    },
    async (c) => {
      await send(c, USAGE);
    }
  );
}

function todayReport(rows: Work[]): FormattedString {
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
    lines.push(fmt`- ${sessions[0]?.name ?? userId}`);
    let total = 0;
    for (let i = 0, len = sessions.length; i < len; i++) {
      const s = sessions[i]!;
      if (s.clockOutAt !== null && s.durationMinutes !== null) {
        total += s.durationMinutes;
        lines.push(
          fmt`  - ${code}${formatUtcCn(s.clockInAt)} → ${
            formatUtcCn(s.clockOutAt)
          }${code}, ${durationText(s.durationMinutes)}`
        );
      } else {
        lines.push(
          fmt`  - ${code}${
            formatUtcCn(s.clockInAt)
          }${code} → (Not checked out)`
        );
      }
    }
    lines.push(fmt`  Total: ${durationText(total)}`);
  }
  return FormattedString.join(lines, '\n');
}

function subcommandArg(args: string): string {
  return args.split(RE_SPACE).slice(1).join(' ').trim();
}
