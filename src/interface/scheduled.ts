import { attempt } from '../attempt.ts';
import { bold, escapeHtml, html, join } from '../display/html.ts';
import type { Doc } from '../display/html.ts';
import type { WorkStore } from '../domain/ports.ts';
import { weekStats } from '../domain/work.ts';
import { durationText, formatUtc8 } from '../display/format.ts';
import type { MatrixClient } from '../infrastructure/matrix/client.ts';

const DAY_MS = 86_400_000;

export async function sendWeeklyReport(
  client: MatrixClient,
  store: WorkStore
): Promise<void> {
  const start = weekStartUtc8();
  const end = new Date(Date.parse(start) + 6 * DAY_MS).toISOString();
  const rooms = await store.activeRooms(start);
  const jobs: Array<Promise<unknown>> = [];
  for (let i = 0, len = rooms.length; i < len; i++) {
    const roomId = rooms[i]!;
    jobs.push((async () => {
      const stats = weekStats(await store.sessions(roomId, undefined, start));
      const doc = reportDoc(stats, start, end);
      await attempt(() => client.sendHtml(roomId, doc.body, doc.html));
    })());
  }
  await Promise.all(jobs);
}

export async function remindOpenSessions(
  client: MatrixClient,
  store: WorkStore
): Promise<void> {
  const since = new Date(Date.now() - 7 * DAY_MS).toISOString();
  const rooms = await store.activeRooms(since);
  const openLists = await Promise.all(rooms.map((roomId) => store.open(roomId)));
  const messages = new Map<string, string>();
  for (let i = 0, len = openLists.length; i < len; i++) {
    const open = openLists[i]!;
    for (let j = 0, openLen = open.length; j < openLen; j++) {
      const session = open[j]!;
      if (messages.has(session.userId)) continue;
      messages.set(
        session.userId,
        `You have been checked in since ${formatUtc8(session.clockInAt)}. Send !check out to finish.`
      );
    }
  }
  await notifyUsers(client, messages);
}

export async function remindMissingCheckIn(
  client: MatrixClient,
  store: WorkStore
): Promise<void> {
  const since = new Date(Date.now() - 7 * DAY_MS).toISOString();
  const rooms = await store.activeRooms(since);
  const roomData = await Promise.all(rooms.map(async (roomId) => ({
    recent: await store.recentUsers(roomId, since),
    done: new Set((await store.sessions(roomId)).map((s) => s.userId))
  })));
  const messages = new Map<string, string>();
  for (let i = 0, len = roomData.length; i < len; i++) {
    const { recent, done } = roomData[i]!;
    for (let j = 0, recentLen = recent.length; j < recentLen; j++) {
      const user = recent[j]!;
      if (done.has(user.userId) || messages.has(user.userId)) continue;
      messages.set(user.userId, 'Send !check in to start.');
    }
  }
  await notifyUsers(client, messages);
}

async function notifyUsers(
  client: MatrixClient,
  messages: ReadonlyMap<string, string>
): Promise<void> {
  const jobs: Array<Promise<unknown>> = [];
  for (const [userId, body] of messages) {
    jobs.push(attempt(() => directMessage(client, userId, body)));
  }
  await Promise.all(jobs);
}

async function directMessage(
  client: MatrixClient,
  userId: string,
  body: string
): Promise<void> {
  const roomId = await client.createDirectRoom(userId);
  await client.sendHtml(roomId, body, escapeHtml(body));
}

function reportDoc(
  stats: ReturnType<typeof weekStats>,
  start: string,
  end: string
): Doc {
  const lines: Doc[] = [
    bold(`Weekly report (${shortDate(start)} to ${shortDate(end)}, UTC+8)`)
  ];
  if (stats.length === 0) {
    lines.push(html`No check-ins this week.`);
  } else {
    for (let i = 0, len = stats.length; i < len; i++) {
      const stat = stats[i]!;
      lines.push(
        html`  ${String(i + 1)}. ${bold(stat.name)} ${durationText(stat.minutes)}, ${
          String(stat.days)
        } days, streak ${String(stat.streak)}`
      );
    }
  }
  return join(lines, '\n');
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
