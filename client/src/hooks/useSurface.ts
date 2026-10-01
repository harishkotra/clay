import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyResponse,
  getPath,
  indexComponents,
  setPath,
  type A2UIComponent,
  type SessionSurface,
  type TurnRecord,
} from '../../../shared/a2ui';
import {
  apiChat,
  apiHealth,
  apiInteract,
  apiSession,
  loadSessionId,
  loadSettings,
  resetSessionId,
  saveSettings,
  type ApiResult,
  type HealthInfo,
  type Settings,
} from '../lib/client';

export type Phase = 'idle' | 'thinking' | 'emitting' | 'patching' | 'error';

export type ChatEntry = {
  id: string;
  role: 'user' | 'agent';
  text: string;
  ts: number;
  /** An agent entry that carries no text still shows what it did. */
  note?: string;
  level?: 'ok' | 'warn' | 'bad';
};

export type UnsupportedLog = { componentId: string; name: string; ts: number };

const EMPTY: SessionSurface = { surfaceId: '', components: [], dataModel: {} };

function labelForPhase(phase: Phase): string {
  if (phase === 'thinking') return 'thinking';
  if (phase === 'emitting') return 'emitting surface';
  if (phase === 'patching') return 'patching surface';
  return '';
}

/**
 * The single source of truth on the client: the surface, its data model, the
 * turn log the inspector reads, and the phase indicator the chat rail shows.
 *
 * Widget events are applied to the local data model first (so a drag feels
 * instant), then sent to the agent, whose reply replaces the surface — the
 * client never computes the numbers the agent owns.
 */
