import { tryCatch } from '@moeru/std/try-catch';
import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import {
  index,
  int,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex
} from 'drizzle-orm/sqlite-core';
import type {
  BurnStore,
  Delivery,
  MediaRef,
  PollStore,
  PollTally,
  ReadMark,
  Stores,
  SubscribeStore
} from '../../domain/ports.ts';
import { CONTENT_TYPES } from '../../domain/value.ts';
import type { ContentType } from '../../domain/value.ts';
import { SUBSCRIBE_PROVIDER } from '../subscribe/sources.ts';
import { Pin } from '../../domain/pin.ts';
import type { PinDraft } from '../../domain/pin.ts';
import type {
  CheckInDraft,
  CheckOutDraft,
  ClosedSession
} from '../../domain/work.ts';
import { Work } from '../../domain/work.ts';

export const works = sqliteTable(
  'works',
  {
    id: int().primaryKey({ autoIncrement: true }),
    roomId: text('room_id').notNull(),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    clockInAt: text('clock_in_at').notNull(),
    clockOutAt: text('clock_out_at'),
    durationMinutes: int('duration_minutes')
  },
  (t) => [
    index('works_room_idx').on(t.roomId),
    index('works_user_idx').on(t.userId),
    uniqueIndex('works_open_idx').on(t.roomId, t.userId).where(
      sql`${t.clockOutAt} IS NULL`
    )
  ]
);

export const pins = sqliteTable(
  'pins',
  {
    id: int().primaryKey({ autoIncrement: true }),
    roomId: text('room_id').notNull(),
    eventId: text('event_id').notNull(),
    userId: text('user_id').notNull(),
    senderName: text('sender_name').notNull(),
    contentType: text('content_type', { enum: CONTENT_TYPES }).notNull(),
    content: text('content').notNull(),
    formatted: text('formatted'),
    mediaUrl: text('media_url'),
    pinnedAt: text('pinned_at').notNull()
  },
  (t) => [
    index('pins_room_idx').on(t.roomId),
    uniqueIndex('pins_room_event_idx').on(t.roomId, t.eventId)
  ]
);

export const ghDeliveries = sqliteTable(
  'gh_deliveries',
  {
    deliveryId: text('delivery_id').primaryKey(),
    createdAt: text('created_at').notNull()
  }
);

export const bindings = sqliteTable(
  'bindings',
  {
    provider: text('provider').notNull(),
    target: text('target').notNull(),
    roomId: text('room_id').notNull()
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.target, t.roomId] }),
    index('bindings_room_idx').on(t.roomId)
  ]
);

export const asTransactions = sqliteTable(
  'as_transactions',
  {
    txnId: text('txn_id').primaryKey(),
    createdAt: text('created_at').notNull()
  }
);

export const polls = sqliteTable(
  'polls',
  {
    id: int().primaryKey({ autoIncrement: true }),
    roomId: text('room_id').notNull(),
    eventId: text('event_id').notNull(),
    question: text('question').notNull(),
    options: text('options').notNull(),
    votes: text('votes').notNull(),
    createdAt: text('created_at').notNull()
  },
  (t) => [uniqueIndex('polls_room_event_idx').on(t.roomId, t.eventId)]
);

