import type { User } from 'grammy/types';

export function userDisplayName(u: User): string {
  return u.username
    ? `@${u.username}`
    : `${u.first_name}${u.last_name ? ` ${u.last_name}` : ''}`;
}

export function formatUtcCn(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  const cn = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(d);
  return `${d.toISOString().replace('T', ' ').slice(0, 16)} UTC (UTC+8 ${cn})`;
}

export function durationText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m} min` : (m === 0 ? `${h} h` : `${h} h ${m} min`);
}
