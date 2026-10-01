/**
 * Widget prop readers.
 *
 * Component props arrive as unknown JSON straight from the agent (validated by
 * the catalog schemas server-side). Widgets read them defensively so a surprising
 * value renders as a blank or a zero rather than taking the surface down.
 */

export type Prim = string | number | boolean;

export function asString(props: Record<string, unknown>, key: string, fallback = ''): string {
  const value = props[key];
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : fallback;
}

export function asNumber(props: Record<string, unknown>, key: string, fallback = 0): number {
  const value = props[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function asBoolean(props: Record<string, unknown>, key: string, fallback = false): boolean {
  return typeof props[key] === 'boolean' ? (props[key] as boolean) : fallback;
}

export function asIds(props: Record<string, unknown>, key: string): string[] {
  const value = props[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

export function asRows(props: Record<string, unknown>, key: string): Record<string, Prim>[] {
  const value = props[key];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is Record<string, Prim> =>
      Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)
  );
}

export function asArray<T>(props: Record<string, unknown>, key: string): T[] {
  const value = props[key];
  return Array.isArray(value) ? (value as T[]) : [];
}

const TONES: Record<string, string> = {
  neutral: 'text-chalk border-ink-600 bg-ink-700/60',
  info: 'text-[#7fd1ff] border-[#2b4b63] bg-[#122430]/70',
  good: 'text-mint border-[#1f4438] bg-[#0f271f]/70',
  warn: 'text-amber border-[#4a3c17] bg-[#241d0c]/70',
  bad: 'text-rose border-[#4d2226] bg-[#251113]/70',
};

export function toneClasses(tone: string): string {
  return TONES[tone] ?? TONES.neutral!;
}

export function toneColor(tone: string): string {
  if (tone === 'good') return 'var(--color-mint)';
  if (tone === 'warn') return 'var(--color-amber)';
  if (tone === 'bad') return 'var(--color-rose)';
  if (tone === 'info') return '#7fd1ff';
  return 'var(--color-clay)';
}

export function formatNumber(value: number): string {
  if (Number.isInteger(value)) return value.toLocaleString('en-US');
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** Renders a numeric value with its unit; `INR` becomes ₹, the rest stay text. */
export function formatWithUnit(value: string | number, unit?: string): string {
  const symbol = unit === 'INR' || unit === '₹' ? '₹' : undefined;
  // Money keeps its sign outside the symbol: -₹10,700, never ₹-10,700.
  if (typeof value === 'number' && symbol && value < 0) {
    return `-${symbol}${formatNumber(Math.abs(value))}`;
  }
  const body = typeof value === 'number' ? formatNumber(value) : value;
  if (!unit) return body;
  return symbol ? `${symbol}${body}` : `${body} ${unit}`;
}