export const subscribeMarks = sqliteTable(
  'subscribe_marks',
  {
    target: text('target').notNull(),
    feed: text('feed').notNull(),
    entryId: text('entry_id').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (t) => [primaryKey({ columns: [t.target, t.feed] })]
);

export const readMarks = sqliteTable(
  'read_marks',
  {
    roomId: text('room_id').notNull(),
    userId: text('user_id').notNull(),
    eventId: text('event_id').notNull(),
    eventTs: int('event_ts').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (t) => [primaryKey({ columns: [t.roomId, t.userId] })]
);

export const botState = sqliteTable(
  'bot_state',
  {
    key: text('key').primaryKey(),
    value: text('value').notNull()
  }
);

export const rateHits = sqliteTable(
  'rate_hits',
  {
    key: text('key').primaryKey(),
    count: int('count').notNull(),
    expiresAt: int('expires_at').notNull()
  }
);

export const burnRooms = sqliteTable(
  'burn_rooms',
  {
    roomId: text('room_id').primaryKey(),
    updatedAt: text('updated_at').notNull()
  }
);

export const mediaRefs = sqliteTable(
  'media_refs',
  {
    roomId: text('room_id').notNull(),
    eventId: text('event_id').notNull(),
    urls: text('urls').notNull(),
    ts: text('ts').notNull()
  },
  (t) => [primaryKey({ columns: [t.roomId, t.eventId] })]
);

const RETENTION_DAYS = 7;
const RETENTION_WORKS_DAYS = 90;
const DAY_MS = 86_400_000;

async function wasInserted(
  build: () => Promise<readonly unknown[]>
): Promise<boolean> {
  const rows = await build();
  return rows.length > 0;
}

function workWhere(
  roomId: string,
  userId?: string,
  openOnly = false,
  since?: string
): SQL | undefined {
  return and(
    eq(works.roomId, roomId),
    userId === undefined ? undefined : eq(works.userId, userId),
    openOnly ? isNull(works.clockOutAt) : undefined,
    since === undefined ? undefined : gte(works.clockInAt, since)
  );
}

function pinWhere(roomId: string, eventId?: string): SQL | undefined {
  return and(
    eq(pins.roomId, roomId),
    eventId === undefined ? undefined : eq(pins.eventId, eventId)
  );
}

function bindingWhere(
  provider: string,
  roomId?: string,
  target?: string
): SQL | undefined {
  return and(
    eq(bindings.provider, provider),
    roomId === undefined ? undefined : eq(bindings.roomId, roomId),
    target === undefined ? undefined : eq(bindings.target, target)
  );
}

export class D1Store implements Stores {
  private readonly db: ReturnType<typeof drizzle>;

  constructor(private readonly d1: D1Database) {
    this.db = drizzle(d1);
  }

  async checkIn(input: CheckInDraft): Promise<boolean> {
    return wasInserted(() => this.db
      .insert(works)
      .values(input)
      .onConflictDoNothing()
      .returning({ id: works.id }));
  }

  async checkOut(input: CheckOutDraft): Promise<ClosedSession | null> {
    const rows = await this.db
      .select()
      .from(works)
      .where(workWhere(input.roomId, input.userId, true))
      .limit(1);
    const session = rows[0];
    if (!session) return null;
    const durationMinutes = Math.max(
      0,
      Math.round(
        (new Date(input.clockOutAt).getTime()
          - new Date(session.clockInAt).getTime())
        / 60000
      )
    );
    await this.db
      .update(works)
      .set({ clockOutAt: input.clockOutAt, durationMinutes })
      .where(eq(works.id, session.id));
    return {
      clockInAt: session.clockInAt,
      clockOutAt: input.clockOutAt,
      durationMinutes
    };
  }

  async sessions(
    roomId: string,
    userId?: string,
    since?: string
  ): Promise<Work[]> {
    const start = since ?? new Date(
      new Date().toISOString().slice(0, 10)
    ).toISOString();
    const rows = await this.db
      .select()
      .from(works)
      .where(workWhere(roomId, userId, false, start))
      .orderBy(desc(works.clockInAt));
    return rows.map(Work.from);
  }

  async open(roomId: string): Promise<Work[]> {
    const rows = await this.db
      .select()
      .from(works)
      .where(workWhere(roomId, undefined, true))
      .orderBy(desc(works.clockInAt));
    return rows.map(Work.from);
  }

  async recentUsers(
    roomId: string,
    since: string
  ): Promise<Array<{ userId: string, name: string }>> {
    return this.db
      .selectDistinct({ userId: works.userId, name: works.name })
      .from(works)
      .where(workWhere(roomId, undefined, false, since));
  }

  async activeRooms(since: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ roomId: works.roomId })
      .from(works)
      .where(gte(works.clockInAt, since));
    return rows.map((row) => row.roomId);
  }

  async search(
    roomId: string,
    query: string,
    limit: number
  ): Promise<Pin[]> {
    interface PinRow {
      id: number,
      roomId: string,
      eventId: string,
      userId: string,
      senderName: string,
      contentType: ContentType,
      content: string,
      formatted: string | null,
      mediaUrl: string | null,
      pinnedAt: string
    }
    const res = await this.d1
      .prepare(`
        SELECT p.id, p.room_id AS roomId, p.event_id AS eventId,
               p.user_id AS userId, p.sender_name AS senderName,
               p.content_type AS contentType, p.content, p.formatted,
               p.media_url AS mediaUrl, p.pinned_at AS pinnedAt
        FROM pins_fts
        JOIN pins p ON p.id = pins_fts.rowid
        WHERE p.room_id = ? AND pins_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `)
      .bind(roomId, `"${query.replaceAll('"', '""')}"`, limit)
      .all<PinRow>();
    return res.results.map(Pin.from);
  }

  async ping(): Promise<number> {
    const start = Date.now();
    await this.d1.prepare('SELECT 1').all();
    return Date.now() - start;
  }

  async deliveries(limit: number): Promise<Delivery[]> {
    return this.db
      .select({
        deliveryId: ghDeliveries.deliveryId,
        createdAt: ghDeliveries.createdAt
      })
      .from(ghDeliveries)
      .orderBy(desc(ghDeliveries.createdAt))
      .limit(limit);
  }

  async upsert(input: PinDraft): Promise<void> {
    await this.db
      .insert(pins)
      .values(input)
      .onConflictDoUpdate({
        target: [pins.roomId, pins.eventId],
        set: {
          senderName: input.senderName,
          contentType: input.contentType,
          content: input.content,
          formatted: input.formatted,
          mediaUrl: input.mediaUrl,
          pinnedAt: input.pinnedAt
        }
      });
  }

  async list(roomId: string, limit?: number): Promise<Pin[]> {
    const base = this.db
      .select()
      .from(pins)
      .where(pinWhere(roomId))
      .orderBy(desc(pins.pinnedAt));
    const rows = limit === undefined
      ? await base
      : await base.limit(limit);
    return rows.map(Pin.from);
  }

  async get(roomId: string, eventId: string): Promise<Pin | undefined> {
    const rows = await this.db
      .select()
      .from(pins)
      .where(pinWhere(roomId, eventId))
      .limit(1);
    return rows[0] ? Pin.from(rows[0]) : undefined;
  }

  async remove(roomId: string, eventId: string): Promise<boolean> {
    const res = await this.db
      .delete(pins)
      .where(pinWhere(roomId, eventId));
    return res.meta.changes > 0;
  }

  async pinnedEventIds(roomId: string): Promise<string[]> {
    const rows = await this.db
      .select({ eventId: pins.eventId })
      .from(pins)
      .where(eq(pins.roomId, roomId));
    return rows.map((row) => row.eventId);
  }

  async saveMediaRef(ref: MediaRef): Promise<void> {
    const urls = JSON.stringify(ref.urls);
    await this.db
      .insert(mediaRefs)
      .values({ roomId: ref.roomId, eventId: ref.eventId, urls, ts: ref.ts })
      .onConflictDoUpdate({
        target: [mediaRefs.roomId, mediaRefs.eventId],
        set: { urls, ts: ref.ts }
      });
  }

  async mediaRefUrls(roomId: string, eventId: string): Promise<string[] | null> {
    const rows = await this.db
      .select({ urls: mediaRefs.urls })
      .from(mediaRefs)
      .where(and(eq(mediaRefs.roomId, roomId), eq(mediaRefs.eventId, eventId)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return parseMediaUrls(row.urls);
  }

  async dropMediaRef(roomId: string, eventId: string): Promise<void> {
    await this.db
      .delete(mediaRefs)
      .where(and(eq(mediaRefs.roomId, roomId), eq(mediaRefs.eventId, eventId)));
  }

  async record(deliveryId: string, timestamp: string): Promise<boolean> {
    return wasInserted(() => this.db
      .insert(ghDeliveries)
      .values({ deliveryId, createdAt: timestamp })
      .onConflictDoNothing()
      .returning({ deliveryId: ghDeliveries.deliveryId }));
  }

  async drop(deliveryId: string): Promise<void> {
    await this.db
      .delete(ghDeliveries)
      .where(eq(ghDeliveries.deliveryId, deliveryId));
  }

  async bind(provider: string, target: string, roomId: string): Promise<boolean> {
    const res = await this.db
      .insert(bindings)
      .values({ provider, target, roomId })
      .onConflictDoNothing();
    return res.meta.changes > 0;
  }

  async unbind(provider: string, target: string, roomId: string): Promise<boolean> {
    const res = await this.db
      .delete(bindings)
      .where(bindingWhere(provider, roomId, target));
    return res.meta.changes > 0;
  }

  async targets(provider: string, roomId: string): Promise<string[]> {
    const rows = await this.db
      .select({ target: bindings.target })
      .from(bindings)
      .where(bindingWhere(provider, roomId))
      .orderBy(bindings.target);
    return rows.map((row) => row.target);
  }

  async chats(provider: string, target: string): Promise<string[]> {
    const rows = await this.db
      .select({ roomId: bindings.roomId })
      .from(bindings)
      .where(bindingWhere(provider, undefined, target))
      .orderBy(bindings.roomId);
    return rows.map((row) => row.roomId);
  }

  async recordTransaction(txnId: string, timestamp: string): Promise<boolean> {
    return wasInserted(() => this.db
      .insert(asTransactions)
      .values({ txnId, createdAt: timestamp })
      .onConflictDoNothing()
      .returning({ txnId: asTransactions.txnId }));
  }

  async dropTransaction(txnId: string): Promise<void> {
    await this.db
      .delete(asTransactions)
      .where(eq(asTransactions.txnId, txnId));
  }

  async rateIncr(key: string, frameMs: number): Promise<number> {
    const now = Date.now();
    await this.db
      .insert(rateHits)
      .values({ key, count: 1, expiresAt: now + frameMs })
      .onConflictDoUpdate({
        target: rateHits.key,
        set: {
          count: sql`CASE WHEN ${rateHits.expiresAt} <= ${now} THEN 1 ELSE ${rateHits.count} + 1 END`,
          expiresAt: sql`CASE WHEN ${rateHits.expiresAt} <= ${now} THEN ${now + frameMs} ELSE ${rateHits.expiresAt} END`
        }
      });
    const rows = await this.db
      .select({ count: rateHits.count })
      .from(rateHits)
      .where(eq(rateHits.key, key))
      .limit(1);
    return rows[0]?.count ?? 1;
  }

  async pollCreate(
    roomId: string,
    eventId: string,
    question: string,
    options: string[],
    createdAt: string
  ): Promise<void> {
    await this.db
      .insert(polls)
      .values({
        roomId,
        eventId,
        question,
        options: JSON.stringify(options),
        votes: '{}',
        createdAt
      })
      .onConflictDoNothing();
  }

  async pollVote(
    roomId: string,
    eventId: string,
    optionIndex: number,
    voter: string
  ): Promise<PollTally | null> {
    const rows = await this.db
      .select()
      .from(polls)
      .where(and(eq(polls.roomId, roomId), eq(polls.eventId, eventId)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const parsedOptions = parseJson(row.options);
    if (parsedOptions === undefined) return null;
    const options = stringArray(parsedOptions);
    if (optionIndex < 0 || optionIndex >= options.length) return null;
    const votes = parsePollVotes(row.votes);
    const voters = votes.get(optionIndex) ?? new Set<string>();
    voters.add(voter);
    votes.set(optionIndex, voters);
    const serialized: Record<string, string[]> = {};
    for (const [index, senders] of votes) serialized[String(index)] = [...senders];
    await this.db
      .update(polls)
      .set({ votes: JSON.stringify(serialized) })
      .where(eq(polls.id, row.id));
    const counts = options.map((_option, i) => votes.get(i)?.size ?? 0);
    return { question: row.question, options, counts };
  }

  async subscribeTargets(): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ target: bindings.target })
      .from(bindings)
      .where(eq(bindings.provider, SUBSCRIBE_PROVIDER));
    return rows.map((row) => row.target);
  }

  async subscribeAdvance(
    target: string,
    feed: string,
    entryId: string,
    at: string
  ): Promise<string | null> {
    const rows = await this.db
      .select({ entryId: subscribeMarks.entryId })
      .from(subscribeMarks)
      .where(and(eq(subscribeMarks.target, target), eq(subscribeMarks.feed, feed)))
      .limit(1);
    const previous = rows[0]?.entryId ?? null;
    if (previous !== entryId) {
      await this.db
        .insert(subscribeMarks)
        .values({ target, feed, entryId, updatedAt: at })
        .onConflictDoUpdate({
          target: [subscribeMarks.target, subscribeMarks.feed],
          set: { entryId, updatedAt: at }
        });
    }
    return previous;
  }

  async burnRooms(): Promise<string[]> {
    const rows = await this.db
      .select({ roomId: burnRooms.roomId })
      .from(burnRooms);
    return rows.map((row) => row.roomId);
  }

  async burnEnable(roomId: string, at: string): Promise<void> {
    await this.db
      .insert(burnRooms)
      .values({ roomId, updatedAt: at })
      .onConflictDoNothing();
  }

  async burnDisable(roomId: string): Promise<boolean> {
    const res = await this.db
      .delete(burnRooms)
      .where(eq(burnRooms.roomId, roomId));
    return res.meta.changes > 0;
  }

  async readMarks(roomId: string): Promise<ReadMark[]> {
    return this.db
      .select({
        roomId: readMarks.roomId,
        userId: readMarks.userId,
        eventId: readMarks.eventId,
        eventTs: readMarks.eventTs
      })
      .from(readMarks)
      .where(eq(readMarks.roomId, roomId));
  }

  async upsertReadMark(mark: ReadMark, at: string): Promise<void> {
    const rows = await this.db
      .select({ eventTs: readMarks.eventTs })
      .from(readMarks)
      .where(and(eq(readMarks.roomId, mark.roomId), eq(readMarks.userId, mark.userId)))
      .limit(1);
    if (rows[0] !== undefined && rows[0].eventTs >= mark.eventTs) return;
    await this.db
      .insert(readMarks)
      .values({ ...mark, updatedAt: at })
      .onConflictDoUpdate({
        target: [readMarks.roomId, readMarks.userId],
        set: { eventId: mark.eventId, eventTs: mark.eventTs, updatedAt: at }
      });
  }

  async stateGet(key: string): Promise<string | null> {
    const rows = await this.db
      .select({ value: botState.value })
      .from(botState)
      .where(eq(botState.key, key))
      .limit(1);
    return rows[0]?.value ?? null;
  }

  async stateSet(key: string, value: string): Promise<void> {
    await this.db
      .insert(botState)
      .values({ key, value })
      .onConflictDoUpdate({ target: botState.key, set: { value } });
  }

  async purge(): Promise<void> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * DAY_MS).toISOString();
    const worksCutoff = new Date(
      Date.now() - RETENTION_WORKS_DAYS * DAY_MS
    ).toISOString();
    await this.db.batch([
      this.db
        .delete(works)
        .where(lt(works.clockInAt, worksCutoff)),
      this.db
        .delete(ghDeliveries)
        .where(lt(ghDeliveries.createdAt, cutoff)),
      this.db
        .delete(asTransactions)
        .where(lt(asTransactions.createdAt, cutoff)),
      this.db
        .delete(polls)
        .where(lt(polls.createdAt, cutoff)),
      this.db
        .delete(mediaRefs)
        .where(lt(mediaRefs.ts, cutoff)),
      this.db
        .delete(rateHits)
        .where(lt(rateHits.expiresAt, Date.now()))
    ]);
  }
}

function parseJson(raw: string): unknown {
  return tryCatch(() => JSON.parse(raw) as unknown).data;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function parseMediaUrls(raw: string): string[] | null {
  const parsed = parseJson(raw);
  if (!Array.isArray(parsed)) return null;
  return stringArray(parsed);
}

function parsePollVotes(raw: string): Map<number, Set<string>> {
  const result = new Map<number, Set<string>>();
  const parsed = parseJson(raw);
  if (typeof parsed !== 'object' || parsed === null) return result;
  const entries = Object.entries(parsed);
  for (let i = 0, len = entries.length; i < len; i++) {
    const [key, value] = entries[i]!;
    const index = Number(key);
    if (!Number.isSafeInteger(index) || !Array.isArray(value)) continue;
    result.set(index, new Set(stringArray(value)));
  }
  return result;
}
