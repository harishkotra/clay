import type { WidgetProps } from '../renderer/types';
import { asString } from './util';

const VARIANTS: Record<string, { tag: 'h1' | 'h2' | 'h3' | 'p'; className: string }> = {
  h1: { tag: 'h1', className: 'text-2xl font-semibold tracking-tight text-chalk' },
  h2: { tag: 'h2', className: 'text-lg font-semibold tracking-tight text-chalk' },
  h3: { tag: 'h3', className: 'text-sm font-semibold uppercase tracking-[0.14em] text-mist' },
  body: { tag: 'p', className: 'text-sm leading-relaxed text-chalk/90' },
  muted: { tag: 'p', className: 'text-xs leading-relaxed text-mist' },
  mono: { tag: 'p', className: 'font-mono text-xs text-chalk/80' },
};

export default function Text({ props }: WidgetProps) {
  const variant = VARIANTS[String(props.variant ?? 'body')] ?? VARIANTS.body!;
  const text = asString(props, 'text');
  const Tag = variant.tag;
  return <Tag className={variant.className}>{text}</Tag>;
}
