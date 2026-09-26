// Finance ERP — UI pieces shared by the Pledges … Statements pages, built on the
// Finance kit (../kit.tsx) and in its look: a per-currency figures strip, a
// progress bar, a year select, toggle chips for multi-status filters, a
// statement-PDF button that says plainly when there is no statement, and the
// small key/value and trail layouts drawers use.
import { useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import axios from "axios";
import { FileText } from "lucide-react";
import { FinanceApi, financeErrorCode, financeErrorMessage } from "../../../api/finance";
import { Button, Card, FIN, MoneyText, Skeleton, selectStyle, useFinanceToast, type ButtonVariant, type KpiTone } from "../kit";
import { sortTotals } from "../money";
import { statementMissingText, type StatementKind } from "./logic";

/* ---------- errors ---------- */

/** A 404 from the server (a statement that does not exist, a partner that is not one). */
export function isNotFound(e: unknown): boolean {
  if (financeErrorCode(e) === "NOT_FOUND") return true;
  return axios.isAxiosError(e) && e.response?.status === 404;
}

/* ---------- figures ---------- */

const TONE_COLOR: Record<KpiTone, string> = { default: FIN.navy, good: FIN.good, warn: FIN.warn, danger: FIN.danger };

export interface FigureGroup {
  currency: string;
  figures: readonly { label: string; amount_minor: number; tone?: KpiTone | undefined; title?: string | undefined }[];
  /** Under the figures (e.g. "12 pledges"). */
  note?: ReactNode;
}

/** Per-currency totals with several figures each (pledged / paid / remaining),
 *  KES first — never a figure that adds two currencies. */
export function FiguresStrip({ label, groups, loading = false, extra }: { label: string; groups: readonly FigureGroup[]; loading?: boolean | undefined; extra?: ReactNode }): ReactElement {
  return (
    <Card style={{ padding: "12px 18px" }}>
      <div className="flex items-start flex-wrap" style={{ gap: "10px 32px", opacity: loading && groups.length > 0 ? 0.55 : 1, transition: "opacity 150ms" }} aria-busy={loading}>
        <span className="nuru-eyebrow" style={{ paddingTop: 3 }}>
          {label}
        </span>
        {loading && groups.length === 0 ? (
          <Skeleton width={220} height={16} />
        ) : groups.length === 0 ? (
          <span style={{ fontSize: 13, color: FIN.muted }}>Nothing in this selection.</span>
        ) : (
          sortTotals(groups).map((g) => (
            <div key={g.currency} data-currency={g.currency} style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <div className="flex items-baseline flex-wrap" style={{ gap: "4px 18px" }}>
                {g.figures.map((f) => (
                  <span key={f.label} className="inline-flex items-baseline" style={{ gap: 6 }} title={f.title}>
                    <span style={{ fontSize: 11, color: FIN.muted, fontWeight: 600 }}>{f.label}</span>
                    <MoneyText amount_minor={f.amount_minor} currency={g.currency} strong style={{ fontSize: 14.5, color: TONE_COLOR[f.tone ?? "default"] }} />
                  </span>
                ))}
              </div>
              {g.note ? <span style={{ fontSize: 11.5, color: FIN.muted }}>{g.note}</span> : null}
            </div>
          ))
        )}
        {extra ? <span style={{ marginLeft: "auto", fontSize: 11.5, color: FIN.muted, maxWidth: 360 }}>{extra}</span> : null}
      </div>
    </Card>
  );
}

/** A thin progress bar (display only — the percentage comes from the server's figures). */
export function ProgressBar({ percent, tone = "default", width = 120, label }: { percent: number | null; tone?: KpiTone | undefined; width?: number | string | undefined; label?: string | undefined }): ReactElement {
  const pct = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  const color = tone === "good" ? "#16A34A" : tone === "warn" ? "#C89B3C" : tone === "danger" ? FIN.danger : FIN.navy;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      aria-label={label}
      style={{ width, height: 7, background: "#EEF0F3", borderRadius: 999, overflow: "hidden", flexShrink: 0 }}
    >
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 999, transition: "width 200ms" }} />
    </div>
  );
}

/* ---------- selects ---------- */

export function YearSelect({ value, years, onChange, label = "Year", style }: { value: number; years: readonly number[]; onChange: (year: number) => void; label?: string | undefined; style?: CSSProperties | undefined }): ReactElement {
  const list = years.includes(value) ? years : [value, ...years];
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ ...selectStyle, fontFamily: FIN.mono, ...style }}>
      {list.map((y) => (
        <option key={y} value={y}>
          {label}: {y}
        </option>
      ))}
    </select>
  );
}

