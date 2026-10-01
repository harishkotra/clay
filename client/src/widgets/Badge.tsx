import type { WidgetProps } from '../renderer/types';
import { asString, toneClasses } from './util';

export default function Badge({ props }: WidgetProps) {
  const text = asString(props, 'text');
  const tone = asString(props, 'tone', 'neutral');
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${toneClasses(tone)}`}
    >
      {text}
    </span>
  );
}
