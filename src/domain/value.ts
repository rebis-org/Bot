import type { MessageEntity } from '@grammyjs/types';
import { trueFn } from 'foxts/noop';
import * as v from 'valibot';

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

export const MEDIA_TYPES: ReadonlySet<ContentType> = new Set([
  'photo',
  'video',
  'animation',
  'sticker',
  'document',
  'audio',
  'voice'
]);

export function positiveId(label: string) {
  return v.pipe(
    v.number(),
    v.check(
      (n) => Number.isSafeInteger(n) && n > 0,
      `${label} must be a positive integer`
    )
  );
}

export function nonzeroId(label: string) {
  return v.pipe(
    v.number(),
    v.check(
      (n) => Number.isSafeInteger(n) && n !== 0,
      `${label} must be a non-zero integer`
    )
  );
}

export function nonEmpty(label: string) {
  return v.pipe(
    v.string(),
    v.check((s) => s.length > 0, `${label} must not be empty`)
  );
}

export const contentTypeSchema = v.picklist(
  CONTENT_TYPES,
  (issue) => `unknown content type: ${String(issue.input)}`
);

export const entitiesSchema = v.nullable(v.array(v.custom<MessageEntity>(trueFn)));

export function parse<T>(schema: v.GenericSchema, input: unknown): T {
  const result = v.safeParse(schema, input);
  if (!result.success) {
    throw new Error(result.issues[0].message);
  }
  return result.output as T;
}

export function record<const S extends v.GenericSchema>(schema: S) {
  return {
    create: (input: v.InferInput<S>): v.InferOutput<S> => parse(schema, input)
  };
}

export function entity<const S extends v.GenericSchema>(schema: S) {
  return {
    from: (row: v.InferInput<S>): v.InferOutput<S> => parse(schema, row)
  };
}

export function parseGroupChatId(value: string | undefined): number | undefined {
  const n = Number(value);
  if (n === 0 || !Number.isSafeInteger(n)) return undefined;
  return n < 0 ? n : -Number(`100${n}`);
}

export function parseThreadId(value: string | undefined): number | undefined {
  const n = Number(value);
  return value !== undefined && Number.isSafeInteger(n) && n > 0
    ? n
    : undefined;
}
