import { readdir, rm } from 'node:fs/promises';
const output = new URL('../dist/mailhub/', import.meta.url);
for (const name of await readdir(output)) {
  if (name.startsWith('.dev.vars') || name === '.env' || name.startsWith('.env.')) {
    await rm(new URL(name, output), { force: true, recursive: true });
  }
}
