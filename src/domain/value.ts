import * as v from 'valibot';

export const CONTENT_TYPES = [
  'text',
  'image',
  'video',
  'audio',
  'file',
  'emote',
  'other'
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

export const MEDIA_MSGTYPES = {
  image: 'm.image',
  video: 'm.video',
  audio: 'm.audio',
  file: 'm.file'
} as const;

export type MediaMsgtype = (typeof MEDIA_MSGTYPES)[keyof typeof MEDIA_MSGTYPES];

export const MEDIA_TYPES: ReadonlySet<ContentType> = new Set(
  Object.keys(MEDIA_MSGTYPES) as ContentType[]
);

const MEDIA_MSGTYPE_SET: ReadonlySet<string> = new Set(
  Object.values(MEDIA_MSGTYPES)
);

export const MSGTYPE_CONTENT_TYPES: Record<string, ContentType> = {
  'm.text': 'text',
  'm.emote': 'emote',
  ...Object.entries(MEDIA_MSGTYPES).reduce<Record<string, ContentType>>(
    (types, [contentType, msgtype]) => ({
      ...types,
      [msgtype]: contentType as ContentType
    }),
    {}
  )
};

export function mediaMsgtype(contentType: ContentType): MediaMsgtype | undefined {
  return (MEDIA_MSGTYPES as Partial<Record<ContentType, MediaMsgtype>>)[contentType];
}

export function nonEmpty(label: string) {
  return v.pipe(
    v.string(),
    v.check((s) => s.length > 0, `${label} must not be empty`)
  );
}

function prefixed(prefix: string, label: string) {
  return v.pipe(
    v.string(),
    v.check(
      (s) => s[0] === prefix,
      `${label} must start with "${prefix}"`
    )
  );
}

export function roomId(label = 'room ID') {
  return prefixed('!', label);
}

export function userId(label = 'user ID') {
  return prefixed('@', label);
}

export const contentTypeSchema = v.picklist(
  CONTENT_TYPES,
  (issue) => `unknown content type: ${String(issue.input)}`
);

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

export function parseRoomId(value: string | undefined): string | undefined {
  return value?.[0] === '!' ? value : undefined;
}

export function parseUserId(value: string | undefined): string | undefined {
  return value?.[0] === '@' ? value : undefined;
}

export interface MxcUrl {
  serverName: string,
  mediaId: string
}

const MXC_PATTERN = /^mxc:\/\/([^/]+)\/([^/]+)$/;

export function parseMxcUrl(url: unknown): MxcUrl | null {
  if (typeof url !== 'string') return null;
  const match = MXC_PATTERN.exec(url);
  if (match === null) return null;
  return { serverName: match[1]!, mediaId: match[2]! };
}

export function mxcString(ref: MxcUrl): string {
  return `mxc://${ref.serverName}/${ref.mediaId}`;
}

export function extractLocalMedia(
  content: Record<string, unknown>,
  serverName: string
): MxcUrl[] {
  if (typeof content.msgtype !== 'string' || !MEDIA_MSGTYPE_SET.has(content.msgtype)) return [];
  const info = typeof content.info === 'object' && content.info !== null
    ? content.info as Record<string, unknown>
    : undefined;
  const candidates = [content.url, info?.thumbnail_url];
  const refs: MxcUrl[] = [];
  const seen = new Set<string>();
  for (let i = 0, len = candidates.length; i < len; i++) {
    const parsed = parseMxcUrl(candidates[i]);
    if (parsed?.serverName !== serverName) continue;
    if (seen.has(parsed.mediaId)) continue;
    seen.add(parsed.mediaId);
    refs.push(parsed);
  }
  return refs;
}
