import type { WidgetProps } from '../renderer/types';
import { asArray, asRows, asString, type Prim } from './util';

type Column = { key?: unknown; label?: unknown; align?: unknown };

const ALIGN: Record<string, string> = { start: 'text-left', end: 'text-right', center: 'text-center' };

function cell(value: Prim | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number') return value.toLocaleString('en-US');
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return value;
}

export default function Table({ props }: WidgetProps) {
  const caption = asString(props, 'caption');
  const columns = asArray<Column>(props, 'columns').map((column) => ({
    key: asString(column, 'key'),
    label: asString(column, 'label') || asString(column, 'key'),
    align: ALIGN[String(column.align ?? 'start')] ?? ALIGN.start!,
  }));
  const rows = asRows(props, 'rows');

  if (columns.length === 0 || rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line px-3 py-4 text-xs text-mist">
        Table has no rows to show
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-ink-800/80">
      {caption ? (
        <div className="border-b border-line px-3.5 py-2 text-[10px] font-medium uppercase tracking-[0.16em] text-mist">
          {caption}
        </div>
      ) : null}
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-ink-700/60">
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`px-3.5 py-2 font-medium text-mist ${column.align}`}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-t border-line/60">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-3.5 py-2 text-chalk/90 ${column.align} ${
                      column.align === 'text-right' ? 'font-mono tabular-nums' : ''
                    }`}
                  >
                    {cell(row[column.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
