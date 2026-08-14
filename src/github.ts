import {
  bold,
  code,
  fmt,
  FormattedString,
  italic,
  link
} from '@grammyjs/parse-mode';
import type { components } from '@octokit/openapi-webhooks-types';
import { setBit } from 'foxts/bitwise';
import { split0th } from 'foxts/split-nth';
import type { Bot } from 'grammy';
import * as v from 'valibot';
import type { Ctx } from './kernel.ts';
import type { Store } from './store.ts';
import type { ParseResult, WebhookChannel } from './webhook.ts';
import { receiveWebhook } from './webhook.ts';

const RE_REF = /^refs\/heads\//;
const MAX_BODY = 300;
const MAX_COMMITS = 5;

const userSchema = v.object({
  login: v.string(),
  html_url: v.optional(v.string())
});

const repoSchema = v.object({
  full_name: v.string(),
  owner: v.optional(userSchema)
});

const orgSchema = v.object({ login: v.string() });

const ENVELOPE = {
  organization: v.optional(orgSchema),
  repository: repoSchema
} as const;

const commitSchema = v.object({
  id: v.string(),
  url: v.string(),
  message: v.string(),
  author: v.object({ name: v.string() })
});

const pushSchema = v.object({
  ...ENVELOPE,
  ref: v.string(),
  commits: v.array(commitSchema)
});

const issueSchema = v.object({
  ...ENVELOPE,
  action: v.string(),
  issue: v.object({
    number: v.number(),
    title: v.string(),
    html_url: v.string(),
    user: v.optional(userSchema),
    body: v.optional(v.nullable(v.string()))
  })
});

const commentSchema = v.object({
  ...ENVELOPE,
  action: v.string(),
  issue: v.object({
    number: v.number(),
    title: v.string(),
    user: v.optional(userSchema)
  }),
  comment: v.object({
    html_url: v.string(),
    user: v.optional(userSchema),
    body: v.optional(v.nullable(v.string()))
  })
});

const pullRequestSchema = v.object({
  ...ENVELOPE,
  action: v.string(),
  pull_request: v.object({
    number: v.number(),
    title: v.string(),
    html_url: v.string(),
    user: v.optional(userSchema),
    body: v.optional(v.nullable(v.string()))
  })
});

type PushEvent = components['schemas']['webhook-push'];
type IssuesEvent =
  & Omit<
    components['schemas']['webhook-issues-opened'],
    'action'
  >
  & { action: string };
type IssueCommentEvent =
  & Omit<
    components['schemas']['webhook-issue-comment-created'],
    'action'
  >
  & { action: string };
type PullRequestEvent =
  & Omit<
    components['schemas']['webhook-pull-request-opened'],
    'action'
  >
  & { action: string };

const GITHUB_CHANNEL: WebhookChannel = {
  secret: (env) => env.GH_WEBHOOK_SECRET,
  async verify(request, raw, secret) {
    const delivery = request.headers.get('x-github-delivery');
    const event = request.headers.get('x-github-event');
    const signature = request.headers.get('x-hub-signature-256');
    if (!delivery || !event || !signature) {
      return {
        status: 400,
        body: 'missing delivery, event, or signature header'
      };
    }
    if (!(await verifySignature(raw, signature, secret))) {
      return { status: 400, body: 'invalid signature' };
    }
    return 'ok';
  },
  parse(request, value): ParseResult {
    const event = request.headers.get('x-github-event') ?? '';
    const delivery = request.headers.get('x-github-delivery') ?? '';
    const parsed = parseEvent(event, value);
    if (parsed === undefined) return { unhandled: event };
    if ('error' in parsed) return { error: parsed.error };
    return {
      formatted: parsed.formatted,
      key: parsed.org,
      dedupId: delivery || undefined,
      label: event
    };
  },
  chatsFor: (store, org) => store.chatsFor('gh', org)
};

export async function handleGitHubWebhook(
  request: Request,
  env: Env,
  bot: Bot<Ctx>
): Promise<Response> {
  return receiveWebhook(request, env, bot, GITHUB_CHANNEL);
}

async function verifySignature(
  raw: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(raw)
  );
  const expected = 'sha256=' + Array.from(
    new Uint8Array(mac),
    (b) => b.toString(16).padStart(2, '0')
  ).join('');
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0, len = expected.length; i < len; i++) {
    if (expected.charCodeAt(i) !== signature.charCodeAt(i)) {
      diff = setBit(diff, 0);
    }
  }
  return diff === 0;
}

