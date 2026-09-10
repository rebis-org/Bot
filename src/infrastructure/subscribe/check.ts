import { tryCatchAsync } from '@moeru/std/try-catch';
import { bold, code, html, join, link } from '../../display/html.ts';
import type { Doc } from '../../display/html.ts';
import { timeText } from '../../display/format.ts';
import { detailBlock, pushHead } from '../../display/notice.ts';
import { nullthrow } from 'foxts/guard';
import { attempt } from '../../attempt.ts';
import type { Stores } from '../../domain/ports.ts';
import type { MatrixClient } from '../matrix/client.ts';
import type { FeedEntry } from './feed.ts';
import { parseFeedEntries } from './feed.ts';
import type { SubscribeFeed, SubscribeSource } from './sources.ts';
import { discoverFeedUrl, resolveSubscribe, SUBSCRIBE_PROVIDER } from './sources.ts';
import { fetchText } from './http.ts';
import { fetchAppleFeed } from './apple.ts';

const MAX_POSTS_PER_CHECK = 3;

export async function checkSubscriptions(
  client: MatrixClient,
  store: Stores
): Promise<void> {
  const targets = await store.subscribeTargets();
  const jobs: Array<Promise<unknown>> = [];
  for (let i = 0, len = targets.length; i < len; i++) {
    const target = targets[i]!;
    jobs.push((async () => {
      const { error } = await tryCatchAsync(() => checkTarget(client, store, target));
      if (error !== undefined) console.error(`subscribe ${target} failed:`, error);
    })());
  }
  await Promise.all(jobs);
}

async function checkTarget(
  client: MatrixClient,
  store: Stores,
  target: string
): Promise<void> {
  const source = resolveSubscribe(target);
  if (source === null) return;
  const rooms = await store.chats(SUBSCRIBE_PROVIDER, source.key);
  if (rooms.length === 0) return;
  for (let i = 0, len = source.feeds.length; i < len; i++) {
    const feed = source.feeds[i]!;
    // eslint-disable-next-line no-await-in-loop
    const entries = await fetchFeed(feed);
    if (entries.length === 0) continue;
    // eslint-disable-next-line no-await-in-loop
    const previous = await store.subscribeAdvance(
      source.key,
      feed.url,
      entries[0]!.id,
      new Date().toISOString()
    );
    if (previous === null || previous === entries[0]!.id) continue;
    const fresh = feed.kind === 'apple'
      ? [entries[0]!]
      : entriesAfter(entries, previous, MAX_POSTS_PER_CHECK);
    if (fresh.length === 0) continue;
    const doc = renderDoc(source, feed, fresh);
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(rooms.map((roomId) => attempt(() => client.sendHtml(roomId, doc.body, doc.html))));
  }
}

async function fetchFeed(feed: SubscribeFeed): Promise<FeedEntry[]> {
  if (feed.kind === 'apple') return fetchAppleFeed(feed.url);
  const url = feed.discover === true ? await resolveFeedUrl(feed.url) : feed.url;
  return parseFeedEntries(await fetchText(url));
}

async function resolveFeedUrl(pageUrl: string): Promise<string> {
  return nullthrow(
    await discoverFeedUrl(await fetchText(pageUrl), pageUrl),
    `no feed link on ${pageUrl}`
  );
}

function entriesAfter(
  entries: readonly FeedEntry[],
  previousId: string,
  limit: number
): FeedEntry[] {
  let stop = entries.length;
  for (let i = 0, len = entries.length; i < len; i++) {
    if (entries[i]!.id === previousId) {
      stop = i;
      break;
    }
  }
  const fresh: FeedEntry[] = [];
  for (let i = stop - 1; i >= Math.max(stop - limit, 0); i--) fresh.push(entries[i]!);
  return fresh;
}

function entryTitle(entry: FeedEntry): Doc {
  return entry.link === ''
    ? code(entry.title)
    : link(entry.link, entry.title);
}

function renderDoc(
  source: SubscribeSource,
  feed: SubscribeFeed,
  entries: readonly FeedEntry[]
): Doc {
  const target = link(source.home, source.label);
  if (feed.kind !== 'feed' && entries.length === 1) {
    const entry = entries[0]!;
    return detailBlock(
      html`${bold('Release')} ${entryTitle(entry)} to ${target}`,
      entryFields(entry)
    );
  }
  const singular = feed.kind === 'feed' ? 'entry' : 'release';
  const plural = feed.kind === 'feed' ? 'entries' : 'releases';
  const blocks: Doc[] = [];
  for (let i = 0, len = entries.length; i < len; i++) {
    const entry = entries[i]!;
    blocks.push(detailBlock(entryTitle(entry), entryFields(entry)));
  }
  return join([pushHead(entries.length, singular, plural, target), ...blocks], '\n\n');
}

function entryFields(entry: FeedEntry): Array<[string, Doc | string]> {
  const fields: Array<[string, Doc | string]> = [];
  if (entry.author !== null && entry.author !== '') {
    fields.push(['By', entry.author]);
  }
  fields.push(['Time', timeText(entry.updated)]);
  return fields;
}
