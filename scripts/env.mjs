/**
 * `.env` parsing, no dependency.
 *
 * Both runtimes need the same variables: wrangler receives them as `--var`
 * bindings (it deliberately does not promote process env into `env`), the Node
 * fallback receives them as real process env.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function parseEnv(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (!/^["']/.test(value)) {
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

/** Process env wins, so `MODEL=x npm run dev` overrides the file without editing it. */
export function loadEnv(root) {
  const path = resolve(root, '.env');
  if (!existsSync(path)) return { path, loaded: false, values: {} };
  const values = parseEnv(readFileSync(path, 'utf8'));
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return { path, loaded: true, values };
}

/** Variables that belong in the Worker as bindings. Secrets stay server-side. */
export const BINDING_KEYS = [
  'OPENAI_BASE_URL',
  'OPENAI_API_KEY',
  'MODEL',
  'LMSTUDIO_BASE_URL',
  'OLLAMA_BASE_URL',
  'GEMINI_BASE_URL',
  'GEMINI_API_KEY',
  'RUNTIME',
  'PORT',
  'TEMPERATURE',
  'MAX_TOKENS',
];

export function bindings(values) {
  const out = {};
  for (const key of BINDING_KEYS) {
    const value = process.env[key] ?? values[key];
    if (value !== undefined && value !== '') out[key] = value;
  }
  return out;
}
