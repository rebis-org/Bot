import { tryCatch } from '@moeru/std/try-catch';
import { contains } from 'fast-cidr-tools';
import { isIP } from 'node:net';
import { appleSource } from './apple.ts';

export const SUBSCRIBE_PROVIDER = 'subscribe';

export type FeedKind = 'release' | 'feed' | 'apple';

export interface SubscribeFeed {
  kind: FeedKind,
  url: string,
  discover?: boolean
}

export interface SubscribeSource {
  key: string,
  label: string,
  home: string,
  feeds: readonly SubscribeFeed[]
}

const RE_SHORT_REPO =
  /^(?:(github\.com|codeberg\.org)\/)?(?:(?:github|gh|codeberg|cb):)?([\w.-]+)\/([\w.-]+)$/i;
const RE_SCP_LIKE = /^git@([a-z0-9.-]+):(\S+)$/i;
const RE_CODEBERG_PREFIX = /^(?:codeberg|cb):/i;
const RE_KNOWN_FEED_SUFFIX = /(?:\/(?:releases|commits|tags))?\.(?:atom|rss)\/?$/i;
const RE_GIT_SUFFIX = /\.git$/i;
const RE_FEED_PATH = /\.(?:atom|rss|xml)$|\/(?:atom|rss|feed)$/i;
const RE_TRAILING_SLASH = /\/+$/;
const RE_SCHEME = /^https?:\/\//i;
const RE_FEED_TYPE = /atom|rss/i;
const RE_WHITESPACE = /\s+/;
const KNOWN_HOSTS = new Set(['github.com', 'codeberg.org']);
const WEB_SCHEMES = new Set(['http:', 'https:', 'git:', 'ssh:']);

interface RepoRef {
  host: string,
  owner: string,
  name: string
}

interface WebSpec {
  repo: RepoRef | null,
  url: string
}

const RESERVED_IP_RANGES = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '::/128',
  '::1/128',
  '::ffff:0:0/96',
  '64:ff9b::/96',
  '64:ff9b:1::/48',
  '100::/64',
  '2001::/23',
  '2001:db8::/32',
  'fc00::/7',
  'fe80::/10',
  'ff00::/8'
];

function isReservedIp(ip: string): boolean {
  return contains(RESERVED_IP_RANGES, [ip]);
}

export function isBlockedHost(host: string): boolean {
  const normalized = host.toLowerCase();
  if (normalized === '') return true;
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true;
  if (normalized.endsWith('.internal') || normalized.endsWith('.lan')) return true;
  if (normalized.endsWith('.corp') || normalized.endsWith('.home')) return true;
  const literal = stripBrackets(normalized);
  return isIP(literal) !== 0 && isReservedIp(literal);
}

function stripBrackets(host: string): string {
  return host[0] === '[' && host.at(-1) === ']'
    ? host.slice(1, -1)
    : host;
}

export function resolveSubscribe(spec: string): SubscribeSource | null {
  const trimmed = spec.trim();
  if (trimmed === 'apple') return appleSource();
  const short = parseShortRepo(trimmed);
  if (short !== null) return repoSource(short);
  const web = parseWebSpec(trimmed);
  if (web === null) return null;
  if (web.repo !== null) return repoSource(web.repo);
  return urlSource(web.url);
}

function parseShortRepo(spec: string): RepoRef | null {
  const match = RE_SHORT_REPO.exec(spec);
  if (!match) return null;
  const host = match[1]?.toLowerCase()
    ?? (RE_CODEBERG_PREFIX.test(spec) ? 'codeberg.org' : 'github.com');
  return { host, owner: match[2]!, name: match[3]! };
}

function parseWebSpec(spec: string): WebSpec | null {
  const scp = RE_SCP_LIKE.exec(spec);
  const host = scp?.[1] ?? urlHost(spec);
  if (host === null || host === '' || isBlockedHost(host)) return null;
  const rawPath = scp?.[2] ?? urlPath(spec);
  if (rawPath === null || rawPath === '') return null;
  const path = rawPath
    .replace(RE_KNOWN_FEED_SUFFIX, '')
    .replace(RE_GIT_SUFFIX, '')
    .replace(RE_TRAILING_SLASH, '');
  const segments = path.split('/').filter((segment) => segment !== '');
  const normalizedHost = host.toLowerCase();
  if (KNOWN_HOSTS.has(normalizedHost) && segments.length === 2) {
    return {
      repo: {
        host: normalizedHost,
        owner: segments[0]!,
        name: segments[1]!
      },
      url: ''
    };
  }
  if (segments.length === 0) return null;
  return { repo: null, url: `https://${normalizedHost}/${segments.join('/')}` };
}

function urlHost(spec: string): string | null {
  const parsed = parseUrl(spec);
  return parsed?.host ?? null;
}

function urlPath(spec: string): string | null {
  const parsed = parseUrl(spec);
  return parsed?.pathname ?? null;
}

function parseUrl(spec: string): URL | null {
  const { data: parsed } = tryCatch(() => new URL(spec));
  if (parsed === undefined) return null;
  if (!WEB_SCHEMES.has(parsed.protocol)) return null;
  if (parsed.port !== '') return null;
  return parsed;
}

function repoSource(repo: RepoRef): SubscribeSource {
  const path = `${repo.owner}/${repo.name}`;
  const home = `https://${repo.host}/${path}`;
  return {
    key: `${repo.host}/${path.toLowerCase()}`,
    label: path,
    home,
    feeds: [{ kind: 'release', url: `${home}/releases.atom` }]
  };
}

function urlSource(url: string): SubscribeSource {
  const normalized = normalizeUrl(url);
  return {
    key: normalized,
    label: normalized.replace(RE_SCHEME, ''),
    home: normalized,
    feeds: [{
      kind: 'feed',
      url: normalized,
      discover: !RE_FEED_PATH.test(new URL(normalized).pathname)
    }]
  };
}

function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  let path = parsed.pathname;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return `${parsed.origin}${path}${parsed.search}`;
}

export async function discoverFeedUrl(
  html: string,
  pageUrl: string
): Promise<string | null> {
  let found: string | null = null;
  await new HTMLRewriter()
    .on('link', {
      element(el) {
        if (found !== null) return;
        const rel = el.getAttribute('rel');
        const href = el.getAttribute('href');
        if (rel === null || href === null) return;
        if (!rel.toLowerCase().split(RE_WHITESPACE).includes('alternate')) return;
        const type = el.getAttribute('type');
        if (type !== null && !RE_FEED_TYPE.test(type)) return;
        const resolved = parseUrl(new URL(href, pageUrl).href);
        if (resolved === null) return;
        if (resolved.protocol !== 'https:' || isBlockedHost(resolved.hostname)) return;
        found = normalizeUrl(resolved.href);
      }
    })
    .transform(new Response(html))
    .text();
  return found;
}
