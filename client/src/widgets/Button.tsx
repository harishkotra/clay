import type { WidgetProps } from '../renderer/types';
import { asString } from './util';

export default function Button({ componentId, props, onEvent }: WidgetProps) {
  const label = asString(props, 'label', 'Button');
  const action = asString(props, 'action', label);
  const tone = asString(props, 'tone', 'neutral');
  const accent =
    tone === 'bad'
      ? 'border-[#4d2226] text-rose hover:bg-[#251113]'
      : tone === 'good'
        ? 'border-[#1f4438] text-mint hover:bg-[#0f271f]'
        : 'border-line text-chalk hover:bg-ink-700';

  return (
    <button
      type="button"
      onClick={() => onEvent(componentId, action)}
      className={`rounded-md border bg-ink-800/70 px-3 py-1.5 text-xs font-medium transition-colors ${accent}`}
    >
      {label}
    </button>
  );
}
