import type { MessageEntity } from '@grammyjs/types';
import * as v from 'valibot';
import {
  contentTypeSchema,
  entitiesSchema,
  MEDIA_TYPES,
  nonEmpty,
  nonzeroId,
  positiveId,
  record,
  entity
} from './value.ts';
import type { ContentType } from './value.ts';

interface PinDraftShape {
  chatId: number,
  messageId: number,
  userId: number,
  senderName: string,
  contentType: ContentType,
  content: string,
  entities: MessageEntity[] | null,
  fileId: string | null,
  pinnedAt: string
}

interface PinMediaShape {
  contentType: ContentType,
  fileId: string | null
}

function mediaRequiresFile(draft: PinMediaShape) {
  return draft.fileId !== null || !MEDIA_TYPES.has(draft.contentType);
}

function mediaCheck<P extends PinMediaShape>() {
  return v.check(
    (draft: P) => mediaRequiresFile(draft),
    (issue: v.CheckIssue<P>) => `${issue.input.contentType} pin requires a file id`
  );
}

const pinFields = {
  chatId: nonzeroId('chat id'),
  messageId: nonzeroId('message id'),
  userId: nonzeroId('user id'),
  senderName: nonEmpty('sender name'),
  contentType: contentTypeSchema,
  content: v.string(),
  entities: entitiesSchema,
  fileId: v.nullable(v.string()),
  pinnedAt: nonEmpty('pinned time')
} satisfies v.ObjectEntries;

const pinDraftSchema = v.pipe(v.object(pinFields), mediaCheck<PinDraftShape>());
const pinSchema = v.pipe(
  v.object({
    id: positiveId('pin id'),
    ...pinFields,
    unpinnedAt: v.nullable(v.string()),
    deletedAt: v.nullable(v.string())
  }),
  mediaCheck<PinDraftShape & { id: number, unpinnedAt: string | null, deletedAt: string | null }>(),
  v.check(
    (row) => row.deletedAt === null || row.unpinnedAt !== null,
    'a deleted pin must also be unpinned'
  )
);

export const PinDraft = record(pinDraftSchema);
export type PinDraft = v.InferOutput<typeof pinDraftSchema>;

export const Pin = entity(pinSchema);
export type Pin = v.InferOutput<typeof pinSchema>;
