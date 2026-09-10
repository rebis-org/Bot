import { bold, code, html, join, link, text } from '../../display/html.ts';
import type { Doc } from '../../display/html.ts';
import type { BindingStore } from '../../domain/ports.ts';
import { resolveSubscribe, SUBSCRIBE_PROVIDER } from '../../infrastructure/subscribe/sources.ts';
import type { SubscribeSource } from '../../infrastructure/subscribe/sources.ts';
import type { Command } from '../kernel.ts';
import { admin, subcommands, usage } from '../kernel.ts';

const SUBSCRIBE_ROWS = [
  { command: '!subscribe', desc: 'List subscribed targets in this room' },
  { command: '!subscribe insert <spec>', desc: 'Subscribe to a target in this room (administrators)' },
  { command: '!subscribe delete <spec>', desc: 'Unsubscribe from a target (administrators)' }
] as const;

const INSERT_HINT = [
  'Specs:',
  '  apple (Apple operating system updates)',
  '  github:owner/repo or owner/repo',
  '  codeberg:owner/repo',
  '  git@github.com:owner/repo or ssh://git@codeberg.org/owner/repo',
  '  https://host/feed-url.atom or https://host/repo-page'
];

export function subscribe(store: BindingStore): Command {
  return {
    name: 'subscribe',
    desc: 'Subscribe to releases and feeds (administrators)',
    section: 'Subscribe',
    rows: SUBSCRIBE_ROWS,
    handler: subcommands(
      {
        '': async (ctx) => {
          const doc = await listDoc(store, ctx.roomId);
          await ctx.reply(doc.body, doc.html);
        },
        insert: admin(async (ctx) => {
          const spec = ctx.args.trim();
          const source = resolveSubscribe(spec);
          if (source === null) {
            const doc = invalidDoc(spec);
            await ctx.reply(doc.body, doc.html);
            return;
          }
          const added = await store.bind(SUBSCRIBE_PROVIDER, source.key, ctx.roomId);
          const doc = added
            ? html`Subscribed to ${link(source.home, source.label)} in this room. ${
              text(postHint(source))
            }`
            : html`${link(source.home, source.label)} is already subscribed in this room.`;
          await ctx.reply(doc.body, doc.html);
        }),
        delete: admin(async (ctx) => {
          const spec = ctx.args.trim();
          const source = resolveSubscribe(spec);
          if (source === null) {
            const doc = invalidDoc(spec);
            await ctx.reply(doc.body, doc.html);
            return;
          }
          const removed = await store.unbind(SUBSCRIBE_PROVIDER, source.key, ctx.roomId);
          const doc = removed
            ? html`Unsubscribed ${link(source.home, source.label)} from this room.`
            : html`${link(source.home, source.label)} is not subscribed in this room.`;
          await ctx.reply(doc.body, doc.html);
        })
      },
      async (ctx) => {
        const doc = usage(SUBSCRIBE_ROWS);
        await ctx.reply(doc.body, doc.html);
      }
    )
  };
}

async function listDoc(store: BindingStore, roomId: string): Promise<Doc> {
  const targets = await store.targets(SUBSCRIBE_PROVIDER, roomId);
  const lines: Doc[] = [bold('Subscribed targets')];
  if (targets.length === 0) {
    lines.push(html`  none`);
  } else {
    for (let i = 0, len = targets.length; i < len; i++) {
      const source = resolveSubscribe(targets[i]!);
      lines.push(source === null
        ? html`  ${code(targets[i]!)}`
        : html`  ${link(source.home, code(targets[i]!))}`);
    }
  }
  lines.push(html`Send ${code('!subscribe insert <spec>')} to subscribe to a target.`);
  return join(lines, '\n');
}

function invalidDoc(spec: string): Doc {
  const lines: Doc[] = [html`Invalid spec ${code(spec)}.`];
  for (let i = 0, len = INSERT_HINT.length; i < len; i++) {
    lines.push(text(INSERT_HINT[i]!));
  }
  return join(lines, '\n');
}

function postHint(source: SubscribeSource): string {
  return source.feeds[0]!.kind === 'feed'
    ? 'The bot posts new entries.'
    : 'The bot posts new releases.';
}
