import type { WidgetProps } from '../renderer/types';
import { asIds } from './util';

const GAP: Record<string, string> = { sm: 'gap-1.5', md: 'gap-3', lg: 'gap-6' };

export default function Column({ props, renderChild }: WidgetProps) {
  const gap = GAP[String(props.gap ?? 'md')] ?? GAP.md!;
  return (
    <div className={`flex w-full flex-col ${gap}`}>
      {asIds(props, 'children').map((id) => (
        <div key={id}>{renderChild(id)}</div>
      ))}
    </div>
  );
}
