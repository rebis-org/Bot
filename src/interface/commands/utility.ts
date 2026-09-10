import { bold, code, html, join } from '../../display/html.ts';
import type { Doc } from '../../display/html.ts';
import type { PollStore, SystemStore } from '../../domain/ports.ts';
import { formatUtc8 } from '../../display/format.ts';
import type { MatrixClient } from '../../infrastructure/matrix/client.ts';
import type { Command, InboundEvent } from '../kernel.ts';
import { admin } from '../kernel.ts';

const OPTION_KEYS = [
  '1\u{FE0F}⃣',
  '2\u{FE0F}⃣',
  '3\u{FE0F}⃣',
  '4\u{FE0F}⃣',
  '5\u{FE0F}⃣',
  '6\u{FE0F}⃣',
  '7\u{FE0F}⃣',
  '8\u{FE0F}⃣',
  '9\u{FE0F}⃣',
  '🔟'
] as const;

export const dice: Command = {
  name: 'dice',
  desc: 'Roll dice',
  section: 'Other',
  rows: [{ command: '!dice', desc: 'Roll dice (1-6)' }],
  async handler(ctx) {
    const value = 1 + Math.floor(Math.random() * 6);
    await ctx.reply(`🎲 ${value}`);
  }
};

export function ping(store: SystemStore, client: MatrixClient): Command {
  return {
    name: 'ping',
    desc: 'Test connectivity (with latency)',
    section: 'Other',
    rows: [{ command: '!ping', desc: 'Test connectivity (with latency)' }],
    async handler(ctx) {
      const matrix = await client.serverLatencyMs();
      const d1 = await store.ping();
      await ctx.reply(`pong (Matrix ${matrix} ms, D1 ${d1} ms)`);
    }
  };
}

export function poll(store: PollStore): Command {
  return {
    name: 'poll',
    desc: 'Create a poll',
    section: 'Other',
    rows: [{ command: '!poll', desc: 'Create a poll' }],
    async handler(ctx) {
      const parts = ctx.args.split('|').map((s) => s.trim());
      const question = parts[0];
      const options = parts.slice(1);
      if (!question || options.length < 2 || options.length > 10) {
        await ctx.reply('Usage: !poll Question | Option 1 | Option 2 | ...');
        return;
      }
      const doc = pollDoc(question, options, []);
      const eventId = await ctx.client.sendHtml(ctx.roomId, doc.body, doc.html);
      await store.pollCreate(
        ctx.roomId,
        eventId,
        question,
        options,
        new Date().toISOString()
      );
      await Promise.all(options.map(
        (_option, i) => ctx.client.sendReaction(ctx.roomId, eventId, OPTION_KEYS[i]!)
      ));
    }
  };
}

export async function handleReaction(
  client: MatrixClient,
  store: PollStore,
  event: InboundEvent,
  annotation: { eventId: string, key: string }
): Promise<void> {
  const optionIndex = OPTION_KEYS.indexOf(annotation.key as typeof OPTION_KEYS[number]);
  if (optionIndex < 0) return;
  const tally = await store.pollVote(
    event.roomId,
    annotation.eventId,
    optionIndex,
    event.sender
  );
  if (tally === null) return;
  const doc = pollDoc(tally.question, tally.options, tally.counts);
  await client.editHtml(event.roomId, annotation.eventId, doc.body, doc.html);
}

export function status(
  store: SystemStore,
  config: ReadonlyArray<readonly [string, boolean]>
): Command {
  return {
    name: 'status',
    desc: 'Show config and webhook status (administrators)',
    section: 'Other',
    rows: [{ command: '!status', desc: 'Show config and webhook status (administrators)' }],
    handler: admin(async (ctx) => {
      const doc = await render(store, config);
      await ctx.reply(doc.body, doc.html);
    })
  };
}

function pollDoc(
  question: string,
  options: readonly string[],
  counts: readonly number[]
): Doc {
  const lines: Doc[] = [html`${bold('Poll')}: ${question}`];
  for (let i = 0, len = options.length; i < len; i++) {
    const label = counts.length === 0 ? '' : ` — ${String(counts[i] ?? 0)}`;
    lines.push(html`${OPTION_KEYS[i]!} ${options[i]!}${label}`);
  }
  return join(lines, '\n');
}

async function render(
  store: SystemStore,
  config: ReadonlyArray<readonly [string, boolean]>
): Promise<Doc> {
  const lines: Doc[] = [bold('Status'), html`Config:`];
  for (let i = 0, len = config.length; i < len; i++) {
    const [name, ok] = config[i]!;
    lines.push(html`  ${code(name)} ${ok ? '✓' : '✗'}`);
  }
  const deliveries = await store.deliveries(5);
  if (deliveries.length === 0) {
    lines.push(html`Webhook deliveries: none`);
  } else {
    lines.push(html`Webhook deliveries (last ${String(deliveries.length)}):`);
    for (let i = 0, len = deliveries.length; i < len; i++) {
      const delivery = deliveries[i]!;
      lines.push(
        html`  ${formatUtc8(delivery.createdAt)} ${code(delivery.deliveryId)}`
      );
    }
  }
  return join(lines, '\n');
}
