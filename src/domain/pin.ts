import * as v from 'valibot';
import {
  contentTypeSchema,
  MEDIA_TYPES,
  nonEmpty,
  record,
  entity,
  roomId,
  userId
} from './value.ts';
import type { ContentType } from './value.ts';

interface PinMediaShape {
  contentType: ContentType,
  mediaUrl: string | null
}

function mediaCheck<P extends PinMediaShape>() {
  return v.check(
    (draft: P) => draft.mediaUrl !== null || !MEDIA_TYPES.has(draft.contentType),
    (issue: v.CheckIssue<P>) => `${issue.input.contentType} pin requires a media URL`
  );
}

const pinFields = {
  roomId: roomId(),
  eventId: nonEmpty('event ID'),
  userId: userId(),
  senderName: nonEmpty('sender name'),
  contentType: contentTypeSchema,
  content: v.string(),
  formatted: v.nullable(v.string()),
  mediaUrl: v.nullable(v.string()),
  pinnedAt: nonEmpty('pinned time')
} satisfies v.ObjectEntries;

const pinDraftObject = v.object(pinFields);
const pinObject = v.object({ id: v.number(), ...pinFields });

const pinDraftSchema = v.pipe(
  pinDraftObject,
  mediaCheck<v.InferOutput<typeof pinDraftObject>>()
);
const pinSchema = v.pipe(pinObject, mediaCheck<v.InferOutput<typeof pinObject>>());

export const PinDraft = record(pinDraftSchema);
export type PinDraft = v.InferOutput<typeof pinDraftSchema>;

export const Pin = entity(pinSchema);
export type Pin = v.InferOutput<typeof pinSchema>;
