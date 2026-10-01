/**
 * Clay's agent: one Durable Object per session, SQLite-backed state, A2UI
 * messages in and out.
 *
 * The Worker (`export default`) owns the public HTTP contract (`/api/*`) and
 * forwards each call to the DO that owns that session id. The DO owns the
 * session's surface + data model through the Agents SDK's `this.state`, which
 * persists in the object's SQLite storage and survives eviction between calls.
 */

import { Agent } from 'agents';
import {
  diffComponents,
  type A2UIComponent,
  type SessionSurface,
  type TurnRecord,
} from '../shared/a2ui.ts';
import { runChatTurn, runInteractTurn, type EngineEnv, type TurnOutcome } from './turn.ts';
import { resolveSettings, testConnection, type InferenceSettings } from './inference.ts';

export type SessionState = {
  sessionId: string;
  surfaceId: string;
  components: A2UIComponent[];
  dataModel: Record<string, unknown>;
  turns: TurnRecord[];
  updatedAt: number;
};

export type ClayEnv = {
  CLAY_AGENT: DurableObjectNamespace<ClayAgent>;
  RUNTIME_LABEL?: string;
} & Record<string, string | undefined>;

const MAX_TURNS_KEPT = 24;

function jsonResponse(body: unknown, status = 200, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extra,
    },
  });
}

const CORS: HeadersInit = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type,x-clay-session',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};

function surfaceOf(state: SessionState): SessionSurface {
  return { surfaceId: state.surfaceId, components: state.components, dataModel: state.dataModel };
}

function envFor(env: ClayEnv): EngineEnv {
  return env as EngineEnv;
}

function clientSessionId(request: Request, body?: { sessionId?: unknown }): string | null {
  const fromHeader = request.headers.get('x-clay-session');
  if (fromHeader) return fromHeader;
  if (typeof body?.sessionId === 'string' && body.sessionId) return body.sessionId;
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get('sessionId');
  if (fromQuery) return fromQuery;
  return null;
}

function newSessionId(): string {
  return `s-${crypto.randomUUID().slice(0, 8)}`;
}

export class ClayAgent extends Agent<ClayEnv, SessionState> {
  initialState: SessionState = {
    sessionId: '',
    surfaceId: '',
    components: [],
    dataModel: {},
    turns: [],
    updatedAt: Date.now(),
  };

  /**
   * All of the A2UI logic runs inside the object so `this.state` is the single
   * authority on what the surface currently is.
   */
  async onRequest(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    await this.ensureSeeded();

    if (path === '/api/health') {
      return this.json({
        ok: true,
        runtime: 'workers',
        sessionId: this.state.sessionId,
        surfaceId: this.state.surfaceId || null,
        components: this.state.components.length,
        turns: this.state.turns.length,
      });
    }

    if (path === '/api/session') {
      return this.json({
        sessionId: this.state.sessionId,
        surfaceId: this.state.surfaceId,
        components: this.state.components,
        dataModel: this.state.dataModel,
        turns: this.state.turns,
        updatedAt: this.state.updatedAt,
      });
    }

    if (path === '/api/chat') return this.handleChat(request);
    if (path === '/api/interact') return this.handleInteract(request);

    return this.json({ error: 'not_found', detail: path }, 404);
  }

  private async ensureSeeded(): Promise<void> {
    if (!this.state.sessionId) {
      this.setState({ ...this.state, sessionId: this.name });
    }
  }

  private json(body: unknown, status = 200): Response {
    return jsonResponse(body, status, CORS);
  }

  private recordTurn(turn: TurnRecord): TurnRecord[] {
    const turns = [...this.state.turns, turn];
    return turns.slice(-MAX_TURNS_KEPT);
  }

  private async readBody<T>(request: Request): Promise<T | { error: string; detail: string }> {
    const text = await request.text();
    if (!text) return { error: 'bad_request', detail: 'empty request body' };
    try {
      return JSON.parse(text) as T;
    } catch {
      return { error: 'bad_request', detail: 'request body is not JSON' };
    }
  }

