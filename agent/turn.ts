/**
 * The turn engine, shared by both runtimes.
 *
 * `agent/index.ts` (Durable Object) and `server-node/index.ts` (fallback) speak
 * the identical HTTP contract, so everything that decides what the agent does —
 * build messages, call the model, guardrail the reply, fold it into the surface
 * — lives here once.
 *
 * Retry policy, which is the subtle part:
 *  - a reply that is *broken as an emission* (truncated JSON, a component entry
 *    with no id) is asked for again. The model produces the replacement; a
 *    payload is never patched locally.
 *  - a reply that is well-formed but off-catalog (unknown component name,
 *    forbidden prop, injection pattern) is the guardrail's verdict. It comes
 *    back untouched as `invalid_surface`, never retried, never repaired.
 */

import {
  completeJson,
  InferenceError,
  resolveSettings,
  type ChatMessageLite,
  type InferenceSettings,
  type ProviderDefaults,
} from './inference.ts';
import { buildChatMessages, buildInteractMessages, type ChatMessage } from './prompt.ts';
import { classifyEmission, type Emission } from './components.ts';
import {
  applyResponse,
  getPath,
  indexComponents,
  recomputedIds,
  setPath,
  type A2UIResponse,
  type RejectedComponent,
  type SessionSurface,
  type TurnRecord,
} from '../shared/a2ui.ts';
import { COMPONENT_NAMES } from '../shared/catalog.ts';

export type TurnMeta = {
  model: string;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
};

export type TurnOutcome = {
  status: 'ok' | 'invalid_surface' | 'error';
  emitted: A2UIResponse | null;
  raw: string;
  detail?: string;
  rejected: RejectedComponent[];
  attempts: number;
  surface: SessionSurface;
  recomputed: string[];
  meta: TurnMeta | null;
};

export type EngineEnv = ProviderDefaults & {
  /** Optional sampling overrides; kept out of `.env.example` so it stays verbatim. */
  TEMPERATURE?: string;
  MAX_TOKENS?: string;
} & Record<string, string | undefined>;

const HISTORY_TURNS = 3;
const HISTORY_CHAR_BUDGET = 6_000;
const MALFORMED_RETRIES = 3;

function runtimeSampling(env: EngineEnv): { temperature?: number; maxTokens?: number } {
  const temperature = Number(env.TEMPERATURE);
  const maxTokens = Number(env.MAX_TOKENS);
  return {
    temperature: Number.isFinite(temperature) ? temperature : undefined,
    maxTokens: Number.isFinite(maxTokens) ? maxTokens : undefined,
  };
}

function settingsFor(env: EngineEnv, overrides?: Partial<InferenceSettings>): InferenceSettings {
  return resolveSettings(overrides, env, runtimeSampling(env));
}

function toLite(messages: ChatMessage[]): ChatMessageLite[] {
  return messages.map((message) => ({ role: message.role, content: message.content }));
}

/**
 * Keep the model honest across turns: it sees its own recent A2UI replies as
 * assistant messages. Bounded by both turn count and characters, because the
 * surfaces are verbose.
 */
export function historyFromTurns(turns: TurnRecord[]): ChatMessage[] {
  const usable = turns.filter((turn) => turn.status === 'ok' && turn.emitted);
  const out: ChatMessage[] = [];
  let budget = HISTORY_CHAR_BUDGET;

  for (const turn of usable.slice(-HISTORY_TURNS)) {
    const assistant = turn.raw.slice(0, budget);
    budget -= assistant.length;
    if (assistant.length === 0) break;
    out.push({ role: 'user', content: turn.input.slice(0, 800) });
    out.push({ role: 'assistant', content: assistant });
  }
  return out;
}

/**
 * Names in a refused payload that the catalog does not define. The surface is
 * still rejected; this only tells the inspector *which* components were refused.
 */
export function rejectedComponents(raw: string): RejectedComponent[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const components = (parsed as { surfaceUpdate?: { components?: unknown } })?.surfaceUpdate
    ?.components;
  if (!Array.isArray(components)) return [];

  const out: RejectedComponent[] = [];
  components.forEach((entry: unknown, index: number) => {
    if (!entry || typeof entry !== 'object') return;
    const record = entry as { id?: unknown; component?: unknown };
    if (!record.component || typeof record.component !== 'object') return;
    const keys = Object.keys(record.component as Record<string, unknown>);
    if (keys.length !== 1) return;
    const name = keys[0] ?? '';
    if ((COMPONENT_NAMES as readonly string[]).includes(name)) return;
    out.push({
      id: typeof record.id === 'string' ? record.id : `#${index}`,
      name,
      path: `surfaceUpdate.components[${index}].component.${name}`,
    });
  });
  return out;
}

