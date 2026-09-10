import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { D1Store } from './store.ts';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', '..', 'migrations');

type BindValue = null | number | bigint | string | Uint8Array;

function fakeD1(db: DatabaseSync) {
  return {
    prepare(query: string) {
      let params: readonly unknown[] = [];

      return {
        bind(...values: unknown[]) {
          params = values;
          return this;
        },
        run() {
          const result = db.prepare(query).run(...(params as BindValue[]));
          return Promise.resolve({
            success: true,
            meta: {
              changes: Number(result.changes),
              last_row_id: Number(result.lastInsertRowid),
              duration: 0
            }
          });
        },
        all() {
          const results = db.prepare(query).all(...(params as BindValue[]));
          return Promise.resolve({
            results,
            success: true,
            meta: { changes: 0, last_row_id: 0, duration: 0 }
          });
        },
        first() {
          return Promise.resolve(
            db.prepare(query).get(...(params as BindValue[])) ?? null
          );
        },
        raw() {
          const rows = db.prepare(query).all(...(params as BindValue[]));
          return Promise.resolve(
            rows.map((row) => Object.values(row as Record<string, unknown>))
          );
        }
      };
    },
    async batch(statements: ReadonlyArray<{ all: () => Promise<unknown> }>) {
      const results: unknown[] = [];
      for (let i = 0, len = statements.length; i < len; i++) {
        // eslint-disable-next-line no-await-in-loop
        results.push(await statements[i]!.all());
      }
      return results;
    }
  };
}

export function makeTestStore(): D1Store {
  const db = new DatabaseSync(':memory:');
  const entries = readdirSync(MIGRATIONS_DIR).sort();
  for (let i = 0, len = entries.length; i < len; i++) {
    const file = join(MIGRATIONS_DIR, entries[i]!, 'migration.sql');
    const statements = readFileSync(file, 'utf8').split('--> statement-breakpoint');
    for (let s = 0, slen = statements.length; s < slen; s++) {
      const statement = statements[s]!.trim();
      if (statement !== '') db.exec(statement);
    }
  }
  // eslint-disable-next-line sukka/type/no-force-cast-via-top-type
  return new D1Store(fakeD1(db) as unknown as D1Database);
}