export function useSurface() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [sessionId, setSessionId] = useState<string>(() => loadSessionId());
  const [surface, setSurface] = useState<SessionSurface>(EMPTY);
  const [turns, setTurns] = useState<TurnRecord[]>([]);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<{ error: string; detail?: string; raw?: string } | null>(null);
  const [unsupported, setUnsupported] = useState<UnsupportedLog[]>([]);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const lastAction = useRef<null | (() => void)>(null);
  const sequence = useRef(0);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const next = await apiHealth();
      if (!cancelled) setHealth(next);
    };
    void poll();
    const timer = setInterval(poll, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const nextId = () => `e${(sequence.current += 1)}`;

  const pushEntry = useCallback((entry: Omit<ChatEntry, 'id' | 'ts'>) => {
    setEntries((current) => [...current, { ...entry, id: nextId(), ts: Date.now() }]);
  }, []);

  const logUnsupported = useCallback((componentId: string, name: string) => {
    setUnsupported((current) =>
      current.some((item) => item.componentId === componentId && item.name === name)
        ? current
        : [...current, { componentId, name, ts: Date.now() }]
    );
  }, []);

  /** Fold an agent reply into state, and mirror the outcome into the chat rail. */
  const consume = useCallback(
    (result: ApiResult, kind: 'chat' | 'interact', input: string) => {
      if (!result.ok) {
        setPhase('error');
        setError({ error: result.error, detail: result.detail, raw: result.raw });
        setTurns((current) => [
          ...current,
          {
            index: current.length,
            kind,
            input,
            raw: result.raw ?? '',
            emitted: null,
            rejected: result.rejected ?? [],
            status: result.error === 'invalid_surface' ? 'invalid_surface' : 'error',
            detail: result.detail ?? result.error,
            recomputed: [],
            attempts: 0,
            ts: Date.now(),
          },
        ]);
        pushEntry({
          role: 'agent',
          text: '',
          note:
            result.error === 'no_api_key'
              ? 'refused: no API key (open Settings)'
              : result.error === 'invalid_surface'
                ? 'rejected an invalid surface — see the inspector'
                : `error: ${result.error}`,
          level: 'bad',
        });
        return;
      }

      setError(null);
      const message = {
        surfaceUpdate: result.surfaceUpdate,
        dataModelUpdate: result.dataModelUpdate,
        deleteSurface: result.deleteSurface,
      };
      const applied = applyResponse(surface, message);

      setSurface(applied);
      if (result.sessionId && result.sessionId !== sessionId) {
        setSessionId(result.sessionId);
        localStorage.setItem('clay.session.v1', result.sessionId);
      }

      setTurns((current) => [
        ...current,
        {
          index: current.length,
          kind,
          input,
          raw: JSON.stringify(message, null, 2),
          emitted: message,
          rejected: result.rejected ?? [],
          status: 'ok',
          recomputed: result.recomputed ?? [],
          attempts: result.attempts ?? 0,
          ts: Date.now(),
        },
      ]);

      const components = applied.components.length;
      if (kind === 'chat') {
        pushEntry({
          role: 'agent',
          text: result.text ?? '',
          note: `emitted ${components} components${result.meta ? ` · ${result.meta.model} · ${result.meta.latencyMs}ms` : ''}`,
          level: 'ok',
        });
      } else {
        const moved = (result.recomputed ?? []).filter((id) => id !== '').length;
        pushEntry({
          role: 'agent',
          text: result.text ?? '',
          note: moved
            ? `recomputed ${moved} dependent component${moved === 1 ? '' : 's'}`
            : 'patched the touched component only — no dependents changed',
          level: moved ? 'ok' : 'warn',
        });
      }

      setPhase('idle');
    },
    [pushEntry, sessionId, surface]
  );

  const send = useCallback(
    (message: string) => {
      const text = message.trim();
      if (!text) return;
      setPhase('thinking');
      pushEntry({ role: 'user', text });
      lastAction.current = () => void run(text);

      async function run(body: string) {
        setPhase('thinking');
        const timer = setTimeout(() => setPhase((p) => (p === 'thinking' ? 'emitting' : p)), 1_200);
        const result = await apiChat(body, settings, sessionId);
        clearTimeout(timer);
        consume(result, 'chat', body);
      }

      void run(text);
    },
    [consume, pushEntry, sessionId, settings]
  );

  const interact = useCallback(
    (componentId: string, value: unknown) => {
      const component = indexComponents(surface.components).get(componentId);
      if (!component) return;
      const name = Object.keys(component.component)[0] ?? '';
      const props = (component.component as Record<string, Record<string, unknown>>)[name] ?? {};
      const bind = typeof props.bind === 'string' ? props.bind : '';

      // Optimistic: write the bound path locally so the widget tracks the drag.
      if (bind) {
        const optimistic = { ...surface, dataModel: { ...surface.dataModel } };
        setPath(optimistic.dataModel, bind, value);
        setSurface(optimistic);
      }

      setPhase('patching');
      const input = `${componentId} = ${JSON.stringify(value)}`;
      lastAction.current = () => void finish();

      async function finish() {
        const result = await apiInteract(
          { surfaceId: surface.surfaceId, componentId, value },
          settings,
          sessionId
        );
        consume(result, 'interact', input);
      }

      void finish();
    },
    [consume, sessionId, settings, surface]
  );

  const retry = useCallback(() => {
    lastAction.current?.();
  }, []);

  const reset = useCallback(async () => {
    const fresh = resetSessionId();
    setSessionId(fresh);
    setSurface(EMPTY);
    setTurns([]);
    setEntries([]);
    setUnsupported([]);
    setError(null);
    setPhase('idle');
    lastAction.current = null;
  }, []);

  /** Rehydrate a session after a page reload: state lives in the Durable Object. */
  const restore = useCallback(async () => {
    const snapshot = await apiSession(sessionId);
    if (!snapshot || snapshot.components.length === 0) return;
    setSurface({
      surfaceId: snapshot.surfaceId,
      components: snapshot.components,
      dataModel: snapshot.dataModel,
    });
    setTurns(snapshot.turns ?? []);
    setEntries([
      {
        id: 'restored',
        role: 'agent',
        text: '',
        note: `restored surface "${snapshot.surfaceId}" from session ${snapshot.sessionId}`,
        level: 'ok',
        ts: snapshot.updatedAt,
      },
    ]);
  }, [sessionId]);

  const restoredOnce = useRef(false);
  useEffect(() => {
    if (restoredOnce.current) return;
    restoredOnce.current = true;
    void restore();
  }, [restore]);

  const boundValue = useCallback(
    (bind: string) => getPath(surface.dataModel, bind),
    [surface.dataModel]
  );

  const status = useMemo(() => labelForPhase(phase), [phase]);

  return {
    settings,
    setSettings,
    sessionId,
    surface: surface as SessionSurface & { components: A2UIComponent[] },
    components: surface.components,
    dataModel: surface.dataModel,
    turns,
    entries,
    phase,
    status,
    error,
    unsupported,
    health,
    send,
    interact,
    retry,
    reset,
    restore,
    logUnsupported,
    boundValue,
  };
}
