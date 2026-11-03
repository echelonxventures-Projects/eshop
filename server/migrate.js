import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {closeDb, migrate} from './db.js';

const schema = await fs.readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8');
try {
  await migrate(schema);
  console.log('Database schema is up to date.');
} finally {
  await closeDb();
}
