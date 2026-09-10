import { Buffer } from 'node:buffer';
import { tryCatch } from '@moeru/std/try-catch';
import { nullthrow } from 'foxts/guard';
import { split0th } from 'foxts/split-nth';
import type { FeedEntry } from './feed.ts';
import { readLimited } from './http.ts';
import type { SubscribeFeed, SubscribeSource } from './sources.ts';

const PALLAS_URL = 'https://gdmf.apple.com/v2/assets';
const PALLAS_TIMEOUT_MS = 10000;
const AUDIENCE_CACHE_TTL_MS = 600000;
const RE_LEGACY_PREFIX = /^9\.9\./;

const MAC_ASSET = 'com.apple.MobileAsset.MacSoftwareUpdate';
const OS_ASSET = 'com.apple.MobileAsset.SoftwareUpdate';

interface AppleDevice {
  version: string,
  build: string,
  prodtype: string,
  model: string
}

interface AppleTrack {
  name: string,
  train: string,
  audience: string,
  assetType: string,
  device: AppleDevice
}

function device(prodtype: string, model: string) {
  return (version: string, build: string): AppleDevice => ({
    version,
    build,
    prodtype,
    model
  });
}

const macBook = device('MacBookPro18,3', 'J314sAP');
const iPhone7 = device('iPhone7,1', 'N56AP');
const iPhone9 = device('iPhone9,3', 'D101AP');
const iPhone10 = device('iPhone10,6', 'D221AP');
const iPhone11 = device('iPhone11,8', 'N841AP');
const iPhone12 = device('iPhone12,1', 'N104AP');
const iPad5 = device('iPad5,1', 'J96AP');
const iPad6 = device('iPad6,12', 'J72tAP');
const iPad7 = device('iPad7,12', 'J172AP');
const iPad16 = device('iPad16,5', 'J720AP');
const watch6 = device('Watch6,18', 'N199AP');
const watch7 = device('Watch7,5', 'N210AP');
const homePod = device('AudioAccessory5,1', 'B520AP');
const appleTv = device('AppleTV14,1', 'J255AP');
const visionPro = device('RealityDevice14,1', 'N301AP');

