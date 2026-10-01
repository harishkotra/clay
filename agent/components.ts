/**
 * The allowlisted component catalog, as zod schemas.
 *
 * Two jobs:
 *  - `catalogJson` is injected verbatim into the system prompt as `CATALOG:`.
 *  - `validateA2UI` is the guardrail. It never repairs: an unknown component
 *    name, an off-catalog prop, a broken tree or an injection pattern comes
 *    back as `{ error: "invalid_surface", detail, raw }`.
 */

import { z } from 'zod';
import { CATALOG, COMPONENT_NAMES, type ComponentName } from '../shared/catalog.ts';
import { findInjection, getPath, type A2UIResponse } from '../shared/a2ui.ts';

const idSchema = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/, 'id must be a simple slug');

const toneSchema = z.enum(['neutral', 'good', 'warn', 'bad', 'info']);
const gapSchema = z.enum(['sm', 'md', 'lg']);

export const columnSchema = z
  .strictObject({
    children: z.array(idSchema).min(1).max(40),
    gap: gapSchema.optional(),
  })
  .describe('vertical stack of other components');

export const rowSchema = z
  .strictObject({
    children: z.array(idSchema).min(1).max(12),
    gap: gapSchema.optional(),
    align: z.enum(['start', 'center', 'end']).optional(),
  })
  .describe('horizontal group, for stats, badges and buttons side by side');

export const textSchema = z.strictObject({
  text: z.string().min(1).max(600),
  variant: z.enum(['h1', 'h2', 'h3', 'body', 'muted', 'mono']).optional(),
});

export const sliderSchema = z.strictObject({
  label: z.string().min(1).max(60),
  min: z.number(),
  max: z.number(),
  step: z.number().positive(),
  value: z.number(),
  bind: z.string().min(1).max(60),
  unit: z.string().min(1).max(12).optional(),
}).superRefine((value, ctx) => {
  if (value.max <= value.min) {
    ctx.addIssue({ code: 'custom', message: 'max must be greater than min', path: ['max'] });
  }
  if (value.value < value.min || value.value > value.max) {
    ctx.addIssue({ code: 'custom', message: 'value must sit inside [min, max]', path: ['value'] });
  }
});

export const toggleSchema = z.strictObject({
  label: z.string().min(1).max(60),
  value: z.boolean(),
  bind: z.string().min(1).max(60),
  hint: z.string().max(120).optional(),
});

const cellSchema = z.union([z.string().max(120), z.number(), z.boolean()]);

export const tableSchema = z.strictObject({
  columns: z
    .array(
      z.strictObject({
        key: z.string().min(1).max(40),
        label: z.string().min(1).max(60),
        align: z.enum(['start', 'end', 'center']).optional(),
      })
    )
    .min(1)
    .max(10),
  rows: z.array(z.record(z.string(), cellSchema)).min(1).max(60),
  caption: z.string().max(80).optional(),
});

export const barChartSchema = z.strictObject({
  series: z
    .array(
      z.strictObject({
        label: z.string().min(1).max(60),
        value: z.number().finite(),
      })
    )
    .min(1)
    .max(40),
  unit: z.string().min(1).max(12).optional(),
  maxValue: z.number().finite().positive().optional(),
});

export const statSchema = z.strictObject({
  label: z.string().min(1).max(60),
  value: z.union([z.string().max(40), z.number().finite()]),
  unit: z.string().min(1).max(12).optional(),
  hint: z.string().max(120).optional(),
  tone: toneSchema.optional(),
});

export const badgeSchema = z.strictObject({
  text: z.string().min(1).max(60),
  tone: toneSchema.optional(),
});

export const buttonSchema = z.strictObject({
  label: z.string().min(1).max(60),
  action: z.string().min(1).max(60),
  tone: toneSchema.optional(),
});

/** name -> props schema, kept in lockstep with shared/catalog.ts. */
export const PROP_SCHEMAS = {
  Column: columnSchema,
  Row: rowSchema,
  Text: textSchema,
  Slider: sliderSchema,
  Toggle: toggleSchema,
  Table: tableSchema,
  BarChart: barChartSchema,
  Stat: statSchema,
  Badge: badgeSchema,
  Button: buttonSchema,
} as const satisfies Record<ComponentName, z.ZodType>;

export type PropsFor<N extends ComponentName> = z.infer<(typeof PROP_SCHEMAS)[N]>;

/**
 * A component body is exactly one catalogued key. `z.strictObject` on each
 * variant means an unknown name such as `HologramMap` fails here with a path
 * that names the offending component, which is what the inspector shows.
 */
