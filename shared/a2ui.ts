/**
 * A2UI wire contract — types and pure helpers shared by the agent runtime, the
 * Node fallback, the client renderer and the verifier.
 *
 * A surface is a flat component list plus an id-keyed lookup; components are
 * linked by id (`Column.children`). The dataModel is a plain JSON object that
 * interactive widgets write into through a dotted `bind` path.
 */

export type ComponentName = string;

export type A2UIComponent = {
  id: string;
  component: Record<ComponentName, Record<string, unknown>>;
};

export type SurfaceUpdate = {
  surfaceId: string;
  components: A2UIComponent[];
};

export type DataModelUpdate = {
  surfaceId: string;
  dataModel: Record<string, unknown>;
};

export type DeleteSurface = { surfaceId: string };

export type A2UIResponse = {
  surfaceUpdate?: SurfaceUpdate;
  dataModelUpdate?: DataModelUpdate;
  deleteSurface?: DeleteSurface;
  text?: string;
};

export type SessionSurface = {
  surfaceId: string;
  components: A2UIComponent[];
  dataModel: Record<string, unknown>;
};

/** A turn as the inspector sees it: what we asked, what came back verbatim. */
export type TurnRecord = {
  index: number;
  kind: 'chat' | 'interact';
  input: string;
  /** The exact A2UI message the agent emitted, before any client processing. */
  raw: string;
  emitted: A2UIResponse | null;
  rejected: RejectedComponent[];
  status: 'ok' | 'invalid_surface' | 'error';
  detail?: string;
  /** Component ids whose displayed values changed, excluding the touched one. */
  recomputed: string[];
  /** Model calls it took to land a usable emission (1 = first try). */
  attempts: number;
  ts: number;
};

export type RejectedComponent = {
  id: string;
  name: string;
  path: string;
};

export function getPath(source: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined;
  let current: unknown = source;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
    if (current === undefined) return undefined;
  }
  return current;
}

export function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  const leaf = segments.pop() ?? '';
  let cursor: Record<string, unknown> = target;
  for (const key of segments) {
    const next = cursor[key];
    if (next === null || typeof next !== 'object') cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[leaf] = value;
}

/** Fold one agent message into the current surface. Never mutates its inputs. */
export function applyResponse(
  surface: SessionSurface,
  message: A2UIResponse
): SessionSurface {
  let next: SessionSurface = {
    surfaceId: surface.surfaceId,
    components: surface.components,
    dataModel: { ...surface.dataModel },
  };

  if (message.deleteSurface) {
    if (message.deleteSurface.surfaceId === surface.surfaceId) {
      next = { surfaceId: surface.surfaceId, components: [], dataModel: {} };
    }
  }

  if (message.surfaceUpdate) {
    next = {
      surfaceId: message.surfaceUpdate.surfaceId,
      components: message.surfaceUpdate.components.map((component) => ({
        id: component.id,
        component: component.component,
      })),
      dataModel: next.dataModel,
    };
  }

  if (message.dataModelUpdate) {
    next = {
      ...next,
      dataModel: { ...next.dataModel, ...message.dataModelUpdate.dataModel },
    };
  }

  return next;
}

export function componentNames(components: A2UIComponent[]): ComponentName[] {
  return components.map((component) => Object.keys(component.component)[0] ?? '');
}

/** Sorted multiset of component types — used to compare generated trees. */
export function typeMultiset(components: A2UIComponent[]): string[] {
  return componentNames(components).filter(Boolean).sort();
}

export function indexComponents(components: A2UIComponent[]): Map<string, A2UIComponent> {
  return new Map(components.map((component) => [component.id, component]));
}

/** Walk a component's props and collect every primitive leaf as `path -> value`. */
export function flattenProps(
  props: unknown,
  prefix = '',
  out: Record<string, unknown> = {}
): Record<string, unknown> {
  if (Array.isArray(props)) {
    props.forEach((item, index) => flattenProps(item, `${prefix}[${index}]`, out));
    return out;
  }
  if (props && typeof props === 'object') {
    for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
      flattenProps(value, prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }
  if (prefix) out[prefix] = props;
  return out;
}

/** Numeric leaves only: the numbers a viewer would actually read off the widget. */
export function numericFields(component: A2UIComponent): Record<string, number> {
  const name = componentNames([component])[0] ?? '';
  const props = component.component[name] ?? {};
  const flat = flattenProps(props);
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(flat)) {
    // `min`/`max`/`step` describe the control's range, not a computed output.
    if (/(^|\.)(min|max|step|maxValue)$/.test(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

export type ComponentDiff = {
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: string[];
};

export function diffComponents(
  previous: A2UIComponent[],
  next: A2UIComponent[]
): ComponentDiff {
  const before = indexComponents(previous);
  const after = indexComponents(next);
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  const unchanged: string[] = [];

  for (const [id, component] of after) {
    if (!before.has(id)) {
      added.push(id);
      continue;
    }
    if (JSON.stringify(before.get(id)) !== JSON.stringify(component)) changed.push(id);
    else unchanged.push(id);
  }
  for (const id of before.keys()) {
    if (!after.has(id)) removed.push(id);
  }

  const sort = (list: string[]) => list.sort();
  return { added: sort(added), removed: sort(removed), changed: sort(changed), unchanged: sort(unchanged) };
}

/**
 * Ids whose *displayed numbers* differ between two turns, excluding the widget
 * the user touched. Proves the agent recomputed dependents instead of echoing.
 */
export function recomputedIds(
  previous: A2UIComponent[],
  next: A2UIComponent[],
  touchedId: string
): string[] {
  const before = indexComponents(previous);
  const out: string[] = [];
  for (const component of next) {
    if (component.id === touchedId) continue;
    const old = before.get(component.id);
    if (!old) continue;
    const oldNumbers = numericFields(old);
    const newNumbers = numericFields(component);
    const keys = new Set([...Object.keys(oldNumbers), ...Object.keys(newNumbers)]);
    let differs = false;
    for (const key of keys) {
      if (oldNumbers[key] !== newNumbers[key]) {
        differs = true;
        break;
      }
    }
    if (differs || JSON.stringify(old) !== JSON.stringify(component)) out.push(component.id);
  }
  return out.sort();
}

export const INJECTION_PATTERNS = ['<script', 'onclick', 'javascript:'] as const;

export function findInjection(text: string): string | null {
  const haystack = text.toLowerCase();
  for (const pattern of INJECTION_PATTERNS) {
    if (haystack.includes(pattern)) return pattern;
  }
  return null;
}