/**
 * `bind` is a promise: a widget's displayed value equals the value stored at its
 * data path. After a patch lands we re-sync interactive widgets from the data
 * model, so a stale echo in `surfaceUpdate` cannot rewind what the user dragged.
 */
export function syncBoundValues(surface: SessionSurface): SessionSurface {
  const components = surface.components.map((component) => {
    const name = Object.keys(component.component)[0] ?? '';
    if (name !== 'Slider' && name !== 'Toggle') return component;
    const props = component.component[name] as Record<string, unknown>;
    if (typeof props.bind !== 'string') return component;
    const bound = getPath(surface.dataModel, props.bind);
    if (bound === undefined) return component;
    if (name === 'Slider' && typeof bound !== 'number') return component;
    if (name === 'Toggle' && typeof bound !== 'boolean') return component;
    if (props.value === bound) return component;
    return { id: component.id, component: { [name]: { ...props, value: bound } } };
  });
  return { ...surface, components };
}

type AskResult =
  | { ok: true; raw: string; meta: TurnMeta; emission: Emission }
  | { ok: false; error: InferenceError };

async function askOnce(
  messages: ChatMessage[],
  settings: InferenceSettings,
  fetchImpl?: typeof fetch
): Promise<AskResult> {
  try {
    const completion = await completeJson(toLite(messages), settings, fetchImpl);
    return {
      ok: true,
      raw: completion.raw,
      meta: {
        model: completion.model,
        latencyMs: completion.latencyMs,
        promptTokens: completion.usage?.promptTokens,
        completionTokens: completion.usage?.completionTokens,
      },
      emission: classifyEmission(completion.raw),
    };
  } catch (cause) {
    return { ok: false, error: cause as InferenceError };
  }
}

type EmitResult =
  | { ok: true; message: A2UIResponse; raw: string; meta: TurnMeta; attempts: number }
  | {
      ok: false;
      kind: 'invalid_surface' | 'error';
      detail: string;
      raw: string;
      meta: TurnMeta | null;
      attempts: number;
      rejected: RejectedComponent[];
    };

/** Drive the model until it emits something usable, or something forbidden. */
async function emit(
  messages: ChatMessage[],
  settings: InferenceSettings,
  fetchImpl?: typeof fetch
): Promise<EmitResult> {
  let conversation = messages;

  for (let attempt = 1; attempt <= MALFORMED_RETRIES + 1; attempt += 1) {
    const response = await askOnce(conversation, settings, fetchImpl);

    if (!response.ok) {
      const error = response.error;
      return {
        ok: false,
        kind: 'error',
        detail: error.code === 'no_api_key' ? 'no_api_key' : `${error.code}: ${error.message}`,
        raw: error.detail ?? '',
        meta: null,
        attempts: attempt,
        rejected: [],
      };
    }

    const { raw, meta, emission } = response;

    if (emission.kind === 'ok') {
      return { ok: true, message: emission.message, raw, meta, attempts: attempt };
    }

    // An off-catalog reply is final. A malformed one gets another attempt,
    // unless the attempts are spent — then it is reported as it arrived.
    if (emission.kind === 'rejected' || attempt > MALFORMED_RETRIES) {
      return {
        ok: false,
        kind: 'invalid_surface',
        detail: emission.detail,
        raw,
        meta,
        attempts: attempt,
        rejected: rejectedComponents(raw),
      };
    }

    conversation = [
      ...conversation,
      { role: 'assistant', content: raw.slice(0, 12_000) },
      {
        role: 'user',
        content: `That reply was rejected by the A2UI parser: ${emission.detail}. Re-emit the entire A2UI JSON object. Every entry in "components" must be an object with BOTH "id" (a non-empty string) and "component" (exactly one catalogued name with its props). Do not truncate, do not elide, do not explain. JSON only.`,
      },
    ];
  }

  return {
    ok: false,
    kind: 'error',
    detail: 'emission loop exhausted',
    raw: '',
    meta: null,
    attempts: MALFORMED_RETRIES + 1,
    rejected: [],
  };
}

function failureOf(
  result: Extract<EmitResult, { ok: false }>,
  surface: SessionSurface
): TurnOutcome {
  return {
    status: result.kind,
    emitted: null,
    raw: result.raw,
    detail: result.detail,
    rejected: result.rejected,
    attempts: result.attempts,
    surface,
    recomputed: [],
    meta: result.meta,
  };
}