export const APPLE_TRACKS: Record<string, AppleTrack> = {
  'macos-14-release': { name: 'macOS', train: '14', audience: '60b55e25-a8ed-4f45-826c-c1495a4ccc65', assetType: MAC_ASSET, device: macBook('14.7.8', '23H730') },
  'macos-14-beta': { name: 'macOS', train: '14', audience: '77c3bd36-d384-44e8-b550-05122d7da438', assetType: MAC_ASSET, device: macBook('14.7.8', '23H730') },
  'macos-15-release': { name: 'macOS', train: '15', audience: '60b55e25-a8ed-4f45-826c-c1495a4ccc65', assetType: MAC_ASSET, device: macBook('15.7', '24G222') },
  'macos-15-beta': { name: 'macOS', train: '15', audience: '98df7800-8378-4469-93bf-5912da21a1e1', assetType: MAC_ASSET, device: macBook('15.7', '24G222') },
  'macos-26-release': { name: 'macOS', train: '26', audience: '60b55e25-a8ed-4f45-826c-c1495a4ccc65', assetType: MAC_ASSET, device: macBook('26.0.1', '25A362') },
  'macos-26-beta': { name: 'macOS', train: '26', audience: '832afda4-7283-41da-a95b-75f4a151e473', assetType: MAC_ASSET, device: macBook('26.0.1', '25A362') },
  'macos-27-beta': { name: 'macOS', train: '27', audience: '621ba5ab-54b6-4a71-891a-425ac0ce4551', assetType: MAC_ASSET, device: macBook('26.5', '25F71') },
  'ios-12-release': { name: 'iOS', train: '12', audience: '01c1d682-6e8f-4908-b724-5501fe3f5e5c', assetType: OS_ASSET, device: iPhone7('12.5.6', '16H71') },
  'ios-15-release': { name: 'iOS', train: '15', audience: '01c1d682-6e8f-4908-b724-5501fe3f5e5c', assetType: OS_ASSET, device: iPhone9('15.6', '19G71') },
  'ios-16-release': { name: 'iOS', train: '16', audience: '01c1d682-6e8f-4908-b724-5501fe3f5e5c', assetType: OS_ASSET, device: iPhone10('16.6', '20G75') },
  'ios-18-release': { name: 'iOS', train: '18', audience: '01c1d682-6e8f-4908-b724-5501fe3f5e5c', assetType: OS_ASSET, device: iPhone11('18.5', '22F76') },
  'ios-18-beta': { name: 'iOS', train: '18', audience: '41651cee-d0e2-442f-b786-85682ff6db86', assetType: OS_ASSET, device: iPhone11('18.5', '22F76') },
  'ios-26-release': { name: 'iOS', train: '26', audience: '01c1d682-6e8f-4908-b724-5501fe3f5e5c', assetType: OS_ASSET, device: iPhone12('26.0.1', '23A355') },
  'ios-26-beta': { name: 'iOS', train: '26', audience: 'da1941f6-9822-4347-b771-fb09c3509052', assetType: OS_ASSET, device: iPhone12('26.0.1', '23A355') },
  'ios-27-beta': { name: 'iOS', train: '27', audience: 'a5f921db-50af-448c-8f7e-3f093ca2c954', assetType: OS_ASSET, device: iPhone12('26.5', '23F77') },
  'ipados-15-release': { name: 'iPadOS', train: '15', audience: '01c1d682-6e8f-4908-b724-5501fe3f5e5c', assetType: OS_ASSET, device: iPad5('15.6', '19G71') },
  'ipados-16-release': { name: 'iPadOS', train: '16', audience: '01c1d682-6e8f-4908-b724-5501fe3f5e5c', assetType: OS_ASSET, device: iPad6('16.6', '20G75') },
  'ipados-18-release': { name: 'iPadOS', train: '18', audience: '01c1d682-6e8f-4908-b724-5501fe3f5e5c', assetType: OS_ASSET, device: iPad7('18.5', '22F76') },
  'ipados-18-beta': { name: 'iPadOS', train: '18', audience: '41651cee-d0e2-442f-b786-85682ff6db86', assetType: OS_ASSET, device: iPad7('18.5', '22F76') },
  'ipados-26-release': { name: 'iPadOS', train: '26', audience: '01c1d682-6e8f-4908-b724-5501fe3f5e5c', assetType: OS_ASSET, device: iPad16('26.0.1', '23A355') },
  'ipados-26-beta': { name: 'iPadOS', train: '26', audience: 'da1941f6-9822-4347-b771-fb09c3509052', assetType: OS_ASSET, device: iPad16('26.0.1', '23A355') },
  'ipados-27-beta': { name: 'iPadOS', train: '27', audience: 'a5f921db-50af-448c-8f7e-3f093ca2c954', assetType: OS_ASSET, device: iPad16('26.5', '23F77') },
  'watchos-11-release': { name: 'watchOS', train: '11', audience: 'b82fcf9c-c284-41c9-8eb2-e69bf5a5269f', assetType: OS_ASSET, device: watch6('11.5', '22T572') },
  'watchos-11-beta': { name: 'watchOS', train: '11', audience: '23d7265b-1000-47cf-8d0a-07144942db9e', assetType: OS_ASSET, device: watch6('11.5', '22T572') },
  'watchos-26-release': { name: 'watchOS', train: '26', audience: 'b82fcf9c-c284-41c9-8eb2-e69bf5a5269f', assetType: OS_ASSET, device: watch6('26.0.1', '23R8352') },
  'watchos-26-beta': { name: 'watchOS', train: '26', audience: 'e73d2741-8003-45cd-b909-86b9840f2ea2', assetType: OS_ASSET, device: watch6('26.0.1', '23R8352') },
  'watchos-27-beta': { name: 'watchOS', train: '27', audience: '973a069a-8d0c-4247-8239-9493f14ee56e', assetType: OS_ASSET, device: watch7('26.5', '23T570') },
  'audioos-26-release': { name: 'audioOS', train: '26', audience: '0322d49d-d558-4ddf-bdff-c0443d0e6fac', assetType: OS_ASSET, device: homePod('26.0.1', '23J362') },
  'audioos-26-beta': { name: 'audioOS', train: '26', audience: '47ed08e9-bd89-454e-938c-664029863ee8', assetType: OS_ASSET, device: homePod('26.0.1', '23J362') },
  'tvos-26-release': { name: 'tvOS', train: '26', audience: '356d9da0-eee4-4c6c-bbe5-99b60eadddf0', assetType: OS_ASSET, device: appleTv('26.0.1', '23J362') },
  'tvos-26-beta': { name: 'tvOS', train: '26', audience: '69cc7bd5-9ff2-4f5e-8b4f-30955542a81d', assetType: OS_ASSET, device: appleTv('26.0.1', '23J362') },
  'tvos-27-beta': { name: 'tvOS', train: '27', audience: '6ca2978e-e976-48b5-9b85-cba646d5dea8', assetType: OS_ASSET, device: appleTv('26.5', '23L471') },
  'visionos-26-release': { name: 'visionOS', train: '26', audience: 'c59ff9d1-5468-4f6c-9e54-f68d5eeab93b', assetType: OS_ASSET, device: visionPro('26.0.1', '23M341') },
  'visionos-26-beta': { name: 'visionOS', train: '26', audience: '6cc62786-ab10-4911-bbc3-ebb7815972f6', assetType: OS_ASSET, device: visionPro('26.0.1', '23M341') },
  'visionos-27-beta': { name: 'visionOS', train: '27', audience: '3796f01d-bf07-45c2-8df6-ad7300055ed9', assetType: OS_ASSET, device: visionPro('26.5', '23O471') }
};

