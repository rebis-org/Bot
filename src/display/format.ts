import { code, fmt } from '@grammyjs/parse-mode';
import type { FormattedString } from '@grammyjs/parse-mode';
import type { User } from 'grammy/types';

const RE_WORD_START = /\b\w/g;
const SHANGHAI_TIME = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});

export function userDisplayName(u: User): string {
  return u.username
    ? `@${u.username}`
    : `${u.first_name}${u.last_name ? ` ${u.last_name}` : ''}`;
}

export function formatUtc8(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  if (Number.isNaN(d.getTime())) return isoTimestamp;
  const shanghaiTime = SHANGHAI_TIME.format(d);
  return `${d.toISOString().replace('T', ' ').slice(0, 16)} UTC (UTC+8 ${shanghaiTime})`;
}

export function durationText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m} min` : (m === 0 ? `${h} h` : `${h} h ${m} min`);
}

export function prettify(s: string): string {
  return s
    .replaceAll('_', ' ')
    .toLowerCase()
    .replaceAll(RE_WORD_START, (c) => c.toUpperCase());
}

export function kv(
  label: string,
  value: FormattedString | string | null | undefined
): FormattedString {
  if (value === undefined || value === null || value === '') {
    return fmt`${label}: N/A`;
  }
  return fmt`${label}: ${value}`;
}

export function timeText(iso: string): FormattedString {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fmt`${code}${iso}${code}`;
  const utc = d.toISOString().replace('T', ' ').slice(0, 16);
  const shanghaiTime = SHANGHAI_TIME.format(d);
  return fmt`${code}${utc}${code} UTC (UTC+8 ${code}${shanghaiTime}${code})`;
}
