import { bold, code, fmt, FormattedString, link } from '@grammyjs/parse-mode';
import { kv, timeText } from './format.ts';

export type Cell = FormattedString | string | null | undefined;
export type Row<P> = (payload: P) => FormattedString | string | undefined;

export function header(
  label: string,
  scope: string,
  url: string
): FormattedString {
  return fmt`${bold}${label}${bold} ${link(url)}${scope}${link(url)}`;
}

export function itemLink(
  url: string,
  text: FormattedString | string
): FormattedString {
  return fmt`${link(url)}${text}${link(url)}`;
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
    return kv(label, value ? fmt`${code}${value}${code}` : undefined);
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
  ) => FormattedString | string
): Row<P> {
  return (payload) => kv(label, linkUser(get(payload)));
}

export function linkRow<P>(
  label: string,
  get: (payload: P) => { url: string, text: string }
): Row<P> {
  return (payload) => {
    const item = get(payload);
    return kv(label, itemLink(item.url, item.text));
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
  get: (payload: P) => ReadonlyArray<FormattedString | string>
): Row<P> {
  return (payload) => {
    const items = get(payload);
    if (items.length === 0) return kv(label, undefined);
    return FormattedString.join(
      [fmt`\n${label}:`, ...items.map((item) => fmt`  ${item}`)],
      '\n'
    );
  };
}

export function when<P>(
  cond: (payload: P) => boolean,
  rows: ReadonlyArray<Row<P>>
): Row<P> {
  return (payload) => {
    if (!cond(payload)) return;
    const content: Array<FormattedString | string> = [];
    for (let i = 0, len = rows.length; i < len; i++) {
      const row = rows[i]!(payload);
      if (row !== undefined) content.push(row);
    }
    return content.length === 0
      ? undefined
      : FormattedString.join(content, '\n');
  };
}

export function compose<P>(
  getHeader: (payload: P) => { label: string, scope: string, url: string },
  rows: ReadonlyArray<Row<P>>
): (payload: P) => FormattedString | null {
  return (payload) => {
    const h = getHeader(payload);
    const content: Array<FormattedString | string> = [];
    for (let i = 0, len = rows.length; i < len; i++) {
      const row = rows[i]!(payload);
      if (row !== undefined) content.push(row);
    }
    return FormattedString.join([header(h.label, h.scope, h.url), '', ...content], '\n');
  };
}
