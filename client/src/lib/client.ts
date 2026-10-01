/**
 * Client-side transport + Settings storage.
 *
 * Everything the user changes in the Settings panel lives in localStorage under
 * `clay.settings.v1` and travels on each request body. The server prefers those
 * overrides and falls back to its own `.env`. The API key is only ever sent
 * *to* the server; nothing in the responses echoes it back.
 */

import type { A2UIComponent, A2UIResponse, RejectedComponent, TurnRecord } from '../../../shared/a2ui';

export type PresetId = 'particle' | 'lmstudio' | 'ollama' | 'gemini' | 'custom';

export type Settings = {
  preset: PresetId;
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature?: number;
  maxTokens?: number;
};

export const SETTINGS_KEY = 'clay.settings.v1';
export const SESSION_KEY = 'clay.session.v1';

export type Preset = {
  id: PresetId;
  label: string;
  baseUrl: string;
  model: string;
  needsKey: boolean;
  hint: string;
};

export const PRESETS: Preset[] = [
  {
    id: 'particle',
    label: 'Particle.ai',
    baseUrl: 'https://api.particle.ai/v1',
    model: 'deepseek-v4.1-flash',
    needsKey: true,
    hint: 'OpenAI-compatible, default',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    model: 'local-model',
    needsKey: false,
    hint: 'local, no key',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.2',
    needsKey: false,
    hint: 'local, no key',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    model: 'gemini-2.5-flash',
    needsKey: true,
    hint: 'Google OpenAI-compatible endpoint',
  },
  {
    id: 'custom',
    label: 'Custom',
    baseUrl: '',
    model: '',
    needsKey: true,
    hint: 'any OpenAI-compatible /v1',
  },
];

export const DEFAULT_SETTINGS: Settings = {
  preset: 'particle',
  baseUrl: PRESETS[0]!.baseUrl,
  model: PRESETS[0]!.model,
  apiKey: '',
};

export function loadSettings(): Settings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (!stored) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(stored) as Partial<Settings>;
    return {
      preset: (parsed.preset as PresetId) ?? 'custom',
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : '',
      model: typeof parsed.model === 'string' ? parsed.model : '',
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      temperature: typeof parsed.temperature === 'number' ? parsed.temperature : undefined,
      maxTokens: typeof parsed.maxTokens === 'number' ? parsed.maxTokens : undefined,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/** Empty fields are omitted so the server's `.env` fills exactly the gaps. */
export function settingsForRequest(settings: Settings): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (settings.baseUrl.trim()) out.baseUrl = settings.baseUrl.trim();
  if (settings.model.trim()) out.model = settings.model.trim();
  if (settings.apiKey.trim()) out.apiKey = settings.apiKey.trim();
  if (typeof settings.temperature === 'number') out.temperature = settings.temperature;
  if (typeof settings.maxTokens === 'number') out.maxTokens = settings.maxTokens;
  return out;
}

function createSessionId(): string {
  return `c-${crypto.randomUUID().slice(0, 8)}`;
}

export function loadSessionId(): string {
  const existing = localStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const created = createSessionId();
  localStorage.setItem(SESSION_KEY, created);
  return created;
}

export function resetSessionId(): string {
  const created = createSessionId();
  localStorage.setItem(SESSION_KEY, created);
  return created;
}

export type ApiSuccess = {
  ok: true;
  status: number;
  surfaceUpdate?: SurfacePart;
  dataModelUpdate?: DataModelPart;
  deleteSurface?: { surfaceId: string };
  text?: string;
  sessionId: string;
  surfaceId: string;
  components: A2UIComponent[];
  dataModel: Record<string, unknown>;
  recomputed: string[];
  rejected: RejectedComponent[];
  attempts?: number;
  meta?: { model: string; latencyMs: number; promptTokens?: number; completionTokens?: number } | null;
  changed?: { added: string[]; removed: string[]; changed: string[]; unchanged: string[] };
};

type SurfacePart = NonNullable<A2UIResponse['surfaceUpdate']>;
type DataModelPart = NonNullable<A2UIResponse['dataModelUpdate']>;

export type ApiFailure = {
  ok: false;
  status: number;
  error: string;
  detail?: string;
  raw?: string;
  rejected: RejectedComponent[];
};