  private async handleChat(request: Request): Promise<Response> {
    const body = await this.readBody<{
      message?: string;
      settings?: Partial<InferenceSettings>;
      sessionId?: string;
    }>(request);
    if ('error' in body) return this.json(body, 400);

    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) return this.json({ error: 'bad_request', detail: 'message is required' }, 400);

    const previous = surfaceOf(this.state);
    const outcome = await runChatTurn({
      message,
      surface: previous,
      turns: this.state.turns,
      env: envFor(this.env),
      overrides: body.settings,
    });

    this.setState({
      ...this.state,
      sessionId: this.state.sessionId || this.name,
      surfaceId: outcome.surface.surfaceId,
      components: outcome.surface.components,
      dataModel: outcome.surface.dataModel,
      updatedAt: Date.now(),
      turns: this.recordTurn({
        index: this.state.turns.length,
        kind: 'chat',
        input: message,
        raw: outcome.raw,
        emitted: outcome.emitted,
        rejected: outcome.rejected,
        status: outcome.status,
        detail: outcome.detail,
        recomputed: outcome.recomputed,
        attempts: outcome.attempts,
        ts: Date.now(),
      }),
    });

    if (outcome.status !== 'ok') return this.errorResponse(outcome);

    return this.json({
      ...(outcome.emitted ?? {}),
      sessionId: this.state.sessionId,
      surfaceId: outcome.surface.surfaceId,
      components: outcome.surface.components,
      dataModel: outcome.surface.dataModel,
      turn: this.state.turns.length - 1,
      recomputed: outcome.recomputed,
      attempts: outcome.attempts,
      meta: outcome.meta,
      rejected: outcome.rejected,
    });
  }

  private async handleInteract(request: Request): Promise<Response> {
    const body = await this.readBody<{
      surfaceId?: string;
      componentId?: string;
      value?: unknown;
      settings?: Partial<InferenceSettings>;
      sessionId?: string;
    }>(request);
    if ('error' in body) return this.json(body, 400);

    const componentId = typeof body.componentId === 'string' ? body.componentId : '';
    if (!componentId) {
      return this.json({ error: 'bad_request', detail: 'componentId is required' }, 400);
    }
    if (body.surfaceId && this.state.surfaceId && body.surfaceId !== this.state.surfaceId) {
      return this.json(
        { error: 'stale_surface', detail: `surface "${body.surfaceId}" is not "${this.state.surfaceId}"` },
        409
      );
    }

    const previous = surfaceOf(this.state);
    const outcome = await runInteractTurn({
      surfaceId: body.surfaceId ?? previous.surfaceId,
      componentId,
      value: body.value,
      surface: previous,
      turns: this.state.turns,
      env: envFor(this.env),
      overrides: body.settings,
    });

    this.setState({
      ...this.state,
      surfaceId: outcome.surface.surfaceId,
      components: outcome.surface.components,
      dataModel: outcome.surface.dataModel,
      updatedAt: Date.now(),
      turns: this.recordTurn({
        index: this.state.turns.length,
        kind: 'interact',
        input: `${componentId} = ${JSON.stringify(body.value)}`,
        raw: outcome.raw,
        emitted: outcome.emitted,
        rejected: outcome.rejected,
        status: outcome.status,
        detail: outcome.detail,
        recomputed: outcome.recomputed,
        attempts: outcome.attempts,
        ts: Date.now(),
      }),
    });

    if (outcome.status !== 'ok') return this.errorResponse(outcome);

    return this.json({
      ...(outcome.emitted ?? {}),
      sessionId: this.state.sessionId,
      surfaceId: outcome.surface.surfaceId,
      components: outcome.surface.components,
      dataModel: outcome.surface.dataModel,
      turn: this.state.turns.length - 1,
      recomputed: outcome.recomputed,
      attempts: outcome.attempts,
      changed: diffComponents(previous.components, outcome.surface.components),
      meta: outcome.meta,
      rejected: outcome.rejected,
    });
  }

  private errorResponse(outcome: TurnOutcome): Response {
    if (outcome.status === 'invalid_surface') {
      return this.json(
        {
          error: 'invalid_surface',
          detail: outcome.detail ?? 'invalid surface',
          raw: outcome.raw.slice(0, 300),
          rejected: outcome.rejected,
        },
        422
      );
    }
    const detail = outcome.detail ?? 'inference failed';
    if (detail === 'no_api_key') return this.json({ error: 'no_api_key', detail }, 400);
    const status = detail.startsWith('upstream') || detail.startsWith('empty_completion') ? 502 : 500;
    return this.json({ error: 'agent_error', detail, raw: outcome.raw.slice(0, 300) }, status);
  }
}

