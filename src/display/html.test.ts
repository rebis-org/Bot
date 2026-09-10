import { describe, expect, it } from 'vitest';
import { bold, code, escapeHtml, html, link, sanitize, text } from './html.ts';

describe('escapeHtml', () => {
  it('escapes markup characters', () => {
    expect(escapeHtml('<a href="x">&\'')).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;\''
    );
  });
});

describe('html template', () => {
  it('escapes interpolated strings but not Doc values', () => {
    const doc = html`${'<script>'} ${bold('safe')}`;
    expect(doc.html).toBe('&lt;script&gt; <b>safe</b>');
    expect(doc.body).toBe('<script> **safe**');
  });
});

describe('link', () => {
  it('renders https links', () => {
    const doc = link('https://example.com/?a="b"', 'label');
    expect(doc.html).toBe('<a href="https://example.com/?a=&quot;b&quot;">label</a>');
    expect(doc.body).toBe('label');
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'mxc://server/media'
  ])('drops disallowed scheme %s', (url) => {
    const doc = link(url, 'click me');
    expect(doc.html).toBe('click me');
    expect(doc.html).not.toContain('<a');
    expect(doc.body).toBe('click me');
  });

  it('drops malformed urls but keeps the label', () => {
    const doc = link('not a url', code('x'));
    expect(doc.html).toBe('<code>x</code>');
  });

  it('keeps Doc labels when the scheme is disallowed', () => {
    const doc = link('javascript:alert(1)', bold('bold label'));
    expect(doc.html).toBe('<b>bold label</b>');
  });
});

describe('sanitize', () => {
  it('strips scripts and event handlers but keeps allowlisted markup', () => {
    const dirty = '<b>ok</b><script>alert(1)</script><img src=x onerror=alert(1)><a href="https://e.com" onclick="x()">l</a>';
    const cleaned = sanitize(dirty);
    expect(cleaned).toContain('<b>ok</b>');
    expect(cleaned).not.toContain('script');
    expect(cleaned).not.toContain('img');
    expect(cleaned).not.toContain('onerror');
    expect(cleaned).not.toContain('onclick');
    expect(cleaned).toContain('<a href="https://e.com">l</a>');
  });

  it('strips javascript hrefs', () => {
    expect(sanitize('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript');
  });
});

describe('text', () => {
  it('escapes both body views consistently', () => {
    const doc = text('<b>&</b>');
    expect(doc.body).toBe('<b>&</b>');
    expect(doc.html).toBe('&lt;b&gt;&amp;&lt;/b&gt;');
  });
});
