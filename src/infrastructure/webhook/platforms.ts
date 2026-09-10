import type { BindingProvider } from '../../domain/ports.ts';
import { GITHUB_CHANNEL } from './github.ts';
import type { WebhookChannel } from './webhook.ts';

export interface Platform extends BindingProvider {
  route: string,
  channel: WebhookChannel
}

export function platforms(
  env: Pick<Env, 'GH_ORG'>
): readonly Platform[] {
  return [
    {
      id: 'gh',
      label: 'GitHub',
      targetLabel: 'organization',
      targetLabelPlural: 'organizations',
      value: env.GH_ORG.toLowerCase(),
      restricted: true,
      route: '/webhook/github',
      channel: GITHUB_CHANNEL
    }
  ];
}
