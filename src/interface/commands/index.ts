import { bold, html, join, link } from '../../display/html.ts';
import type { Doc } from '../../display/html.ts';
import type {
  Command,
  CommandCtx,
  CommandRow,
  HelpSection
} from '../kernel.ts';
import { suggestCommand, usage } from '../kernel.ts';

export interface Commands {
  names: readonly string[],
  dispatch: (name: string, ctx: CommandCtx) => Promise<void>,
  help: () => { body: string, html: string }
}

export function commands(commandList: readonly Command[]): Commands {
  const byName = new Map<string, Command>();
  for (let i = 0, len = commandList.length; i < len; i++) {
    const cmd = commandList[i]!;
    byName.set(cmd.name, cmd);
  }
  const names = commandList.map((cmd) => cmd.name);

  return {
    names,
    async dispatch(name, ctx) {
      const cmd = byName.get(name);
      if (cmd) {
        await cmd.handler(ctx);
        return;
      }
      const suggestion = suggestCommand(name, names);
      await ctx.reply(
        suggestion === undefined
          ? 'Unknown command.'
          : `Unknown command. Did you mean \`!${suggestion}\`?`
      );
    },
    help() {
      const doc = renderHelp(sections(commandList));
      return { body: doc.body, html: doc.html };
    }
  };
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
  other.push({ command: '!help', desc: 'Show this help' });
  map.set('Other', other);
  return Array.from(map, ([heading, rows]) => ({ heading, rows }));
}

export function renderHelp(sections: readonly HelpSection[]): Doc {
  const blocks: Doc[] = [html`\n${bold('Help')}`];
  for (let i = 0, len = sections.length; i < len; i++) {
    const section = sections[i]!;
    blocks.push(join(
      [bold(section.heading), usage(section.rows)],
      '\n'
    ));
  }
  blocks.push(link('https://github.com/rebis-org/Bot', 'Repository'));
  return join(blocks, '\n\n');
}
