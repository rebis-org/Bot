import { attempt } from '../attempt.ts';
import { bold, code, html } from '../display/html.ts';
import type { Doc } from '../display/html.ts';
import { timeText } from '../display/format.ts';
import type { MatrixClient } from '../infrastructure/matrix/client.ts';
import type { InboundEvent } from './kernel.ts';

export function logEntry(event: InboundEvent): Doc | null {
  const stamp = timeText(new Date().toISOString());
  const content = event.content;
  switch (event.type) {
    case 'm.room.member': {
      const membership = typeof content.membership === 'string'
        ? content.membership
        : '';
      if (membership === 'join') {
        return entry(stamp, 'Member joined', memberName(event));
      }
      if (membership === 'leave' || membership === 'ban') {
        return entry(stamp, 'Member left', memberName(event));
      }
      return null;
    }
    case 'm.room.name': {
      const name = typeof content.name === 'string' ? content.name : '';
      return entry(stamp, 'Room name changed', name);
    }
    case 'm.room.avatar':
      return entry(stamp, 'Room avatar changed');
    case 'm.room.pinned_events':
      return entry(stamp, 'Pinned events changed', `by ${event.sender}`);
    case 'm.room.redaction':
      return entry(
        stamp,
        'Message redacted',
        html`${code(`#${event.redacts ?? ''}`)} by ${event.sender}`
      );
    case 'm.room.message': {
      const relates = content['m.relates_to'] as
        | Record<string, unknown>
        | undefined;
      if (relates?.rel_type === 'm.replace') {
        const target = typeof relates.event_id === 'string'
          ? relates.event_id
          : '';
        return entry(
          stamp,
          'Message edited',
          html`${code(`#${target}`)} by ${event.sender}`
        );
      }
      return null;
    }
    default:
      return null;
  }
}

export async function postLog(
  client: MatrixClient,
  logRoomId: string | undefined,
  doc: Doc
): Promise<void> {
  if (logRoomId === undefined) {
    console.log(doc.body);
    return;
  }
  await attempt(() => client.sendHtml(logRoomId, doc.body, doc.html));
}

function memberName(event: InboundEvent): string {
  const displayname = event.content.displayname;
  return typeof displayname === 'string' && displayname !== ''
    ? displayname
    : event.sender;
}

function entry(stamp: Doc, title: string, detail: Doc | string = ''): Doc {
  return detail
    ? html`${stamp} ${bold(title)} ${detail}`
    : html`${stamp} ${bold(title)}`;
}
