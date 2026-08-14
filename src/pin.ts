import { Menu } from '@grammyjs/menu';
import type { Router } from '@grammyjs/router';
import { StatelessQuestion } from '@grammyjs/stateless-question';
import { bold, code, fmt, FormattedString } from '@grammyjs/parse-mode';
import type { Message, MessageEntity } from 'grammy/types';
import { formatUtcCn, userDisplayName } from './format.ts';
import type { GroupCtx } from './kernel.ts';
import {
  admin,
  commandArgs,
  isAdmin,
  parseId,
  requireAdmin,
  send,
  subcommands,
  usage
} from './kernel.ts';
import { PinDraft } from './domain.ts';
import type { ContentType, Pin } from './domain.ts';
import type { Store } from './store.ts';

const MAX_CONTENT = 2000;
const CONFIRM = new Set(['confirm', 'yes', 'y', '1']);
const RE_PIN_ID = /#(\d+)/;

const USAGE = usage([
  ['/pin insert', 'Pin the replied-to message (administrators)'],
  ['/pin delete <message ID>', 'Unpin and delete the record (administrators, confirmation required)'],
  ['/pin retrieve [message ID]', 'View pin information']
]);

export interface PinFeature {
  router: Router<GroupCtx>,
  question: StatelessQuestion<GroupCtx>,
  menu: Menu<GroupCtx>
}

export function pin(store: Store): PinFeature {
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
      const removed = await store.removePin(
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
    const visible = await store.activePins(c.chat.id, 8);
    const adminUser = await isAdmin(c);
    for (let i = 0, len = visible.length; i < len; i++) {
      const p = visible[i]!;
      const id = p.messageId.toString();
      range.text({
        text: `#${id} ${p.senderName} ${p.contentType}`,
        payload: id
      }, async (b) => {
        const row = await store.getPin(b.chat.id, Number(b.match));
        if (!row) {
          await b.answerCallbackQuery('Record not found. It may have been deleted.');
          return;
        }
        await sendPin(b, row);
      });
      if (adminUser) {
        range.text({ text: 'Delete', payload: id }, async (b) => {
          if (!(await requireAdmin(b))) return;
          await question.replyWithMarkdown(
            b,
            `Unpin and delete record #${b.match}?\nReply "confirm" to proceed. Reply anything else to cancel.`
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
        const { content, entities } = truncateContent(
          snap.content,
          (reply.text
            ? reply.entities
            : (reply.caption ? reply.caption_entities : null))
          ?? null
        );
        await store.upsertPin(PinDraft.create({
          chatId: c.chat.id,
          messageId: reply.message_id,
          userId: reply.from?.id ?? c.from.id,
          senderName: reply.from
            ? userDisplayName(reply.from)
            : reply.sender_chat?.title ?? 'Unknown',
          contentType: snap.contentType,
          content,
          entities,
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
          `Unpin and delete record #${id}?\nReply "confirm" to proceed. Reply anything else to cancel.`
        );
      }),
      async retrieve(c) {
        const id = parseId(commandArgs(c));
        if (id !== undefined) {
          const row = await store.getPin(c.chat.id, id);
          if (row) await sendPin(c, row);
          else await c.reply(`No pin record found for #${id}.`);
          return;
        }
        await send(c, pinList(await store.activePins(c.chat.id)), menu);
      }
    },
    async (c) => {
      await send(c, USAGE);
    }
  );

  return { router, question, menu };
}

function extractPinId(text: string): number | undefined {
  const m = RE_PIN_ID.exec(text);
  return m ? Number(m[1]) : undefined;
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
    const p = active[i]!;
    const snippet = p.content.length > 40
      ? `${p.content.slice(0, 40)}…`
      : p.content;
    const state = p.unpinnedAt ? ' | Unpinned' : '';
    lines.push(
      fmt`- ${code}#${p.messageId}${code} | ${p.senderName} | ${p.contentType} | ${formatUtcCn(p.pinnedAt)}${state}`
    );
    if (snippet && p.contentType === 'text') {
      lines.push(fmt`  ${snippet}`);
    }
  }
  lines.push(
    fmt`Use the buttons below to view. To delete, send ${code}/pin delete <message ID>${code} (administrators).`
  );
  return FormattedString.join(lines, '\n');
}

async function sendPin(c: GroupCtx, p: Pin) {
  const formatted = p.content
    ? new FormattedString(p.content, p.entities ?? undefined)
    : undefined;
  const caption = formatted?.caption;
  const captionEntities = formatted?.caption_entities;
  switch (p.contentType) {
    case 'photo':
      return c.replyWithPhoto(p.fileId!, { caption, caption_entities: captionEntities });
    case 'video':
      return c.replyWithVideo(p.fileId!, { caption, caption_entities: captionEntities });
    case 'animation':
      return c.replyWithAnimation(p.fileId!, { caption, caption_entities: captionEntities });
    case 'sticker':
      return c.replyWithSticker(p.fileId!);
    case 'document':
      return c.replyWithDocument(p.fileId!, { caption, caption_entities: captionEntities });
    case 'audio':
      return c.replyWithAudio(p.fileId!, { caption, caption_entities: captionEntities });
    case 'voice':
      return c.replyWithVoice(p.fileId!);
    default:
      return c.reply(p.content || `[${p.contentType}]`, {
        entities: p.entities ?? undefined
      });
  }
}

function snapshot(
  m: Message
): { contentType: ContentType, content: string, fileId: string | null } {
  if (m.text) return { contentType: 'text', content: m.text, fileId: null };
  const cap = m.caption ?? '';
  if (m.photo) {
    return {
      contentType: 'photo',
      content: cap,
      fileId: m.photo.at(-1)?.file_id ?? null
    };
  }
  if (m.animation) {
    return {
      contentType: 'animation',
      content: cap,
      fileId: m.animation.file_id
    };
  }
  if (m.video) {
    return { contentType: 'video', content: cap, fileId: m.video.file_id };
  }
  if (m.sticker) {
    return { contentType: 'sticker', content: '', fileId: m.sticker.file_id };
  }
  if (m.document) {
    return {
      contentType: 'document',
      content: cap,
      fileId: m.document.file_id
    };
  }
  if (m.audio) {
    return { contentType: 'audio', content: cap, fileId: m.audio.file_id };
  }
  if (m.voice) {
    return { contentType: 'voice', content: cap, fileId: m.voice.file_id };
  }
  return { contentType: 'other', content: '', fileId: null };
}

function truncateContent(
  text: string,
  entities: MessageEntity[] | null
): { content: string, entities: MessageEntity[] | null } {
  if (text.length <= MAX_CONTENT) return { content: text, entities };
  const content = text.slice(0, MAX_CONTENT);
  const trimmed = entities?.filter((e) => e.offset + e.length <= MAX_CONTENT)
    ?? null;
  return { content, entities: trimmed };
}
