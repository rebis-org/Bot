import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchText } from './http.ts';

function redirectTo(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchText', () => {
  it('follows a same-site redirect', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(redirectTo('https://git.zx2c4.com/cgit/atom'))
      .mockResolvedValueOnce(new Response('<feed/>', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchText('https://git.zx2c4.com/cgit')).resolves.toBe('<feed/>');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('follows a redirect to a subdomain of the same site', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(redirectTo('https://cdn.zx2c4.com/feed.atom'))
      .mockResolvedValueOnce(new Response('<feed/>', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchText('https://git.zx2c4.com/cgit')).resolves.toBe('<feed/>');
  });

  it('rejects a cross-site redirect', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(redirectTo('https://evil.example/feed.atom'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchText('https://git.zx2c4.com/cgit')).rejects.toThrow('cross-site redirect');
  });

  it('rejects a redirect to a blocked host', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(redirectTo('https://127.0.0.1/feed.atom'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchText('https://git.zx2c4.com/cgit')).rejects.toThrow('not allowed');
  });

  it('rejects plain http targets', async () => {
    await expect(fetchText('http://git.zx2c4.com/cgit')).rejects.toThrow('only https');
  });

  it('rejects non-default ports', async () => {
    await expect(fetchText('https://git.zx2c4.com:8443/cgit')).rejects.toThrow('ports');
  });

  it('gives up after too many redirects', async () => {
    const fetchMock = vi.fn()
      .mockImplementation(() => Promise.resolve(redirectTo('https://git.zx2c4.com/loop')));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchText('https://git.zx2c4.com/cgit')).rejects.toThrow();
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(5);
  });
});
