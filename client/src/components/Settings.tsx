import { useEffect, useState } from 'react';
import {
  apiTest,
  PRESETS,
  settingsForRequest,
  type PresetId,
  type Settings as SettingsType,
  type TestResult,
} from '../lib/client';

type Props = {
  open: boolean;
  settings: SettingsType;
  onApply: (next: SettingsType) => void;
  onClose: () => void;
  serverFallback: { baseUrl?: string | null; model?: string | null; hasKey?: boolean };
};

const FIELD =
  'w-full rounded-md border border-line bg-ink-900 px-3 py-2 font-mono text-xs text-chalk outline-none placeholder:text-mist/50 focus:border-clay/60';

/**
 * Provider switching without touching code. A preset fills base URL + model; the
 * three overrides travel with every request, and anything left blank falls back
 * to the server's `.env`.
 */
export default function Settings({ open, settings, onApply, onClose, serverFallback }: Props) {
  const [draft, setDraft] = useState<SettingsType>(settings);
  const [test, setTest] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(settings);
      setTest(null);
    }
  }, [open, settings]);

  if (!open) return null;

  const applyPreset = (id: PresetId) => {
    const preset = PRESETS.find((entry) => entry.id === id);
    if (!preset) return;
    setDraft((current) => ({
      ...current,
      preset: id,
      baseUrl: id === 'custom' ? current.baseUrl : preset.baseUrl,
      model: id === 'custom' ? current.model : preset.model,
    }));
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    const result = await apiTest(draft);
    setTest(result);
    setTesting(false);
  };

  const usesServer = settingsForRequest(draft);

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/60 p-6 backdrop-blur-sm">
      <div className="mt-10 w-full max-w-2xl overflow-hidden rounded-xl border border-line bg-ink-850 shadow-2xl">
        <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-chalk">Inference settings</h2>
            <p className="mt-0.5 text-[11px] text-mist">
              Stored in localStorage under <span className="font-mono">clay.settings.v1</span> and
              forwarded on every request. Blank fields use the server&apos;s .env.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line px-2.5 py-1 text-xs text-mist hover:bg-ink-700"
          >
            close
          </button>
        </header>

        <div className="grid gap-5 px-5 py-4">
          <div>
            <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-mist">
              Provider
            </div>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((preset) => {
                const active = draft.preset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPreset(preset.id)}
                    className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                      active
                        ? 'border-clay/70 bg-clay/15 text-chalk'
                        : 'border-line bg-ink-800 text-mist hover:text-chalk'
                    }`}
                  >
                    {preset.label}
                    {active ? <span className="ml-1.5 text-[10px] text-clay">active</span> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-[0.16em] text-mist">
                Base URL
              </span>
              <input
                className={FIELD}
                value={draft.baseUrl}
                placeholder={serverFallback.baseUrl ?? 'https://api.openai.com/v1'}
                onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
              />
              {!draft.baseUrl && serverFallback.baseUrl ? (
                <span className="mt-1 block text-[10px] text-mist">
                  from server: <span className="font-mono">{serverFallback.baseUrl}</span>
                </span>
              ) : null}
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-[0.16em] text-mist">
                Model
              </span>
              <input
                className={FIELD}
                value={draft.model}
                placeholder={serverFallback.model ?? 'model id'}
                onChange={(event) => setDraft({ ...draft, model: event.target.value })}
              />
              {!draft.model && serverFallback.model ? (
                <span className="mt-1 block text-[10px] text-mist">
                  from server: <span className="font-mono">{serverFallback.model}</span>
                </span>
              ) : null}
            </label>

            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-[0.16em] text-mist">
                API key — never sent to this page by the server
              </span>
              <input
                className={FIELD}
                type="password"
                autoComplete="off"
                value={draft.apiKey}
                placeholder={serverFallback.hasKey ? 'blank uses the server key' : 'no server key set'}
                onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-[0.16em] text-mist">
                Temperature
              </span>
              <input
                className={FIELD}
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={draft.temperature ?? ''}
                placeholder="0.2 (default)"
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    temperature: event.target.value === '' ? undefined : Number(event.target.value),
                  })
                }
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-[0.16em] text-mist">
                Max output tokens
              </span>
              <input
                className={FIELD}
                type="number"
                step="512"
                min="256"
                value={draft.maxTokens ?? ''}
                placeholder="32768 (default)"
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    maxTokens: event.target.value === '' ? undefined : Number(event.target.value),
                  })
                }
              />
            </label>
          </div>

          <div className="rounded-lg border border-line bg-ink-800/60 p-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={runTest}
                disabled={testing}
                className="rounded-md border border-mint/40 bg-mint/10 px-3 py-1.5 text-xs font-medium text-mint disabled:opacity-50"
              >
                {testing ? 'testing…' : 'Test connection'}
              </button>
              <span className="text-[11px] text-mist">
                POST {draft.baseUrl || serverFallback.baseUrl || '(unset)'}/chat/completions
              </span>
            </div>
            {test ? (
              <div className="mt-3 space-y-1.5">
                <div
                  className={`font-mono text-[11px] ${test.ok ? 'text-mint' : 'text-rose'}`}
                >
                  {test.ok ? 'HTTP' : 'FAIL'} {test.status || '—'} · {test.latencyMs}ms
                </div>
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-ink-900 p-2 font-mono text-[10px] leading-relaxed text-mist scrollbar-thin">
                  {test.body.slice(0, 700)}
                </pre>
              </div>
            ) : null}
          </div>
        </div>

        <footer className="flex items-center justify-between border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={() => onApply({ ...draft, apiKey: draft.apiKey })}
            className="rounded-md border border-clay/60 bg-clay/15 px-3.5 py-1.5 text-xs font-semibold text-chalk"
          >
            Save
          </button>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-mist">
              sending {Object.keys(usesServer).length} override field(s) per request
            </span>
            <button
              type="button"
              onClick={() => {
                const cleared: SettingsType = {
                  preset: 'custom',
                  baseUrl: '',
                  model: '',
                  apiKey: '',
                };
                setDraft(cleared);
                onApply(cleared);
              }}
              className="rounded-md border border-line px-3 py-1.5 text-xs text-mist hover:bg-ink-700"
            >
              Clear overrides
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
