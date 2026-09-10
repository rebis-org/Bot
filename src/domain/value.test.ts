import { describe, expect, it } from 'vitest';
import { extractLocalMedia, parseMxcUrl } from './value.ts';

const HS = 'matrix.rebis.cn';

describe('parseMxcUrl', () => {
  it('parses a well-formed mxc url', () => {
    expect(parseMxcUrl('mxc://matrix.rebis.cn/AbCdEf123')).toEqual({
      serverName: 'matrix.rebis.cn',
      mediaId: 'AbCdEf123'
    });
  });

  it('parses a server name with a port', () => {
    expect(parseMxcUrl('mxc://example.com:8448/mediaId')).toEqual({
      serverName: 'example.com:8448',
      mediaId: 'mediaId'
    });
  });

  it.each([
    'https://matrix.rebis.cn/AbCdEf123',
    'mxc:matrix.rebis.cn/AbCdEf123',
    'mxc://matrix.rebis.cn',
    'mxc:///AbCdEf123',
    'mxc://matrix.rebis.cn/',
    'mxc://matrix.rebis.cn/a/b',
    'mxc://',
    '',
    null,
    undefined,
    42,
    {},
    []
  ])('rejects %s', (input) => {
    expect(parseMxcUrl(input)).toBeNull();
  });
});

describe('extractLocalMedia', () => {
  it.each(['m.image', 'm.video', 'm.audio', 'm.file'])(
    'picks url for %s',
    (msgtype) => {
      const refs = extractLocalMedia(
        { msgtype, url: `mxc://${HS}/media1` },
        HS
      );
      expect(refs).toEqual([{ serverName: HS, mediaId: 'media1' }]);
    }
  );

  it('picks info.thumbnail_url alongside url', () => {
    const refs = extractLocalMedia(
      {
        msgtype: 'm.video',
        url: `mxc://${HS}/video1`,
        info: { thumbnail_url: `mxc://${HS}/thumb1` }
      },
      HS
    );
    expect(refs).toEqual([
      { serverName: HS, mediaId: 'video1' },
      { serverName: HS, mediaId: 'thumb1' }
    ]);
  });

  it('dedupes a thumbnail pointing at the same media', () => {
    const refs = extractLocalMedia(
      {
        msgtype: 'm.image',
        url: `mxc://${HS}/same`,
        info: { thumbnail_url: `mxc://${HS}/same` }
      },
      HS
    );
    expect(refs).toEqual([{ serverName: HS, mediaId: 'same' }]);
  });

  it.each(['m.text', 'm.notice', 'm.emote', 'm.location'])(
    'ignores non-media msgtype %s',
    (msgtype) => {
      const refs = extractLocalMedia(
        { msgtype, url: `mxc://${HS}/media1` },
        HS
      );
      expect(refs).toEqual([]);
    }
  );

  it('ignores content without a msgtype', () => {
    expect(extractLocalMedia({ url: `mxc://${HS}/media1` }, HS)).toEqual([]);
  });

  it('skips remote-server media', () => {
    const refs = extractLocalMedia(
      { msgtype: 'm.image', url: 'mxc://remote.example/media1' },
      HS
    );
    expect(refs).toEqual([]);
  });

  it('keeps a local thumbnail when url is remote', () => {
    const refs = extractLocalMedia(
      {
        msgtype: 'm.image',
        url: 'mxc://remote.example/media1',
        info: { thumbnail_url: `mxc://${HS}/thumb1` }
      },
      HS
    );
    expect(refs).toEqual([{ serverName: HS, mediaId: 'thumb1' }]);
  });

  it('ignores non-mxc and missing urls', () => {
    const refs = extractLocalMedia(
      {
        msgtype: 'm.file',
        url: 'https://example.com/file',
        info: { thumbnail_url: 42 }
      },
      HS
    );
    expect(refs).toEqual([]);
  });

  it('ignores info that is not an object', () => {
    const refs = extractLocalMedia(
      { msgtype: 'm.image', url: `mxc://${HS}/media1`, info: 'x' },
      HS
    );
    expect(refs).toEqual([{ serverName: HS, mediaId: 'media1' }]);
  });
});
