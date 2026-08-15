import { bold, fmt, FormattedString } from '@grammyjs/parse-mode';
import type { Bot } from 'grammy';
import type { WorkStore } from '../domain/ports.ts';
import { weekStats } from '../domain/work.ts';
import { durationText, formatUtc8 } from '../display/format.ts';
import type { Ctx } from './kernel.ts';

const DAY_MS = 86_400_000;

export async function sendWeeklyReport(
  bot: Bot<Ctx>,
  store: WorkStore,
  chatId: number,
  threadId: number | undefined
): Promise<void> {
  const start = weekStartUtc8();
  const stats = weekStats(await store.sessions(chatId, undefined, start));
  const end = new Date(Date.parse(start) + 6 * DAY_MS).toISOString();
  const lines: FormattedString[] = [
    fmt`${bold}Weekly report (${shortDate(start)} to ${shortDate(end)}, UTC+8)${bold}`
  ];
  if (stats.length === 0) {
    lines.push(fmt`No check-ins this week.`);
  } else {
    for (let i = 0, len = stats.length; i < len; i++) {
      const stat = stats[i]!;
      lines.push(
        fmt`  ${i + 1}. ${bold}${stat.name}${bold} ${durationText(stat.minutes)}, ${
          stat.days
        } days, streak ${stat.streak}`
      );
    }
  }
  const report = FormattedString.join(lines, '\n');
  await bot.api.sendMessage(chatId, report.text, {
    entities: report.entities,
    message_thread_id: threadId
  });
}

export async function remindOpenSessions(
  bot: Bot<Ctx>,
  store: WorkStore,
  chatId: number
): Promise<void> {
  const open = await store.open(chatId);
  const seen = new Set<number>();
  const jobs: Array<Promise<unknown>> = [];
  for (let i = 0, len = open.length; i < len; i++) {
    const session = open[i]!;
    if (seen.has(session.userId)) continue;
    seen.add(session.userId);
    jobs.push(bot.api
      .sendMessage(
        session.userId,
        `You are still checked in since ${formatUtc8(session.clockInAt)}. Send /check out to finish.`
      )
      .catch((err) => console.error(err)));
  }
  await Promise.all(jobs);
}

export async function remindMissingCheckIn(
  bot: Bot<Ctx>,
  store: WorkStore,
  chatId: number
): Promise<void> {
  const since = new Date(Date.now() - 7 * DAY_MS).toISOString();
  const recent = await store.recentUsers(chatId, since);
  const done = new Set((await store.sessions(chatId)).map((s) => s.userId));
  const jobs: Array<Promise<unknown>> = [];
  for (let i = 0, len = recent.length; i < len; i++) {
    const user = recent[i]!;
    if (done.has(user.userId)) continue;
    jobs.push(bot.api
      .sendMessage(user.userId, 'Time to check in: /check in')
      .catch((err) => console.error(err)));
  }
  await Promise.all(jobs);
}

function weekStartUtc8(): string {
  const utc8 = new Date(Date.now() + 8 * 3_600_000);
  const back = (utc8.getUTCDay() + 6) % 7;
  return new Date(
    Date.UTC(utc8.getUTCFullYear(), utc8.getUTCMonth(), utc8.getUTCDate() - back)
    - 8 * 3_600_000
  ).toISOString();
}

function shortDate(iso: string): string {
  return iso.slice(5, 10);
}
