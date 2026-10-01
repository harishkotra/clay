import type { WidgetProps } from '../renderer/types';
import { asIds } from './util';

const GAP: Record<string, string> = { sm: 'gap-2', md: 'gap-3', lg: 'gap-5' };
const ALIGN: Record<string, string> = { start: 'items-start', center: 'items-center', end: 'items-end' };

export default function Row({ props, renderChild }: WidgetProps) {
  const gap = GAP[String(props.gap ?? 'md')] ?? GAP.md!;
  const align = ALIGN[String(props.align ?? 'start')] ?? ALIGN.start!;
  return (
    <div className={`flex flex-wrap ${gap} ${align}`}>
      {asIds(props, 'children').map((id) => (
        <div key={id}>{renderChild(id)}</div>
      ))}
    </div>
  );
}
