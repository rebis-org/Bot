import * as v from 'valibot';
import { entity, nonEmpty, nonzeroId, positiveId, record } from './value.ts';

interface SessionShape {
  id: number,
  chatId: number,
  userId: number,
  name: string,
  clockInAt: string,
  clockOutAt: string | null,
  durationMinutes: number | null
}

const sessionChecks: ReadonlyArray<
  v.PipeItem<SessionShape, SessionShape, v.BaseIssue<unknown>>
> = [
  v.check(
    (session: SessionShape) => (session.clockOutAt === null)
      === (session.durationMinutes === null),
    'clock-out time and duration must be either both set or both null'
  ),
  v.check(
    (session: SessionShape) => session.durationMinutes === null
      || session.durationMinutes >= 0,
    'duration must be non-negative'
  ),
  v.check(
    (session: SessionShape) => session.clockOutAt === null
      || new Date(session.clockOutAt).getTime() >= new Date(session.clockInAt).getTime(),
    'clock-out time must not be before clock-in time'
  )
];

const checkInFields = {
  chatId: nonzeroId('chat id'),
  userId: nonzeroId('user id'),
  name: nonEmpty('name'),
  clockInAt: nonEmpty('clock-in time')
} satisfies v.ObjectEntries;

const checkOutFields = {
  chatId: nonzeroId('chat id'),
  userId: nonzeroId('user id'),
  clockOutAt: nonEmpty('clock-out time')
} satisfies v.ObjectEntries;

const workFields = {
  ...checkInFields,
  clockOutAt: v.nullable(v.string()),
  durationMinutes: v.nullable(v.number())
} satisfies v.ObjectEntries;

const checkInSchema = v.object(checkInFields);
const checkOutSchema = v.object(checkOutFields);
const workSchema = v.pipe(
  v.object({ id: positiveId('session id'), ...workFields }),
  ...sessionChecks
);

export const CheckInDraft = record(checkInSchema);
export type CheckInDraft = v.InferOutput<typeof checkInSchema>;

export const CheckOutDraft = record(checkOutSchema);
export type CheckOutDraft = v.InferOutput<typeof checkOutSchema>;

export const Work = entity(workSchema);
export type Work = v.InferOutput<typeof workSchema>;

export interface ClosedSession {
  clockInAt: string,
  clockOutAt: string,
  durationMinutes: number
}

export interface WeekStat {
  userId: number,
  name: string,
  minutes: number,
  days: number,
  streak: number
}

const DAY_MS = 86_400_000;
const UTC8 = 8 * 3_600_000;

function dayKeyUtc8(iso: string): string {
  return new Date(Date.parse(iso) + UTC8).toISOString().slice(0, 10);
}

export function weekStats(rows: readonly Work[]): WeekStat[] {
  const byUser = new Map<
    number,
    { name: string, minutes: number, days: Set<string> }
  >();
  for (let i = 0, len = rows.length; i < len; i++) {
    const row = rows[i]!;
    const stat = byUser.get(row.userId)
      ?? { name: row.name, minutes: 0, days: new Set<string>() };
    stat.minutes += row.durationMinutes ?? 0;
    stat.days.add(dayKeyUtc8(row.clockInAt));
    byUser.set(row.userId, stat);
  }
  const today = dayKeyUtc8(new Date().toISOString());
  const yesterday = dayKeyUtc8(new Date(Date.now() - DAY_MS).toISOString());
  return Array.from(byUser, ([userId, stat]) => ({
    userId,
    name: stat.name,
    minutes: stat.minutes,
    days: stat.days.size,
    streak: streakLength(stat.days, today, yesterday)
  })).sort((a, b) => b.minutes - a.minutes);
}

function streakLength(
  days: ReadonlySet<string>,
  today: string,
  yesterday: string
): number {
  let cursor = days.has(today) ? today : yesterday;
  let count = 0;
  while (days.has(cursor)) {
    count += 1;
    cursor = dayKeyUtc8(
      new Date(Date.parse(`${cursor}T00:00:00Z`) - DAY_MS).toISOString()
    );
  }
  return count;
}