/** Pill toggles for a multi-value filter (expense status). At least one stays on. */
export function ToggleChips<K extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: readonly { key: K; label: string; hint?: string | undefined }[];
  value: readonly K[];
  onChange: (next: K[]) => void;
  ariaLabel: string;
}): ReactElement {
  return (
    <div role="group" aria-label={ariaLabel} className="inline-flex items-center flex-wrap" style={{ gap: 6 }}>
      {options.map((o) => {
        const on = value.includes(o.key);
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={on}
            title={o.hint}
            onClick={() => {
              const next = on ? value.filter((k) => k !== o.key) : [...value, o.key];
              if (next.length > 0) onChange(options.map((x) => x.key).filter((k) => next.includes(k)));
            }}
            style={{
              height: 30,
              padding: "0 12px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              border: `1px solid ${on ? FIN.navy : FIN.border}`,
              background: on ? FIN.navy : FIN.card,
              color: on ? "#fff" : FIN.navy,
              whiteSpace: "nowrap",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A segmented control (report groupings: by fund | channel | source). */
export function Segmented<K extends string>({ options, value, onChange, ariaLabel }: { options: readonly { key: K; label: string }[]; value: K; onChange: (k: K) => void; ariaLabel: string }): ReactElement {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex" style={{ border: `1px solid ${FIN.border}`, borderRadius: 10, overflow: "hidden", background: FIN.card }}>
      {options.map((o, i) => {
        const on = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.key)}
            style={{
              height: 34,
              padding: "0 14px",
              fontSize: 12.5,
              fontWeight: on ? 700 : 500,
              border: "none",
              borderLeft: i === 0 ? "none" : `1px solid ${FIN.border}`,
              background: on ? FIN.surface : "transparent",
              color: FIN.navy,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- statement PDFs ---------- */

/**
 * Download a member's giving or Partners statement PDF for a year. A 404 means
 * there is nothing to print for that year — said plainly ("No partner
 * statement for 2026") rather than as an error; anything else is the
 * server's own message. Toasts go to the page's FinanceToaster.
 */
export function StatementPdfButton({
  userId,
  year,
  kind,
  memberName,
  label,
  size = "sm",
  variant = "secondary",
}: {
  userId: string;
  year: number;
  kind: StatementKind;
  memberName?: string | undefined;
  label?: string | undefined;
  size?: "sm" | "md" | undefined;
  variant?: ButtonVariant | undefined;
}): ReactElement {
  const [busy, setBusy] = useState(false);
  const toast = useFinanceToast();
  const noun = kind === "partners" ? "partner statement" : "giving statement";
  const run = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const base = `${memberName ? `${memberName} ` : ""}${noun} ${year}`;
    try {
      if (kind === "partners") await FinanceApi.partnerStatementPdf(userId, year, base);
      else await FinanceApi.givingStatementPdf(userId, year, base);
    } catch (e) {
      if (isNotFound(e)) toast(statementMissingText(kind, year), "warn");
      else toast(financeErrorMessage(e, `Could not download the ${noun}.`), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size={size} variant={variant} icon={<FileText size={12} />} busy={busy} onClick={() => void run()} title={`Download the ${noun} PDF for ${year}`}>
      {label ?? (kind === "partners" ? "Partner PDF" : "Giving PDF")}
    </Button>
  );
}

/* ---------- drawer layouts ---------- */

/** A grid of labelled values (a drawer's facts). */
export function KeyValues({ items, columns = 2 }: { items: readonly { label: string; value: ReactNode; title?: string | undefined }[]; columns?: number | undefined }): ReactElement {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(min(${columns === 3 ? 150 : 200}px, 100%), 1fr))`, gap: 10 }}>
      {items.map((it) => (
        <div key={it.label} title={it.title} style={{ padding: "10px 12px", background: FIN.input, borderRadius: 10, minWidth: 0 }}>
          <div style={{ fontSize: 10.5, color: FIN.muted, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 700, marginBottom: 4 }}>{it.label}</div>
          <div style={{ fontSize: 13, color: FIN.navy, overflowWrap: "anywhere" }}>{it.value}</div>
        </div>
      ))}
    </div>
  );
}

export interface TrailStep {
  label: string;
  who: string | null;
  when: string | null;
  note?: ReactNode;
  tone?: "ok" | "warn" | "info" | "muted" | undefined;
}

/** Who did what, when — oldest first (recorded → edited → approved → voided). */
export function Trail({ steps }: { steps: readonly TrailStep[] }): ReactElement {
  const dot = (t: TrailStep["tone"]): string => (t === "ok" ? "#16A34A" : t === "warn" ? "#C89B3C" : t === "muted" ? "#9AA3AF" : "#1E4068");
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
      {steps.map((s, i) => (
        <li key={`${s.label}-${i}`} className="flex items-start" style={{ gap: 10 }}>
          <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 999, background: dot(s.tone), marginTop: 5, flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, color: FIN.navy }}>
              <strong>{s.label}</strong>
              {s.who ? <> by {s.who}</> : null}
              {s.when ? <span style={{ color: FIN.muted, fontFamily: FIN.mono, fontSize: 12 }}> · {s.when}</span> : null}
            </div>
            {s.note ? <div style={{ fontSize: 12.5, color: FIN.muted, marginTop: 2 }}>{s.note}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A drawer section heading. */
export function SubHead({ children, aside }: { children: ReactNode; aside?: ReactNode }): ReactElement {
  return (
    <div className="flex items-baseline justify-between flex-wrap" style={{ gap: 8, margin: "20px 0 10px" }}>
      <div style={{ fontFamily: FIN.display, fontSize: 16, color: FIN.navy }}>{children}</div>
      {aside ? <div style={{ fontSize: 11.5, color: FIN.muted }}>{aside}</div> : null}
    </div>
  );
}

/** Two lines in a cell: a primary value and a muted second line. */
export function Stacked({ primary, secondary, strong = false }: { primary: ReactNode; secondary?: ReactNode; strong?: boolean | undefined }): ReactElement {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontWeight: strong ? 700 : 500, color: FIN.navy, overflow: "hidden", textOverflow: "ellipsis" }}>{primary}</div>
      {secondary ? <div style={{ fontSize: 11.5, color: FIN.muted, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{secondary}</div> : null}
    </div>
  );
}
