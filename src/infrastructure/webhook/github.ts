import { err, ok } from '@moeru/results';
import type { Result } from '@moeru/results';
import { map } from '@moeru/results/result';
import { split0th } from 'foxts/split-nth';
import * as v from 'valibot';
import type { BindingStore } from '../../domain/ports.ts';
import { bold, code, html, join, link } from '../../display/html.ts';
import type { Doc } from '../../display/html.ts';
import { kv, timeText } from '../../display/format.ts';
import { detailBlock, pushHead } from '../../display/notice.ts';
import {
  compose,
  kvRow,
  linkRow,
  listRow,
  timeRow,
  titleRow,
  userRow,
  when
} from '../../display/report.ts';
import type { Row } from '../../display/report.ts';
import type { ParseFailure, ParseResult, WebhookChannel } from './webhook.ts';
import { verifySignature } from './webhook.ts';

const RE_REF = /^refs\/heads\//;

const userSchema = v.object({
  login: v.string(),
  html_url: v.optional(v.string())
});

const labelSchema = v.object({ name: v.string() });

const milestoneSchema = v.object({ title: v.string() });

const repoSchema = v.object({
  full_name: v.string(),
  html_url: v.optional(v.string()),
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
  timestamp: v.string(),
  author: v.object({
    name: v.string(),
    username: v.optional(v.nullable(v.string()))
  })
});

const pushSchema = v.object({
  ...ENVELOPE,
  ref: v.string(),
  commits: v.array(commitSchema)
});

const issueSchema = v.object({
  ...ENVELOPE,
  action: v.string(),
  label: v.optional(labelSchema),
  assignee: v.optional(userSchema),
  issue: v.object({
    number: v.number(),
    title: v.string(),
    html_url: v.string(),
    user: v.optional(userSchema),
    labels: v.optional(v.array(labelSchema)),
    assignees: v.optional(v.array(userSchema)),
    milestone: v.optional(v.nullable(milestoneSchema)),
    created_at: v.string()
  })
});

const forkSchema = v.object({
  ...ENVELOPE,
  forkee: v.object({
    full_name: v.string(),
    html_url: v.string(),
    created_at: v.string()
  }),
  sender: v.optional(userSchema)
});

const starSchema = v.object({
  ...ENVELOPE,
  action: v.string(),
  starred_at: v.optional(v.nullable(v.string())),
  sender: v.optional(userSchema)
});

const discussionSchema = v.object({
  ...ENVELOPE,
  action: v.string(),
  discussion: v.object({
    number: v.number(),
    title: v.string(),
    html_url: v.string(),
    user: v.optional(userSchema),
    created_at: v.string()
  }),
  sender: v.optional(userSchema)
});

const statusSchema = v.object({
  ...ENVELOPE,
  state: v.string(),
  description: v.optional(v.nullable(v.string())),
  commit_id: v.string(),
  created_at: v.string(),
  sender: v.optional(userSchema)
});

export const GITHUB_CHANNEL: WebhookChannel = {
  secret: (env) => env.GH_WEBHOOK_SECRET,
  async verify(request, raw, secret) {
    const delivery = request.headers.get('x-github-delivery');
    const event = request.headers.get('x-github-event');
    const signature = request.headers.get('x-hub-signature-256');
    if (!delivery || !event || !signature) {
      return err({
        status: 400,
        body: 'missing delivery, event, or signature header'
      });
    }
    if (!(await verifySignature(raw, signature, secret))) {
      return err({ status: 400, body: 'invalid signature' });
    }
    return ok(true);
  },
  parse(request, value): ParseResult {
    const event = request.headers.get('x-github-event') ?? '';
    const delivery = request.headers.get('x-github-delivery') ?? '';
    return map(parseEvent(event, value), (parsed) => ({
      ...parsed,
      dedupId: delivery || undefined,
      label: event
    }));
  },
  chatsFor: (store: BindingStore, bindingKey) => store.chats('gh', bindingKey)
};

interface Envelope {
  organization?: { login?: string },
  repository?: { full_name?: string, owner?: { login?: string } }
}

type ParsedEvent = Result<
  { formatted: Doc | null, bindingKey: string | undefined },
  ParseFailure
>;

const ALLOWED = new Set([
  'push',
  'issues',
  'fork',
  'star',
  'discussion',
  'status'
]);

interface EventSpec {
  schema: v.GenericSchema,
  render: (payload: never) => Doc | null
}

function spec<S extends v.GenericSchema>(
  schema: S,
  getHeader: (payload: v.InferOutput<S>) => {
    label: string,
    scope: string,
    url: string
  },
  rows: ReadonlyArray<Row<v.InferOutput<S>>>
): EventSpec {
  return {
    schema,
    render: compose(getHeader, rows)
  };
}

