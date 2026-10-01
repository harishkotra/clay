import { useEffect, useRef, useState } from 'react';
import RawMessages from './components/RawMessages';
import Settings from './components/Settings';
import { useSurface } from './hooks/useSurface';
import SurfaceRenderer from './renderer/SurfaceRenderer';
import { CATALOG, COMPONENT_NAMES } from '../../shared/catalog';

const SUGGESTIONS = [
  'Plan a 5-day trip to Kerala under 40000 rupees, with a per-day cost breakdown',
  'Explain this dataset: 12 months of revenue, 8% growth, one outlier in March',
  'Compare three laptop configurations under 120000 INR for video editing',
];

const PHRASE: Record<string, string> = {
  thinking: 'thinking',
  emitting: 'emitting surface',
  patching: 'patching',
};

export default function App() {
  const clay = useSurface();
  const [draft, setDraft] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' });
  }, [clay.entries, clay.phase]);

  const submit = (message: string) => {
    if (!message.trim() || clay.phase === 'thinking' || clay.phase === 'emitting') return;
    clay.send(message);
    setDraft('');
  };

  const hasSurface = clay.components.length > 0;
  const needsKey = clay.error?.error === 'no_api_key';

  return (
    <div className="flex h-full flex-col bg-ink-900">
      <header className="flex items-center gap-4 border-b border-line bg-ink-850/90 px-4 py-2.5">
        <div className="flex items-baseline gap-2.5">
          <span className="text-sm font-semibold tracking-[0.22em] text-chalk">CLAY</span>
          <span className="text-[11px] text-mist">agent-to-UI surfaces, not paragraphs</span>
        </div>

        <div className="ml-auto flex items-center gap-2 text-[11px]">
          <button
            type="button"
            onClick={() => setShowCatalog((open) => !open)}
            className="rounded-md border border-line bg-ink-800 px-2.5 py-1 text-mist hover:text-chalk"
          >
            catalog
          </button>
          <span
            className={`rounded-md border px-2.5 py-1 font-mono ${
              clay.health ? 'border-mint/40 bg-mint/10 text-mint' : 'border-rose/40 bg-rose/10 text-rose'
            }`}
            title={clay.health ? JSON.stringify(clay.health) : 'agent runtime unreachable'}
          >
            {clay.health ? `runtime: ${clay.health.runtime}` : 'runtime: offline'}
          </span>
          <span className="hidden rounded-md border border-line bg-ink-800 px-2.5 py-1 font-mono text-mist md:inline">
            {clay.health?.model ?? (clay.settings.model || 'model: —')}
          </span>
          <span className="hidden rounded-md border border-line bg-ink-800 px-2.5 py-1 font-mono text-mist lg:inline">
            session {clay.sessionId}
          </span>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="rounded-md border border-line bg-ink-800 px-2.5 py-1 text-mist hover:text-chalk"
          >
            settings
          </button>
          <button
            type="button"
            onClick={() => void clay.reset()}
            className="rounded-md border border-line bg-ink-800 px-2.5 py-1 text-mist hover:text-chalk"
            title="new session id, empty surface"
          >
            reset
          </button>
        </div>
      </header>

      {showCatalog ? <CatalogStrip onClose={() => setShowCatalog(false)} /> : null}

      {needsKey ? (
        <div className="flex items-center gap-3 border-b border-rose/40 bg-[#251113] px-4 py-2 text-xs text-rose">
          <span className="font-semibold uppercase tracking-wider">no_api_key</span>
          <span className="text-rose/90">
            Neither Settings nor the server&apos;s .env supplied an inference key. Open settings and
            paste one, or set OPENAI_API_KEY in .env.
          </span>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="ml-auto rounded border border-rose/50 px-2 py-1 text-[11px] text-rose hover:bg-rose/10"
          >
            open settings
          </button>
        </div>
      ) : null}

      {!clay.health ? (
        <div className="border-b border-amber/40 bg-[#241d0c] px-4 py-2 text-[11px] text-amber">
          /api/health is not answering — start the agent runtime with{' '}
          <span className="font-mono">npm run dev</span> (workers on :8787, or{' '}
          <span className="font-mono">RUNTIME=node</span> on :3001).
        </div>
      ) : null}

      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(320px,380px)_1fr]">
        <section className="flex min-h-0 flex-col border-r border-line bg-ink-850">
          <div className="flex items-center justify-between border-b border-line px-4 py-2">
            <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">
              conversation
            </span>
            <span className="font-mono text-[10px] text-mist">{clay.turns.length} turns</span>
          </div>

          <div ref={log} className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-4 scrollbar-thin">
            {clay.entries.length === 0 ? (
              <div className="space-y-4">
                <p className="text-xs leading-relaxed text-mist">
                  Ask for a plan. Clay answers with a live surface: the model emits a declarative
                  component tree, the client renders it as working widgets, and every interaction goes
                  back to the agent, which recomputes the dependent numbers.
                </p>
                <div className="space-y-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => submit(suggestion)}
                      className="block w-full rounded-md border border-line bg-ink-800 px-3 py-2 text-left text-[11px] leading-relaxed text-chalk/80 hover:border-clay/50 hover:text-chalk"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {clay.entries.map((entry) =>
              entry.role === 'user' ? (
                <div key={entry.id} className="rounded-lg border border-line bg-ink-800 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-mist">you</div>
                  <div className="mt-1 text-xs leading-relaxed text-chalk/90">{entry.text}</div>
                </div>
              ) : (
                <div key={entry.id} className="rounded-lg border border-line/70 bg-ink-900/60 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-[0.16em] text-clay">clay</span>
                    {entry.level === 'bad' ? (
                      <span className="rounded bg-rose/15 px-1.5 py-0.5 font-mono text-[10px] text-rose">
                        refused
                      </span>
                    ) : null}
                    {entry.level === 'warn' ? (
                      <span className="rounded bg-amber/15 px-1.5 py-0.5 font-mono text-[10px] text-amber">
                        no dependents
                      </span>
                    ) : null}
                  </div>
                  {entry.text ? (
                    <div className="mt-1 text-xs leading-relaxed text-chalk/90">{entry.text}</div>
                  ) : null}
                  {entry.note ? (
                    <div className="mt-1 font-mono text-[10px] text-mist">{entry.note}</div>
                  ) : null}
                </div>
              )
            )}

            {clay.phase === 'thinking' || clay.phase === 'emitting' ? (
              <div className="flex items-center gap-2 rounded-lg border border-clay/30 bg-clay/5 px-3 py-2 text-[11px] text-clay">
                <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-clay" />
                {PHRASE[clay.phase]}…
              </div>
            ) : null}
            {clay.phase === 'patching' ? (
              <div className="flex items-center gap-2 rounded-lg border border-mint/30 bg-mint/5 px-3 py-2 text-[11px] text-mint">
                <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-mint" />
                patching — agent is recomputing dependents…
              </div>
            ) : null}
          </div>

          <div className="border-t border-line p-3">
            <textarea
              ref={inputRef}
              value={draft}
              rows={2}
              placeholder="ask for a plan, a breakdown, an explanation…"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submit(draft);
                }
              }}
              className="w-full resize-none rounded-md border border-line bg-ink-900 px-3 py-2 text-xs text-chalk outline-none placeholder:text-mist/50 focus:border-clay/60"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => submit(draft)}
                disabled={!draft.trim() || clay.phase === 'thinking' || clay.phase === 'emitting'}
                className="rounded-md border border-clay/60 bg-clay/15 px-3 py-1.5 text-xs font-semibold text-chalk disabled:opacity-40"
              >
                send
              </button>
              <span className="text-[10px] text-mist">enter to send · shift+enter for newline</span>
            </div>
            <div className="mt-3 flex items-center justify-center gap-2 border-t border-line/70 pt-2.5 text-[10px] text-mist">
              <span>
                Built by{' '}
                <a
                  href="https://harishkotra.me"
                  target="_blank"
                  rel="noreferrer"
                  className="text-chalk/80 underline decoration-line underline-offset-2 hover:text-clay"
                >
                  Harish Kotra
                </a>
              </span>
              <span className="text-line">·</span>
              <a
                href="https://dailybuild.xyz"
                target="_blank"
                rel="noreferrer"
                className="underline decoration-line underline-offset-2 hover:text-clay"
              >
                other builds
              </a>
            </div>
          </div>
        </section>

        <section className="flex min-h-0 flex-col">
          <div className="canvas-grid relative min-h-0 flex-1 overflow-auto p-5 scrollbar-thin">
            <div className="mx-auto max-w-3xl">
              {hasSurface ? (
                <>
                  <div className="mb-3 flex items-center gap-2">
                    <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">
                      surface
                    </span>
                    <span className="rounded border border-line bg-ink-800 px-2 py-0.5 font-mono text-[10px] text-mist">
                      {clay.surface.surfaceId}
                    </span>
                    <span className="rounded border border-line bg-ink-800 px-2 py-0.5 font-mono text-[10px] text-mist">
                      {clay.components.length} components
                    </span>
                    {clay.unsupported.length > 0 ? (
                      <span className="rounded border border-rose/40 bg-rose/10 px-2 py-0.5 font-mono text-[10px] text-rose">
                        {clay.unsupported.length} unsupported
                      </span>
                    ) : null}
                  </div>

                  {clay.error ? (
                    <div className="mb-3 rounded-lg border border-rose/40 bg-[#251113] px-3 py-2.5">
                      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-rose">
                        {clay.error.error}
                        <button
                          type="button"
                          onClick={clay.retry}
                          className="ml-auto rounded border border-rose/50 px-2 py-0.5 text-[10px] font-normal text-rose hover:bg-rose/10"
                        >
                          retry
                        </button>
                      </div>
                      {clay.error.detail ? (
                        <div className="mt-1 font-mono text-[10px] leading-relaxed text-rose/85">
                          {clay.error.detail}
                        </div>
                      ) : null}
                      {clay.error.raw ? (
                        <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-ink-900/80 p-2 font-mono text-[10px] text-mist scrollbar-thin">
                          {clay.error.raw}
                        </pre>
                      ) : null}
                    </div>
                  ) : null}

                  <SurfaceRenderer
                    components={clay.components}
                    dataModel={clay.dataModel}
                    onEvent={clay.interact}
                    onUnsupported={clay.logUnsupported}
                  />
                </>
              ) : clay.error ? (
                <div className="rounded-lg border border-rose/40 bg-[#251113] p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-rose">
                    {clay.error.error}
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-rose/85">{clay.error.detail}</div>
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-ink-900/80 p-2 font-mono text-[10px] text-mist scrollbar-thin">
                    {clay.error.raw}
                  </pre>
                  <button
                    type="button"
                    onClick={clay.retry}
                    className="mt-3 rounded border border-rose/50 px-2.5 py-1 text-[11px] text-rose hover:bg-rose/10"
                  >
                    retry
                  </button>
                </div>
              ) : (
                <EmptyState busy={clay.phase === 'thinking' || clay.phase === 'emitting'} />
              )}
            </div>
          </div>

          <div className="h-[34vh] min-h-[220px] shrink-0">
            <RawMessages turns={clay.turns} unsupported={clay.unsupported} />
          </div>
        </section>
      </main>

      <Settings
        open={settingsOpen}
        settings={clay.settings}
        onApply={(next) => {
          clay.setSettings(next);
          setSettingsOpen(false);
        }}
        onClose={() => setSettingsOpen(false)}
        serverFallback={{
          baseUrl: clay.health?.baseUrl,
          model: clay.health?.model,
          hasKey: clay.health?.hasServerKey,
        }}
      />
    </div>
  );
}

