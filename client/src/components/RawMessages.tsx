import { useMemo, useState } from 'react';
import { diffComponents, type A2UIComponent, type TurnRecord } from '../../../shared/a2ui';
import type { UnsupportedLog } from '../hooks/useSurface';

type Props = {
  turns: TurnRecord[];
  unsupported: UnsupportedLog[];
};

type Tab = 'raw' | 'diff' | 'rejected';

function componentsOf(turn: TurnRecord | undefined): A2UIComponent[] {
  return turn?.emitted?.surfaceUpdate?.components ?? [];
}

function StatusChip({ status }: { status: TurnRecord['status'] }) {
  const map = {
    ok: 'border-mint/40 bg-mint/10 text-mint',
    invalid_surface: 'border-rose/40 bg-rose/10 text-rose',
    error: 'border-amber/40 bg-amber/10 text-amber',
  } as const;
  return (
    <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${map[status]}`}>
      {status}
    </span>
  );
}

/**
 * The inspector shows the protocol, not a summary of it: the exact JSON the agent
 * emitted for each turn, what changed relative to the previous turn, and every
 * component that was refused — server-side or client-side.
 */
export default function RawMessages({ turns, unsupported }: Props) {
  const [tab, setTab] = useState<Tab>('raw');
  const [selected, setSelected] = useState<number | null>(null);

  const index = selected ?? Math.max(0, turns.length - 1);
  const turn = turns[index];
  const previous = turns[index - 1];
  const diff = useMemo(
    () => diffComponents(componentsOf(previous), componentsOf(turn)),
    [previous, turn]
  );

  if (!turn) {
    return (
      <div className="flex h-full items-center justify-center border-t border-line bg-ink-850 px-6">
        <p className="max-w-md text-center text-[11px] leading-relaxed text-mist">
          Raw A2UI messages appear here per turn: the exact JSON the agent emitted, the diff against
          the previous turn, and anything the guardrail refused.
        </p>
      </div>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col border-t border-line bg-ink-850">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">
          raw messages
        </span>
        <div className="flex flex-wrap items-center gap-1">
          {turns.map((entry, position) => (
            <button
              key={position}
              type="button"
              onClick={() => setSelected(position)}
              className={`rounded border px-2 py-1 font-mono text-[10px] ${
                position === index
                  ? 'border-clay/60 bg-clay/15 text-chalk'
                  : 'border-line bg-ink-800 text-mist hover:text-chalk'
              } ${entry.status === 'invalid_surface' ? 'ring-1 ring-rose/30' : ''}`}
              title={`${entry.kind}: ${entry.input}`}
            >
              {entry.kind === 'chat' ? 'T' : 'I'}
              {position}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1">
          {(['raw', 'diff', 'rejected'] as Tab[]).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setTab(name)}
              className={`rounded px-2.5 py-1 text-[11px] capitalize ${
                tab === name ? 'bg-ink-600 text-chalk' : 'text-mist hover:text-chalk'
              }`}
            >
              {name}
              {name === 'rejected' && (turn.rejected.length > 0 || unsupported.length > 0) ? (
                <span className="ml-1 text-rose">{turn.rejected.length + unsupported.length}</span>
              ) : null}
            </button>
          ))}
        </div>
      </header>

      <div className="flex items-center gap-3 border-b border-line/70 px-3 py-2 text-[11px] text-mist">
        <StatusChip status={turn.status} />
        <span className="font-mono">{turn.kind}</span>
        <span className="truncate font-mono text-chalk/80">{turn.input}</span>
        {turn.attempts && turn.attempts > 1 ? (
          <span className="rounded bg-amber/10 px-1.5 py-0.5 font-mono text-[10px] text-amber">
            {turn.attempts} attempts
          </span>
        ) : null}
        {turn.recomputed.length > 0 ? (
          <span className="truncate font-mono text-[10px] text-mint">
            recomputed: {turn.recomputed.join(', ')}
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        {tab === 'raw' ? (
          <pre className="whitespace-pre-wrap px-3.5 py-3 font-mono text-[11px] leading-relaxed text-chalk/85">
            {turn.raw || '(empty)'}
          </pre>
        ) : null}

        {tab === 'diff' ? (
          <div className="grid gap-3 px-3.5 py-3 text-[11px]">
            {index === 0 ? (
              <p className="text-mist">First turn — nothing to diff against yet.</p>
            ) : (
              <>
                <DiffRow label="added" ids={diff.added} tone="text-mint" />
                <DiffRow label="changed" ids={diff.changed} tone="text-amber" />
                <DiffRow label="removed" ids={diff.removed} tone="text-rose" />
                <DiffRow label="unchanged" ids={diff.unchanged} tone="text-mist" muted />
                <p className="mt-1 leading-relaxed text-mist">
                  {index - 1}→{index}: {componentsOf(previous).length} →{' '}
                  {componentsOf(turn).length} components. A widget event that only changes the
                  touched component would show an empty <span className="text-amber">changed</span>{' '}
                  row.
                </p>
              </>
            )}
            {turn.detail ? (
              <p className="mt-1 rounded border border-line bg-ink-800 p-2 font-mono text-[10px] text-rose">
                {turn.detail}
              </p>
            ) : null}
          </div>
        ) : null}

        {tab === 'rejected' ? (
          <div className="flex flex-col gap-2 px-3.5 py-3">
            {turn.rejected.length === 0 && unsupported.length === 0 ? (
              <p className="text-[11px] text-mist">
                Nothing refused. The guardrail rejects unknown component names, off-catalog props,
                broken trees and markup patterns.
              </p>
            ) : null}
            {turn.rejected.map((entry, position) => (
              <div
                key={`${entry.path}-${position}`}
                className="rounded-md border border-[#4d2226] bg-[#251113] px-3 py-2"
              >
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-rose">
                  rejected: {entry.name}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-rose/80">{entry.path}</div>
                {turn.detail ? (
                  <div className="mt-1 font-mono text-[10px] text-mist">{turn.detail}</div>
                ) : null}
              </div>
            ))}
            {unsupported.map((entry) => (
              <div
                key={`${entry.componentId}-client`}
                className="rounded-md border border-[#4d2226] bg-[#251113] px-3 py-2"
              >
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-rose">
                  UNSUPPORTED COMPONENT: {entry.name}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-rose/80">
                  client allowlist · component id {entry.componentId} · refused in the renderer, not
                  rendered
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function DiffRow({ label, ids, tone, muted }: { label: string; ids: string[]; tone: string; muted?: boolean }) {
  return (
    <div className="flex gap-3">
      <span className={`w-20 shrink-0 font-mono text-[10px] uppercase tracking-wider ${tone}`}>
        {label}
      </span>
      <span className={`font-mono text-[11px] ${muted ? 'text-mist' : 'text-chalk/90'}`}>
        {ids.length === 0 ? '—' : `${ids.length}: ${ids.join(', ')}`}
      </span>
    </div>
  );
}