const EVENTS: Record<string, EventSpec> = {
  push: { schema: pushSchema, render: pushText },
  issues: spec(issueSchema, (payload) => ({
    label: actionLabel('Issue', payload.action),
    scope: `${payload.repository.full_name}#${payload.issue.number}`,
    url: payload.issue.html_url
  }), [
    titleRow((payload) => payload.issue.title),
    userRow('By', (payload) => payload.issue.user, userLink),
    timeRow((payload) => payload.issue.created_at),
    when((payload) => payload.label !== undefined, [
      kvRow('Label', (payload) => payload.label?.name)
    ]),
    when((payload) => payload.assignee !== undefined, [
      userRow('Assignee', (payload) => payload.assignee, userLink)
    ]),
    when((payload) => payload.action === 'opened', [
      listRow('Assignees', (payload) => userItems(payload.issue.assignees)),
      listRow('Labels', (payload) => labelItems(payload.issue.labels)),
      kvRow('Milestone', (payload) => payload.issue.milestone?.title)
    ])
  ]),
  fork: spec(forkSchema, (payload) => ({
    label: 'Repository forked',
    scope: payload.repository.full_name,
    url: repoUrl(payload.repository)
  }), [
    linkRow('Forked to', (payload) => ({
      url: payload.forkee.html_url,
      text: payload.forkee.full_name
    })),
    userRow('By', (payload) => payload.sender, userLink),
    timeRow((payload) => payload.forkee.created_at)
  ]),
  star: spec(starSchema, (payload) => ({
    label: actionLabel('Star', payload.action),
    scope: payload.repository.full_name,
    url: repoUrl(payload.repository)
  }), [
    userRow('By', (payload) => payload.sender, userLink),
    timeRow((payload) => payload.starred_at)
  ]),
  discussion: spec(discussionSchema, (payload) => ({
    label: actionLabel('Discussion', payload.action),
    scope: `${payload.repository.full_name}#${payload.discussion.number}`,
    url: payload.discussion.html_url
  }), [
    titleRow((payload) => payload.discussion.title),
    userRow('By', (payload) => payload.discussion.user, userLink),
    timeRow((payload) => payload.discussion.created_at)
  ]),
  status: spec(statusSchema, (payload) => ({
    label: `Commit status ${payload.state}`,
    scope: payload.repository.full_name,
    url: repoUrl(payload.repository)
  }), [
    linkRow('Commit', (payload) => ({
      url: `https://github.com/${payload.repository.full_name}/commit/${payload.commit_id}`,
      text: payload.commit_id.slice(0, 7)
    })),
    kvRow('State', (payload) => payload.state),
    kvRow('Description', (payload) => payload.description),
    userRow('By', (payload) => payload.sender, userLink),
    timeRow((payload) => payload.created_at)
  ])
};

function parseEvent(
  event: string,
  value: unknown
): ParsedEvent {
  if (!ALLOWED.has(event)) return err({ unhandled: event });
  const spec = EVENTS[event];
  if (!spec) return err({ unhandled: event });
  const result = v.safeParse(spec.schema, value);
  if (!result.success) return err({ error: result.issues[0].message });
  return ok({
    formatted: spec.render(result.output as never),
    bindingKey: orgName(result.output as Envelope)
  });
}

function actionLabel(prefix: string, action: string): string {
  return `${prefix} ${action.replaceAll('_', ' ')}`;
}

function orgName(payload: Envelope): string | undefined {
  const org = payload.organization?.login;
  if (org) return org.toLowerCase();
  const owner = payload.repository?.owner?.login;
  return owner?.toLowerCase();
}

function pushText(payload: v.InferOutput<typeof pushSchema>): Doc | null {
  const commits = payload.commits;
  if (commits.length === 0) return null;
  const repo = payload.repository;
  const branch = payload.ref.replace(RE_REF, '');
  const head = html`${pushHead(
    commits.length,
    'commit',
    'commits',
    link(repoUrl(repo), repo.full_name)
  )}:${code(branch)}`;
  const blocks: Doc[] = [];
  for (let i = 0, len = commits.length; i < len; i++) {
    blocks.push(commitBlock(commits[i]!));
  }
  return join([head, ...blocks], '\n\n');
}

function commitBlock(
  commit: v.InferOutput<typeof commitSchema>
): Doc {
  const id = commit.id.slice(0, 7) || '???????';
  const subject = split0th(commit.message, '\n');
  return detailBlock(html`${link(commit.url, id)} ${subject}`, [
    ['By', commitAuthor(commit)],
    ['Time', timeText(commit.timestamp)]
  ]);
}

function repoUrl(repo: { full_name: string, html_url?: string }): string {
  return repo.html_url ?? `https://github.com/${repo.full_name}`;
}

function commitAuthor(
  commit: v.InferOutput<typeof commitSchema>
): Doc | string {
  const username = commit.author.username ?? undefined;
  if (!username) return commit.author.name;
  const url = `https://github.com/${username}`;
  return link(url, `@${username}`);
}

function userLink(
  user: { login?: string, html_url?: string } | null | undefined
): Doc | string {
  if (!user?.login) return 'Unknown';
  const url = user.html_url ?? `https://github.com/${user.login}`;
  return link(url, `@${user.login}`);
}

function userItems(
  users:
    | ReadonlyArray<{ login?: string, html_url?: string } | null>
    | null
    | undefined
): Array<Doc | string> {
  const items: Array<Doc | string> = [];
  if (!users) return items;
  for (let i = 0, len = users.length; i < len; i++) {
    const user = users[i];
    if (user) items.push(userLink(user));
  }
  return items;
}

function labelItems(
  labels: ReadonlyArray<v.InferOutput<typeof labelSchema>> | undefined
): Doc[] {
  const items: Doc[] = [];
  if (!labels) return items;
  for (let i = 0, len = labels.length; i < len; i++) {
    items.push(code(labels[i]!.name));
  }
  return items;
}
