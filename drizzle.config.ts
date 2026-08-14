import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: 'migrations',
  schema: './src/store.ts',
  dialect: 'sqlite',
  driver: 'd1-http'
});
