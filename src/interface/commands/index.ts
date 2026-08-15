import { CommandGroup, commandNotFound } from '@grammyjs/commands';
import { bold, fmt, FormattedString } from '@grammyjs/parse-mode';
import { Composer, InlineKeyboard } from 'grammy';
import type { Bot } from 'grammy';
import type { Command, CommandRow, Ctx, GroupCtx, HelpSection } from '../kernel.ts';
import { send, usage } from '../kernel.ts';
import { appendArrayInPlace } from 'foxts/append-array-in-place';

const keyboard = new InlineKeyboard().url(
  'Repository',
  'https://github.com/rebis-org/Bot'
);

export interface Commands {
  group: CommandGroup<GroupCtx>,
  unknown: Composer<GroupCtx>,
  sync: (bot: Bot<Ctx>) => Promise<void>
}

export function commands(commandList: readonly Command[]): Commands {
  const group = new CommandGroup<GroupCtx>();
  const helpText = renderHelp(sections(commandList));
  group.command('help', 'Show help', help);
  group.command('start', 'Show help', help);
  for (let i = 0, len = commandList.length; i < len; i++) {
    const cmd = commandList[i]!;
    group.command(cmd.name, cmd.desc, cmd.handler);
  }

  const unknown = new Composer<GroupCtx>();
  unknown.filter(commandNotFound(group)).use(async (c) => {
    await c.reply(
      c.commandSuggestion
        ? `Unknown command. Did you mean ${c.commandSuggestion}?`
        : 'Unknown command.'
    );
  });

  return {
    group,
    unknown,
    sync: (bot) => group.setCommands(bot)
  };

  async function help(c: GroupCtx) {
    await send(c, helpText, keyboard);
  }
}

function sections(commandList: readonly Command[]): HelpSection[] {
  const map = new Map<string, CommandRow[]>();
  for (let i = 0, len = commandList.length; i < len; i++) {
    const cmd = commandList[i]!;
    const rows = map.get(cmd.section) ?? [];
    for (let j = 0, rowsLen = cmd.rows.length; j < rowsLen; j++) {
      rows.push(cmd.rows[j]!);
    }
    map.set(cmd.section, rows);
  }
  const other = map.get('Other') ?? [];
  other.push({ command: '/help', desc: 'Show this help' });
  map.set('Other', other);
  return Array.from(map, ([heading, rows]) => ({ heading, rows }));
}

export function renderHelp(sections: readonly HelpSection[]): FormattedString {
  return FormattedString.join(
    [
      fmt`\n${bold}Help${bold}`,
      ...sections.map((s) => FormattedString.join(
        [fmt`${bold}${s.heading}${bold}`, usage(s.rows)],
        '\n'
      ))
    ],
    '\n\n'
  );
}
