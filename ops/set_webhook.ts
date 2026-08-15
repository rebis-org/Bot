import 'dotenv/config';
import { Bot } from 'grammy';
import process from 'node:process';

async function main(): Promise<void> {
  const bot = new Bot(process.env.BOT_TOKEN!);
  await bot.init();
  await bot.api.setWebhook(process.env.WEB_HOOK!, {
    secret_token: process.env.SECRET_TOKEN
  });
}

main();
