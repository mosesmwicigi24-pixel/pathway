// A report matrix, one currency at a time (Finance → Reports, Income and
// Expenses tabs): rows (fund / channel / source / category) × January–December
// + the year, with the totals row — and, for income, a compact bar chart of
// the months. KES and USD are separate tables, never one sum. Each table is
// checked to foot (rows → totals, months → year) before it is shown as sound.
import { useLayoutEffect, useRef, useState, type MutableRefObject, type ReactElement } from "react";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import type { FinanceReportMatrix } from "../../../api/finance";
import { DataTable, FIN, Notice, SectionCard, type Column } from "../kit";
import { formatMinor } from "../money";
import { MONTH_LABELS, matrixProblems } from "./logic";

type Block = FinanceReportMatrix["currencies"][number];
type Row = Block["rows"][number];

/** A compact axis label from minor units: 1,250,000.00 → "1.3M", 45,000.00 → "45k". Display only. */
export function compactMajor(minor: number): string {
  const major = Number(BigInt(Math.trunc(minor)) / 100n);
  const abs = Math.abs(major);
  if (abs >= 1_000_000) return `${(major / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${Math.round(major / 1_000)}k`;
  return String(major);
}

/** The chart's own width, measured (the chart is drawn only once there is room —
 *  never at 0 × 0). */
function useWidth(): [MutableRefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

const CHART_PAD_X = 16;

function MonthChart({ block }: { block: Block }): ReactElement {
  const data = MONTH_LABELS.map((m, i) => ({ month: m, total: block.totals.months[i] ?? 0 }));
  const [ref, width] = useWidth();
  const inner = width - CHART_PAD_X * 2;
  return (
    <div ref={ref} style={{ height: 170, padding: `12px ${CHART_PAD_X}px 4px` }} aria-label={`${block.currency} by month`} role="img">
      {inner > 0 ? (
        <BarChart width={inner} height={154} data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} tickFormatter={(v: number) => compactMajor(v)} width={44} />
          <Tooltip
            cursor={{ fill: "rgba(11,31,51,0.04)" }}
            contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", fontSize: 12 }}
            formatter={(v) => [formatMinor(Number(v), block.currency), "Total"]}
          />
          <Bar dataKey="total" fill="#C89B3C" radius={[6, 6, 0, 0]} />
        </BarChart>
      ) : null}
    </div>
  );
}

export function MatrixBlock({ block, rowHeader, emptyText, chart = false }: { block: Block; rowHeader: string; emptyText: string; chart?: boolean | undefined }): ReactElement {
  const code = block.currency;
  const problems = matrixProblems(block);
  const columns: Column<Row>[] = [
    { key: "label", header: rowHeader, cell: (r) => <span style={{ fontWeight: 600 }}>{r.label}</span>, width: 200 },
    ...MONTH_LABELS.map<Column<Row>>((m, i) => ({ key: m, header: m, cell: (r) => formatMinor(r.months[i] ?? 0, null), align: "right", mono: true })),
    { key: "total", header: "Year", cell: (r) => <strong>{formatMinor(r.total_minor, null)}</strong>, align: "right", mono: true },
  ];
  const footer = (
    <tr style={{ borderTop: `2px solid ${FIN.border}`, background: FIN.surface }} data-testid={`matrix-total-${code}`}>
      <td style={{ padding: "10px 16px", fontSize: 12.5, fontWeight: 700, color: FIN.navy }}>Total</td>
      {block.totals.months.map((v, i) => (
        <td key={i} style={{ padding: "10px 16px", fontSize: 12.5, fontFamily: FIN.mono, fontWeight: 700, textAlign: "right", color: FIN.navy, whiteSpace: "nowrap" }}>
          {formatMinor(v, null)}
        </td>
      ))}
      <td style={{ padding: "10px 16px", fontSize: 13, fontFamily: FIN.mono, fontWeight: 800, textAlign: "right", color: FIN.navy, whiteSpace: "nowrap" }}>{formatMinor(block.totals.total_minor, null)}</td>
    </tr>
  );
  return (
    <section aria-label={`${code} table`} data-currency-block={code}>
      <SectionCard
        title={`${code} · ${formatMinor(block.totals.total_minor, code)}`}
        subtitle={`Amounts in ${code}. ${block.rows.length} ${block.rows.length === 1 ? "row" : "rows"}, largest first.`}
        flush
        footer={
          problems.length > 0 ? (
            <Notice tone="warn">These figures do not add up — do not rely on this table; tell the developers. {problems.slice(0, 3).join(" ")}</Notice>
          ) : block.rows.length > 0 ? (
            <span style={{ fontSize: 11.5, color: FIN.muted }}>✓ Every row adds up across the months, and every month down the rows, to the totals.</span>
          ) : undefined
        }
      >
        {chart && block.rows.length > 0 ? <MonthChart block={block} /> : null}
        <DataTable ariaLabel={`${code} by month`} columns={columns} rows={block.rows} rowKey={(r) => r.key} empty={emptyText} footer={footer} minWidth={1240} />
      </SectionCard>
    </section>
  );
}
