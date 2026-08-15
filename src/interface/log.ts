import type { FormattedString } from '@grammyjs/parse-mode';
import { bold, code, fmt } from '@grammyjs/parse-mode';
import type { Middleware } from 'grammy';
import { timeText, userDisplayName } from '../display/format.ts';
import type { GroupCtx } from './kernel.ts';

export function groupLog(threadId: number | undefined): Middleware<GroupCtx> {
  return async (c, next) => {
    const log = logEntry(c);
    if (log) {
      try {
        await c.api.sendMessage(c.chat.id, log.text, {
          entities: log.entities,
          message_thread_id: threadId
        });
      } catch (err) {
        console.error(err);
      }
    }
    await next();
  };
}

function logEntry(c: GroupCtx): FormattedString | null {
  const stamp = timeText(new Date().toISOString());
  const message = c.message;
  if (message) {
    if (message.new_chat_members?.length) {
      return entry(
        stamp,
        'Members joined',
        message.new_chat_members.map(userDisplayName).join(', ')
      );
    }
    if (message.left_chat_member) {
      return entry(
        stamp,
        'Member left',
        userDisplayName(message.left_chat_member)
      );
    }
    if (message.new_chat_title) {
      return entry(stamp, 'Chat title changed', message.new_chat_title);
    }
    if (message.new_chat_photo) return entry(stamp, 'Chat photo changed');
    if (message.delete_chat_photo) return entry(stamp, 'Chat photo removed');
    if (message.pinned_message) {
      return entry(
        stamp,
        'Message pinned',
        fmt`#${code}${message.pinned_message.message_id}${code} by ${userDisplayName(message.from)}`
      );
    }
  }
  const edited = c.editedMessage;
  if (edited) {
    return entry(
      stamp,
      'Message edited',
      fmt`#${code}${edited.message_id}${code} by ${userDisplayName(edited.from)}`
    );
  }
  return null;
}

function entry(
  stamp: FormattedString,
  title: string,
  detail: FormattedString | string = ''
): FormattedString {
  return detail
    ? fmt`${stamp} ${bold}${title}${bold} ${detail}`
    : fmt`${stamp} ${bold}${title}${bold}`;
}
