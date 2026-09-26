// Small presentational pieces the set-A Finance pages share: per-currency money
// lines (negatives in the danger colour), a segmented control, and a two-column
// detail list. Everything else comes from the kit (components/finance/kit.tsx).
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { FIN, MoneyText } from "../kit";
import { sortTotals } from "../money";

/** One MoneyText per currency (KES first); "—" when there is nothing. */
export function MoneyLines({
  amounts,
  strong = false,
  empty = "—",
  align = "right",
}: {
  amounts: readonly { currency: string; amount_minor: number }[];
  strong?: boolean | undefined;
  empty?: ReactNode;
  align?: "left" | "right" | undefined;
}): ReactElement {
  if (amounts.length === 0) return <span style={{ color: FIN.muted }}>{empty}</span>;
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: align === "right" ? "flex-end" : "flex-start", gap: 2 }}>
      {sortTotals(amounts).map((a) => (
        <MoneyText key={a.currency} amount_minor={a.amount_minor} currency={a.currency} strong={strong} />
      ))}
    </span>
  );
}

/** A small segmented control (radio semantics). */
export function Segmented<K extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  style,
}: {
  options: readonly { key: K; label: string }[];
  value: K;
  onChange: (k: K) => void;
  ariaLabel: string;
  style?: CSSProperties | undefined;
}): ReactElement {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex" style={{ border: `1px solid ${FIN.border}`, borderRadius: 10, overflow: "hidden", width: "fit-content", ...style }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.key)}
            style={{ padding: "6px 14px", fontSize: 12.5, fontWeight: 600, border: "none", background: on ? FIN.navy : FIN.card, color: on ? "#fff" : FIN.navy, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A label / value grid for drawers. */
export function DetailList({ children }: { children: ReactNode }): ReactElement {
  return <dl style={{ display: "grid", gridTemplateColumns: "minmax(110px, 160px) minmax(0, 1fr)", gap: "10px 16px", margin: 0 }}>{children}</dl>;
}

export function Detail({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <>
      <dt style={{ fontSize: 11, fontWeight: 700, color: FIN.muted, textTransform: "uppercase", letterSpacing: 0.6, paddingTop: 2 }}>{label}</dt>
      <dd style={{ fontSize: 13, color: FIN.navy, margin: 0, minWidth: 0, overflowWrap: "anywhere" }}>{children}</dd>
    </>
  );
}

/** A muted explanatory paragraph under a heading or above a form. */
export function Explain({ children, style }: { children: ReactNode; style?: CSSProperties | undefined }): ReactElement {
  return <div style={{ fontSize: 12.5, color: FIN.muted, lineHeight: 1.55, ...style }}>{children}</div>;
}

export const miniTh: CSSProperties = { fontSize: 10.5, fontWeight: 700, color: FIN.muted, textTransform: "uppercase", letterSpacing: 0.6, padding: "8px 10px", whiteSpace: "nowrap" };
export const miniTd: CSSProperties = { padding: "8px 10px", fontSize: 12.5, color: FIN.navy };
