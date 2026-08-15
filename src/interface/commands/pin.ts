import { Menu } from '@grammyjs/menu';
import { bold, code, fmt, FormattedString } from '@grammyjs/parse-mode';
import { StatelessQuestion } from '@grammyjs/stateless-question';
import type { Message } from 'grammy/types';
import type { PinStore } from '../../domain/ports.ts';
import type { Pin } from '../../domain/pin.ts';
import type { ContentType } from '../../domain/value.ts';
import { PinDraft } from '../../domain/pin.ts';
import { formatUtc8, userDisplayName } from '../../display/format.ts';
import type { Command, GroupCtx } from '../kernel.ts';
import {
  admin,
  commandArgs,
  isAdmin,
  parseId,
  requireAdmin,
  send,
  subcommands,
  usage
} from '../kernel.ts';

const CONFIRM = new Set(['confirm', 'yes', 'y', '1']);
const CONFIRM_HINT = 'Reply "confirm" to proceed. Reply anything else to cancel.';
const RE_PIN_ID = /#(\d+)/;
const RE_SPACE = /\s+/;

export const PIN_COMMANDS = [
  { command: '/pin insert', desc: 'Pin the replied-to message (administrators)' },
  {
    command: '/pin delete <message ID>',
    desc: 'Unpin and delete the record (administrators, confirmation required)'
  },
  { command: '/pin retrieve [message ID]', desc: 'View pin information' }
] as const;

export interface PinFeature {
  command: Command,
  question: StatelessQuestion<GroupCtx>,
  menu: Menu<GroupCtx>
}

export function pin(store: PinStore): PinFeature {
  const question = new StatelessQuestion<GroupCtx>(
    'confirm-pin-delete',
    async (c) => {
      const id = extractPinId(c.message.reply_to_message.text ?? '');
      if (id === undefined) return;
      const answer = (c.message.text ?? '').trim().toLowerCase();
      if (!CONFIRM.has(answer)) {
        await c.reply('Operation cancelled.');
        return;
      }
      await c.api.unpinChatMessage(c.chat.id, id).catch((err) => console.error(err));
      const removed = await store.remove(
        c.chat.id,
        id,
        new Date().toISOString()
      );
      await c.reply(
        removed
          ? `Pin removed and record deleted (message #${id}).`
          : `No pin record found for #${id}.`
      );
    }
  );

  const menu = new Menu<GroupCtx>('pin-list').dynamic(async (c, range) => {
    const visible = await store.list(c.chat.id, 8);
    const adminUser = await isAdmin(c);
    for (let i = 0, len = visible.length; i < len; i++) {
      const pin = visible[i]!;
      const id = pin.messageId.toString();
      range.text({
        text: `#${id} ${pin.senderName} ${pin.contentType}`,
        payload: id
      }, async (b) => {
        const row = await store.get(b.chat.id, Number(b.match));
        if (!row) {
          await b.answerCallbackQuery(
            'Record not found. It may have been deleted.'
          );
          return;
        }
        await sendPin(b, row);
      });
      if (adminUser) {
        range.text({ text: 'Delete', payload: id }, async (b) => {
          if (!(await requireAdmin(b))) return;
          await question.replyWithMarkdown(
            b,
            `Unpin and delete record #${b.match}?\n${CONFIRM_HINT}`
          );
        });
      }
      range.row();
    }
  });

  const router = subcommands<GroupCtx>(
    {
      insert: admin(async (c) => {
        const reply = c.msg!.reply_to_message;
        if (!reply) {
          await c.reply('Reply to a message, then send /pin insert.');
          return;
        }
        try {
          await c.api.pinChatMessage(c.chat.id, reply.message_id, {
            disable_notification: true
          });
        } catch (err) {
          console.error(err);
          await c.reply(
            'Pin failed. The bot needs administrator permission (can_pin_messages).'
          );
          return;
        }
        const snap = snapshot(reply);
        await store.upsert(PinDraft.create({
          chatId: c.chat.id,
          messageId: reply.message_id,
          userId: reply.from?.id ?? c.from.id,
          senderName: reply.from
            ? userDisplayName(reply.from)
            : reply.sender_chat?.title ?? 'Unknown',
          contentType: snap.contentType,
          content: snap.content,
          entities: (reply.text
            ? reply.entities
            : (reply.caption ? reply.caption_entities : null))
          ?? null,
          fileId: snap.fileId,
          pinnedAt: new Date().toISOString()
        }));
        await c.reply(`Pin complete (message #${reply.message_id}).`);
      }),
      delete: admin(async (c) => {
        const id = parseId(commandArgs(c))
          ?? c.msg!.reply_to_message?.message_id;
        if (id === undefined) {
          await c.reply(
            'Reply to the pinned message, or send /pin delete <message ID>.'
          );
          return;
        }
        await question.replyWithMarkdown(
          c,
          `Unpin and delete record #${id}?\n${CONFIRM_HINT}`
        );
      }),
      async retrieve(c) {
        const id = parseId(commandArgs(c));
        if (id !== undefined) {
          const row = await store.get(c.chat.id, id);
          if (row) await sendPin(c, row);
          else await c.reply(`No pin record found for #${id}.`);
          return;
        }
        await send(c, pinList(await store.list(c.chat.id)), menu);
      },
      async search(c) {
        const query = commandArgs(c).split(RE_SPACE).slice(1).join(' ').trim();
        if (!query) {
          await c.reply('Usage: /pin search <text>');
          return;
        }
        const rows = await store.search(c.chat.id, query, 5);
        if (rows.length === 0) {
          await c.reply(`No pins match "${query}".`);
          return;
        }
        const lines: FormattedString[] = [
          fmt`Pins matching ${code}${query}${code}:`
        ];
        for (let i = 0, len = rows.length; i < len; i++) {
          const pin = rows[i]!;
          lines.push(
            fmt`  ${code}#${pin.messageId}${code} | ${pin.senderName} | ${
              pin.content.length > 40 ? `${pin.content.slice(0, 40)}…` : pin.content
            }`
          );
        }
        await send(c, FormattedString.join(lines, '\n'));
      }
    },
    async (c) => {
      await send(c, usage(PIN_COMMANDS));
    }
  );

  return {
    command: {
      name: 'pin',
      desc: 'Pin/unpin, retrieve (administrators)',
      section: 'Pins',
      rows: PIN_COMMANDS,
      handler: router.middleware()
    },
    question,
    menu
  };
}

