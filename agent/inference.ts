/**
 * Plain-fetch inference layer.
 *
 * One code path for every provider: POST {baseUrl}/chat/completions with
 * `stream:false` and `response_format:{type:"json_object"}`. Particle.ai is the
 * default; Ollama / LM Studio need no key; Gemini works through its
 * OpenAI-compatible endpoint. Switching providers is a Settings change, not an
 * edit to this file.
 *
 * The API key only ever exists here and in the server's env — it is never
 * returned to the client.
 */

export type InferenceSettings = {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
};

export type ProviderDefaults = {
  OPENAI_BASE_URL?: string;
  OPENAI_API_KEY?: string;
  MODEL?: string;
  GEMINI_BASE_URL?: string;
  GEMINI_API_KEY?: string;
  LMSTUDIO_BASE_URL?: string;
  OLLAMA_BASE_URL?: string;
};

export type ChatMessageLite = { role: string; content: string };

export class InferenceError extends Error {
  readonly code: string;
  readonly detail?: string;

  constructor(code: string, message: string, detail?: string) {
    super(message);
    this.name = 'InferenceError';
    this.code = code;
    this.detail = detail;
  }
}

export const FALLBACK_BASE_URL = 'https://api.particle.ai/v1';
export const FALLBACK_MODEL = 'deepseek-v4.1-flash';

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * Resolve per-request overrides on top of server env. A field that the client
 * sends wins even if it is an empty string (that is how "clear the key" works);
 * `undefined` means "not set in Settings, fall back to .env".
 */
export function resolveSettings(
  overrides: Partial<InferenceSettings> | undefined,
  env: ProviderDefaults,
  runtime: { temperature?: number; maxTokens?: number } = {}
): InferenceSettings {
  const baseUrl =
    overrides?.baseUrl ?? env.OPENAI_BASE_URL ?? env.GEMINI_BASE_URL ?? FALLBACK_BASE_URL;
  const model = overrides?.model ?? env.MODEL ?? FALLBACK_MODEL;
  const apiKey = overrides?.apiKey ?? env.OPENAI_API_KEY ?? env.GEMINI_API_KEY ?? '';

  return {
    baseUrl: trimSlash(baseUrl || FALLBACK_BASE_URL),
    apiKey: (apiKey ?? '').trim(),
    model: (model || FALLBACK_MODEL).trim(),
    temperature: clampNumber(overrides?.temperature, 0, 2, runtime.temperature ?? 0.2),
    // Deliberately generous: reasoning models spend output budget on hidden
    // thinking before writing any JSON, and a truncated surface is unusable.
    maxTokens: clampInt(overrides?.maxTokens, 256, 65536, runtime.maxTokens ?? 32768),
  };
}

function clampNumber(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  return Math.round(clampNumber(value, min, max, fallback));
}

/**
 * Models are told to emit raw JSON; some still wrap it in a fence. This is
 * extraction, not repair: the payload is then validated by components.ts and a
 * mangled surface is still rejected as invalid_surface.
 */
export function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return trimmed;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return (fence[1] ?? '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

export type CompletionResult = {
  raw: string;
  model: string;
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null;
  latencyMs: number;
};

export async function completeJson(
  messages: ChatMessageLite[],
  settings: InferenceSettings,
  fetchImpl: typeof fetch = fetch
): Promise<CompletionResult> {
  if (!settings.apiKey) throw new InferenceError('no_api_key', 'no_api_key');

  const url = `${settings.baseUrl}/chat/completions`;
  const started = Date.now();

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
      stream: false,
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(90_000),
  }).catch((cause: Error) => {
    throw new InferenceError('upstream_unreachable', `cannot reach ${url}`, cause.message);
  });

  const bodyText = await response.text();

  if (!response.ok) {
    throw new InferenceError(
      'upstream_status',
      `upstream returned ${response.status}`,
      bodyText.slice(0, 600)
    );
  }

  let payload: {
    choices?: { message?: { content?: string }; text?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    model?: string;
  };
  try {
    payload = JSON.parse(bodyText);
  } catch {
    throw new InferenceError('upstream_not_json', 'upstream reply was not JSON', bodyText.slice(0, 300));
  }

  const choice = payload.choices?.[0];
  const content = choice?.message?.content ?? choice?.text ?? '';
  if (!content) {
    throw new InferenceError('empty_completion', 'upstream returned no content', bodyText.slice(0, 300));
  }

  return {
    raw: extractJson(content),
    model: payload.model ?? settings.model,
    usage: payload.usage
      ? {
          promptTokens: payload.usage.prompt_tokens,
          completionTokens: payload.usage.completion_tokens,
          totalTokens: payload.usage.total_tokens,
        }
      : null,
    latencyMs: Date.now() - started,
  };
}

export type ConnectionTest = {
  ok: boolean;
  status: number;
  body: string;
  latencyMs: number;
  url: string;
};

/** "Test connection" in Settings: the real status code and a slice of the body. */
export async function testConnection(
  settings: InferenceSettings,
  fetchImpl: typeof fetch = fetch
): Promise<ConnectionTest> {
  const url = `${settings.baseUrl}/chat/completions`;
  const started = Date.now();

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [{ role: 'user', content: 'Reply with exactly {"ok":true} and nothing else.' }],
        stream: false,
        max_tokens: 64,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      body: body.slice(0, 800),
      latencyMs: Date.now() - started,
      url,
    };
  } catch (cause) {
    return {
      ok: false,
      status: 0,
      body: String((cause as Error)?.message ?? cause),
      latencyMs: Date.now() - started,
      url,
    };
  }
}
