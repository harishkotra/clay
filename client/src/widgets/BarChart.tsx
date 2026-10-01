import type { WidgetProps } from '../renderer/types';
import { asArray, asNumber, asString, formatNumber } from './util';

type Point = { label?: unknown; value?: unknown };

/**
 * Horizontal bars, drawn from `series` with a shared scale. Negative values are
 * handled by splitting the row at zero, so a "left of budget" bar that turns
 * negative still reads correctly instead of collapsing.
 */
export default function BarChart({ props }: WidgetProps) {
  const unit = asString(props, 'unit');
  const series = asArray<Point>(props, 'series').map((point) => ({
    label: asString(point, 'label'),
    value: asNumber(point, 'value', 0),
  }));

  if (series.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line px-3 py-4 text-xs text-mist">
        BarChart has no series to show
      </div>
    );
  }

  const declared = typeof props.maxValue === 'number' ? Math.abs(props.maxValue) : 0;
  const scale = Math.max(declared, ...series.map((point) => Math.abs(point.value)), 1);
  const currency = unit === 'INR' || unit === '₹';
  const suffix = unit && !currency ? ` ${unit}` : '';

  return (
    <div className="rounded-lg border border-line bg-ink-800/80 px-3.5 py-3">
      <div className="flex flex-col gap-2.5">
        {series.map((point, index) => {
          const width = (Math.abs(point.value) / scale) * 100;
          const negative = point.value < 0;
          return (
            <div key={`${point.label}-${index}`} className="grid grid-cols-[minmax(72px,1fr)_3fr_auto] items-center gap-3">
              <span className="truncate text-[11px] text-mist" title={point.label}>
                {point.label}
              </span>
              <span className="relative h-4 overflow-hidden rounded-sm bg-ink-700/70">
                <span
                  className="absolute inset-y-0 left-0 rounded-sm transition-[width] duration-500 ease-out"
                  style={{
                    width: `${Math.min(100, width)}%`,
                    background: negative ? 'var(--color-rose)' : 'var(--color-clay)',
                    opacity: negative ? 0.85 : 0.9 - Math.min(0.45, index * 0.05),
                  }}
                />
              </span>
              <span
                className={`font-mono text-[11px] tabular-nums ${negative ? 'text-rose' : 'text-chalk/90'}`}
              >
                {currency ? '₹' : ''}
                {formatNumber(point.value)}
                {suffix}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
