import { bold, code, fmt, FormattedString } from '@grammyjs/parse-mode';
import type { MiddlewareFn } from 'grammy';
import type { BindingStore, BindingProvider } from '../../domain/ports.ts';
import type { Command, CommandRow, GroupCtx } from '../kernel.ts';
import { admin, send, subcommands, usage } from '../kernel.ts';

export function bind(
  store: BindingStore,
  providers: readonly BindingProvider[]
): Command {
  const routes: Record<string, MiddlewareFn<GroupCtx>> = {
    status: statusAll(store, providers)
  };
  for (let i = 0, len = providers.length; i < len; i++) {
    const provider = providers[i]!;
    routes[provider.id] = providerRouter(store, provider);
  }
  return {
    name: 'bind',
    desc: 'Bind/unbind GitHub or Cloudflare, status (administrators)',
    section: 'Bindings',
    rows: bindCommands(providers),
    handler: subcommands<GroupCtx>(
      routes,
      async (c) => {
        await send(c, usage(bindCommands(providers)));
      }
    ).middleware()
  };
}

function providerRouter(
  store: BindingStore,
  provider: BindingProvider
): MiddlewareFn<GroupCtx> {
  return subcommands<GroupCtx>(
    {
      '': admin(bindHandler(store, provider)),
      bind: admin(bindHandler(store, provider)),
      unbind: admin(unbindHandler(store, provider)),
      status: statusHandler(store, provider)
    },
    async (c) => {
      await send(c, usage(bindCommands([provider])));
    },
    1
  ).middleware();
}

export function bindCommands(
  providers: readonly BindingProvider[]
): readonly CommandRow[] {
  return [
    ...providers.flatMap((provider) => [
      {
        command: `/bind ${provider.id}`,
        desc: `Bind this group to ${provider.label} (administrators)`
      },
      {
        command: `/bind ${provider.id} unbind`,
        desc: 'Unbind (administrators)'
      },
      {
        command: `/bind ${provider.id} status`,
        desc: `View ${provider.label} bound to this group`
      }
    ]),
    { command: '/bind status', desc: 'View all bound services' }
  ];
}

function bindHandler(store: BindingStore, provider: BindingProvider) {
  return async (c: GroupCtx) => {
    await store.bind(provider.id, provider.value, c.chat.id);
    await send(
      c,
      fmt`${provider.label} ${provider.targetLabel} ${code}${provider.value}${code} is bound to this group.`
    );
  };
}

function unbindHandler(store: BindingStore, provider: BindingProvider) {
  return async (c: GroupCtx) => {
    const ok = await store.unbind(provider.id, provider.value, c.chat.id);
    await send(
      c,
      ok
        ? fmt`${provider.label} ${provider.targetLabel} ${code}${provider.value}${code} is unbound.`
        : fmt`${provider.label} ${provider.targetLabel} ${code}${provider.value}${code} is not bound to this group.`
    );
  };
}

function statusHandler(store: BindingStore, provider: BindingProvider) {
  return async (c: GroupCtx) => {
    await send(c, await section(store, provider, c.chat.id));
  };
}

function statusAll(
  store: BindingStore,
  providers: readonly BindingProvider[]
) {
  return async (c: GroupCtx) => {
    const sections = await Promise.all(
      providers.map((provider) => section(store, provider, c.chat.id))
    );
    await send(c, FormattedString.join(sections, '\n'));
  };
}

async function section(
  store: BindingStore,
  provider: BindingProvider,
  chatId: number
): Promise<FormattedString> {
  const targets = await store.targets(provider.id, chatId);
  return targets.length === 0
    ? fmt`No ${provider.label} ${provider.targetLabel} is bound to this group.`
    : FormattedString.join(
      [
        fmt`${bold}Bound ${provider.label} ${provider.targetLabelPlural}${bold}`,
        ...targets.map((target) => fmt`  ${code}${target}${code}`)
      ],
      '\n'
    );
}