interface PallasAsset {
  Build: string,
  OSVersion: string
}

interface PallasPayload {
  PostingDate?: string,
  Assets?: PallasAsset[]
}

const audienceCache = new Map<string, { at: number, payload: PallasPayload }>();

export function appleSource(): SubscribeSource {
  const feeds: SubscribeFeed[] = [];
  const keys = Object.keys(APPLE_TRACKS);
  for (let i = 0, len = keys.length; i < len; i++) {
    feeds.push({ kind: 'apple', url: keys[i]! });
  }
  return {
    key: 'apple',
    label: 'Apple',
    home: 'https://www.apple.com',
    feeds
  };
}

export async function fetchAppleFeed(trackKey: string): Promise<FeedEntry[]> {
  const track = nullthrow(APPLE_TRACKS[trackKey], `unknown apple track: ${trackKey}`);
  const payload = await pallasPayload(track);
  return trackEntries(track, payload.Assets ?? [], payload.PostingDate ?? '');
}

export function trackEntries(
  track: AppleTrack,
  assets: readonly PallasAsset[],
  postingDate: string
): FeedEntry[] {
  const byBuild = new Map<string, PallasAsset>();
  for (let i = 0, len = assets.length; i < len; i++) {
    const asset = assets[i]!;
    if (trainOf(versionOf(asset)) !== track.train) continue;
    if (!byBuild.has(asset.Build)) byBuild.set(asset.Build, asset);
  }
  const builds = [...byBuild.values()]
    .toSorted((a, b) => compareVersions(versionOf(b), versionOf(a)));
  const entries: FeedEntry[] = [];
  for (let i = 0, len = builds.length; i < len; i++) {
    const asset = builds[i]!;
    entries.push({
      id: asset.Build,
      title: `${track.name} ${versionOf(asset)} (${asset.Build})`,
      updated: postingDate,
      link: '',
      author: null
    });
  }
  return entries;
}

export function decodePallasPayload(jwt: string): PallasPayload {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('pallas response is not a JWT');
  const { data: parsed } = tryCatch(
    () => JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as unknown
  );
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('pallas payload is not an object');
  }
  return parsed;
}

async function pallasPayload(track: AppleTrack): Promise<PallasPayload> {
  const cached = audienceCache.get(track.audience);
  if (cached !== undefined && cached.at > Date.now() - AUDIENCE_CACHE_TTL_MS) {
    return cached.payload;
  }
  const payload = await postPallas(track);
  audienceCache.set(track.audience, { at: Date.now(), payload });
  return payload;
}

async function postPallas(track: AppleTrack): Promise<PallasPayload> {
  const res = await fetch(PALLAS_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      AssetAudience: track.audience,
      ClientVersion: 2,
      AssetType: track.assetType,
      BuildVersion: track.device.build,
      HWModelStr: track.device.model,
      ProductType: track.device.prodtype,
      ProductVersion: track.device.version
    }),
    signal: AbortSignal.timeout(PALLAS_TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`pallas ${track.name} failed: ${res.status}`);
  return decodePallasPayload(await readLimited(res, PALLAS_URL));
}

function versionOf(asset: PallasAsset): string {
  return asset.OSVersion.replace(RE_LEGACY_PREFIX, '');
}

function trainOf(version: string): string {
  return split0th(version, '.');
}

function compareVersions(latest: string, current: string): number {
  const newer = latest.split('.');
  const older = current.split('.');
  const len = Math.max(newer.length, older.length);
  for (let i = 0; i < len; i++) {
    const next = Number(newer[i] ?? 0);
    const previous = Number(older[i] ?? 0);
    if (next !== previous) return next - previous;
  }
  return 0;
}
