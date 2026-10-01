/**
 * Node fallback runtime.
 *
 * Same HTTP contract as `agent/index.ts`, same turn engine (agent/turn.ts), no
 * Durable Objects: sessions live in a Map keyed by session id. Selected with
 * `RUNTIME=node` in `.env`; `npm run dev` then proxies Vite to :3001 instead of
 * :8787. Nothing in the client knows the difference.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  diffComponents,
  type A2UIComponent,
  type TurnRecord,
} from '../shared/a2ui.ts';
import { runChatTurn, runInteractTurn, type EngineEnv } from '../agent/turn.ts';
import { resolveSettings, testConnection, type InferenceSettings } from '../agent/inference.ts';

type Session = {
  sessionId: string;
  surfaceId: string;
  components: A2UIComponent[];
  dataModel: Record<string, unknown>;
  turns: TurnRecord[];
  updatedAt: number;
};

const sessions = new Map<string, Session>();
const MAX_TURNS_KEPT = 24;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type,x-clay-session',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
    ...CORS,
  });
  res.end(payload);
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 2_000_000) {
        rejectBody(new Error('body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    request.on('error', rejectBody);
  });
}

function engineEnv(): EngineEnv {
  return {
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    MODEL: process.env.MODEL,
    GEMINI_BASE_URL: process.env.GEMINI_BASE_URL,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    LMSTUDIO_BASE_URL: process.env.LMSTUDIO_BASE_URL,
    OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
    TEMPERATURE: process.env.TEMPERATURE,
    MAX_TOKENS: process.env.MAX_TOKENS,
  };
}

function sessionIdFrom(request: IncomingMessage, body: { sessionId?: unknown } | null): string {
  const header = request.headers['x-clay-session'];
  if (typeof header === 'string' && header) return header;
  if (typeof body?.sessionId === 'string' && body.sessionId) return body.sessionId;
  return `s-${randomUUID().slice(0, 8)}`;
}

function sessionFor(id: string): Session {
  const existing = sessions.get(id);
  if (existing) return existing;
  const created: Session = {
    sessionId: id,
    surfaceId: '',
    components: [],
    dataModel: {},
    turns: [],
    updatedAt: Date.now(),
  };
  sessions.set(id, created);
  return created;
}

function commit(
  session: Session,
  result: {
    status: 'ok' | 'invalid_surface' | 'error';
    emitted: unknown;
    raw: string;
    detail?: string;
    surface: { surfaceId: string; components: A2UIComponent[]; dataModel: Record<string, unknown> };
    recomputed: string[];
  },
  turn: Omit<TurnRecord, 'index' | 'ts'>
): void {
  session.surfaceId = result.surface.surfaceId;
  session.components = result.surface.components;
  session.dataModel = result.surface.dataModel;
  session.updatedAt = Date.now();
  session.turns = [...session.turns, { ...turn, index: session.turns.length, ts: Date.now() }].slice(
    -MAX_TURNS_KEPT
  );
}

function errorStatus(detail: string | undefined): { code: string; status: number } {
  if (!detail) return { code: 'agent_error', status: 500 };
  if (detail === 'no_api_key') return { code: 'no_api_key', status: 400 };
  if (detail.startsWith('upstream') || detail.startsWith('empty_completion')) {
    return { code: 'agent_error', status: 502 };
  }
  return { code: 'agent_error', status: 500 };
}

async function handle(request: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const path = url.pathname;
  const method = request.method ?? 'GET';

  if (method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  if (method === 'GET' && path === '/api/health') {
    send(res, 200, {
      ok: true,
      runtime: 'node',
      nodeVersion: process.version,
      sessions: sessions.size,
      model: process.env.MODEL ?? null,
      hasServerKey: Boolean(process.env.OPENAI_API_KEY),
    });
    return;
  }

  if (method === 'POST' && path === '/api/test') {
    // Settings → "Test connection". The key is used here and never echoed back.
    const raw = await readBody(request);
    let body: { settings?: Partial<InferenceSettings> } = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      send(res, 400, { error: 'bad_request', detail: 'request body is not JSON' });
      return;
    }
    const env = engineEnv();
    const settings = resolveSettings(body.settings, env);
    const result = await testConnection(settings);
    const redacted = settings.apiKey ? result.body.split(settings.apiKey).join('[redacted]') : result.body;
    send(res, result.ok ? 200 : 502, { ...result, body: redacted, model: settings.model });
    return;
  }

  if (method === 'GET' && path.startsWith('/api/session/')) {
    const id = decodeURIComponent(path.slice('/api/session/'.length));
    const session = sessions.get(id);
    if (!session) {
      send(res, 404, { error: 'unknown_session', detail: `no session "${id}" in this process` });
      return;
    }
    send(res, 200, session);
    return;
  }

  if (method === 'POST' && (path === '/api/chat' || path === '/api/interact')) {
    const raw = await readBody(request);
    let body: {
      message?: string;
      surfaceId?: string;
      componentId?: string;
      value?: unknown;
      sessionId?: string;
      settings?: Partial<InferenceSettings>;
    };
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      send(res, 400, { error: 'bad_request', detail: 'request body is not JSON' });
      return;
    }

    const id = sessionIdFrom(request, body);
    const session = sessionFor(id);
    res.setHeader('x-clay-session', id);

    const surface = {
      surfaceId: session.surfaceId,
      components: session.components,
      dataModel: session.dataModel,
    };

    if (path === '/api/chat') {
      const message = typeof body.message === 'string' ? body.message.trim() : '';
      if (!message) {
        send(res, 400, { error: 'bad_request', detail: 'message is required' });
        return;
      }
      const result = await runChatTurn({
        message,
        surface,
        turns: session.turns,
        env: engineEnv(),
        overrides: body.settings,
      });
      commit(session, result, {
        kind: 'chat',
        input: message,
        raw: result.raw,
        emitted: result.emitted,
        rejected: result.rejected,
        status: result.status,
        detail: result.detail,
        recomputed: result.recomputed,
        attempts: result.attempts,
      });
      if (result.status === 'invalid_surface') {
        send(res, 422, {
          error: 'invalid_surface',
          detail: result.detail,
          raw: result.raw.slice(0, 300),
          rejected: result.rejected,
        });
        return;
      }
      if (result.status !== 'ok') {
        const failure = errorStatus(result.detail);
        send(res, failure.status, { error: failure.code, detail: result.detail });
        return;
      }
      send(res, 200, {
        ...(result.emitted ?? {}),
        sessionId: id,
        surfaceId: session.surfaceId,
        components: session.components,
        dataModel: session.dataModel,
        recomputed: result.recomputed,
        attempts: result.attempts,
        rejected: result.rejected,
        meta: result.meta,
      });
      return;
    }

    const componentId = typeof body.componentId === 'string' ? body.componentId : '';
    if (!componentId) {
      send(res, 400, { error: 'bad_request', detail: 'componentId is required' });
      return;
    }
    if (body.surfaceId && session.surfaceId && body.surfaceId !== session.surfaceId) {
      send(res, 409, { error: 'stale_surface', detail: `surface "${body.surfaceId}" is not "${session.surfaceId}"` });
      return;
    }

    const result = await runInteractTurn({
      surfaceId: body.surfaceId ?? session.surfaceId,
      componentId,
      value: body.value,
      surface,
      turns: session.turns,
      env: engineEnv(),
      overrides: body.settings,
    });
    commit(session, result, {
      kind: 'interact',
      input: `${componentId} = ${JSON.stringify(body.value)}`,
      raw: result.raw,
      emitted: result.emitted,
      rejected: result.rejected,
      status: result.status,
      detail: result.detail,
      recomputed: result.recomputed,
      attempts: result.attempts,
    });
    if (result.status === 'invalid_surface') {
      send(res, 422, {
        error: 'invalid_surface',
        detail: result.detail,
        raw: result.raw.slice(0, 300),
        rejected: result.rejected,
      });
      return;
    }
    if (result.status !== 'ok') {
      const failure = errorStatus(result.detail);
      send(res, failure.status, { error: failure.code, detail: result.detail });
      return;
    }

    send(res, 200, {
      ...(result.emitted ?? {}),
      sessionId: id,
      surfaceId: session.surfaceId,
      components: session.components,
      dataModel: session.dataModel,
      recomputed: result.recomputed,
      attempts: result.attempts,
      rejected: result.rejected,
      changed: diffComponents(surface.components, session.components),
      meta: result.meta,
    });
    return;
  }

  if (method === 'GET' && (path === '/' || path === '/api')) {
    send(res, 200, {
      name: 'clay-agent',
      runtime: 'node',
      endpoints: ['/api/chat', '/api/interact', '/api/session/:id', '/api/health'],
    });
    return;
  }

  send(res, 404, { error: 'not_found', detail: path, runtime: 'node' });
}

const port = Number(process.env.PORT ?? 3001);

const server = createServer((request, response) => {
  handle(request, response).catch((cause: Error) => {
    console.error('[clay:node] unhandled', cause);
    if (!response.headersSent) send(response, 500, { error: 'internal', detail: cause.message });
    else response.end();
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[clay:node] fallback runtime on http://127.0.0.1:${port} (RUNTIME=node, no Durable Objects)`);
  if (!process.env.OPENAI_API_KEY) {
    console.log('[clay:node] no OPENAI_API_KEY in env — /api/chat will answer 400 no_api_key until Settings supplies one');
  }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
