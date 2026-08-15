import { bold, code, fmt, FormattedString } from '@grammyjs/parse-mode';
import type { SystemStore } from '../../domain/ports.ts';
import { formatUtc8 } from '../../display/format.ts';
import type { Command, GroupCtx } from '../kernel.ts';
import { commandArgs, send } from '../kernel.ts';

const DICE: Record<
  string,
  { emoji: '🎲' | '🎯' | '🏀' | '⚽' | '🎳' | '🎰', range: string }
> = {
  dice: { emoji: '🎲', range: '1-6' },
  darts: { emoji: '🎯', range: '1-6' },
  basketball: { emoji: '🏀', range: '1-5' },
  football: { emoji: '⚽', range: '1-5' },
  slots: { emoji: '🎰', range: '1-64' },
  bowling: { emoji: '🎳', range: '1-6' }
};

export const dice: Command = {
  name: 'dice',
  desc: 'Roll dice',
  section: 'Other',
  rows: [
    {
      command: '/dice <type>',
      desc: 'Roll dice (dice/darts/basketball/football/slots/bowling)'
    }
  ],
  async handler(c) {
    const type = commandArgs(c).toLowerCase();
    const spec = DICE[type];
    if (!spec) {
      await send(c, diceUsage());
      return;
    }
    await c.replyWithDice(spec.emoji);
  }
};

export function ping(store: SystemStore): Command {
  return {
    name: 'ping',
    desc: 'Test connectivity (with latency)',
    section: 'Other',
    rows: [{ command: '/ping', desc: 'Test connectivity (with latency)' }],
    async handler(c) {
      const start = Date.now();
      await c.api.getMe();
      const d1 = await store.ping();
      await c.reply(`pong (Telegram ${Date.now() - start} ms, D1 ${d1} ms)`);
    }
  };
}

export const poll: Command = {
  name: 'poll',
  desc: 'Create a poll',
  section: 'Other',
  rows: [{ command: '/poll', desc: 'Create a poll' }],
  async handler(c) {
    const parts = commandArgs(c).split('|').map((s) => s.trim());
    const question = parts[0];
    const options = parts.slice(1);
    if (!question || options.length < 2 || options.length > 10) {
      await c.reply('Usage: /poll Question | Option 1 | Option 2 | ...');
      return;
    }
    await c.replyWithPoll(question, options, { is_anonymous: true });
  }
};

export function status(
  store: SystemStore,
  config: ReadonlyArray<readonly [string, boolean]>
): Command {
  return {
    name: 'status',
    desc: 'Show config and webhook status',
    section: 'Other',
    rows: [{ command: '/status', desc: 'Show config and webhook status' }],
    async handler(c) {
      await send(c, await render(store, config));
    }
  };
}

function diceUsage(): FormattedString {
  const lines = Object.entries(DICE).map(([name, spec]) => fmt`${
    spec.emoji
  } ${code}${name}${code} (${code}${spec.range}${code})`);
  return FormattedString.join(
    [fmt`Usage: ${code}/dice <type>${code}`, ...lines],
    '\n'
  );
}

async function render(
  store: SystemStore,
  config: ReadonlyArray<readonly [string, boolean]>
): Promise<FormattedString> {
  const rows = config.map(([name, ok]) => fmt`${
    code
  }${name}${code} ${ok ? '✓' : '✗'}`);
  const lines: FormattedString[] = [
    fmt`${bold}Status${bold}`,
    fmt`Config:`,
    ...rows.map((row) => fmt`  ${row}`)
  ];
  const deliveries = await store.deliveries(5);
  if (deliveries.length === 0) {
    lines.push(fmt`Webhook deliveries: none`);
  } else {
    lines.push(fmt`Webhook deliveries (last ${deliveries.length}):`);
    for (let i = 0, len = deliveries.length; i < len; i++) {
      const delivery = deliveries[i]!;
      lines.push(
        fmt`  ${formatUtc8(delivery.createdAt)} ${code}${delivery.deliveryId}${code}`
      );
    }
  }
  return FormattedString.join(lines, '\n');
}
