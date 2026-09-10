import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { APPLE_TRACKS, appleSource, decodePallasPayload, trackEntries } from './apple.ts';
import { keysLength } from 'foxts/property-count';

function jwt(payload: unknown): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `header.${encoded}.signature`;
}

describe('decodePallasPayload', () => {
  it('decodes the base64url JSON payload', () => {
    const payload = decodePallasPayload(jwt({
      PostingDate: '2026-08-24',
      Assets: [{ Build: '25G83', OSVersion: '26.6.2' }]
    }));
    expect(payload.PostingDate).toBe('2026-08-24');
    expect(payload.Assets).toHaveLength(1);
    expect(payload.Assets![0]!.Build).toBe('25G83');
  });

  it('rejects a body that is not a JWT', () => {
    expect(() => decodePallasPayload('not-a-jwt')).toThrow('not a JWT');
  });

  it('rejects a payload that is not an object', () => {
    expect(() => decodePallasPayload(jwt('text'))).toThrow('not an object');
  });
});

describe('trackEntries', () => {
  const track = APPLE_TRACKS['macos-26-release']!;

  it('keeps only assets of the track train', () => {
    const entries = trackEntries(track, [
      { Build: '25G83', OSVersion: '26.6.2' },
      { Build: '24G830', OSVersion: '15.7.9' },
      { Build: '23H730', OSVersion: '14.7.8' }
    ], '2026-08-24');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe('25G83');
    expect(entries[0]!.title).toBe('macOS 26.6.2 (25G83)');
    expect(entries[0]!.updated).toBe('2026-08-24');
    expect(entries[0]!.link).toBe('');
    expect(entries[0]!.author).toBeNull();
  });

  it('deduplicates builds and sorts newest first', () => {
    const entries = trackEntries(track, [
      { Build: '25G83', OSVersion: '26.6.2' },
      { Build: '25G83', OSVersion: '26.6.2' },
      { Build: '25F71', OSVersion: '26.5' },
      { Build: '25G100', OSVersion: '26.6.10' }
    ], '2026-08-24');
    expect(entries.map((entry) => entry.id)).toEqual(['25G100', '25G83', '25F71']);
  });

  it('strips the legacy 9.9 version prefix', () => {
    const entries = trackEntries(APPLE_TRACKS['ios-26-release']!, [
      { Build: '23F77', OSVersion: '9.9.26.5' }
    ], '2026-08-24');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.title).toBe('iOS 26.5 (23F77)');
  });

  it('returns an empty list when the train has no assets', () => {
    const entries = trackEntries(APPLE_TRACKS['macos-27-beta']!, [], '2026-08-24');
    expect(entries).toEqual([]);
  });
});

describe('appleSource', () => {
  it('exposes one feed per track', () => {
    const source = appleSource();
    expect(source.key).toBe('apple');
    expect(source.label).toBe('Apple');
    expect(source.home).toBe('https://www.apple.com');
    expect(source.feeds).toHaveLength(keysLength(APPLE_TRACKS));
    for (let i = 0, len = source.feeds.length; i < len; i++) {
      const feed = source.feeds[i]!;
      expect(feed.kind).toBe('apple');
      expect(APPLE_TRACKS[feed.url]).toBeDefined();
    }
  });
});
