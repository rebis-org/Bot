import { bold, html, join } from './html.ts';
import type { Doc } from './html.ts';
import { kv } from './format.ts';

export function pushHead(
  count: number,
  singular: string,
  plural: string,
  target: Doc
): Doc {
  const word = count === 1 ? singular : plural;
  return html`${bold(String(count))} new ${bold(word)} to ${target}`;
}

export function detailBlock(
  main: Doc,
  fields: ReadonlyArray<readonly [string, Doc | string]>
): Doc {
  const lines: Doc[] = [main];
  for (let i = 0, len = fields.length; i < len; i++) {
    lines.push(html`  ${kv(fields[i]![0], fields[i]![1])}`);
  }
  return join(lines, '\n');
}
