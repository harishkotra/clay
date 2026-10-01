import { useEffect, useRef, useState } from 'react';
import type { WidgetProps } from '../renderer/types';
import { getPath } from '../../../shared/a2ui';
import { asBoolean, asString } from './util';

export default function Toggle({ componentId, props, dataModel, onEvent }: WidgetProps) {
  const label = asString(props, 'label', 'Toggle');
  const hint = asString(props, 'hint');
  const bind = asString(props, 'bind');
  const serverValue = asBoolean(props, 'value', false);
  const bound = bind ? getPath(dataModel, bind) : undefined;
  const authoritative = typeof bound === 'boolean' ? bound : serverValue;

  const [draft, setDraft] = useState<boolean | null>(null);
  const shown = draft ?? authoritative;
  const pending = useRef<boolean | null>(null);

  useEffect(() => {
    if (pending.current !== null && pending.current === authoritative) {
      pending.current = null;
      setDraft(null);
    }
  }, [authoritative]);

  const flip = () => {
    const next = !shown;
    pending.current = next;
    setDraft(next);
    onEvent(componentId, next);
  };

  return (
    <div className="rounded-lg border border-line bg-ink-800/80 px-3.5 py-3">
      <button
        type="button"
        role="switch"
        aria-checked={shown}
        onClick={flip}
        className="flex w-full items-center gap-3 text-left"
      >
        <span
          className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${
            shown ? 'border-mint/60 bg-mint/25' : 'border-line bg-ink-600'
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${
              shown ? 'left-[18px] bg-mint' : 'left-0.5 bg-mist'
            }`}
          />
        </span>
        <span className="text-xs font-medium text-chalk">{label}</span>
      </button>
      {hint ? <div className="mt-1.5 pl-12 text-[11px] leading-snug text-mist">{hint}</div> : null}
    </div>
  );
}
