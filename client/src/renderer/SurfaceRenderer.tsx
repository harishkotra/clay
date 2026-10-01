import { useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { A2UIComponent } from '../../../shared/a2ui';
import { resolveComponent } from './registry';

type Props = {
  components: A2UIComponent[];
  dataModel: Record<string, unknown>;
  onEvent: (componentId: string, value: unknown) => void;
  onUnsupported: (componentId: string, name: string) => void;
};

const MAX_DEPTH = 24;

function nameOf(component: A2UIComponent): { name: string; props: Record<string, unknown> } {
  const name = Object.keys(component.component)[0] ?? '';
  const props = (component.component as Record<string, Record<string, unknown>>)[name] ?? {};
  return { name, props };
}

/**
 * Renders the agent's component tree. Every node is resolved through the
 * allowlist in registry.ts; nothing here can execute what the model sent, and an
 * unknown component becomes a visible red card instead of a crash.
 */
export default function SurfaceRenderer({
  components,
  dataModel,
  onEvent,
  onUnsupported,
}: Props) {
  const { byId, rootId, unsupported, orphans } = useMemo(() => {
    const map = new Map<string, A2UIComponent>();
    const referenced = new Set<string>();

    for (const component of components) {
      if (map.has(component.id)) continue;
      map.set(component.id, component);
    }
    for (const component of map.values()) {
      const { props } = nameOf(component);
      const children = Array.isArray(props.children) ? (props.children as unknown[]) : [];
      for (const child of children) {
        if (typeof child === 'string') referenced.add(child);
      }
    }

    const roots = [...map.keys()].filter((id) => !referenced.has(id));
    const missing = [...referenced].filter((id) => !map.has(id));
    const refused = [...map.values()].filter((component) => {
      const { name } = nameOf(component);
      return resolveComponent(name).kind === 'unsupported';
    });
    return {
      byId: map,
      rootId: roots[0] ?? [...map.keys()][0] ?? null,
      unsupported: refused,
      orphans: missing,
    };
  }, [components]);

  // Logging is a side effect, so it runs after paint, never during render.
  useEffect(() => {
    for (const component of unsupported) {
      onUnsupported(component.id, nameOf(component).name);
    }
  }, [unsupported, onUnsupported]);

  if (!rootId) return null;

  const renderNode = (id: string, depth: number): ReactNode => {
    const component = byId.get(id);
    if (!component) {
      return (
        <div className="rounded-md border border-dashed border-line px-3 py-2 text-[11px] text-mist">
          missing component: {id}
        </div>
      );
    }

    if (depth > MAX_DEPTH) {
      return (
        <div className="rounded-md border border-amber/40 bg-ink-800 px-3 py-2 text-[11px] text-amber">
          depth limit reached at {id}
        </div>
      );
    }

    const { name, props } = nameOf(component);
    const resolved = resolveComponent(name);

    if (resolved.kind === 'unsupported') {
      return (
        <div className="rounded-md border border-[#4d2226] bg-[#251113] px-3 py-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-rose">
            UNSUPPORTED COMPONENT: {name}
          </div>
          <div className="mt-1 font-mono text-[10px] text-rose/70">
            id {component.id} · refused by the client allowlist · logged to the inspector
          </div>
        </div>
      );
    }

    const Widget = resolved.Widget;
    return (
      <Widget
        componentId={component.id}
        props={props}
        dataModel={dataModel}
        onEvent={onEvent}
        renderChild={(childId) => renderNode(childId, depth + 1)}
      />
    );
  };

  return (
    <div className="surface-enter flex flex-col gap-3" data-surface-root={rootId}>
      {renderNode(rootId, 0)}
      {orphans.length > 0 ? (
        <div className="rounded-md border border-amber/40 bg-ink-800 px-3 py-2 text-[11px] text-amber">
          {orphans.length} referenced id(s) are not in the component list: {orphans.join(', ')}
        </div>
      ) : null}
    </div>
  );
}
