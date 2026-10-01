import type { ReactNode } from 'react';

/**
 * Every widget gets the same shape: its catalog props, the live data model, the
 * event callback, and the renderer's child hook. Nothing else — a widget cannot
 * reach the network or invent a component.
 */
export type WidgetProps = {
  componentId: string;
  props: Record<string, unknown>;
  dataModel: Record<string, unknown>;
  onEvent: (componentId: string, value: unknown) => void;
  renderChild: (id: string) => ReactNode;
};
