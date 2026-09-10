import { describe, expect, it } from 'vitest';
import { isBlockedHost, resolveSubscribe } from './sources.ts';

const RE_GH_KEY = /^github\.com\/[\w.-]+\/[\w.-]+$/;

describe('resolveSubscribe', () => {
  it('resolves the apple target', () => {
    const source = resolveSubscribe('apple');
    expect(source).not.toBeNull();
    expect(source!.key).toBe('apple');
    expect(source!.label).toBe('Apple');
    expect(source!.home).toBe('https://www.apple.com');
    expect(source!.feeds.length).toBeGreaterThan(0);
    expect(source!.feeds[0]!.kind).toBe('apple');
  });

  it.each([
    'https://git.zx2c4.com/cgit',
    'git://git.zx2c4.com/cgit',
    'ssh://git@git.zx2c4.com/cgit'
  ])('parses arbitrary git host %s', (spec) => {
    const source = resolveSubscribe(spec);
    expect(source).not.toBeNull();
    expect(source!.key).toBe('https://git.zx2c4.com/cgit');
    expect(source!.home).toBe('https://git.zx2c4.com/cgit');
    expect(source!.label).toBe('git.zx2c4.com/cgit');
    expect(source!.feeds[0]!.kind).toBe('feed');
  });

  it.each([
    'git@github.com:matrix-construct/tuwunel.git',
    'https://github.com/matrix-construct/tuwunel',
    'https://github.com/matrix-construct/tuwunel.git'
  ])('parses github repo %s', (spec) => {
    const source = resolveSubscribe(spec);
    expect(source).not.toBeNull();
    expect(source!.key).toBe('github.com/matrix-construct/tuwunel');
    expect(source!.feeds[0]).toEqual({
      kind: 'release',
      url: 'https://github.com/matrix-construct/tuwunel/releases.atom'
    });
  });

  it.each([
    'ssh://git@codeberg.org/forgejo/forgejo.git',
    'https://codeberg.org/forgejo/forgejo',
    'https://codeberg.org/forgejo/forgejo.git'
  ])('parses codeberg repo %s', (spec) => {
    const source = resolveSubscribe(spec);
    expect(source).not.toBeNull();
    expect(source!.key).toBe('codeberg.org/forgejo/forgejo');
    expect(source!.feeds[0]).toEqual({
      kind: 'release',
      url: 'https://codeberg.org/forgejo/forgejo/releases.atom'
    });
  });

  it.each([
    'git@github.com:nginx/nginx.git',
    'https://github.com/nginx/nginx',
    'https://github.com/nginx/nginx.git',
    'git@github.com:TwiN/gatus.git',
    'https://github.com/TwiN/gatus',
    'https://github.com/TwiN/gatus.git',
    'https://github.com/gnosek/fcgiwrap',
    'https://github.com/gnosek/fcgiwrap.git',
    'git@github.com:gnosek/fcgiwrap.git',
    'git@github.com:henrygd/beszel.git',
    'https://github.com/henrygd/beszel',
    'https://github.com/henrygd/beszel.git',
    'git@github.com:SagerNet/sing-box.git',
    'https://github.com/SagerNet/sing-box',
    'https://github.com/SagerNet/sing-box.git'
  ])('parses repo spec %s', (spec) => {
    const source = resolveSubscribe(spec);
    expect(source).not.toBeNull();
    expect(source!.key).toMatch(RE_GH_KEY);
    expect(source!.key).toBe(source!.key.toLowerCase());
    expect(source!.feeds[0]!.kind).toBe('release');
    expect(source!.feeds[0]!.url.toLowerCase()).toBe(
      `https://${source!.key}/releases.atom`
    );
  });

  it.each([
    'owner/repo',
    'gh:owner/repo'
  ])('parses short github form %s', (spec) => {
    const source = resolveSubscribe(spec);
    expect(source!.key).toBe('github.com/owner/repo');
    expect(source!.feeds[0]!.kind).toBe('release');
  });

  it.each([
    'cb:owner/repo',
    'codeberg:owner/repo'
  ])('parses short codeberg form %s', (spec) => {
    const source = resolveSubscribe(spec);
    expect(source!.key).toBe('codeberg.org/owner/repo');
    expect(source!.feeds[0]!.kind).toBe('release');
  });

  it.each([
    'https://127.0.0.1/repo',
    'https://10.0.0.1/repo',
    'https://172.16.0.1/repo',
    'https://192.168.1.1/repo',
    'https://100.64.0.1/repo',
    'https://169.254.169.254/latest/meta-data',
    'https://198.18.0.1/repo',
    'https://224.0.0.1/repo',
    'https://[::1]/repo',
    'https://[::ffff:10.0.0.1]/repo',
    'https://[64:ff9b::10.0.0.1]/repo',
    'https://[fd00::1]/repo',
    'https://[fe80::1]/repo',
    'https://[100::1]/repo',
    'https://localhost/repo',
    'https://foo.localhost/repo',
    'https://host.internal/repo',
    'https://host.lan/repo',
    'https://host.corp/repo',
    'https://host.home/repo',
    'https://example.com:8080/repo',
    'https://example.com:22/repo'
  ])('rejects dangerous target %s', (spec) => {
    expect(resolveSubscribe(spec)).toBeNull();
  });

  it.each([
    'https://8.8.8.8/repo',
    'https://1.1.1.1/repo',
    'https://[2001:4860:4860::8888]/repo'
  ])('parses public ip literal %s', (spec) => {
    const source = resolveSubscribe(spec);
    expect(source).not.toBeNull();
    expect(source!.key).toBe(spec);
    expect(source!.feeds[0]).toEqual({
      kind: 'feed',
      url: spec,
      discover: true
    });
  });

  it('rejects garbage', () => {
    expect(resolveSubscribe('')).toBeNull();
    expect(resolveSubscribe('not a url at all')).toBeNull();
  });
});

describe('isBlockedHost', () => {
  it('blocks reserved ip literals and local names', () => {
    expect(isBlockedHost('127.0.0.1')).toBe(true);
    expect(isBlockedHost('10.0.0.1')).toBe(true);
    expect(isBlockedHost('169.254.169.254')).toBe(true);
    expect(isBlockedHost('[::1]')).toBe(true);
    expect(isBlockedHost('::ffff:10.0.0.1')).toBe(true);
    expect(isBlockedHost('localhost')).toBe(true);
    expect(isBlockedHost('git.zx2c4.com')).toBe(false);
    expect(isBlockedHost('github.com')).toBe(false);
  });

  it('allows public ip literals', () => {
    expect(isBlockedHost('8.8.8.8')).toBe(false);
    expect(isBlockedHost('1.1.1.1')).toBe(false);
    expect(isBlockedHost('[2001:4860:4860::8888]')).toBe(false);
  });
});
