/**
 * Start the agent runtime.
 *
 *   RUNTIME=workers (default) -> wrangler dev on :8787, Durable Object per session
 *   RUNTIME=node              -> plain Node server on $PORT (3001), same HTTP contract
 *
 * `.env` is read here and handed to the child process, because wrangler does not
 * promote process env into Worker bindings: each variable becomes `--var`.
 */

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bindings, loadEnv } from './env.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const envFile = loadEnv(root);
const runtime = (process.env.RUNTIME ?? 'workers').trim().toLowerCase();
const port = runtime === 'node' ? process.env.PORT ?? '3001' : process.env.AGENT_PORT ?? '8787';

if (!envFile.loaded) {
  process.stderr.write(`[clay] no .env at ${envFile.path} — copy .env.example and add a key\n`);
}

/** Keep wrangler's local state inside the project instead of the user's XDG dirs. */
const sandbox = join(root, '.wrangler');
for (const [variable, sub] of [
  ['XDG_CONFIG_HOME', 'config'],
  ['XDG_CACHE_HOME', 'cache'],
  ['XDG_DATA_HOME', 'data'],
]) {
  mkdirSync(join(sandbox, sub), { recursive: true });
  process.env[variable] = join(sandbox, sub);
}

let child;

if (runtime === 'node') {
  child = spawn(process.execPath, ['--disable-warning=ExperimentalTypes', 'server-node/index.ts'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PORT: port, RUNTIME: 'node' },
  });
} else {
  const wrangler = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  const args = ['dev', '--ip', '127.0.0.1', '--port', port, '--persist-to', join(sandbox, 'state')];
  for (const [key, value] of Object.entries(bindings(envFile.values))) {
    args.push('--var', `${key}:${value}`);
  }
  child = spawn(process.execPath, [wrangler, ...args], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
}

child.on('close', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});

process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
