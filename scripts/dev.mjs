/**
 * `npm run dev` — agent runtime + Vite client side by side.
 *
 * The client always talks to `/api` on its own origin; Vite proxies that to
 * whichever runtime `RUNTIME` selects (:8787 workers, :3001 node), so switching
 * runtimes does not touch the client.
 */

import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

loadEnv(root);

const runtime = (process.env.RUNTIME ?? 'workers').trim().toLowerCase();
const agentPort = runtime === 'node' ? process.env.PORT ?? '3001' : process.env.AGENT_PORT ?? '8787';
const clientPort = process.env.CLIENT_PORT ?? '5173';

const children = [];

function run(label, command, args, color) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, RUNTIME: runtime, AGENT_PORT: agentPort },
  });
  const prefix = `\x1b[${color}m[${label}]\x1b[0m `;
  const pipe = (stream) => {
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) process.stdout.write(`${prefix}${line}\n`);
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('close', (code) => {
    process.stdout.write(`${prefix}exited with ${code ?? 'signal'}\n`);
    shutdown(code ?? 0);
  });
  children.push(child);
}

function shutdown(code) {
  for (const child of children) child.kill('SIGTERM');
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

process.stdout.write(
  `\x1b[1mClay\x1b[0m — runtime \x1b[36m${runtime}\x1b[0m on http://127.0.0.1:${agentPort}` +
    `, client \x1b[35mhttp://127.0.0.1:${clientPort}\x1b[0m\n`
);

run('agent', process.execPath, [join(root, 'scripts', 'run-agent.mjs')], '36');
run('client', process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', clientPort], '35');
