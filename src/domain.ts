import type { MessageEntity } from '@grammyjs/types';

export const CONTENT_TYPES = [
  'text',
  'photo',
  'video',
  'animation',
  'sticker',
  'document',
  'audio',
  'voice',
  'other'
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

const MEDIA_TYPES: ReadonlySet<ContentType> = new Set([
  'photo',
  'video',
  'animation',
  'sticker',
  'document',
  'audio',
  'voice'
]);

interface WorkRow {
  id: number,
  chatId: number,
  userId: number,
  name: string,
  clockInAt: string,
  clockOutAt: string | null,
  durationMinutes: number | null
}

export class Work {
  private constructor(
    readonly id: number,
    readonly chatId: number,
    readonly userId: number,
    readonly name: string,
    readonly clockInAt: string,
    readonly clockOutAt: string | null,
    readonly durationMinutes: number | null
  ) {
    assertPositive(id, 'session id');
    assertPositive(chatId, 'chat id');
    assertPositive(userId, 'user id');
    assertNonEmpty(name, 'name');
    assertNonEmpty(clockInAt, 'clock-in time');
    if ((clockOutAt === null) !== (durationMinutes === null)) {
      throw new Error(
        'clock-out time and duration must be either both set or both null'
      );
    }
    if (durationMinutes !== null && durationMinutes < 0) {
      throw new Error('duration must be non-negative');
    }
    if (
      clockOutAt !== null
      && new Date(clockOutAt).getTime() < new Date(clockInAt).getTime()
    ) {
      throw new Error('clock-out time must not be before clock-in time');
    }
  }

  static from(this: void, row: WorkRow): Work {
    return new Work(
      row.id,
      row.chatId,
      row.userId,
      row.name,
      row.clockInAt,
      row.clockOutAt,
      row.durationMinutes
    );
  }

  get isOpen(): boolean {
    return this.clockOutAt === null;
  }
}

export class CheckInDraft {
  private constructor(
    readonly chatId: number,
    readonly userId: number,
    readonly name: string,
    readonly clockInAt: string
  ) {
    assertPositive(chatId, 'chat id');
    assertPositive(userId, 'user id');
    assertNonEmpty(name, 'name');
    assertNonEmpty(clockInAt, 'clock-in time');
  }

  static create(this: void, input: {
    chatId: number,
    userId: number,
    name: string,
    clockInAt: string
  }): CheckInDraft {
    return new CheckInDraft(
      input.chatId,
      input.userId,
      input.name,
      input.clockInAt
    );
  }
}

export class CheckOutDraft {
  private constructor(
    readonly chatId: number,
    readonly userId: number,
    readonly clockOutAt: string
  ) {
    assertPositive(chatId, 'chat id');
    assertPositive(userId, 'user id');
    assertNonEmpty(clockOutAt, 'clock-out time');
  }

  static create(this: void, input: {
    chatId: number,
    userId: number,
    clockOutAt: string
  }): CheckOutDraft {
    return new CheckOutDraft(input.chatId, input.userId, input.clockOutAt);
  }
}

interface PinRow {
  id: number,
  chatId: number,
  messageId: number,
  userId: number,
  senderName: string,
  contentType: ContentType,
  content: string,
  entities: MessageEntity[] | null,
  fileId: string | null,
  pinnedAt: string,
  unpinnedAt: string | null,
  deletedAt: string | null
}

export class Pin {
  private constructor(
    readonly id: number,
    readonly chatId: number,
    readonly messageId: number,
    readonly userId: number,
    readonly senderName: string,
    readonly contentType: ContentType,
    readonly content: string,
    readonly entities: MessageEntity[] | null,
    readonly fileId: string | null,
    readonly pinnedAt: string,
    readonly unpinnedAt: string | null,
    readonly deletedAt: string | null
  ) {
    assertPositive(id, 'pin id');
    assertPositive(chatId, 'chat id');
    assertPositive(messageId, 'message id');
    assertPositive(userId, 'user id');
    assertNonEmpty(senderName, 'sender name');
    assertContentType(contentType);
    assertNonEmpty(pinnedAt, 'pinned time');
    if (fileId === null && MEDIA_TYPES.has(contentType)) {
      throw new Error(`${contentType} pin requires a file id`);
    }
    if (deletedAt !== null && unpinnedAt === null) {
      throw new Error('a deleted pin must also be unpinned');
    }
  }

  static from(this: void, row: PinRow): Pin {
    return new Pin(
      row.id,
      row.chatId,
      row.messageId,
      row.userId,
      row.senderName,
      row.contentType,
      row.content,
      row.entities,
      row.fileId,
      row.pinnedAt,
      row.unpinnedAt,
      row.deletedAt
    );
  }

  get isActive(): boolean {
    return this.deletedAt === null;
  }
}

export class PinDraft {
  private constructor(
    readonly chatId: number,
    readonly messageId: number,
    readonly userId: number,
    readonly senderName: string,
    readonly contentType: ContentType,
    readonly content: string,
    readonly entities: MessageEntity[] | null,
    readonly fileId: string | null,
    readonly pinnedAt: string
  ) {
    assertPositive(chatId, 'chat id');
    assertPositive(messageId, 'message id');
    assertPositive(userId, 'user id');
    assertNonEmpty(senderName, 'sender name');
    assertContentType(contentType);
    assertNonEmpty(pinnedAt, 'pinned time');
    if (fileId === null && MEDIA_TYPES.has(contentType)) {
      throw new Error(`${contentType} pin requires a file id`);
    }
  }

  static create(this: void, input: {
    chatId: number,
    messageId: number,
    userId: number,
    senderName: string,
    contentType: ContentType,
    content: string,
    entities: MessageEntity[] | null,
    fileId: string | null,
    pinnedAt: string
  }): PinDraft {
    return new PinDraft(
      input.chatId,
      input.messageId,
      input.userId,
      input.senderName,
      input.contentType,
      input.content,
      input.entities,
      input.fileId,
      input.pinnedAt
    );
  }
}

function assertPositive(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function assertNonEmpty(value: string, label: string): void {
  if (value.length === 0) {
    throw new Error(`${label} must not be empty`);
  }
}

function assertContentType(value: string): asserts value is ContentType {
  if (!(CONTENT_TYPES as readonly string[]).includes(value)) {
    throw new Error(`unknown content type: ${value}`);
  }
}
