import { bold, code, fmt, FormattedString } from '@grammyjs/parse-mode';
import type { Router } from '@grammyjs/router';
import type { Middleware } from 'grammy';
import type { GroupCtx } from './kernel.ts';
import { admin, send, subcommands, usage } from './kernel.ts';
import type { Store } from './store.ts';

export interface BindingProvider {
  id: string,
  label: string,
  targetLabel: string,
  targetLabelPlural: string,
  value: string
}

export function bind(
  store: Store,
  providers: readonly BindingProvider[]
): Router<GroupCtx> {
  const routes: Record<string, Middleware<GroupCtx>> = {
    status: statusAll(store, providers)
  };
  for (let i = 0, len = providers.length; i < len; i++) {
    const p = providers[i]!;
    routes[p.id] = providerRouter(store, p);
  }
  return subcommands<GroupCtx>(
    routes,
    async (c) => {
      await send(c, usageFor(providers));
    }
  );
}

function providerRouter(
  store: Store,
  p: BindingProvider
): Middleware<GroupCtx> {
  return subcommands<GroupCtx>(
    {
      '': admin(bindHandler(store, p)), // `/bind gh` 默认执行 bind
      bind: admin(bindHandler(store, p)),
      unbind: admin(unbindHandler(store, p)),
      status: statusHandler(store, p)
    },
    async (c) => {
      await send(c, usageFor([p]));
    },
    1
  ).middleware();
}

function bindHandler(store: Store, p: BindingProvider) {
  return async (c: GroupCtx) => {
    await store.bind(p.id, p.value, c.chat.id);
    await send(
      c,
      fmt`${p.label} ${p.targetLabel} ${code}${p.value}${code} is bound to this group.`
    );
  };
}

function unbindHandler(store: Store, p: BindingProvider) {
  return async (c: GroupCtx) => {
    const ok = await store.unbind(p.id, p.value, c.chat.id);
    await send(
      c,
      ok
        ? fmt`${p.label} ${p.targetLabel} ${code}${p.value}${code} is unbound.`
        : fmt`${p.label} ${p.targetLabel} ${code}${p.value}${code} is not bound to this group.`
    );
  };
}

function statusHandler(store: Store, p: BindingProvider) {
  return async (c: GroupCtx) => {
    await send(c, await section(store, p, c.chat.id));
  };
}

function statusAll(
  store: Store,
  providers: readonly BindingProvider[]
) {
  return async (c: GroupCtx) => {
    const sections = await Promise.all(
      providers.map((p) => section(store, p, c.chat.id))
    );
    await send(c, FormattedString.join(sections, '\n'));
  };
}

async function section(
  store: Store,
  p: BindingProvider,
  chatId: number
): Promise<FormattedString> {
  const targets = await store.targetsFor(p.id, chatId);
  return targets.length === 0
    ? fmt`No ${p.label} ${p.targetLabel} is bound to this group.`
    : FormattedString.join(
      [
        fmt`${bold}Bound ${p.label} ${p.targetLabelPlural}${bold}`,
        ...targets.map((t) => fmt`- ${code}${t}${code}`)
      ],
      '\n'
    );
}

function usageFor(
  providers: readonly BindingProvider[]
): FormattedString {
  return usage(
    providers.flatMap((p) => [
      [`/bind ${p.id}`, `Bind this group to ${p.label} (administrators)`],
      [`/bind ${p.id} unbind`, 'Unbind (administrators)'],
      [`/bind ${p.id} status`, `View ${p.label} bound to this group`]
    ])
  );
}
