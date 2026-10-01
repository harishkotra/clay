import type { ComponentType } from 'react';
import { type ComponentName } from '../../../shared/catalog';
import { ALLOWED_COMPONENTS, decide } from './allowlist';
import type { WidgetProps } from './types';
import Badge from '../widgets/Badge';
import BarChart from '../widgets/BarChart';
import Button from '../widgets/Button';
import Column from '../widgets/Column';
import Row from '../widgets/Row';
import Slider from '../widgets/Slider';
import Stat from '../widgets/Stat';
import Table from '../widgets/Table';
import Text from '../widgets/Text';
import Toggle from '../widgets/Toggle';

/**
 * The client allowlist. Keys are exactly the catalogued component names, so the
 * type system enforces that the renderer cannot grow a widget the agent isn't
 * allowed to ask for — and anything outside this map is rendered as unsupported.
 */
export const registry: Record<ComponentName, ComponentType<WidgetProps>> = {
  Column,
  Row,
  Text,
  Slider,
  Toggle,
  Table,
  BarChart,
  Stat,
  Badge,
  Button,
};

export type Resolved =
  | { kind: 'widget'; name: string; Widget: ComponentType<WidgetProps> }
  | { kind: 'unsupported'; name: string };

/**
 * One resolution path: the allowlist decides what may exist, the registry decides
 * which widget draws it. An off-catalog name is `unsupported`, never a guess.
 */
export function resolveComponent(name: string): Resolved {
  const decision = decide(name);
  if (decision.kind === 'unsupported') return { kind: 'unsupported', name };
  const Widget = registry[name as ComponentName];
  return Widget ? { kind: 'widget', name, Widget } : { kind: 'unsupported', name };
}

export { ALLOWED_COMPONENTS, unsupportedLabel } from './allowlist';
