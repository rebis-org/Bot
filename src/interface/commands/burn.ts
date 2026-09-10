import { tryCatchAsync } from '@moeru/std/try-catch';
import { extractErrorMessage } from 'foxts/extract-error-message';
import type { Stores } from '../../domain/ports.ts';
import type { MatrixClient } from '../../infrastructure/matrix/client.ts';
import { burnForce } from '../../infrastructure/burn/burn.ts';
import type { Command } from '../kernel.ts';
import { admin, subcommands, usage } from '../kernel.ts';

const BURN_ROWS = [
  { command: '!burn on', desc: 'Enable read-and-burn in this room (administrators)' },
  { command: '!burn off', desc: 'Disable read-and-burn (administrators)' },
  { command: '!burn now', desc: 'Immediately redact all unpinned messages in this room, ignoring age and read state (administrators)' }
] as const;

const BURN_ON_TEXT = 'Read-and-burn is enabled in this room. Messages read by all members for over 24 hours are redacted. When a member sends no read receipts, messages older than 48 hours are redacted. Burned messages and media are removed from this server. Copies already federated to other homeservers are beyond our control.';
const BURN_OFF_TEXT = 'Read-and-burn is not enabled in this room.';
const FORCE_STARTED_TEXT = 'Force burn started. This message shows progress.';

export function burn(store: Stores): Command {
  return {
    name: 'burn',
    desc: 'Redact messages fully read for over 24 hours; removed from this server only (administrators)',
    section: 'Burn',
    rows: BURN_ROWS,
    handler: subcommands(
      {
        '': async (ctx) => {
          const rooms = await store.burnRooms();
          const text = rooms.includes(ctx.roomId) ? BURN_ON_TEXT : BURN_OFF_TEXT;
          await ctx.reply(text, text);
        },
        on: admin(async (ctx) => {
          await store.burnEnable(ctx.roomId, new Date().toISOString());
          await ctx.reply(BURN_ON_TEXT, BURN_ON_TEXT);
        }),
        off: admin(async (ctx) => {
          const removed = await store.burnDisable(ctx.roomId);
          const text = removed
            ? 'Read-and-burn disabled in this room.'
            : BURN_OFF_TEXT;
          await ctx.reply(text, text);
        }),
        now: admin(async (ctx) => {
          const replyEventId = await ctx.reply(FORCE_STARTED_TEXT, FORCE_STARTED_TEXT);
          ctx.defer(runForceBurn(ctx.client, store, ctx.roomId, replyEventId));
        })
      },
      async (ctx) => {
        const doc = usage(BURN_ROWS);
        await ctx.reply(doc.body, doc.html);
      }
    )
  };
}

async function runForceBurn(
  client: MatrixClient,
  store: Stores,
  roomId: string,
  replyEventId: string
): Promise<void> {
  const edit = async (text: string): Promise<void> => {
    const { error } = await tryCatchAsync(() => client.editHtml(roomId, replyEventId, text, text));
    if (error !== undefined) console.error('force burn progress edit failed:', error);
  };
  const { error } = await tryCatchAsync(async () => {
    const result = await burnForce(client, store, roomId, async (burned) => {
      await edit(`Force burn in progress. ${String(burned)} messages redacted so far.`);
    });
    let text: string;
    if (result.done) {
      text = result.burned === 0
        ? 'Force burn finished. Nothing to burn; only unpinned, unredacted room messages are burned.'
        : `Force burn finished. Burned ${String(result.burned)} messages. Pinned messages were kept.`;
    } else {
      text = `Burned ${String(result.burned)} messages so far; this run reached the limit. Send !burn now again to continue. Pinned messages were kept.`;
    }
    await edit(text);
  });
  if (error !== undefined) {
    const detail = extractErrorMessage(error) ?? 'unknown error';
    await edit(`Force burn failed: ${detail}.`);
  }
}
