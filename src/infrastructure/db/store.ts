import type { MessageEntity } from '@grammyjs/types';
import { and, desc, eq, gte, isNotNull, isNull, lt, sql } from 'drizzle-orm';
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
import type { Delivery, Stores } from '../../domain/ports.ts';
import { CONTENT_TYPES } from '../../domain/value.ts';
import type { ContentType } from '../../domain/value.ts';
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
    chatId: int('chat_id').notNull(),
    userId: int('user_id').notNull(),
    name: text('name').notNull(),
    clockInAt: text('clock_in_at').notNull(),
    clockOutAt: text('clock_out_at'),
    durationMinutes: int('duration_minutes'),
    deletedAt: text('deleted_at')
  },
  (t) => [
    index('works_chat_idx').on(t.chatId),
    index('works_user_idx').on(t.userId),
    uniqueIndex('works_open_idx').on(t.chatId, t.userId).where(
      sql`${t.clockOutAt} IS NULL`
    )
  ]
);

export const pins = sqliteTable(
  'pins',
  {
    id: int().primaryKey({ autoIncrement: true }),
    chatId: int('chat_id').notNull(),
    messageId: int('message_id').notNull(),
    userId: int('user_id').notNull(),
    senderName: text('sender_name').notNull(),
    contentType: text('content_type', { enum: CONTENT_TYPES }).notNull(),
    content: text('content').notNull(),
    entities: text({ mode: 'json' }).$type<MessageEntity[]>(),
    fileId: text('file_id'),
    pinnedAt: text('pinned_at').notNull(),
    unpinnedAt: text('unpinned_at'),
    deletedAt: text('deleted_at')
  },
  (t) => [
    index('pins_chat_idx').on(t.chatId),
    uniqueIndex('pins_chat_msg_idx').on(t.chatId, t.messageId)
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
    chatId: int('chat_id').notNull()
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.target, t.chatId] }),
    index('bindings_chat_idx').on(t.chatId)
  ]
);

const RETENTION_DAYS = 7;
const DAY_MS = 86_400_000;

async function wasInserted(
  build: () => Promise<readonly unknown[]>
): Promise<boolean> {
  const rows = await build();
  return rows.length > 0;
}

function workWhere(
  chatId: number,
  userId?: number,
  openOnly = false,
  since?: string
): SQL | undefined {
  return and(
    eq(works.chatId, chatId),
    userId === undefined ? undefined : eq(works.userId, userId),
    openOnly ? isNull(works.clockOutAt) : undefined,
    isNull(works.deletedAt),
    since === undefined ? undefined : gte(works.clockInAt, since)
  );
}

function pinWhere(chatId: number, messageId?: number): SQL | undefined {
  return and(
    eq(pins.chatId, chatId),
    messageId === undefined ? undefined : eq(pins.messageId, messageId),
    isNull(pins.deletedAt)
  );
}

