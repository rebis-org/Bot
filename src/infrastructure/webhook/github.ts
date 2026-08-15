import { bold, code, fmt, FormattedString, link } from '@grammyjs/parse-mode';
import { split0th } from 'foxts/split-nth';
import * as v from 'valibot';
import type { BindingStore } from '../../domain/ports.ts';
import { kv, prettify, timeText } from '../../display/format.ts';
import {
  codeRow,
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
import type { ParseResult, WebhookChannel } from './webhook.ts';
import { parseThreadId } from '../../domain/value.ts';
import { verifySignature } from './webhook.ts';

const RE_REF = /^refs\/heads\//;

const userSchema = v.object({
  login: v.string(),
  html_url: v.optional(v.string())
});

const reviewerSchema = v.object({
  login: v.optional(v.string()),
  html_url: v.optional(v.string()),
  name: v.optional(v.nullable(v.string()))
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

const pullRequestSchema = v.object({
  ...ENVELOPE,
  action: v.string(),
  label: v.optional(labelSchema),
  assignee: v.optional(userSchema),
  pull_request: v.object({
    number: v.number(),
    title: v.string(),
    html_url: v.string(),
    user: v.optional(userSchema),
    assignees: v.optional(v.array(userSchema)),
    requested_reviewers: v.optional(v.array(reviewerSchema)),
    labels: v.optional(v.array(labelSchema)),
    milestone: v.optional(v.nullable(milestoneSchema)),
    created_at: v.string()
  })
});

const createSchema = v.object({
  ...ENVELOPE,
  ref: v.string(),
  ref_type: v.string(),
  sender: v.optional(userSchema)
});

const deleteSchema = v.object({
  ...ENVELOPE,
  ref: v.string(),
  ref_type: v.string(),
  sender: v.optional(userSchema)
});

const releaseSchema = v.object({
  ...ENVELOPE,
  action: v.string(),
  release: v.object({
    tag_name: v.string(),
    html_url: v.string(),
    author: v.optional(userSchema),
    published_at: v.optional(v.nullable(v.string())),
    created_at: v.string()
  }),
  sender: v.optional(userSchema)
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

const watchSchema = v.object({
  ...ENVELOPE,
  action: v.string(),
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

const projectsV2Schema = v.object({
  organization: orgSchema,
  action: v.string(),
  projects_v2: v.object({
    title: v.string(),
    created_at: v.string()
  }),
  sender: v.optional(userSchema)
});

const projectsV2ItemSchema = v.object({
  organization: orgSchema,
  action: v.string(),
  projects_v2: v.object({
    title: v.string()
  }),
  projects_v2_item: v.object({
    content_type: v.optional(v.string()),
    created_at: v.string()
  }),
  sender: v.optional(userSchema)
});

const projectsV2StatusUpdateSchema = v.object({
  organization: orgSchema,
  action: v.string(),
  projects_v2: v.object({
    title: v.string()
  }),
  projects_v2_status_update: v.object({
    status: v.optional(v.string()),
    created_at: v.string()
  }),
  sender: v.optional(userSchema)
});

const envelopeSchema = v.object({
  action: v.optional(v.string()),
  sender: v.optional(userSchema),
  repository: v.optional(v.object({
    full_name: v.string(),
    html_url: v.optional(v.string())
  })),
  organization: v.optional(orgSchema)
});

export const GITHUB_CHANNEL: WebhookChannel = {
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
      bindingKey: parsed.bindingKey,
      dedupId: delivery || undefined,
      label: event
    };
  },
  chatsFor: (store: BindingStore, bindingKey) => store.chats('gh', bindingKey),
  threadId: (env) => parseThreadId(env.GH_THREAD_ID)
};

interface Envelope {
  organization?: { login?: string },
  repository?: { full_name?: string, owner?: { login?: string } }
}

type ParsedEvent =
  | { formatted: FormattedString | null, bindingKey: string | undefined }
  | { error: string };

const ALLOWED = new Set([
  'create',
  'delete',
  'member',
  'discussion',
  'fork',
  'issues',
  'merge_group',
  'milestone',
  'org_block',
  'membership',
  'organization',
  'pull_request',
  'push',
  'release',
  'repository',
  'star',
  'sub_issues',
  'team',
  'team_add',
  'public',
  'watch',
  'status',
  'projects_v2',
  'projects_v2_item',
  'projects_v2_status_update'
]);

interface EventSpec {
  schema: v.GenericSchema,
  render: (payload: never) => FormattedString | null
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

function actionRow<P extends { action?: string }>(payload: P): FormattedString | string {
  return kv('Action', payload.action);
}

function bySenderRow<
  P extends { sender?: { login?: string, html_url?: string } }
>(payload: P): FormattedString | string {
  return kv('By', userLink(payload.sender));
}

const EVENTS: Record<string, EventSpec> = {
  push: { schema: pushSchema, render: pushText },
  create: spec(createSchema, (payload) => ({
    label: `${capitalize(payload.ref_type)} created`,
    scope: payload.repository.full_name,
    url: repoUrl(payload.repository)
  }), [
    codeRow('Ref', (payload) => payload.ref),
    userRow('By', (payload) => payload.sender, userLink)
  ]),
  delete: spec(deleteSchema, (payload) => ({
    label: `${capitalize(payload.ref_type)} deleted`,
    scope: payload.repository.full_name,
    url: repoUrl(payload.repository)
  }), [
    codeRow('Ref', (payload) => payload.ref),
    userRow('By', (payload) => payload.sender, userLink)
  ]),
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
  pull_request: spec(pullRequestSchema, (payload) => ({
    label: actionLabel('Pull request', payload.action),
    scope: `${payload.repository.full_name}#${payload.pull_request.number}`,
    url: payload.pull_request.html_url
  }), [
    titleRow((payload) => payload.pull_request.title),
    userRow('By', (payload) => payload.pull_request.user, userLink),
    timeRow((payload) => payload.pull_request.created_at),
    kvRow('Milestone', (payload) => payload.pull_request.milestone?.title),
    when((payload) => payload.label !== undefined, [
      kvRow('Label', (payload) => payload.label?.name)
    ]),
    when((payload) => payload.assignee !== undefined, [
      userRow('Assignee', (payload) => payload.assignee, userLink)
    ]),
    when((payload) => payload.action === 'opened', [
      listRow('Assignees', (payload) => userItems(payload.pull_request.assignees)),
      listRow(
        'Reviewers',
        (payload) => reviewerItems(payload.pull_request.requested_reviewers)
      ),
      listRow('Labels', (payload) => labelItems(payload.pull_request.labels))
    ])
  ]),
  release: spec(releaseSchema, (payload) => ({
    label: actionLabel('Release', payload.action),
    scope: payload.repository.full_name,
    url: payload.release.html_url
  }), [
    linkRow('Tag', (payload) => ({
      url: payload.release.html_url,
      text: payload.release.tag_name
    })),
    userRow('By', (payload) => payload.release.author ?? payload.sender, userLink),
    timeRow((payload) => payload.release.published_at ?? payload.release.created_at)
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
  watch: spec(watchSchema, (payload) => ({
    label: 'Watch started',
    scope: payload.repository.full_name,
    url: repoUrl(payload.repository)
  }), [
    userRow('By', (payload) => payload.sender, userLink)
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
  ]),
  projects_v2: spec(projectsV2Schema, (payload) => ({
    label: actionLabel('Projects', payload.action),
    scope: payload.organization.login,
    url: `https://github.com/${payload.organization.login}`
  }), [
    codeRow('Title', (payload) => payload.projects_v2.title),
    userRow('By', (payload) => payload.sender, userLink),
    timeRow((payload) => payload.projects_v2.created_at)
  ]),
  projects_v2_item: spec(projectsV2ItemSchema, (payload) => ({
    label: actionLabel('Project items', payload.action),
    scope: payload.organization.login,
    url: `https://github.com/${payload.organization.login}`
  }), [
    codeRow('Item', (payload) => payload.projects_v2_item.content_type),
    codeRow('Project', (payload) => payload.projects_v2.title),
    userRow('By', (payload) => payload.sender, userLink),
    timeRow((payload) => payload.projects_v2_item.created_at)
  ]),
  projects_v2_status_update: spec(projectsV2StatusUpdateSchema, (payload) => ({
    label: actionLabel('Projects status updates', payload.action),
    scope: payload.organization.login,
    url: `https://github.com/${payload.organization.login}`
  }), [
    codeRow('Project', (payload) => payload.projects_v2.title),
    codeRow('Status', (payload) => {
      const status = payload.projects_v2_status_update.status;
      return status ? prettify(status) : undefined;
    }),
    userRow('By', (payload) => payload.sender, userLink),
    timeRow((payload) => payload.projects_v2_status_update.created_at)
  ])
};

function parseEvent(
  event: string,
  value: unknown
): ParsedEvent | undefined {
  if (!ALLOWED.has(event)) return undefined;
  const spec = EVENTS[event];
  if (!spec) return genericText(event, value);
  const result = v.safeParse(spec.schema, value);
  if (!result.success) return { error: result.issues[0].message };
  return {
    formatted: spec.render(result.output as never),
    bindingKey: orgName(result.output as Envelope)
  };
}

function genericText(
  event: string,
  value: unknown
): ParsedEvent | undefined {
  const result = v.safeParse(envelopeSchema, value);
  if (!result.success) return { error: result.issues[0].message };
  const payload = result.output;
  const name = payload.repository?.full_name ?? payload.organization?.login;
  if (!name) return undefined;
  const url = payload.repository?.html_url ?? `https://github.com/${name}`;
  const label = prettify(event);
  const inHead = payload.action !== undefined && event !== 'sub_issues';
  return {
    formatted: compose<v.InferOutput<typeof envelopeSchema>>(
      () => ({
        label: inHead ? actionLabel(label, payload.action!) : label,
        scope: name,
        url
      }),
      inHead ? [bySenderRow] : [actionRow, bySenderRow]
    )(payload),
    bindingKey: orgName(payload)
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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

function pushText(payload: v.InferOutput<typeof pushSchema>): FormattedString | null {
  const commits = payload.commits;
  if (commits.length === 0) return null;
  const repo = payload.repository;
  const branch = payload.ref.replace(RE_REF, '');
  const count = commits.length === 1 ? 'commit' : 'commits';
  const head = fmt`${bold}${commits.length}${bold} new ${bold}${count}${bold} to ${
    link(repoUrl(repo))
  }${repo.full_name}${link(repoUrl(repo))}:${code}${branch}${code}`;
  const blocks = commits.map((commit) => commitBlock(commit));
  return FormattedString.join([head, ...blocks], '\n\n');
}

function commitBlock(
  commit: v.InferOutput<typeof commitSchema>
): FormattedString {
  const id = commit.id.slice(0, 7) || '???????';
  const subject = split0th(commit.message, '\n');
  return FormattedString.join([
    fmt`${link(commit.url)}${id}${link(commit.url)} ${subject}`,
    fmt`  ${kv('By', commitAuthor(commit))}`,
    fmt`  ${kv('Time', timeText(commit.timestamp))}`
  ], '\n');
}

function repoUrl(repo: { full_name: string, html_url?: string }): string {
  return repo.html_url ?? `https://github.com/${repo.full_name}`;
}

function commitAuthor(
  commit: v.InferOutput<typeof commitSchema>
): FormattedString | string {
  const username = commit.author.username ?? undefined;
  if (!username) return commit.author.name;
  const url = `https://github.com/${username}`;
  return fmt`${link(url)}@${username}${link(url)}`;
}

function userLink(
  user: { login?: string, html_url?: string } | null | undefined
): FormattedString | string {
  if (!user?.login) return 'Unknown';
  const url = user.html_url ?? `https://github.com/${user.login}`;
  return fmt`${link(url)}@${user.login}${link(url)}`;
}

function userItems(
  users:
    | ReadonlyArray<{ login?: string, html_url?: string } | null>
    | null
    | undefined
): Array<FormattedString | string> {
  const items: Array<FormattedString | string> = [];
  if (!users) return items;
  for (let i = 0, len = users.length; i < len; i++) {
    const user = users[i];
    if (user) items.push(userLink(user));
  }
  return items;
}

function reviewerItems(
  reviewers:
    | ReadonlyArray<v.InferOutput<typeof reviewerSchema>>
    | null
    | undefined
): Array<FormattedString | string> {
  const items: Array<FormattedString | string> = [];
  if (!reviewers) return items;
  for (let i = 0, len = reviewers.length; i < len; i++) {
    const reviewer = reviewers[i]!;
    items.push(reviewer.login ? userLink(reviewer) : (reviewer.name ?? 'Team'));
  }
  return items;
}

function labelItems(
  labels: ReadonlyArray<v.InferOutput<typeof labelSchema>> | undefined
): FormattedString[] {
  const items: FormattedString[] = [];
  if (!labels) return items;
  for (let i = 0, len = labels.length; i < len; i++) {
    items.push(fmt`${code}${labels[i]!.name}${code}`);
  }
  return items;
}