function EmptyState({ busy }: { busy: boolean }) {
  return (
    <div className="flex min-h-[55vh] flex-col items-center justify-center gap-3 text-center">
      <div className="text-[10px] font-medium uppercase tracking-[0.3em] text-mist">
        {busy ? 'the agent is drawing' : 'ask for a plan'}
      </div>
      {busy ? (
        <div className="grid w-full max-w-md gap-2">
          {[70, 45, 85, 55].map((width, index) => (
            <div
              key={index}
              className="pulse-dot h-8 rounded-md border border-line bg-ink-800/70"
              style={{ width: `${width}%`, animationDelay: `${index * 120}ms` }}
            />
          ))}
        </div>
      ) : (
        <p className="max-w-sm text-[11px] leading-relaxed text-mist">
          The surface on the right is generated per prompt. It is a component tree bound to a data
          model — move a widget and the agent patches the widgets that depend on it.
        </p>
      )}
    </div>
  );
}

function CatalogStrip({ onClose }: { onClose: () => void }) {
  return (
    <div className="border-b border-line bg-ink-850 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">
          component allowlist
        </span>
        <span className="font-mono text-[10px] text-mist">{COMPONENT_NAMES.length} names</span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded border border-line px-2 py-0.5 text-[10px] text-mist hover:bg-ink-700"
        >
          hide
        </button>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {COMPONENT_NAMES.map((name) => {
          const doc = CATALOG[name];
          return (
            <div key={name} className="rounded-md border border-line bg-ink-800/70 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-chalk">{name}</span>
                {doc.interactive ? (
                  <span className="rounded bg-clay/15 px-1.5 py-0.5 font-mono text-[9px] text-clay">
                    emits event
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-mist">{doc.description}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