interface Envelope {
  organization?: { login?: string },
  repository?: { full_name?: string, owner?: { login?: string } }
}

type ParsedEvent =
  | { formatted: FormattedString | null, org: string | undefined }
  | { error: string };

function parseEvent(
  event: string,
  value: unknown
): ParsedEvent | undefined {
  switch (event) {
    case 'push':
      return parsePayload(
        pushSchema,
        value,
        orgName,
        (p) => pushText(p as PushEvent)
      );
    case 'issues':
      return parsePayload(
        issueSchema,
        value,
        orgName,
        (p) => issueText(p as IssuesEvent)
      );
    case 'issue_comment':
      return parsePayload(
        commentSchema,
        value,
        orgName,
        (p) => commentText(p as IssueCommentEvent)
      );
    case 'pull_request':
      return parsePayload(
        pullRequestSchema,
        value,
        orgName,
        (p) => pullRequestText(p as PullRequestEvent)
      );
    default:
      return undefined;
  }
}

function parsePayload<T extends v.GenericSchema>(
  schema: T,
  value: unknown,
  org: (p: v.InferOutput<T>) => string | undefined,
  format: (p: v.InferOutput<T>) => FormattedString | null
): ParsedEvent {
  const result = v.safeParse(schema, value);
  if (!result.success) {
    return { error: result.issues[0].message };
  }
  const payload = result.output;
  return { formatted: format(payload), org: org(payload) };
}

function orgName(payload: Envelope): string | undefined {
  const org = payload.organization?.login;
  if (org) return org.toLowerCase();
  const owner = payload.repository?.owner?.login;
  return owner?.toLowerCase();
}

function pushText(p: PushEvent): FormattedString | null {
  const commits = p.commits;
  if (commits.length === 0) return null;
  const repo = p.repository.full_name;
  const branch = p.ref.replace(RE_REF, '');
  const lines = commits.slice(0, MAX_COMMITS).map((c) => {
    const id = c.id.slice(0, 7) || '???????';
    const subject = truncate(split0th(c.message, '\n'));
    return fmt`${link(c.url)}${id}${
      link(c.url)
    } ${subject} by ${c.author.name}`;
  });
  const header =
    fmt`${bold}${commits.length} new commits to ${code}${repo}${code}:${code}${branch}${code}${bold}`;
  return FormattedString.join([header, ...lines], '\n');
}

function issueText(p: IssuesEvent): FormattedString | null {
  if (p.action !== 'opened') return null;
  const issue = p.issue;
  const head = titleLine(
    p,
    issue.number,
    issue.title,
    issue.html_url,
    'New issue'
  );
  const body = bodyText(issue.body);
  return FormattedString.join([head, userLine(issue.user), body], '\n');
}

function commentText(p: IssueCommentEvent): FormattedString | null {
  if (p.action !== 'created') return null;
  const comment = p.comment;
  const head = titleLine(
    p,
    p.issue.number,
    p.issue.title,
    comment.html_url,
    'New comment on'
  );
  const body = bodyText(comment.body);
  return FormattedString.join([head, userLine(comment.user), body], '\n');
}

function pullRequestText(p: PullRequestEvent): FormattedString | null {
  if (p.action !== 'opened') return null;
  const pr = p.pull_request;
  const head = titleLine(
    p,
    pr.number,
    pr.title,
    pr.html_url,
    'New pull request'
  );
  const body = bodyText(pr.body);
  return FormattedString.join([head, userLine(pr.user), body], '\n');
}

function titleLine(
  p: { repository: { full_name: string } },
  number: number,
  title: string,
  url: string,
  label: string
): FormattedString {
  const text = `${p.repository.full_name}#${number} ${title}`.trim();
  return fmt`${bold}${label} ${link(url)}${text}${link(url)}${bold}`;
}

function userLine(
  user: v.InferOutput<typeof userSchema> | null | undefined
): FormattedString {
  const name = user?.login ?? 'Unknown';
  return user?.html_url
    ? fmt`by ${link(user.html_url)}@${name}${link(user.html_url)}`
    : fmt`by @${name}`;
}

function bodyText(body: string | null | undefined): FormattedString {
  return body?.trim()
    ? fmt(['', ''], truncate(body))
    : fmt`${italic}(No description)${italic}`;
}

function truncate(s: string, max = MAX_BODY): string {
  const trimmed = s.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}
