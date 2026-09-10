import { tryCatch } from '@moeru/std/try-catch';
import { FilterXSS } from 'xss';

export interface Doc {
  body: string,
  html: string
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function doc(body: string, html: string): Doc {
  return { body, html: html.replaceAll('\n', '<br>') };
}

export function html(
  strings: TemplateStringsArray,
  ...values: ReadonlyArray<Doc | string>
): Doc {
  let body = '';
  let formatted = '';
  for (let i = 0, len = strings.length; i < len; i++) {
    body += strings[i];
    formatted += strings[i];
    const value = values[i];
    if (value === undefined) continue;
    if (typeof value === 'string') {
      body += value;
      formatted += escapeHtml(value);
    } else {
      body += value.body;
      formatted += value.html;
    }
  }
  return doc(body, formatted);
}

export function join(docs: readonly Doc[], separator: string): Doc {
  let body = '';
  let formatted = '';
  for (let i = 0, len = docs.length; i < len; i++) {
    if (i > 0) {
      body += separator;
      formatted += escapeHtml(separator);
    }
    body += docs[i]!.body;
    formatted += docs[i]!.html;
  }
  return doc(body, formatted);
}

export function text(value: string): Doc {
  return { body: value, html: escapeHtml(value) };
}

export function bold(value: Doc | string): Doc {
  const inner = typeof value === 'string' ? text(value) : value;
  return { body: `**${inner.body}**`, html: `<b>${inner.html}</b>` };
}

export function italic(value: Doc | string): Doc {
  const inner = typeof value === 'string' ? text(value) : value;
  return { body: `*${inner.body}*`, html: `<i>${inner.html}</i>` };
}

export function code(value: string): Doc {
  return { body: `\`${value}\``, html: `<code>${escapeHtml(value)}</code>` };
}

const LINK_SCHEMES = new Set(['https:', 'http:', 'mailto:']);

export function link(url: string, label: Doc | string): Doc {
  const inner = typeof label === 'string' ? text(label) : label;
  const { data: parsed } = tryCatch(() => new URL(url));
  const scheme = parsed?.protocol;
  if (scheme === undefined || !LINK_SCHEMES.has(scheme)) return inner;
  const href = escapeHtml(url);
  return { body: inner.body, html: `<a href="${href}">${inner.html}</a>` };
}

const XSS_FILTER = new FilterXSS({
  whiteList: {
    a: ['href'],
    b: [],
    strong: [],
    i: [],
    em: [],
    code: [],
    pre: [],
    br: []
  },
  stripIgnoreTag: true,
  stripIgnoreTagBody: ['script', 'style']
});

export function sanitize(value: string): string {
  return XSS_FILTER.process(value);
}
