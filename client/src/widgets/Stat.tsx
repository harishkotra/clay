import type { WidgetProps } from '../renderer/types';
import { asString, formatWithUnit, toneColor } from './util';

export default function Stat({ props }: WidgetProps) {
  const label = asString(props, 'label');
  const raw = props.value;
  const value = typeof raw === 'number' || typeof raw === 'string' ? raw : String(raw ?? '');
  const unit = typeof props.unit === 'string' ? props.unit : undefined;
  const hint = asString(props, 'hint');
  const tone = toneColor(asString(props, 'tone', 'neutral'));

  return (
    <div className="min-w-[132px] flex-1 rounded-lg border border-line bg-ink-800/80 px-3.5 py-3">
      <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">{label}</div>
      <div className="mt-1.5 font-mono text-[22px] leading-none tabular-nums" style={{ color: tone }}>
        {formatWithUnit(value, unit)}
      </div>
      {hint ? <div className="mt-1.5 text-[11px] leading-snug text-mist">{hint}</div> : null}
    </div>
  );
}
