import { useEffect, useRef, useState } from 'react';
import type { WidgetProps } from '../renderer/types';
import { getPath } from '../../../shared/a2ui';
import { asNumber, asString, formatNumber } from './util';

/**
 * The slider is the one widget that must feel immediate *and* honest: dragging
 * moves the thumb and its own number locally, then commits a single event so the
 * agent can recompute everything that depends on this value. The committed value
 * is what the server writes into `bind`, so the drag can never desync the model.
 */
export default function Slider({ componentId, props, dataModel, onEvent }: WidgetProps) {
  const label = asString(props, 'label', 'Value');
  const min = asNumber(props, 'min', 0);
  const max = asNumber(props, 'max', 100);
  const step = asNumber(props, 'step', 1);
  const unit = asString(props, 'unit');
  const bind = asString(props, 'bind');

  const serverValue = asNumber(props, 'value', min);
  const bound = bind ? getPath(dataModel, bind) : undefined;
  const authoritative = typeof bound === 'number' ? bound : serverValue;

  const [draft, setDraft] = useState<number | null>(null);
  const dragging = draft !== null;
  const shown = draft ?? authoritative;
  const pending = useRef<number | null>(null);

  // When the agent's answer arrives, the draft is dropped and the shown value
  // snaps to whatever the data model now says.
  useEffect(() => {
    if (pending.current !== null && pending.current === authoritative) {
      pending.current = null;
      setDraft(null);
    }
  }, [authoritative]);

  const percent = max > min ? ((shown - min) / (max - min)) * 100 : 0;

  const commit = (value: number) => {
    pending.current = value;
    setDraft(null);
    onEvent(componentId, value);
  };

  return (
    <div className="w-full min-w-[240px] flex-1 rounded-lg border border-line bg-ink-800/80 px-3.5 py-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">{label}</span>
        <span
          className={`font-mono text-sm tabular-nums ${dragging ? 'text-clay' : 'text-chalk'}`}
        >
          {unit === 'INR' ? '₹' : ''}
          {formatNumber(shown)}
          {unit && unit !== 'INR' ? ` ${unit}` : ''}
        </span>
      </div>
      <input
        type="range"
        className="mt-3 w-full"
        min={min}
        max={max}
        step={step}
        value={shown}
        aria-label={label}
        style={{
          background: `linear-gradient(to right, var(--color-clay) ${percent}%, var(--color-ink-600) ${percent}%)`,
        }}
        onChange={(event) => setDraft(Number(event.target.value))}
        onPointerUp={() => {
          if (draft !== null) commit(draft);
        }}
        onKeyUp={() => {
          if (draft !== null) commit(draft);
        }}
        onBlur={() => {
          if (draft !== null && draft !== authoritative) commit(draft);
        }}
      />
      <div className="mt-1.5 flex justify-between font-mono text-[10px] text-mist/70">
        <span>{unit === 'INR' ? '₹' : ''}{formatNumber(min)}</span>
        <span>{dragging ? 'release to recompute' : `${bind || 'static'}`}</span>
        <span>{unit === 'INR' ? '₹' : ''}{formatNumber(max)}</span>
      </div>
    </div>
  );
}
