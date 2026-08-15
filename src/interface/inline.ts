import type { Middleware } from 'grammy';
import type { PinStore } from '../domain/ports.ts';
import type { Ctx } from './kernel.ts';

export function inlineQuery(
  store: PinStore,
  chatId: number
): Middleware<Ctx> {
  return async (c) => {
    if (!c.inlineQuery) return;
    const query = c.inlineQuery.query.trim();
    if (!query) {
      await c.answerInlineQuery([], { is_personal: true, cache_time: 0 });
      return;
    }
    const found = await store.search(chatId, query, 10);
    await c.answerInlineQuery(
      found.map((pin, i) => ({
        type: 'article' as const,
        id: String(i + 1),
        title: `#${pin.messageId} ${pin.senderName} ${pin.contentType}`,
        description: pin.content.slice(0, 60),
        input_message_content: {
          message_text: pin.content || `[${pin.contentType}]`,
          entities: pin.entities ?? undefined
        }
      })),
      { is_personal: true, cache_time: 0 }
    );
  };
}
