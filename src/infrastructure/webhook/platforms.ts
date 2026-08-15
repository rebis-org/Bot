import type { BindingProvider } from '../../domain/ports.ts';
import { CLOUDFLARE_CHANNEL } from './cloudflare.ts';
import { GITHUB_CHANNEL } from './github.ts';
import type { WebhookChannel } from './webhook.ts';

export interface Platform extends BindingProvider {
  route: string,
  channel: WebhookChannel
}

export function platforms(
  env: Pick<Env, 'GH_ORG' | 'CF_ACCOUNT_ID' | 'GH_THREAD_ID' | 'CF_THREAD_ID'>
): readonly Platform[] {
  return [
    {
      id: 'gh',
      label: 'GitHub',
      targetLabel: 'organization',
      targetLabelPlural: 'organizations',
      value: env.GH_ORG.toLowerCase(),
      route: '/webhook/github',
      channel: GITHUB_CHANNEL
    },
    {
      id: 'cf',
      label: 'Cloudflare',
      targetLabel: 'account',
      targetLabelPlural: 'accounts',
      value: env.CF_ACCOUNT_ID,
      route: '/webhook/cloudflare',
      channel: CLOUDFLARE_CHANNEL
    }
  ];
}
