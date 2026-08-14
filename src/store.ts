import type { MessageEntity } from '@grammyjs/types';
import { and, desc, eq, gte, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import {
  index,
  int,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex
} from 'drizzle-orm/sqlite-core';
import type { CheckInDraft, CheckOutDraft, PinDraft } from './domain.ts';
import { CONTENT_TYPES, Pin, Work } from './domain.ts';

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

export interface ClosedSession {
  clockInAt: string,
  clockOutAt: string,
  durationMinutes: number
}

const RETENTION_DAYS = 30;
const DAY_MS = 86_400_000;

export class Store {
  private readonly db: ReturnType<typeof drizzle>;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  async checkIn(input: CheckInDraft): Promise<boolean> {
    const rows = await this.db
      .insert(works)
      .values(input)
      .onConflictDoNothing()
      .returning({ id: works.id });
    return rows.length > 0;
  }

  async checkOut(input: CheckOutDraft): Promise<ClosedSession | null> {
    const open = await this.db
      .select()
      .from(works)
      .where(
        and(
          eq(works.chatId, input.chatId),
          eq(works.userId, input.userId),
          isNull(works.clockOutAt),
          isNull(works.deletedAt)
        )
      )
      .limit(1);
    const session = open[0];
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

  async todaySessions(chatId: number, userId?: number): Promise<Work[]> {
    const start = new Date(new Date().toISOString().slice(0, 10)).toISOString();
    const rows = await this.db
      .select()
      .from(works)
      .where(
        and(
          eq(works.chatId, chatId),
          isNull(works.deletedAt),
          gte(works.clockInAt, start),
          userId === undefined ? undefined : eq(works.userId, userId)
        )
      )
      .orderBy(desc(works.clockInAt));
    return rows.map(Work.from);
  }

  async upsertPin(input: PinDraft): Promise<void> {
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

  async activePins(chatId: number, limit?: number): Promise<Pin[]> {
    const base = this.db
      .select()
      .from(pins)
      .where(and(eq(pins.chatId, chatId), isNull(pins.deletedAt)))
      .orderBy(desc(pins.pinnedAt));
    const rows = limit === undefined
      ? await base
      : await base.limit(limit);
    return rows.map(Pin.from);
  }

  async getPin(chatId: number, messageId: number): Promise<Pin | undefined> {
    const rows = await this.db
      .select()
      .from(pins)
      .where(
        and(
          eq(pins.chatId, chatId),
          eq(pins.messageId, messageId),
          isNull(pins.deletedAt)
        )
      )
      .limit(1);
    return rows[0] ? Pin.from(rows[0]) : undefined;
  }

  async removePin(
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
      .where(
        and(
          eq(pins.chatId, chatId),
          eq(pins.messageId, messageId),
          isNull(pins.deletedAt)
        )
      );
    return res.meta.changes > 0;
  }

  async recordDelivery(
    deliveryId: string,
    timestamp: string
  ): Promise<boolean> {
    const rows = await this.db
      .insert(ghDeliveries)
      .values({ deliveryId, createdAt: timestamp })
      .onConflictDoNothing()
      .returning({ deliveryId: ghDeliveries.deliveryId });
    return rows.length > 0;
  }

  async dropDelivery(deliveryId: string): Promise<void> {
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
      .where(
        and(
          eq(bindings.provider, provider),
          eq(bindings.target, target),
          eq(bindings.chatId, chatId)
        )
      );
    return res.meta.changes > 0;
  }

  async targetsFor(provider: string, chatId: number): Promise<string[]> {
    const rows = await this.db
      .select({ target: bindings.target })
      .from(bindings)
      .where(
        and(eq(bindings.provider, provider), eq(bindings.chatId, chatId))
      )
      .orderBy(bindings.target);
    return rows.map((row) => row.target);
  }

  async chatsFor(provider: string, target: string): Promise<number[]> {
    const rows = await this.db
      .select({ chatId: bindings.chatId })
      .from(bindings)
      .where(
        and(eq(bindings.provider, provider), eq(bindings.target, target))
      )
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
