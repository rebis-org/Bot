import { tryCatch, tryCatchAsync } from '@moeru/std/try-catch';
import { nullthrow } from 'foxts/guard';
import { getDomain } from 'tldts-experimental';
import { readBodyCapped } from '../body.ts';
import { isBlockedHost } from './sources.ts';

const MAX_FEED_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 10000;
const FEED_USER_AGENT = 'rebis-bot/1.0 (+https://github.com/rebis-org/Bot)';

export class HttpError extends Error {
  override name = 'HttpError';
}

class StatusError extends HttpError {
  override name = 'StatusError';
}

function assertFetchable(url: string): string {
  const parsed = nullthrow(
    tryCatch(() => new URL(url)).data,
    `${url} failed: invalid URL`
  );
  if (parsed.protocol !== 'https:') {
    throw new HttpError(`${url} failed: only https URLs are allowed`);
  }
  if (parsed.port !== '') {
    throw new HttpError(`${url} failed: non-default ports are not allowed`);
  }
  if (isBlockedHost(parsed.hostname)) {
    throw new HttpError(`${url} failed: host is not allowed`);
  }
  return parsed.href;
}

export async function readLimited(res: Response, url: string): Promise<string> {
  const text = await readBodyCapped(
    res.body,
    res.headers.get('content-length'),
    MAX_FEED_BYTES
  );
  return nullthrow(text, `${url} failed: response too large`);
}

async function fetchOnce(initialUrl: string): Promise<string> {
  let current = assertFetchable(initialUrl);
  const rootSite = siteKey(new URL(current).hostname);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // eslint-disable-next-line no-await-in-loop
    const res = await fetch(current, {
      headers: { 'user-agent': FEED_USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'manual'
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (location === null || hop === MAX_REDIRECTS) {
        throw new HttpError(`${initialUrl} failed: ${String(res.status)}`);
      }
      const next = assertFetchable(new URL(location, current).href);
      if (siteKey(new URL(next).hostname) !== rootSite) {
        throw new HttpError(`${initialUrl} failed: cross-site redirect`);
      }
      current = next;
      continue;
    }
    if (!res.ok) throw new StatusError(`${current} failed: ${String(res.status)}`);

    return readLimited(res, current);
  }
  throw new HttpError(`${initialUrl} failed: too many redirects`);
}

function siteKey(hostname: string): string {
  return getDomain(hostname) ?? hostname;
}

export async function fetchText(url: string): Promise<string> {
  const result = await tryCatchAsync(() => fetchOnce(url));
  if (result.data === undefined) {
    const parsed = new URL(url);
    if (result.error instanceof StatusError && !parsed.pathname.endsWith('/')) {
      parsed.pathname = `${parsed.pathname}/`;
      return fetchOnce(parsed.href);
    }
    throw result.error;
  }
  return result.data;
}