function bindingWhere(
  provider: string,
  chatId?: number,
  target?: string
): SQL | undefined {
  return and(
    eq(bindings.provider, provider),
    chatId === undefined ? undefined : eq(bindings.chatId, chatId),
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
      .where(workWhere(input.chatId, input.userId, true))
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
    chatId: number,
    userId?: number,
    since?: string
  ): Promise<Work[]> {
    const start = since ?? new Date(
      new Date().toISOString().slice(0, 10)
    ).toISOString();
    const rows = await this.db
      .select()
      .from(works)
      .where(workWhere(chatId, userId, false, start))
      .orderBy(desc(works.clockInAt));
    return rows.map(Work.from);
  }

  async open(chatId: number): Promise<Work[]> {
    const rows = await this.db
      .select()
      .from(works)
      .where(workWhere(chatId, undefined, true))
      .orderBy(desc(works.clockInAt));
    return rows.map(Work.from);
  }

  async recentUsers(
    chatId: number,
    since: string
  ): Promise<Array<{ userId: number, name: string }>> {
    return this.db
      .selectDistinct({ userId: works.userId, name: works.name })
      .from(works)
      .where(workWhere(chatId, undefined, false, since));
  }

  async search(
    chatId: number,
    query: string,
    limit: number
  ): Promise<Pin[]> {
    interface PinRow {
      id: number,
      chat_id: number,
      message_id: number,
      user_id: number,
      sender_name: string,
      content_type: string,
      content: string,
      entities: string | null,
      file_id: string | null,
      pinned_at: string,
      unpinned_at: string | null,
      deleted_at: string | null
    }
    const res = await this.d1
      .prepare(`
        SELECT p.id, p.chat_id, p.message_id, p.user_id, p.sender_name,
               p.content_type, p.content, p.entities, p.file_id, p.pinned_at,
               p.unpinned_at, p.deleted_at
        FROM pins_fts
        JOIN pins p ON p.id = pins_fts.rowid
        WHERE p.chat_id = ? AND p.deleted_at IS NULL
          AND pins_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `)
      .bind(chatId, `"${query.replaceAll('"', '""')}"`, limit)
      .all<PinRow>();
    return res.results.map((row) => Pin.from({
      id: row.id,
      chatId: row.chat_id,
      messageId: row.message_id,
      userId: row.user_id,
      senderName: row.sender_name,
      contentType: row.content_type as ContentType,
      content: row.content,
      entities: row.entities === null
        ? null
        : JSON.parse(row.entities) as MessageEntity[],
      fileId: row.file_id,
      pinnedAt: row.pinned_at,
      unpinnedAt: row.unpinned_at,
      deletedAt: row.deleted_at
    }));
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
        target: [pins.chatId, pins.messageId],
        set: {
          senderName: input.senderName,
          contentType: input.contentType,
          content: input.content,
          entities: input.entities,
          fileId: input.fileId,
          pinnedAt: input.pinnedAt,
          unpinnedAt: null,
          deletedAt: null
        }
      });
  }

  async list(chatId: number, limit?: number): Promise<Pin[]> {
    const base = this.db
      .select()
      .from(pins)
      .where(pinWhere(chatId))
      .orderBy(desc(pins.pinnedAt));
    const rows = limit === undefined
      ? await base
      : await base.limit(limit);
    return rows.map(Pin.from);
  }

  async get(chatId: number, messageId: number): Promise<Pin | undefined> {
    const rows = await this.db
      .select()
      .from(pins)
      .where(pinWhere(chatId, messageId))
      .limit(1);
    return rows[0] ? Pin.from(rows[0]) : undefined;
  }

  async remove(
    chatId: number,
    messageId: number,
    timestamp: string
  ): Promise<boolean> {
    const res = await this.db
      .update(pins)
      .set({
        unpinnedAt: timestamp,
        deletedAt: timestamp,
        content: '',
        entities: null,
        fileId: null
      })
      .where(pinWhere(chatId, messageId));
    return res.meta.changes > 0;
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

  async bind(provider: string, target: string, chatId: number): Promise<void> {
    await this.db
      .insert(bindings)
      .values({ provider, target, chatId })
      .onConflictDoNothing();
  }

  async unbind(provider: string, target: string, chatId: number): Promise<boolean> {
    const res = await this.db
      .delete(bindings)
      .where(bindingWhere(provider, chatId, target));
    return res.meta.changes > 0;
  }

  async targets(provider: string, chatId: number): Promise<string[]> {
    const rows = await this.db
      .select({ target: bindings.target })
      .from(bindings)
      .where(bindingWhere(provider, chatId))
      .orderBy(bindings.target);
    return rows.map((row) => row.target);
  }

  async chats(provider: string, target: string): Promise<number[]> {
    const rows = await this.db
      .select({ chatId: bindings.chatId })
      .from(bindings)
      .where(bindingWhere(provider, undefined, target))
      .orderBy(bindings.chatId);
    return rows.map((row) => row.chatId);
  }

  async purge(): Promise<void> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * DAY_MS).toISOString();
    await this.db.batch([
      this.db
        .delete(pins)
        .where(and(isNotNull(pins.deletedAt), lt(pins.deletedAt, cutoff))),
      this.db
        .delete(works)
        .where(and(isNotNull(works.deletedAt), lt(works.deletedAt, cutoff))),
      this.db
        .delete(ghDeliveries)
        .where(lt(ghDeliveries.createdAt, cutoff))
    ]);
  }
}