function extractPinId(text: string): number | undefined {
  const message = RE_PIN_ID.exec(text);
  return message ? Number(message[1]) : undefined;
}

function pinList(active: Pin[]): FormattedString {
  const lines: FormattedString[] = [
    fmt`${bold}Pinned messages (${active.length} total)${bold}`
  ];
  if (active.length === 0) {
    lines.push(fmt`No pinned messages.`);
    return FormattedString.join(lines, '\n');
  }
  for (let i = 0, len = active.length; i < len; i++) {
    const pin = active[i]!;
    const snippet = pin.content.length > 40
      ? `${pin.content.slice(0, 40)}…`
      : pin.content;
    const state = pin.unpinnedAt ? ' | Unpinned' : '';
    lines.push(
      fmt`  ${code}#${pin.messageId}${code} | ${pin.senderName} | ${pin.contentType} | ${
        formatUtc8(pin.pinnedAt)
      }${state}`
    );
    if (snippet && pin.contentType === 'text') {
      lines.push(fmt`    ${snippet}`);
    }
  }
  lines.push(
    fmt`Use the buttons below to view. To delete, send ${code}/pin delete <message ID>${code} (administrators).`
  );
  return FormattedString.join(lines, '\n');
}

async function sendPin(c: GroupCtx, pin: Pin) {
  const formatted = pin.content
    ? new FormattedString(pin.content, pin.entities ?? undefined)
    : undefined;
  const caption = formatted?.caption;
  const captionEntities = formatted?.caption_entities;
  switch (pin.contentType) {
    case 'photo':
      return c.replyWithPhoto(pin.fileId!, {
        caption,
        caption_entities: captionEntities
      });
    case 'video':
      return c.replyWithVideo(pin.fileId!, {
        caption,
        caption_entities: captionEntities
      });
    case 'animation':
      return c.replyWithAnimation(pin.fileId!, {
        caption,
        caption_entities: captionEntities
      });
    case 'sticker':
      return c.replyWithSticker(pin.fileId!);
    case 'document':
      return c.replyWithDocument(pin.fileId!, {
        caption,
        caption_entities: captionEntities
      });
    case 'audio':
      return c.replyWithAudio(pin.fileId!, {
        caption,
        caption_entities: captionEntities
      });
    case 'voice':
      return c.replyWithVoice(pin.fileId!);
    default:
      return c.reply(pin.content || `[${pin.contentType}]`, {
        entities: pin.entities ?? undefined
      });
  }
}

function snapshot(
  message: Message
): { contentType: ContentType, content: string, fileId: string | null } {
  if (message.text) return { contentType: 'text', content: message.text, fileId: null };
  const cap = message.caption ?? '';
  if (message.photo) {
    return {
      contentType: 'photo',
      content: cap,
      fileId: message.photo.at(-1)?.file_id ?? null
    };
  }
  if (message.animation) {
    return {
      contentType: 'animation',
      content: cap,
      fileId: message.animation.file_id
    };
  }
  if (message.video) {
    return { contentType: 'video', content: cap, fileId: message.video.file_id };
  }
  if (message.sticker) {
    return { contentType: 'sticker', content: '', fileId: message.sticker.file_id };
  }
  if (message.document) {
    return {
      contentType: 'document',
      content: cap,
      fileId: message.document.file_id
    };
  }
  if (message.audio) {
    return { contentType: 'audio', content: cap, fileId: message.audio.file_id };
  }
  if (message.voice) {
    return { contentType: 'voice', content: cap, fileId: message.voice.file_id };
  }
  return { contentType: 'other', content: '', fileId: null };
}
