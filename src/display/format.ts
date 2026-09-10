import { code, html } from './html.ts';
import type { Doc } from './html.ts';

const SHANGHAI_TIME = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});

function utc8Text(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const utc = d.toISOString().replace('T', ' ').slice(0, 16);
  return `${utc} UTC (UTC+8 ${SHANGHAI_TIME.format(d)})`;
}

export function formatUtc8(isoTimestamp: string): string {
  return utc8Text(isoTimestamp) ?? isoTimestamp;
}

export function durationText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m} min` : (m === 0 ? `${h} h` : `${h} h ${m} min`);
}

export function kv(
  label: string,
  value: Doc | string | null | undefined
): Doc {
  if (value === undefined || value === null || value === '') {
    return html`${label}: N/A`;
  }
  return html`${label}: ${value}`;
}

export function timeText(iso: string): Doc {
  return code(utc8Text(iso) ?? iso);
}