export async function runChatTurn(args: {
  message: string;
  surface: SessionSurface;
  turns: TurnRecord[];
  env: EngineEnv;
  overrides?: Partial<InferenceSettings>;
  fetchImpl?: typeof fetch;
}): Promise<TurnOutcome> {
  const settings = settingsFor(args.env, args.overrides);
  const messages = buildChatMessages(args.message, historyFromTurns(args.turns));
  const result = await emit(messages, settings, args.fetchImpl);

  if (!result.ok) return failureOf(result, args.surface);

  return {
    status: 'ok',
    emitted: result.message,
    raw: result.raw,
    rejected: [],
    attempts: result.attempts,
    surface: syncBoundValues(applyResponse(args.surface, result.message)),
    recomputed: [],
    meta: result.meta,
  };
}

export type InteractTarget = {
  componentId: string;
  componentName: string;
  bind: string | null;
  props: Record<string, unknown>;
};

export function findTarget(surface: SessionSurface, componentId: string): InteractTarget | null {
  const component = indexComponents(surface.components).get(componentId);
  if (!component) return null;
  const name = Object.keys(component.component)[0] ?? '';
  const props = (component.component as Record<string, Record<string, unknown>>)[name] ?? {};
  return {
    componentId,
    componentName: name,
    bind: typeof props.bind === 'string' ? props.bind : null,
    props,
  };
}

/**
 * A widget event. The bound data path is written first (that is what `bind`
 * means), the agent is then asked to re-derive everything that depends on it,
 * and the turn reports which components *other than the touched one* changed.
 */
export async function runInteractTurn(args: {
  surfaceId: string;
  componentId: string;
  value: unknown;
  surface: SessionSurface;
  turns: TurnRecord[];
  env: EngineEnv;
  overrides?: Partial<InferenceSettings>;
  fetchImpl?: typeof fetch;
}): Promise<TurnOutcome> {
  const settings = settingsFor(args.env, args.overrides);
  const target = findTarget(args.surface, args.componentId);

  if (!target) {
    return {
      status: 'error',
      emitted: null,
      raw: '',
      detail: `unknown componentId "${args.componentId}" for surface "${args.surfaceId}"`,
      rejected: [],
      attempts: 0,
      surface: args.surface,
      recomputed: [],
      meta: null,
    };
  }

  // Apply the event to the data model before asking: the model's job is the
  // arithmetic downstream of it, not re-deriving what the slider already says.
  const seeded: SessionSurface = {
    surfaceId: args.surface.surfaceId,
    components: args.surface.components.map((component) =>
      component.id === target.componentId
        ? {
            id: component.id,
            component: { [target.componentName]: { ...target.props, value: args.value } },
          }
        : component
    ),
    dataModel: { ...args.surface.dataModel },
  };
  if (target.bind) setPath(seeded.dataModel, target.bind, args.value);

  const base = buildInteractMessages({
    surface: seeded,
    componentId: target.componentId,
    componentName: target.componentName,
    bind: target.bind,
    value: args.value,
    history: historyFromTurns(args.turns),
  });

  const first = await emit(base, settings, args.fetchImpl);
  if (!first.ok) return failureOf(first, seeded);

  let surface = syncBoundValues(applyResponse(seeded, first.message));
  let recomputed = recomputedIds(args.surface.components, surface.components, target.componentId);
  let emitted = first.message;
  let raw = first.raw;
  let meta = first.meta;
  let attempts = first.attempts;

  // A schema-valid reply that left every dependent number untouched is a failure
  // of the A2UI contract, not of the guardrail. Ask once more, pointing at the
  // model's own previous answer, and keep whichever turn moved more dependents.
  if (recomputed.length === 0) {
    const nudge: ChatMessage[] = [
      ...base,
      { role: 'assistant', content: raw.slice(0, 12_000) },
      {
        role: 'user',
        content: `That reply only updated "${target.componentId}". Every other component still shows the previous numbers. Recompute the dependent components from the new ${
          target.bind ?? 'value'
        } = ${JSON.stringify(args.value)} and return surfaceUpdate with the FULL component list plus dataModelUpdate. The Table rows, BarChart series, Stat values and summary text must reflect the new arithmetic. JSON only.`,
      },
    ];
    const second = await emit(nudge, settings, args.fetchImpl);
    attempts += second.attempts;
    if (second.ok) {
      const candidate = syncBoundValues(applyResponse(seeded, second.message));
      const candidateRecomputed = recomputedIds(
        args.surface.components,
        candidate.components,
        target.componentId
      );
      if (candidateRecomputed.length > recomputed.length) {
        surface = candidate;
        recomputed = candidateRecomputed;
        emitted = second.message;
        raw = second.raw;
        meta = second.meta;
      }
    }
  }

  return {
    status: 'ok',
    emitted,
    raw,
    rejected: [],
    attempts,
    surface,
    recomputed,
    meta,
  };
}
