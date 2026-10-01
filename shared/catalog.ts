/**
 * A2UI component catalog — the single source of truth.
 *
 * The server validates model output against these names (agent/components.ts),
 * the client renders only these names (client/src/renderer/registry.ts), and
 * this exact object is injected into the system prompt as `CATALOG:`. Keeping it
 * free of zod and React means all three can import it without pulling runtime
 * weight into the browser.
 */

export type PropDoc = {
  type: string;
  required: boolean;
  doc: string;
};

export type ComponentDoc = {
  description: string;
  interactive: boolean;
  props: Record<string, PropDoc>;
};

export const TONE = ['neutral', 'good', 'warn', 'bad', 'info'] as const;

export const COMPONENT_NAMES = [
  'Column',
  'Row',
  'Text',
  'Slider',
  'Toggle',
  'Table',
  'BarChart',
  'Stat',
  'Badge',
  'Button',
] as const;

export type ComponentName = (typeof COMPONENT_NAMES)[number];

export const CATALOG: Record<ComponentName, ComponentDoc> = {
  Column: {
    description: 'Vertical stack. The surface must have exactly one root Column.',
    interactive: false,
    props: {
      children: { type: 'string[]', required: true, doc: 'ids of child components, in render order' },
      gap: { type: "'sm'|'md'|'lg'", required: false, doc: 'vertical spacing' },
    },
  },
  Row: {
    description: 'Horizontal stack, for laying out Stats, Badges and Buttons side by side.',
    interactive: false,
    props: {
      children: { type: 'string[]', required: true, doc: 'ids of child components, in render order' },
      gap: { type: "'sm'|'md'|'lg'", required: false, doc: 'horizontal spacing' },
      align: { type: "'start'|'center'|'end'", required: false, doc: 'cross-axis alignment' },
    },
  },
  Text: {
    description: 'A line of text. Use for headings, captions and the one-line summary.',
    interactive: false,
    props: {
      text: { type: 'string', required: true, doc: 'plain text only, no markup' },
      variant: {
        type: "'h1'|'h2'|'h3'|'body'|'muted'|'mono'",
        required: false,
        doc: 'typographic role',
      },
    },
  },
  Slider: {
    description:
      'Numeric drag control. `bind` is a dotted path into the dataModel. Emitting a Slider means the user can move it and you will recompute everything derived from it.',
    interactive: true,
    props: {
      label: { type: 'string', required: true, doc: 'field label' },
      min: { type: 'number', required: true, doc: 'lowest allowed value' },
      max: { type: 'number', required: true, doc: 'highest allowed value' },
      step: { type: 'number', required: true, doc: 'snap increment' },
      value: { type: 'number', required: true, doc: 'current value, must equal dataModel[bind]' },
      bind: { type: 'string', required: true, doc: 'dotted dataModel path this control writes to' },
      unit: { type: 'string', required: false, doc: 'suffix shown next to the value, e.g. INR, kg, %' },
    },
  },
  Toggle: {
    description: 'Boolean switch bound to a dataModel path.',
    interactive: true,
    props: {
      label: { type: 'string', required: true, doc: 'field label' },
      value: { type: 'boolean', required: true, doc: 'current state, must equal dataModel[bind]' },
      bind: { type: 'string', required: true, doc: 'dotted dataModel path this control writes to' },
      hint: { type: 'string', required: false, doc: 'short helper line' },
    },
  },
  Table: {
    description:
      'Rows of primitives. Every cell value must be derived from the dataModel — rows are objects keyed by column.key.',
    interactive: false,
    props: {
      columns: {
        type: '{ key: string; label: string; align?: "start"|"end"|"center" }[]',
        required: true,
        doc: 'column definitions',
      },
      rows: {
        type: 'Record<string, string|number|boolean>[]',
        required: true,
        doc: 'one object per row, keyed by column.key',
      },
      caption: { type: 'string', required: false, doc: 'label above the table' },
    },
  },
  BarChart: {
    description: 'Horizontal bars drawn by the client. Values are plain numbers.',
    interactive: false,
    props: {
      series: {
        type: '{ label: string; value: number }[]',
        required: true,
        doc: 'one entry per bar',
      },
      unit: { type: 'string', required: false, doc: 'suffix for value labels' },
      maxValue: { type: 'number', required: false, doc: 'explicit scale, defaults to max(series.value)' },
    },
  },
  Stat: {
    description: 'Big number with a label. The place to show a computed total or a rate.',
    interactive: false,
    props: {
      label: { type: 'string', required: true, doc: 'what the number means' },
      value: { type: 'string|number', required: true, doc: 'the computed number' },
      unit: { type: 'string', required: false, doc: 'suffix' },
      hint: { type: 'string', required: false, doc: 'second line, e.g. "was 8,000"' },
      tone: { type: TONE.join('|'), required: false, doc: 'accent colour' },
    },
  },
  Badge: {
    description: 'Small pill for a status or tag.',
    interactive: false,
    props: {
      text: { type: 'string', required: true, doc: 'label inside the pill' },
      tone: { type: TONE.join('|'), required: false, doc: 'accent colour' },
    },
  },
  Button: {
    description:
      'Pressing it sends an interaction event whose value is `action`. Use for "recompute", "next option", "add a day".',
    interactive: true,
    props: {
      label: { type: 'string', required: true, doc: 'button caption' },
      action: { type: 'string', required: true, doc: 'event value sent back to the agent' },
      tone: { type: TONE.join('|'), required: false, doc: 'accent colour' },
    },
  },
} as const;

/** JSON injected verbatim after the system prompt as `CATALOG:`. */
export const CATALOG_JSON = JSON.stringify(CATALOG);

export const ROOT_ID = 'root';
