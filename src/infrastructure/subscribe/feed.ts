import { parseFeed } from 'feedsmith';
import type { AtomFeed, JsonFeed, RdfFeed, RssFeed } from 'feedsmith';

export interface FeedEntry {
  id: string,
  title: string,
  updated: string,
  link: string,
  author: string | null
}

function mapEntries<T>(
  items: readonly T[] | undefined,
  pick: (item: T) => FeedEntry
): FeedEntry[] {
  const entries: FeedEntry[] = [];
  const list = items ?? [];
  for (let i = 0, len = list.length; i < len; i++) {
    entries.push(pick(list[i]!));
  }
  return entries;
}

export function parseFeedEntries(xml: string): FeedEntry[] {
  const { format, feed } = parseFeed(xml);
  switch (format) {
    case 'rss':
      return mapEntries(feed.items, (item: RssFeed.Item<string>) => {
        const link = item.link ?? '';
        return {
          id: item.guid?.value ?? link,
          title: item.title ?? '',
          updated: item.pubDate ?? '',
          link,
          author: item.authors?.[0]?.name ?? null
        };
      });
    case 'rdf':
      return mapEntries(feed.items, (item: RdfFeed.Item<string>) => {
        const link = item.link ?? '';
        return {
          id: link,
          title: item.title ?? '',
          updated: item.dc?.dates?.[0] ?? '',
          link,
          author: item.dc?.creators?.[0] ?? null
        };
      });
    case 'atom':
      return mapEntries(feed.entries, (entry: AtomFeed.Entry<string>) => ({
        id: entry.id ?? '',
        title: entry.title?.value ?? '',
        updated: entry.updated ?? entry.published ?? '',
        link: atomLink(entry),
        author: entry.authors?.[0]?.name ?? null
      }));
    case 'json':
      return mapEntries(feed.items, (item: JsonFeed.Item<string>) => {
        const link = item.url ?? item.external_url ?? '';
        return {
          id: item.id ?? link,
          title: item.title ?? '',
          updated: item.date_published ?? item.date_modified ?? '',
          link,
          author: item.authors?.[0]?.name ?? null
        };
      });
    default:
      throw new Error('unrecognized feed format');
  }
}

function atomLink(entry: AtomFeed.Entry<string>): string {
  const links = entry.links ?? [];
  for (let i = 0, len = links.length; i < len; i++) {
    const link = links[i]!;
    if (link.rel === undefined || link.rel === 'alternate') return link.href ?? '';
  }
  return links[0]?.href ?? '';
}