export const componentBodySchema = z.union(
  COMPONENT_NAMES.map((name) => z.strictObject({ [name]: PROP_SCHEMAS[name] }) as never),
  'Please select the valid component'
);

export const componentSchema = z.strictObject({
  id: idSchema,
  component: componentBodySchema,
});

export type ValidatedComponent = z.infer<typeof componentSchema>;

const dataModelSchema = z.record(z.string(), z.unknown());

export const surfaceUpdateSchema = z.strictObject({
  surfaceId: z.string().min(1).max(64),
  components: z.array(componentSchema).min(1).max(64),
});

export const dataModelUpdateSchema = z.strictObject({
  surfaceId: z.string().min(1).max(64),
  dataModel: dataModelSchema,
});

export const deleteSurfaceSchema = z.strictObject({
  surfaceId: z.string().min(1).max(64),
});

/** The A2UI JSON schema, expressed in zod and also handed to the model as text. */
export const a2uiResponseSchema = z
  .strictObject({
    surfaceUpdate: surfaceUpdateSchema.optional(),
    dataModelUpdate: dataModelUpdateSchema.optional(),
    deleteSurface: deleteSurfaceSchema.optional(),
    text: z.string().max(600).optional(),
  })
  .superRefine((value, ctx) => {
    const hasAnything = value.surfaceUpdate || value.dataModelUpdate || value.deleteSurface;
    if (!hasAnything && !value.text) {
      ctx.addIssue({
        code: 'custom',
        message: 'an A2UI message must carry a surface payload or text',
      });
    }

    if (!value.surfaceUpdate) return;
    const components = value.surfaceUpdate.components;
    const ids = components.map((component) => component.id);
    const seen = new Set<string>();
    for (const component of components) {
      if (seen.has(component.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate component id "${component.id}"`,
          path: ['surfaceUpdate', 'components'],
        });
      }
      seen.add(component.id);
    }

    // The tree must be linked: every child id exists and nothing but the root
    // is unreferenced. A dangling child is a rendering hole, so it is rejected.
    const referenced = new Set<string>();
    for (const component of components) {
      const name = Object.keys(component.component)[0] ?? '';
      const props = (component.component as Record<string, { children?: string[] } | undefined>)[
        name
      ];
      for (const child of props?.children ?? []) {
        if (!ids.includes(child)) {
          ctx.addIssue({
            code: 'custom',
            message: `children references missing id "${child}"`,
            path: ['surfaceUpdate', 'components', ids.indexOf(component.id), 'component', name, 'children'],
          });
        }
        if (referenced.has(child)) {
          ctx.addIssue({
            code: 'custom',
            message: `id "${child}" is mounted twice; the surface must be a tree`,
            path: ['surfaceUpdate', 'components', ids.indexOf(component.id), 'component', name, 'children'],
          });
        }
        referenced.add(child);
      }
    }
    const roots = ids.filter((id) => !referenced.has(id));
    if (roots.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        message: `expected exactly one root component, found ${roots.length} (${roots.join(', ') || 'none'})`,
        path: ['surfaceUpdate', 'components'],
      });
    }
  });

export type A2UIMessage = z.infer<typeof a2uiResponseSchema>;

export type Guardrail =
  | { ok: true; message: A2UIResponse }
  | { ok: false; detail: string; raw: string };

/** Human-readable path for the first zod issue, e.g. `surfaceUpdate.components[3].component.Slider.step`. */
function issuePath(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'unknown';
  const path = issue.path.map((segment) =>
    typeof segment === 'number' ? `[${segment}]` : `.${String(segment)}`
  );
  const joined = path.join('').replace(/^\./, '');
  return `${joined || '<root>'}: ${issue.message}`;
}

/**
 * Classify a raw model reply before the full guardrail runs.
 *
 * The distinction matters for the agent loop:
 *  - `malformed` — the emission itself is broken (truncated JSON, a component
 *    entry with no id). Re-asking the model is legitimate; nothing is invented.
 *  - `rejected`  — the model wrote well-formed JSON that the catalog forbids
 *    (unknown component name, off-catalog prop, injection pattern). That is the
 *    guardrail's verdict and is reported as-is, never retried, never repaired.
 */
export type Emission =
  | { kind: 'ok'; message: A2UIResponse }
  | { kind: 'malformed'; detail: string }
  | { kind: 'rejected'; detail: string };

export function classifyEmission(rawText: string): Emission {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (cause) {
    return {
      kind: 'malformed',
      detail: `response is not JSON (${String((cause as Error)?.message ?? cause).slice(0, 160)})`,
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'rejected', detail: '<root>: expected a JSON object' };
  }

  const injection = findInjection(rawText);
  if (injection) {
    return {
      kind: 'rejected',
      detail: `forbidden markup pattern "${injection}"`,
    };
  }

  const surface = (parsed as { surfaceUpdate?: { components?: unknown } }).surfaceUpdate;
  if (surface && Array.isArray(surface.components)) {
    for (const [index, entry] of (surface.components as unknown[]).entries()) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return { kind: 'malformed', detail: `surfaceUpdate.components[${index}]: not an object` };
      }
      const record = entry as Record<string, unknown>;
      if (typeof record.id !== 'string' || record.id.length === 0) {
        return {
          kind: 'malformed',
          detail: `surfaceUpdate.components[${index}].id: missing component id`,
        };
      }
      const body = record.component;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { kind: 'malformed', detail: `surfaceUpdate.components[${index}].component: missing` };
      }
      const keys = Object.keys(body);
      if (keys.length !== 1) {
        // Two components in one body, or none, is a formatting slip rather than a
        // request for something off-catalog: re-ask.
        return {
          kind: 'malformed',
          detail: `surfaceUpdate.components[${index}].component: expected exactly one component, got ${keys.length}`,
        };
      }
      const name = keys[0] as string;
      if (!(name in PROP_SCHEMAS)) {
        return {
          kind: 'rejected',
          detail: `surfaceUpdate.components[${index}].component.${name}: "${name}" is not a known component`,
        };
      }

      // A slider whose value sits outside its own declared range is not a
      // catalog violation, it is a self-inconsistent emission: the model had a
      // slip, so it gets asked again rather than the whole surface being refused.
      if (name === 'Slider') {
        const slider = (body as Record<string, Record<string, unknown>>).Slider ?? {};
        const { min, max, value } = slider;
        if (
          typeof min === 'number' &&
          typeof max === 'number' &&
          typeof value === 'number' &&
          (value < min || value > max)
        ) {
          return {
            kind: 'malformed',
            detail: `surfaceUpdate.components[${index}].component.Slider.value: ${value} is outside the slider's own range [${min}, ${max}]`,
          };
        }
      }
    }
  }

  const result = a2uiResponseSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    // A prop the schema does not know, a missing prop, or a component body that
    // matches no variant is the model fumbling JSON — an emission defect, so the
    // loop asks again. Anything reported by superRefine (duplicate id, dangling
    // child, two roots, a bind with no data behind it) is a contract violation
    // and stays final.
    const defectCodes = new Set(['unrecognized_keys', 'invalid_type', 'invalid_union']);
    return {
      kind: defectCodes.has(String(issue?.code)) ? 'malformed' : 'rejected',
      detail: issuePath(result.error),
    };
  }

  const message = result.data as A2UIResponse;

  // A Slider must be able to write where it claims to bind, otherwise the
  // interaction is a no-op and the live data model is a lie.
  const dataModel = message.dataModelUpdate?.dataModel;
  if (message.surfaceUpdate && dataModel) {
    for (const component of message.surfaceUpdate.components) {
      const name = Object.keys(component.component)[0] ?? '';
      if (name !== 'Slider' && name !== 'Toggle') continue;
      const props = (component.component as Record<string, { bind?: string; value?: unknown }>)[name];
      if (!props?.bind) continue;
      if (getPath(dataModel as Record<string, unknown>, props.bind) === undefined) {
        // Internally inconsistent, not off-catalog: the widget points at a path
        // the model did not write. Asking again fixes it; refusing would not.
        return {
          kind: 'malformed',
          detail: `surfaceUpdate.components.${component.id}.component.${name}.bind: "${props.bind}" is not present in dataModelUpdate.dataModel`,
        };
      }
    }
  }

  return { kind: 'ok', message };
}

/**
 * Parse + guardrail a raw model response. `rawText` is the untouched model
 * output, quoted back to the inspector on failure (first 300 chars).
 */
export function validateA2UI(rawText: string): Guardrail {
  const emission = classifyEmission(rawText);
  if (emission.kind === 'ok') return { ok: true, message: emission.message };
  return { ok: false, detail: emission.detail, raw: rawText.slice(0, 300) };
}

/** The catalog JSON appended to the system prompt. */
export const catalogJson = JSON.stringify(CATALOG);

export { CATALOG, COMPONENT_NAMES };
