import { bold, code, html, join, link } from './html.ts';
import type { Doc } from './html.ts';
import { kv, timeText } from './format.ts';

export type Cell = Doc | string | null | undefined;
export type Row<P> = (payload: P) => Doc | undefined;

export function header(
  label: string,
  scope: string,
  url: string
): Doc {
  return html`${bold(label)} ${link(url, scope)}`;
}

export function kvRow<P>(label: string, get: (payload: P) => Cell): Row<P> {
  return (payload) => kv(label, get(payload));
}

export function codeRow<P>(
  label: string,
  get: (payload: P) => string | null | undefined
): Row<P> {
  return (payload) => {
    const value = get(payload);
    return kv(label, value ? code(value) : undefined);
  };
}

export function titleRow<P>(get: (payload: P) => string): Row<P> {
  return kvRow('Title', get);
}

export function userRow<P>(
  label: string,
  get: (payload: P) => { login?: string, html_url?: string } | null | undefined,
  linkUser: (
    user: { login?: string, html_url?: string } | null | undefined
  ) => Doc | string
): Row<P> {
  return (payload) => kv(label, linkUser(get(payload)));
}

export function linkRow<P>(
  label: string,
  get: (payload: P) => { url: string, text: string }
): Row<P> {
  return (payload) => {
    const item = get(payload);
    return kv(label, link(item.url, item.text));
  };
}

export function timeRow<P>(
  get: (payload: P) => string | null | undefined
): Row<P> {
  return (payload) => {
    const value = get(payload);
    return kv('Time', value ? timeText(value) : undefined);
  };
}

export function listRow<P>(
  label: string,
  get: (payload: P) => ReadonlyArray<Doc | string>
): Row<P> {
  return (payload) => {
    const items = get(payload);
    if (items.length === 0) return kv(label, undefined);
    const lines: Doc[] = [html`\n${label}:`];
    for (let i = 0, len = items.length; i < len; i++) {
      lines.push(html`  ${items[i]!}`);
    }
    return join(lines, '\n');
  };
}

function collect<P>(rows: ReadonlyArray<Row<P>>, payload: P): Doc[] {
  const content: Doc[] = [];
  for (let i = 0, len = rows.length; i < len; i++) {
    const row = rows[i]!(payload);
    if (row !== undefined) content.push(row);
  }
  return content;
}

export function when<P>(
  cond: (payload: P) => boolean,
  rows: ReadonlyArray<Row<P>>
): Row<P> {
  return (payload) => {
    if (!cond(payload)) return;
    const content = collect(rows, payload);
    return content.length === 0
      ? undefined
      : join(content, '\n');
  };
}

export function compose<P>(
  getHeader: (payload: P) => { label: string, scope: string, url: string },
  rows: ReadonlyArray<Row<P>>
): (payload: P) => Doc | null {
  return (payload) => {
    const h = getHeader(payload);
    return join(
      [header(h.label, h.scope, h.url), html``, ...collect(rows, payload)],
      '\n'
    );
  };
}
