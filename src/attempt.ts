import { tryCatchAsync } from '@moeru/std/try-catch';

export async function attempt(task: () => Promise<unknown>): Promise<void> {
  const { error } = await tryCatchAsync(task);
  if (error !== undefined) console.error(error);
}