export type ApiResult = ApiSuccess | ApiFailure;

async function call(path: string, init: RequestInit): Promise<ApiResult> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (cause) {
    return {
      ok: false,
      status: 0,
      error: 'network_error',
      detail: `${path}: ${(cause as Error)?.message ?? cause}`,
      rejected: [],
    };
  }

  const text = await response.text();
  let body: Record<string, unknown>;
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return {
      ok: false,
      status: response.status,
      error: 'response_not_json',
      detail: text.slice(0, 300),
      rejected: [],
    };
  }

  const error = body.error;
  if (!response.ok || error) {
    return {
      ok: false,
      status: response.status,
      error: typeof error === 'string' ? error : `http_${response.status}`,
      detail: typeof body.detail === 'string' ? body.detail : undefined,
      raw: typeof body.raw === 'string' ? body.raw : undefined,
      rejected: Array.isArray(body.rejected) ? (body.rejected as RejectedComponent[]) : [],
    };
  }

  return {
    ok: true,
    status: response.status,
    surfaceUpdate: body.surfaceUpdate as SurfacePart | undefined,
    dataModelUpdate: body.dataModelUpdate as DataModelPart | undefined,
    deleteSurface: body.deleteSurface as { surfaceId: string } | undefined,
    text: typeof body.text === 'string' ? body.text : undefined,
    sessionId: String(body.sessionId ?? ''),
    surfaceId: String(body.surfaceId ?? ''),
    components: Array.isArray(body.components) ? (body.components as A2UIComponent[]) : [],
    dataModel: (body.dataModel as Record<string, unknown>) ?? {},
    recomputed: Array.isArray(body.recomputed) ? (body.recomputed as string[]) : [],
    rejected: Array.isArray(body.rejected) ? (body.rejected as RejectedComponent[]) : [],
    attempts: typeof body.attempts === 'number' ? body.attempts : undefined,
    meta: (body.meta as ApiSuccess['meta']) ?? null,
    changed: body.changed as ApiSuccess['changed'],
  };
}

export function apiChat(
  message: string,
  settings: Settings,
  sessionId: string
): Promise<ApiResult> {
  return call('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-clay-session': sessionId },
    body: JSON.stringify({ sessionId, message, settings: settingsForRequest(settings) }),
  });
}

export function apiInteract(
  args: { surfaceId: string; componentId: string; value: unknown },
  settings: Settings,
  sessionId: string
): Promise<ApiResult> {
  return call('/api/interact', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-clay-session': sessionId },
    body: JSON.stringify({
      sessionId,
      ...args,
      settings: settingsForRequest(settings),
    }),
  });
}

export type SessionSnapshot = {
  sessionId: string;
  surfaceId: string;
  components: A2UIComponent[];
  dataModel: Record<string, unknown>;
  turns: TurnRecord[];
  updatedAt: number;
};

export async function apiSession(sessionId: string): Promise<SessionSnapshot | null> {
  try {
    const response = await fetch(`/api/session/${encodeURIComponent(sessionId)}`);
    if (!response.ok) return null;
    return (await response.json()) as SessionSnapshot;
  } catch {
    return null;
  }
}

export type HealthInfo = {
  ok: boolean;
  runtime: string;
  model?: string | null;
  baseUrl?: string | null;
  hasServerKey?: boolean;
  nodeVersion?: string;
  sessions?: number;
};

export async function apiHealth(): Promise<HealthInfo | null> {
  try {
    const response = await fetch('/api/health');
    if (!response.ok) return null;
    return (await response.json()) as HealthInfo;
  } catch {
    return null;
  }
}

export type TestResult = {
  ok: boolean;
  status: number;
  body: string;
  latencyMs: number;
  url: string;
  model?: string;
};

/** "Test connection": the server proxies the call so the key never round-trips. */
export async function apiTest(settings: Settings): Promise<TestResult> {
  try {
    const response = await fetch('/api/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ settings: settingsForRequest(settings) }),
    });
    const body = (await response.json()) as TestResult;
    return body;
  } catch (cause) {
    return {
      ok: false,
      status: 0,
      body: String((cause as Error)?.message ?? cause),
      latencyMs: 0,
      url: '/api/test',
    };
  }
}