/**
 * Worker entry. `/api/session/:id` is resolved here (the id selects the DO);
 * every other `/api/*` call goes to the session's object, which owns state.
 */
export default {
  async fetch(request: Request, env: ClayEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (path === '/' || path === '/api') {
      return jsonResponse({
        name: 'clay-agent',
        runtime: 'workers',
        endpoints: ['/api/chat', '/api/interact', '/api/session/:id', '/api/health'],
      }, 200, CORS);
    }

    if (path === '/api/health') {
      return jsonResponse(
        {
          ok: true,
          runtime: 'workers',
          model: env.MODEL ?? null,
          baseUrl: env.OPENAI_BASE_URL ?? null,
          hasServerKey: Boolean(env.OPENAI_API_KEY),
        },
        200,
        CORS
      );
    }

    if (path === '/api/test') {
      // Settings → "Test connection". Runs here, not in the DO: no session state
      // is involved, and the API key must never be echoed back to the browser.
      const text = await request.text();
      let body: { settings?: Partial<InferenceSettings> } = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        return jsonResponse({ error: 'bad_request', detail: 'request body is not JSON' }, 400, CORS);
      }
      const settings = resolveSettings(body.settings, {
        OPENAI_BASE_URL: env.OPENAI_BASE_URL,
        OPENAI_API_KEY: env.OPENAI_API_KEY,
        MODEL: env.MODEL,
        GEMINI_BASE_URL: env.GEMINI_BASE_URL,
        GEMINI_API_KEY: env.GEMINI_API_KEY,
        LMSTUDIO_BASE_URL: env.LMSTUDIO_BASE_URL,
        OLLAMA_BASE_URL: env.OLLAMA_BASE_URL,
      });
      const result = await testConnection(settings);
      const redacted = settings.apiKey ? result.body.split(settings.apiKey).join('[redacted]') : result.body;
      return jsonResponse(
        { ...result, body: redacted, model: settings.model },
        result.ok ? 200 : 502,
        CORS
      );
    }

    if (path.startsWith('/api/session/')) {
      const sessionId = decodeURIComponent(path.slice('/api/session/'.length));
      if (!sessionId) return jsonResponse({ error: 'bad_request', detail: 'session id required' }, 400, CORS);
      const stub = stubFor(env, sessionId);
      return stub.fetch(new Request('https://clay.internal/api/session', { headers: request.headers }));
    }

    if (path === '/api/chat' || path === '/api/interact') {
      // Read the body exactly once: a Request stream cannot be consumed twice.
      const text = await request.text();
      let body: { sessionId?: unknown } = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        return jsonResponse({ error: 'bad_request', detail: 'request body is not JSON' }, 400, CORS);
      }
      const sessionId = clientSessionId(request, body) ?? newSessionId();
      const stub = stubFor(env, sessionId);
      const upstream = await stub.fetch(
        new Request(url.toString(), {
          method: request.method,
          headers: request.headers,
          body: text,
        })
      );
      // Stamp the session id on the way out so the client can pin it.
      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.set('x-clay-session', sessionId);
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    }

    if (path.startsWith('/agents/')) {
      const { routeAgentRequest } = await import('agents');
      const routed = await routeAgentRequest(request, env, { cors: true });
      if (routed) return routed;
    }

    void ctx;
    return jsonResponse({ error: 'not_found', detail: path, runtime: 'workers' }, 404, CORS);
  },
} as ExportedHandler<ClayEnv>;

function stubFor(env: ClayEnv, sessionId: string): DurableObjectStub {
  const namespace = env.CLAY_AGENT;
  return namespace.get(namespace.idFromName(sessionId));
}
