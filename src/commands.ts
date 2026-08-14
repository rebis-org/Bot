import { CommandGroup, commandNotFound } from '@grammyjs/commands';
import { bold, code, fmt } from '@grammyjs/parse-mode';
import type { Middleware } from 'grammy';
import { Composer, InlineKeyboard } from 'grammy';
import type { GroupCtx } from './kernel.ts';
import { send } from './kernel.ts';

const keyboard = new InlineKeyboard().url(
  'Repository',
  'https://github.com/rebis-org/Bot'
);

const helpText = fmt`
${bold}Help${bold}

${bold}Check-in${bold}
${code}/check in${code} Check in
${code}/check out${code} Check out
${code}/check retrieve [user ID]${code} View work hours for today (administrators)

${bold}Pins${bold}
${code}/pin insert${code} Pin the replied-to message (administrators)
${code}/pin delete <message ID>${code} Unpin and delete the record (administrators, confirmation required)
${code}/pin retrieve [message ID]${code} View pin information

${bold}Bindings${bold}
${code}/bind gh${code} Bind this group to GitHub (administrators)
${code}/bind gh unbind${code} Unbind (administrators)
${code}/bind gh status${code} View GitHub bound to this group
${code}/bind cf${code} Bind this group to Cloudflare (administrators)
${code}/bind cf unbind${code} Unbind (administrators)
${code}/bind cf status${code} View Cloudflare bound to this group
${code}/bind status${code} View all bound services

${bold}Other${bold}
${code}/ping${code} Test connectivity (with latency)
${code}/help${code} Show this help`;

export interface Commands {
  group: CommandGroup<GroupCtx>,
  unknown: Composer<GroupCtx>
}

export function commands(
  handlers: {
    check: Middleware<GroupCtx>,
    pin: Middleware<GroupCtx>,
    bind: Middleware<GroupCtx>
  }
): Commands {
  const group = new CommandGroup<GroupCtx>();
  group.command('help', 'Show help', help);
  group.command('start', 'Show help', help);
  group.command('ping', 'Test connectivity (with latency)', ping);
  group.command(
    'check',
    'Check in/out, retrieve (administrators)',
    handlers.check
  );
  group.command(
    'pin',
    'Pin/unpin, retrieve (administrators)',
    handlers.pin
  );
  group.command(
    'bind',
    'Bind/unbind GitHub or Cloudflare, status (administrators)',
    handlers.bind
  );

  const unknown = new Composer<GroupCtx>();
  unknown.filter(commandNotFound(group)).use(async (c) => {
    await c.reply(
      c.commandSuggestion
        ? `Unknown command. Did you mean ${c.commandSuggestion}?`
        : 'Unknown command.'
    );
  });

  return { group, unknown };
}

async function help(c: GroupCtx) {
  await send(c, helpText, keyboard);
}

async function ping(c: GroupCtx) {
  const start = Date.now();
  await c.api.getMe();
  await c.reply(`pong (${Date.now() - start} ms)`);
}
