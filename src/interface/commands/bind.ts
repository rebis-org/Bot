import { bold, code, html, join } from '../../display/html.ts';
import type { Doc } from '../../display/html.ts';
import type { BindingProvider, BindingStore } from '../../domain/ports.ts';
import type { Command, CommandCtx, CommandRow } from '../kernel.ts';
import { admin, subcommands, usage } from '../kernel.ts';

export function bind(
  store: BindingStore,
  providers: readonly BindingProvider[],
  allowedRooms: ReadonlySet<string>
): Command {
  const routes: Record<string, (ctx: CommandCtx) => Promise<void>> = {
    status: statusAll(store, providers)
  };
  for (let i = 0, len = providers.length; i < len; i++) {
    const provider = providers[i]!;
    routes[provider.id] = providerRouter(store, provider, allowedRooms);
  }
  return {
    name: 'bind',
    desc: 'Bind/unbind GitHub, status (administrators)',
    section: 'Bindings',
    rows: bindCommands(providers),
    handler: subcommands(
      routes,
      async (ctx) => {
        const doc = usage(bindCommands(providers));
        await ctx.reply(doc.body, doc.html);
      }
    )
  };
}

function providerRouter(
  store: BindingStore,
  provider: BindingProvider,
  allowedRooms: ReadonlySet<string>
): (ctx: CommandCtx) => Promise<void> {
  function gated(handler: (ctx: CommandCtx) => Promise<void>) {
    return admin(designated(provider, allowedRooms, handler));
  }
  return subcommands(
    {
      '': gated((ctx) => bindRoom(store, provider, ctx)),
      bind: gated((ctx) => bindRoom(store, provider, ctx)),
      unbind: gated((ctx) => unbindRoom(store, provider, ctx)),
      status: statusHandler(store, provider)
    },
    async (ctx) => {
      const doc = usage(bindCommands([provider]));
      await ctx.reply(doc.body, doc.html);
    }
  );
}

function designated(
  provider: BindingProvider,
  allowedRooms: ReadonlySet<string>,
  handler: (ctx: CommandCtx) => Promise<void>
): (ctx: CommandCtx) => Promise<void> {
  return async (ctx) => {
    if (provider.restricted === true && !allowedRooms.has(ctx.roomId)) {
      await ctx.reply(
        `Manage ${provider.label} bindings only in a designated room.`
      );
      return;
    }
    await handler(ctx);
  };
}

export function bindCommands(
  providers: readonly BindingProvider[]
): readonly CommandRow[] {
  const rows: CommandRow[] = [];
  for (let i = 0, len = providers.length; i < len; i++) {
    const provider = providers[i]!;
    rows.push(
      {
        command: `!bind ${provider.id}`,
        desc: `Bind this room to ${provider.label} (administrators)`
      },
      {
        command: `!bind ${provider.id} unbind`,
        desc: 'Unbind (administrators)'
      },
      {
        command: `!bind ${provider.id} status`,
        desc: `View ${provider.label} bound to this room`
      }
    );
  }
  rows.push({ command: '!bind status', desc: 'View all bound services' });
  return rows;
}

async function bindRoom(
  store: BindingStore,
  provider: BindingProvider,
  ctx: CommandCtx
): Promise<void> {
  await store.bind(provider.id, provider.value, ctx.roomId);
  const doc = html`${provider.label} ${provider.targetLabel} ${
    code(provider.value)
  } is bound to this room.`;
  await ctx.reply(doc.body, doc.html);
}

async function unbindRoom(
  store: BindingStore,
  provider: BindingProvider,
  ctx: CommandCtx
): Promise<void> {
  const ok = await store.unbind(provider.id, provider.value, ctx.roomId);
  const doc = ok
    ? html`${provider.label} ${provider.targetLabel} ${
      code(provider.value)
    } is unbound.`
    : html`${provider.label} ${provider.targetLabel} ${
      code(provider.value)
    } is not bound to this room.`;
  await ctx.reply(doc.body, doc.html);
}

function statusHandler(store: BindingStore, provider: BindingProvider) {
  return async (ctx: CommandCtx) => {
    const doc = await section(store, provider, ctx.roomId);
    await ctx.reply(doc.body, doc.html);
  };
}

function statusAll(
  store: BindingStore,
  providers: readonly BindingProvider[]
) {
  return async (ctx: CommandCtx) => {
    const sections = await Promise.all(providers.map((provider) => section(store, provider, ctx.roomId)));
    const doc = join(sections, '\n');
    await ctx.reply(doc.body, doc.html);
  };
}

async function section(
  store: BindingStore,
  provider: BindingProvider,
  roomId: string
): Promise<Doc> {
  const targets = await store.targets(provider.id, roomId);
  if (targets.length === 0) {
    return html`No ${provider.label} ${provider.targetLabel} is bound to this room.`;
  }
  const lines: Doc[] = [
    bold(`Bound ${provider.label} ${provider.targetLabelPlural}`)
  ];
  for (let i = 0, len = targets.length; i < len; i++) {
    lines.push(html`  ${code(targets[i]!)}`);
  }
  return join(lines, '\n');
}
