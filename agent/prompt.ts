/**
 * System prompt + JSON schema handed to the model.
 *
 * The prompt is the A2UI contract from the spec, verbatim, with `CATALOG:`
 * replaced by the JSON generated from components.ts, followed by a compact
 * JSON schema. Deliberately content-free: no example surface, so nothing the
 * model draws can be a copy of a tree we hardcoded.
 */

import { catalogJson } from './components.ts';
import { CATALOG } from '../shared/catalog.ts';
import type { SessionSurface } from '../shared/a2ui.ts';

export const SYSTEM_PROMPT = `You answer ONLY with an A2UI JSON object. Allowed top-level keys: surfaceUpdate,
dataModelUpdate, deleteSurface, text.
Use ONLY components from the catalog below. Every component id must be unique within the
surface. Any number you display must be computed from the dataModel, not hardcoded.
If the user changes a widget value, recompute every dependent component and return the
full updated component list plus dataModelUpdate.
Never emit HTML, JSX, scripts, or prose outside "text".
CATALOG: ${catalogJson}

JSON SCHEMA (the whole object is validated; anything off-catalog is rejected):
{
  "surfaceUpdate": { "surfaceId": "s1", "components": [
    { "id": "root", "component": { "Column": { "children": ["<id>", "..."] } } },
    { "id": "<id>", "component": { "<CatalogName>": { ...props } } }
  ] },
  "dataModelUpdate": { "surfaceId": "s1", "dataModel": { "<path>": <json> } },
  "deleteSurface": { "surfaceId": "s1" },
  "text": "<one short sentence, never a paragraph>"
}

SURFACE SHAPE
- Exactly one root component, a "Column" with id "root", whose children cover the
  surface. Row nests horizontally. Every id listed in children must exist.
- Every entry in "components" is an object with BOTH "id" and "component". A
  surfaceUpdate always carries the complete list: never abbreviate, never drop an
  id, never use "..." or elided entries.
- Build the richest surface the question supports: a heading, at least one
  interactive control, and at least two read-only views (Table, BarChart, Stat,
  Badge) whose numbers are derived from dataModel.
- Only emit components the catalog defines. There is no map, no image, no form
  input, no HTML, no custom widget.
- Give each surface your own surfaceId (e.g. "s1") and keep using it for
  dataModelUpdate and deleteSurface.

DATA MODEL
- dataModelUpdate.dataModel is the whole model for the surface, as plain JSON.
- Every interactive widget carries "bind": a dotted path into dataModel, and its
  "value" must equal the number or boolean stored at that path.
- Numbers shown in Table rows, BarChart series, Stat values and text must be the
  values you computed from dataModel, and they must add up.

INTERACTIONS
- An interaction arrives as a "USER EVENT" message naming componentId, its bind
  path, the new value, plus the surface and dataModel as they now stand.
- Apply the event to dataModel, recompute every dependent number (totals,
  per-item costs, chart bars, ratios), then return the FULL updated component
  list and a dataModelUpdate. Components you did not re-send keep their previous
  definition, so always re-send anything whose numbers changed.
- Recomputing only the touched widget is a failure: the widgets that depend on it
  must show the new arithmetic.

CONSTRAINTS
- No HTML, JSX, <script>, onclick, javascript:, or any URL scheme.
- "text" is at most one short sentence. Use widgets, not prose, to explain.
- Emit JSON only. No markdown fences, no commentary outside "text".`.trim();

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

const INTERACTIVE_NAMES = ['Slider', 'Toggle', 'Button'] as const;

function interactiveSummary(surface: SessionSurface): string {
  const widgets = surface.components
    .map((component) => {
      const name = Object.keys(component.component)[0] ?? '';
      const props = component.component[name] as Record<string, unknown>;
      const bind = typeof props.bind === 'string' ? ` bind="${props.bind}"` : '';
      const value = 'value' in props ? ` value=${JSON.stringify(props.value)}` : '';
      const action = typeof props.action === 'string' ? ` action="${props.action}"` : '';
      return `  ${component.id} ${name}${bind}${value}${action}`;
    })
    .join('\n');
  return widgets || '  (none)';
}

/** Turn 1..n: the user's words become a surface. */
export function buildChatMessages(
  userMessage: string,
  history: ChatMessage[] = []
): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: userMessage },
  ];
}

/**
 * A widget event. The previous surface and dataModel travel with it so the
 * model patches real arithmetic instead of inventing a fresh tree.
 */
export function buildInteractMessages(args: {
  surface: SessionSurface;
  componentId: string;
  componentName: string;
  bind: string | null;
  value: unknown;
  history?: ChatMessage[];
}): ChatMessage[] {
  const { surface, componentId, componentName, bind, value } = args;
  const event = {
    componentId,
    component: componentName,
    bind,
    value,
    surfaceId: surface.surfaceId,
  };

  const instruction = bind
    ? `Apply this event: set dataModel${bind ? `."${bind}"` : ''} to ${JSON.stringify(
        value
      )}. Then recompute every component whose numbers depend on it (totals, per-row costs, chart bars, ratios, badges, summary text) and return:
1. surfaceUpdate with the FULL updated component list (same surfaceId "${surface.surfaceId}", same ids), and
2. dataModelUpdate with the complete updated dataModel.
At least the derived widgets must contain DIFFERENT numbers than they do now. Returning the touched component alone, or returning the previous numbers, is a failure.`
    : `This event targets the "${componentName}" component "${componentId}" with value ${JSON.stringify(
        value
      )}. Decide what it means for the surface, recompute the dependent components, and return surfaceUpdate with the FULL updated component list plus dataModelUpdate for surfaceId "${surface.surfaceId}".`;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    ...(args.history ?? []),
    {
      role: 'user',
      content: `USER EVENT: ${JSON.stringify(event)}

CURRENT SURFACE (interactive widgets):
${interactiveSummary(surface)}

CURRENT DATA MODEL:
${JSON.stringify(surface.dataModel)}

${instruction}`,
    },
  ];
}

/** Used by the verifier's engineered "make it emit a bogus component" prompt. */
export const BOGUS_COMPONENT_HINT = 'HologramMap';

export function isInteractive(componentName: string): boolean {
  return (INTERACTIVE_NAMES as readonly string[]).includes(componentName);
}

export { CATALOG };
