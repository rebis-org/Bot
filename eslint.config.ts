/* eslint-disable antfu/no-top-level-await */
import type { Linter } from 'eslint';
import { ignores, sukka } from 'eslint-config-sukka';

const configs = await sukka({
  js: true,
  ts: {
    allowDefaultProject: ['drizzle.config.ts', 'eslint.config.ts']
  },
  json: true,
  node: true,
  stylistic: true
});

configs.push({
  rules: {
    'no-console': 'off',
    'vibe-proof/ban-eslint-disable': 'off'
  }
});

const resolvedConfig: Linter.Config[] = [
  ...ignores({
    gitignore: true,
    customGlobs: [
      'worker-configuration.d.ts',
      '**/.wrangler/**'
    ]
  }),
  ...configs
];

export default resolvedConfig;
