// Finance kit — the shared building blocks every Finance page is made of
// (docs/FINANCE_ERP.md §5). One look for the whole module, taken from the
// portal's own pages (Partners.tsx / Finance.tsx / Departments.tsx): the dark
// hero with a breadcrumb and a tile strip, cards with a hairline border and a
// 16 px radius, DM Serif for titles and figures, DM Mono for amounts, codes and
// dates, pastel status chips, and a right-hand drawer. Dense but calm.
//
// Money on these pages is integer minor units with its currency (money.ts);
// dates are EAT calendar days (dates.ts); every call goes through
// api/finance.ts. Write actions are shown only with the capability
// (useFinanceCaps, §6) and are hidden while /me is still loading.
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Download,
  FileText,
  Inbox,
  Info,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useAppSelector } from "../../store/hooks";
import {
  downloadCsv,
  downloadPdf,
  financeErrorMessage,
  newIdempotencyKey,
  type CurrencyTotal,
  type QueryParams,
} from "../../api/finance";
import { formatMinor, parseMajorToMinor, sortTotals, toMinorBigInt, type MinorInput, type ParsedAmount } from "./money";
import { DATE_PRESETS, fmtRange, periodFor, rangeError, type DatePreset, type PeriodValue } from "./dates";

/* ====================================================================== */
/* Tokens                                                                   */
/* ====================================================================== */

/** The portal's palette, as every Finance page uses it. */
export const FIN = {
  navy: "var(--nuru-navy)",
  gold: "var(--nuru-gold)",
  dark: "var(--nuru-dark)",
  muted: "var(--muted-foreground)",
  border: "var(--border)",
  surface: "var(--secondary)",
  card: "var(--card)",
  input: "var(--input-background)",
  background: "var(--background)",
  display: "var(--font-display)",
  mono: "var(--font-mono)",
  danger: "#B42318",
  warn: "#A87616",
  good: "#0F6B33",
  /** Page gutter — the same clamp every portal page uses. */
  gutter: "clamp(16px,4vw,48px)",
} as const;

export type Tone = "ok" | "warn" | "error" | "info";
export const TONES: Record<Tone, { bg: string; color: string; border: string }> = {
  ok: { bg: "#E8F6EC", color: "#0F6B33", border: "#BFE3CB" },
  warn: { bg: "#FFF4DA", color: "#A87616", border: "#F3DFA6" },
  error: { bg: "#FDECEC", color: "#B42318", border: "#F5C2C0" },
  info: { bg: "#E6EDF5", color: "#1E4068", border: "#C9D6E6" },
};

export const inputStyle: CSSProperties = {
  height: 36,
  padding: "0 12px",
  background: "var(--input-background)",
  border: `1px solid ${FIN.border}`,
  borderRadius: 10,
  fontSize: 13,
  color: FIN.navy,
  width: "100%",
  minWidth: 0,
  outline: "none",
};
export const selectStyle: CSSProperties = {
  height: 36,
  padding: "0 28px 0 12px",
  background: "var(--card)",
  border: `1px solid ${FIN.border}`,
  borderRadius: 10,
  fontSize: 13,
  color: FIN.navy,
  maxWidth: "100%",
  minWidth: 0,
};
export const textareaStyle: CSSProperties = {
  ...inputStyle,
  height: "auto",
  minHeight: 84,
  padding: "10px 12px",
  resize: "vertical",
  lineHeight: 1.5,
};
const thStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: FIN.muted,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  padding: "10px 16px",
  borderBottom: `1px solid ${FIN.border}`,
  whiteSpace: "nowrap",
};

/* ====================================================================== */
/* Capabilities (§6)                                                        */
/* ====================================================================== */

export interface FinanceCaps {
  /** finance:view — every Finance page. Open while /me loads (reads fail open). */
  view: boolean;
  /** finance:export — CSV downloads. */
  export: boolean;
  /** finance:manage — record/reverse gifts, funds, categories, expenses, budgets (draft), campaigns, claims, reminders. */
  manage: boolean;
  /** finance:approve — approve expenses and budgets, fund transfers, opening balances, journal reversals. */
  approve: boolean;
  /** /me has not answered yet — every write capability is false until it does. */
  loading: boolean;
}

/** The caps a permission list grants. null = /me still loading: reads open,
 *  every write (and export) closed — the Partners.tsx idiom. Admin/SuperAdmin
 *  need no special case: /me returns them the full grid. */
export function financeCaps(permissions: readonly string[] | null): FinanceCaps {
  if (permissions === null) return { view: true, export: false, manage: false, approve: false, loading: true };
  return {
    view: permissions.includes("finance:view"),
    export: permissions.includes("finance:export"),
    manage: permissions.includes("finance:manage"),
    approve: permissions.includes("finance:approve"),
    loading: false,
  };
}

/** The signed-in person's Finance capabilities (from state.auth.permissions). */
export function useFinanceCaps(): FinanceCaps {
  const permissions = useAppSelector((s) => s.auth.permissions);
  return financeCaps(permissions);
}

/* ====================================================================== */
/* Small hooks                                                              */
/* ====================================================================== */

/** `value`, settled for `ms` (search boxes). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** One idempotency key per form opening — stable across retries (a retry after
 *  a timeout replays instead of posting twice); `renew()` after a success or
 *  when the form is reset for a new entry. */
export function useIdempotencyKey(): [string, () => void] {
  const [key, setKey] = useState(newIdempotencyKey);
  const renew = useCallback(() => setKey(newIdempotencyKey()), []);
  return [key, renew];
}

/** A string search param kept in the URL (filters that deep-link: Overview
 *  alerts open "/finance/transactions?status=processing"). Setting `fallback`
 *  removes the param; history is replaced, not pushed. */
export function useUrlParam(key: string, fallback = ""): [string, (value: string) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(key) ?? fallback;
  const set = useCallback(
    (next: string) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === fallback || next === "") p.delete(key);
          else p.set(key, next);
          return p;
        },
        { replace: true },
      );
    },
    [setParams, key, fallback],
  );
  return [value, set];
}

/** The page's tab, kept in `?tab=` (so a tab can be linked to). An unknown or
 *  missing value reads as `fallback`, which is never written to the URL. */
export function useUrlTab<K extends string>(keys: readonly K[], fallback: K, param = "tab"): [K, (tab: K) => void] {
  const [raw, setRaw] = useUrlParam(param, fallback);
  const value = (keys as readonly string[]).includes(raw) ? (raw as K) : fallback;
  const set = useCallback((tab: K) => setRaw(tab), [setRaw]);
  return [value, set];
}

/* ====================================================================== */
/* Keyed pagination                                                         */
/* ====================================================================== */

type PageLike = { data: unknown[]; next_cursor: string | null };
type RowOf<P> = P extends { data: (infer R)[] } ? R : never;
type TotalOf<P> = P extends { totals: (infer X)[] } ? X : never;

export interface PagedList<P extends PageLike> {
  rows: RowOf<P>[];
  /** Totals of the WHOLE filtered set, from the first page ([] when the list has none). */
  totals: TotalOf<P>[];
  /** The first page's envelope — for extra fields (year, period, totals_by_status). */
  page: P | null;
  /** The first page is in flight (first load, or after the key changed). Rows
   *  from before stay on screen, dimmed, until the answer lands. */
  loading: boolean;
  loadingMore: boolean;
  /** The first page failed (rows are cleared — never show stale money as current). */
  error: string | null;
  /** A later page failed (rows kept; "Load more" retries). */
  moreError: string | null;
  hasMore: boolean;
  loadMore: () => void;
  /** Refetch from the first page (after a write). */
  reload: () => void;
  /** Patch loaded rows locally (e.g. a row's new status after an action). */
  setRows: (update: (rows: RowOf<P>[]) => RowOf<P>[]) => void;
}

interface PagedState<P extends PageLike> {
  rows: RowOf<P>[];
  totals: TotalOf<P>[];
  page: P | null;
  cursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  moreError: string | null;
}

/**
 * A keyset-paged register: `fetchPage(cursor)` is called with null for the first
 * page and with `next_cursor` for each "Load more". Changing `key` (serialise
 * the filters into it, e.g. JSON.stringify(filters)) starts again from the
 * first page; an answer to an older key is dropped, so a slow response can
 * never overwrite a newer one.
 *
 *   const list = usePagedList((cursor) => FinanceApi.transactions({ ...filters, cursor }), JSON.stringify(filters));
 *   <DataTable columns={cols} rowKey={(r) => r.transaction_id} {...pagedTableProps(list)} />
 */
export function usePagedList<P extends PageLike>(
  fetchPage: (cursor: string | null) => Promise<P>,
  key: string,
  opts: { enabled?: boolean | undefined; errorFallback?: string | undefined } = {},
): PagedList<P> {
  const enabled = opts.enabled !== false;
  const fallback = opts.errorFallback ?? "Could not load this list.";
  const fetchRef = useRef(fetchPage);
  useLayoutEffect(() => {
    fetchRef.current = fetchPage;
  });
  const [state, setState] = useState<PagedState<P>>({
    rows: [],
    totals: [],
    page: null,
    cursor: null,
    loading: enabled,
    loadingMore: false,
    error: null,
    moreError: null,
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  const generation = useRef(0);
  const moreInFlight = useRef(false);

  const reload = useCallback(() => {
    const gen = ++generation.current;
    moreInFlight.current = false;
    setState((s) => ({ ...s, loading: true, loadingMore: false, error: null, moreError: null }));
    fetchRef.current(null).then(
      (p) => {
        if (gen !== generation.current) return;
        const totals = ((p as { totals?: unknown[] }).totals ?? []) as TotalOf<P>[];
        setState({
          rows: p.data as RowOf<P>[],
          totals,
          page: p,
          cursor: p.next_cursor,
          loading: false,
          loadingMore: false,
          error: null,
          moreError: null,
        });
      },
      (e: unknown) => {
        if (gen !== generation.current) return;
        setState({ rows: [], totals: [], page: null, cursor: null, loading: false, loadingMore: false, error: financeErrorMessage(e, fallback), moreError: null });
      },
    );
  }, [fallback]);

  const loadMore = useCallback(() => {
    const s = stateRef.current;
    if (!s.cursor || s.loading || moreInFlight.current) return;
    const gen = generation.current;
    moreInFlight.current = true;
    setState((x) => ({ ...x, loadingMore: true, moreError: null }));
    fetchRef.current(s.cursor).then(
      (p) => {
        if (gen !== generation.current) return;
        moreInFlight.current = false;
        setState((x) => ({ ...x, rows: [...x.rows, ...(p.data as RowOf<P>[])], cursor: p.next_cursor, loadingMore: false }));
      },
      (e: unknown) => {
        if (gen !== generation.current) return;
        moreInFlight.current = false;
        setState((x) => ({ ...x, loadingMore: false, moreError: financeErrorMessage(e, "Could not load more rows.") }));
      },
    );
  }, []);

  useEffect(() => {
    if (enabled) reload();
    else generation.current++; // drop anything in flight
  }, [key, enabled, reload]);

  const setRows = useCallback((update: (rows: RowOf<P>[]) => RowOf<P>[]) => {
    setState((x) => ({ ...x, rows: update(x.rows) }));
  }, []);

  return {
    rows: state.rows,
    totals: state.totals,
    page: state.page,
    loading: state.loading,
    loadingMore: state.loadingMore,
    error: state.error,
    moreError: state.moreError,
    hasMore: state.cursor !== null,
    loadMore,
    reload,
    setRows,
  };
}

/** Spread a PagedList into DataTable's state props. */
export function pagedTableProps<P extends PageLike>(
  list: PagedList<P>,
): Pick<DataTableProps<RowOf<P>>, "rows" | "loading" | "error" | "onRetry" | "hasMore" | "loadingMore" | "moreError" | "onLoadMore"> {
  return {
    rows: list.rows,
    loading: list.loading,
    error: list.error,
    onRetry: list.reload,
    hasMore: list.hasMore,
    loadingMore: list.loadingMore,
    moreError: list.moreError,
    onLoadMore: list.loadMore,
  };
}

/* ====================================================================== */
/* Primitives                                                               */
/* ====================================================================== */

export function Card({ children, style, className }: { children?: ReactNode; style?: CSSProperties | undefined; className?: string | undefined }): ReactElement {
  return (
    <div
      className={`rounded-2xl${className ? ` ${className}` : ""}`}
      style={{ background: FIN.card, border: `1px solid ${FIN.border}`, boxShadow: "0 1px 3px rgba(11,31,51,0.05)", minWidth: 0, ...style }}
    >
      {children}
    </div>
  );
}

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export interface ButtonProps {
  children?: ReactNode;
  onClick?: (() => void) | undefined;
  variant?: ButtonVariant | undefined;
  /** On the dark hero: primary turns gold, secondary translucent. */
  onDark?: boolean | undefined;
  icon?: ReactNode;
  /** Spinner + disabled (a request is in flight). */
  busy?: boolean | undefined;
  disabled?: boolean | undefined;
  /** Disabled, with the reason on hover. */
  disabledTip?: string | undefined;
  type?: "button" | "submit" | undefined;
  size?: "sm" | "md" | undefined;
  title?: string | undefined;
  ariaLabel?: string | undefined;
}

/** The one button. A disabled button carries its reason on a wrapping span,
 *  because a disabled <button> gets no hover events in every browser. */
export function Button({
  children,
  onClick,
  variant = "secondary",
  onDark = false,
  icon,
  busy = false,
  disabled = false,
  disabledTip,
  type = "button",
  size = "md",
  title,
  ariaLabel,
}: ButtonProps): ReactElement {
  const off = busy || disabled || Boolean(disabledTip);
  const palette: CSSProperties =
    variant === "primary"
      ? onDark
        ? { background: FIN.gold, color: "#fff", border: `1px solid ${FIN.gold}` }
        : { background: FIN.navy, color: "#fff", border: `1px solid ${FIN.navy}` }
      : variant === "danger"
        ? { background: "#FDECEC", color: FIN.danger, border: "1px solid #F5C2C0" }
        : variant === "ghost"
          ? { background: "transparent", color: onDark ? "rgba(232,239,245,0.85)" : FIN.navy, border: "1px solid transparent" }
          : onDark
            ? { background: "rgba(255,255,255,0.08)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)" }
            : { background: FIN.card, color: FIN.navy, border: `1px solid ${FIN.border}` };
  return (
    <span title={disabledTip ?? title} style={{ display: "inline-flex", cursor: off ? "not-allowed" : "pointer", maxWidth: "100%" }}>
      <button
        type={type}
        disabled={off}
        aria-disabled={off ? "true" : undefined}
        aria-busy={busy ? "true" : undefined}
        aria-label={ariaLabel}
        onClick={onClick}
        className="inline-flex items-center justify-center gap-2 rounded-lg transition-opacity hover:opacity-90"
        style={{
          height: size === "sm" ? 28 : 34,
          padding: size === "sm" ? "0 10px" : "0 14px",
          fontSize: size === "sm" ? 11.5 : 12.5,
          fontWeight: 600,
          whiteSpace: "nowrap",
          opacity: off ? 0.5 : 1,
          pointerEvents: off ? "none" : "auto",
          ...palette,
        }}
      >
        {busy ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : icon}
        {children}
      </button>
    </span>
  );
}

/** A labelled form row: label, the control, then an error (or a hint). */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
}: {
  label: ReactNode;
  htmlFor?: string | undefined;
  hint?: ReactNode;
  error?: string | null | undefined;
  required?: boolean | undefined;
  children: ReactNode;
}): ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <label htmlFor={htmlFor} style={{ fontSize: 11, color: FIN.muted, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 700 }}>
        {label}
        {required ? <span style={{ color: FIN.danger }}> *</span> : null}
      </label>
      {children}
      {error ? (
        <span role="alert" style={{ fontSize: 11.5, color: FIN.danger, fontWeight: 600 }}>
          {error}
        </span>
      ) : hint ? (
        <span style={{ fontSize: 11.5, color: FIN.muted }}>{hint}</span>
      ) : null}
    </div>
  );
}

export function Skeleton({ width = "100%", height = 12, style }: { width?: number | string | undefined; height?: number | undefined; style?: CSSProperties | undefined }): ReactElement {
  return <span aria-hidden="true" className="animate-pulse" style={{ display: "inline-block", width, height, borderRadius: 6, background: "#E5E7EB", ...style }} />;
}

/** The dashed "nothing here" box. */
export function EmptyState({ title, children, icon }: { title?: ReactNode; children?: ReactNode; icon?: ReactNode }): ReactElement {
  return (
    <div className="text-center" style={{ padding: "36px 20px", border: `1px dashed ${FIN.border}`, borderRadius: 14, margin: 12 }}>
      <div style={{ display: "inline-flex", color: FIN.muted, opacity: 0.6, marginBottom: 8 }}>{icon ?? <Inbox size={22} />}</div>
      {title ? <div style={{ fontSize: 14, fontWeight: 700, color: FIN.navy, marginBottom: 4 }}>{title}</div> : null}
      {children ? <div style={{ fontSize: 13, color: FIN.muted, maxWidth: 520, margin: "0 auto" }}>{children}</div> : null}
    </div>
  );
}

/** A failed read, with Retry. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: (() => void) | undefined }): ReactElement {
  return (
    <div role="alert" className="text-center" style={{ padding: "32px 20px" }}>
      <div style={{ display: "inline-flex", color: FIN.danger, marginBottom: 8 }}>
        <AlertTriangle size={20} />
      </div>
      <div style={{ fontSize: 13.5, color: FIN.navy, fontWeight: 600, marginBottom: onRetry ? 12 : 0 }}>{message}</div>
      {onRetry ? (
        <Button icon={<RefreshCw size={13} />} onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

/* ====================================================================== */
/* Page frame                                                               */
/* ====================================================================== */

/**
 * Every Finance page: the dark hero (breadcrumb "Finance › <title>", actions
 * on the right, the title, a one-line subtitle, optionally a KpiStrip), an
 * optional tab bar, then the content column. Also mounts the FinanceToaster
 * that shows useFinanceToast() toasts.
 */
export function FinancePage({
  title,
  subtitle,
  actions,
  hero,
  tabs,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  /** Right side of the hero — Buttons with `onDark`, ExportButton `onDark`. */
  actions?: ReactNode;
  /** Inside the hero, under the title — usually a <KpiStrip>. */
  hero?: ReactNode;
  /** Under the hero — a <Tabs>. */
  tabs?: ReactNode;
  children?: ReactNode;
}): ReactElement {
  return (
    <>
      <div className="min-h-full" style={{ background: FIN.background }}>
        <div style={{ background: FIN.dark, padding: `22px ${FIN.gutter} 24px` }}>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(232,239,245,0.55)", letterSpacing: "0.04em", minWidth: 0 }}>
              <span>Finance</span>
              <ChevronRight size={10} />
              <span style={{ color: "#fff", fontWeight: 600 }}>{title}</span>
            </div>
            {actions ? <div className="flex items-center gap-2 flex-wrap">{actions}</div> : null}
          </div>
          <h1 style={{ fontFamily: FIN.display, color: "#fff", fontSize: 24, fontWeight: 400, lineHeight: 1.05, marginTop: 16, letterSpacing: "-0.015em" }}>{title}</h1>
          {subtitle ? <p style={{ color: "rgba(232,239,245,0.62)", fontSize: 13, lineHeight: 1.5, marginTop: 8, maxWidth: 760 }}>{subtitle}</p> : null}
          {hero ? <div style={{ marginTop: 16 }}>{hero}</div> : null}
        </div>
        {tabs ? <div style={{ padding: `0 ${FIN.gutter}` }}>{tabs}</div> : null}
        <div style={{ padding: `24px ${FIN.gutter} 48px`, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 16 }}>{children}</div>
      </div>
      <FinanceToaster />
    </>
  );
}

/** A row of KpiTiles. `hero` (default) sits inside FinancePage's dark hero;
 *  `card` lays tiles out as light cards on the page. */
export function KpiStrip({ children, variant = "hero", minTileWidth = 170 }: { children: ReactNode; variant?: "hero" | "card" | undefined; minTileWidth?: number | undefined }): ReactElement {
  const cols = `repeat(auto-fit, minmax(min(${minTileWidth}px, 100%), 1fr))`;
  if (variant === "card") return <div style={{ display: "grid", gridTemplateColumns: cols, gap: 12 }}>{children}</div>;
  return (
    <div
      className="rounded-xl"
      style={{ display: "grid", gridTemplateColumns: cols, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}
    >
      {children}
    </div>
  );
}

export type KpiTone = "default" | "good" | "warn" | "danger";

/** One figure: label, value (a string or <PerCurrency>), hint. With onClick it
 *  is a button (a deep link to the queue behind the number). */
export function KpiTile({
  label,
  value,
  hint,
  icon,
  tone = "default",
  onClick,
  variant = "hero",
  loading = false,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: KpiTone | undefined;
  onClick?: (() => void) | undefined;
  variant?: "hero" | "card" | undefined;
  loading?: boolean | undefined;
}): ReactElement {
  const hero = variant === "hero";
  const toneColor = hero
    ? { default: "#fff", good: "#86EFAC", warn: "#F5C77E", danger: "#F5A3A3" }[tone]
    : { default: FIN.navy, good: FIN.good, warn: FIN.warn, danger: FIN.danger }[tone];
  const labelColor = tone === "default" ? (hero ? "rgba(232,239,245,0.5)" : FIN.muted) : toneColor;
  const body = (
    <>
      <div className="flex items-center gap-1.5" style={{ fontSize: 10, color: labelColor, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginBottom: 6 }}>
        {icon} {label}
      </div>
      <div style={{ fontFamily: FIN.display, fontSize: 18, color: toneColor, lineHeight: 1.15, minHeight: 21 }}>
        {loading ? <Skeleton width="60%" height={16} style={hero ? { background: "rgba(255,255,255,0.12)" } : undefined} /> : value}
      </div>
      {hint ? <div style={{ fontSize: 11, color: hero ? "rgba(232,239,245,0.45)" : FIN.muted, marginTop: 4 }}>{hint}</div> : null}
    </>
  );
  const frame: CSSProperties = hero
    ? { padding: "14px 18px", borderRight: "1px solid rgba(255,255,255,0.07)", borderBottom: "1px solid rgba(255,255,255,0.07)", minWidth: 0, textAlign: "left" }
    : { padding: "14px 16px", background: FIN.card, border: `1px solid ${FIN.border}`, borderRadius: 14, minWidth: 0, textAlign: "left" };
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="transition-opacity hover:opacity-85" style={{ ...frame, background: hero ? "transparent" : FIN.card, cursor: "pointer", font: "inherit", color: "inherit" }}>
        {body}
      </button>
    );
  }
  return <div style={frame}>{body}</div>;
}

/** A titled card; `flush` for a table that runs edge to edge. */
export function SectionCard({
  title,
  subtitle,
  icon,
  actions,
  children,
  footer,
  flush = false,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  flush?: boolean | undefined;
}): ReactElement {
  return (
    <Card style={{ overflow: "hidden" }}>
      <div className="flex items-center justify-between flex-wrap gap-3" style={{ padding: "14px 20px", borderBottom: `1px solid ${FIN.border}` }}>
        <div style={{ minWidth: 0 }}>
          <div className="flex items-center gap-2 nuru-section-title">
            {icon ? <span style={{ display: "inline-flex", color: FIN.navy }}>{icon}</span> : null}
            {title}
          </div>
          {subtitle ? <div style={{ fontSize: 12, color: FIN.muted, marginTop: 2 }}>{subtitle}</div> : null}
        </div>
        {actions ? <div className="flex items-center gap-2 flex-wrap">{actions}</div> : null}
      </div>
      <div style={flush ? undefined : { padding: 20 }}>{children}</div>
      {footer ? <div style={{ borderTop: `1px solid ${FIN.border}`, padding: "12px 20px" }}>{footer}</div> : null}
    </Card>
  );
}

export interface TabDef<K extends string> {
  key: K;
  label: string;
  /** A count badge (e.g. items waiting); hidden when 0 / absent. */
  count?: number | null | undefined;
  hidden?: boolean | undefined;
}

/**
 * The tab bar. Pair it with useUrlTab so the tab lives in `?tab=`:
 *
 *   const [tab, setTab] = useUrlTab(["postings", "journals", "trial"] as const, "postings");
 *   <FinancePage tabs={<Tabs tabs={TABS} value={tab} onChange={setTab} />} …>
 */
export function Tabs<K extends string>({
  tabs,
  value,
  onChange,
  ariaLabel = "Sections",
}: {
  tabs: readonly TabDef<K>[];
  value: K;
  onChange: (tab: K) => void;
  ariaLabel?: string | undefined;
}): ReactElement {
  return (
    <div role="tablist" aria-label={ariaLabel} className="no-scrollbar" style={{ display: "flex", gap: 4, borderBottom: `1px solid ${FIN.border}`, overflowX: "auto" }}>
      {tabs
        .filter((t) => !t.hidden)
        .map((t) => {
          const active = t.key === value;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(t.key)}
              style={{
                padding: "12px 16px",
                border: "none",
                background: "transparent",
                color: active ? FIN.navy : FIN.muted,
                fontSize: 14,
                fontWeight: active ? 700 : 500,
                borderBottom: active ? `2px solid ${FIN.gold}` : "2px solid transparent",
                marginBottom: -1,
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {t.label}
              {t.count ? (
                <span style={{ minWidth: 18, height: 18, padding: "0 6px", borderRadius: 999, background: "#FFF4DA", color: FIN.warn, fontFamily: FIN.mono, fontSize: 11, lineHeight: "18px", textAlign: "center" }}>
                  {t.count}
                </span>
              ) : null}
            </button>
          );
        })}
    </div>
  );
}

/* ====================================================================== */
/* Money display + input                                                    */
/* ====================================================================== */

/** An amount in DM Mono; negative amounts in the danger colour. */
export function MoneyText({
  amount_minor,
  currency,
  strong = false,
  withCode = true,
  style,
}: {
  amount_minor: MinorInput | null | undefined;
  currency: string | null | undefined;
  strong?: boolean | undefined;
  withCode?: boolean | undefined;
  style?: CSSProperties | undefined;
}): ReactElement {
  const n = toMinorBigInt(amount_minor);
  return (
    <span style={{ fontFamily: FIN.mono, fontWeight: strong ? 700 : 500, whiteSpace: "nowrap", color: n !== null && n < 0n ? FIN.danger : undefined, ...style }}>
      {formatMinor(amount_minor, currency, { withCode })}
    </span>
  );
}

/** One line per currency (KES first) — the value of a multi-currency KPI. */
export function PerCurrency({
  amounts,
  empty = "—",
  style,
}: {
  amounts: readonly { currency: string; amount_minor: number }[];
  empty?: ReactNode;
  style?: CSSProperties | undefined;
}): ReactElement {
  if (amounts.length === 0) return <span style={style}>{empty}</span>;
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2, ...style }}>
      {sortTotals(amounts).map((a) => (
        <span key={a.currency} style={{ whiteSpace: "nowrap" }}>
          {formatMinor(a.amount_minor, a.currency)}
        </span>
      ))}
    </span>
  );
}

/** Per-currency totals of the filtered set, above a register. */
export function TotalsStrip({
  totals,
  loading = false,
  label = "Total",
  noun = ["item", "items"],
  extra,
}: {
  totals: readonly CurrencyTotal[];
  loading?: boolean | undefined;
  label?: string | undefined;
  /** [singular, plural] for the count under each amount. */
  noun?: readonly [string, string] | undefined;
  /** Right-hand note (e.g. "succeeded gifts only"). */
  extra?: ReactNode;
}): ReactElement {
  return (
    <Card style={{ padding: "12px 18px" }}>
      <div className="flex items-center flex-wrap" style={{ gap: "10px 28px", opacity: loading && totals.length > 0 ? 0.55 : 1, transition: "opacity 150ms" }} aria-busy={loading}>
        <span className="nuru-eyebrow">{label}</span>
        {loading && totals.length === 0 ? (
          <Skeleton width={160} height={16} />
        ) : totals.length === 0 ? (
          <span style={{ fontSize: 13, color: FIN.muted }}>Nothing in this selection.</span>
        ) : (
          sortTotals(totals).map((t) => (
            <span key={t.currency} className="inline-flex items-baseline" style={{ gap: 8 }}>
              <MoneyText amount_minor={t.amount_minor} currency={t.currency} strong style={{ fontSize: 15, color: FIN.navy }} />
              <span style={{ fontSize: 11.5, color: FIN.muted }}>
                {t.count.toLocaleString()} {t.count === 1 ? noun[0] : noun[1]}
              </span>
            </span>
          ))
        )}
        {extra ? <span style={{ marginLeft: "auto", fontSize: 11.5, color: FIN.muted }}>{extra}</span> : null}
      </div>
    </Card>
  );
}

/**
 * A money field. `value` is the text as typed (never a float); every change
 * reports the parse (parseMajorToMinor) so the form holds integer minor units.
 * The error shows once the field was left (or when `showError`), and a valid
 * amount is echoed back formatted ("= KES 1,500.00") so a slipped zero is seen
 * before it is saved.
 */
export function MoneyInput({
  value,
  onChange,
  currency,
  currencies,
  onCurrencyChange,
  id,
  disabled = false,
  autoFocus = false,
  max,
  showError = false,
  placeholder = "0.00",
}: {
  value: string;
  onChange: (text: string, parsed: ParsedAmount) => void;
  currency: string;
  /** More than one → a currency picker in front of the amount. */
  currencies?: readonly string[] | undefined;
  onCurrencyChange?: ((currency: string) => void) | undefined;
  id?: string | undefined;
  disabled?: boolean | undefined;
  autoFocus?: boolean | undefined;
  /** Upper bound in minor units (default MAX_AMOUNT_MINOR). */
  max?: number | undefined;
  showError?: boolean | undefined;
  placeholder?: string | undefined;
}): ReactElement {
  const [touched, setTouched] = useState(false);
  const parsed = parseMajorToMinor(value, { max });
  const errorVisible = (touched || showError) && value.trim() !== "" ? !parsed.ok : showError && value.trim() === "";
  const picker = currencies && currencies.length > 1 && onCurrencyChange;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <div className="flex items-stretch" style={{ minWidth: 0 }}>
        {picker ? (
          <select
            aria-label="Currency"
            value={currency}
            disabled={disabled}
            onChange={(e) => onCurrencyChange(e.target.value)}
            style={{ ...selectStyle, borderRadius: "10px 0 0 10px", borderRight: "none", fontFamily: FIN.mono, flexShrink: 0, background: FIN.surface }}
          >
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        ) : (
          <span
            className="inline-flex items-center"
            style={{ padding: "0 12px", border: `1px solid ${FIN.border}`, borderRight: "none", borderRadius: "10px 0 0 10px", background: FIN.surface, fontFamily: FIN.mono, fontSize: 12.5, color: FIN.navy, flexShrink: 0 }}
          >
            {currency}
          </span>
        )}
        <input
          id={id}
          value={value}
          disabled={disabled}
          autoFocus={autoFocus}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          aria-invalid={errorVisible ? "true" : undefined}
          onBlur={() => setTouched(true)}
          onChange={(e) => onChange(e.target.value, parseMajorToMinor(e.target.value, { max }))}
          style={{ ...inputStyle, borderRadius: "0 10px 10px 0", fontFamily: FIN.mono, borderColor: errorVisible ? "#F5C2C0" : FIN.border }}
        />
      </div>
      {errorVisible ? (
        <span role="alert" style={{ fontSize: 11.5, color: FIN.danger, fontWeight: 600 }}>
          {parsed.ok ? "Enter an amount." : parsed.error}
        </span>
      ) : parsed.ok ? (
        <span style={{ fontSize: 11.5, color: FIN.muted, fontFamily: FIN.mono }}>= {formatMinor(parsed.minor, currency)}</span>
      ) : null}
    </div>
  );
}

/* ====================================================================== */
/* Status chips                                                             */
/* ====================================================================== */

export interface ChipStyle {
  label: string;
  bg: string;
  color: string;
}
const GREEN = { bg: "#E8F6EC", color: "#0F6B33" };
const AMBER = { bg: "#FFF4DA", color: "#A87616" };
const ROSE = { bg: "#FDECEC", color: "#B42318" };
const VIOLET = { bg: "#F3EAFE", color: "#7C3AED" };
const GREY = { bg: "#EEF0F3", color: "#6B7280" };
const NAVY = { bg: "#E6EDF5", color: "#1E4068" };

/** One colour per meaning, module-wide: green = done/good, amber = waiting on
 *  someone, rose = failed/refused, violet = reversed/fulfilled, grey = inert,
 *  navy = entered but not yet posted. */
export const STATUS_CHIPS: Readonly<Record<string, ChipStyle>> = {
  // transactions
  succeeded: { label: "Succeeded", ...GREEN },
  processing: { label: "Processing", ...AMBER },
  requires_action: { label: "Awaiting payer", ...AMBER },
  failed: { label: "Failed", ...ROSE },
  refunded: { label: "Refunded", ...VIOLET },
  // expenses (maker-checker)
  recorded: { label: "Recorded", ...NAVY },
  approved: { label: "Approved", ...GREEN },
  void: { label: "Void", ...GREY },
  // budgets
  draft: { label: "Draft", ...GREY },
  // claims / needs
  pending: { label: "Pending", ...AMBER },
  confirmed: { label: "Confirmed", ...GREEN },
  rejected: { label: "Rejected", ...ROSE },
  closed: { label: "Closed", ...GREY },
  // pledge standing
  on_track: { label: "On track", ...GREEN },
  behind: { label: "Behind", ...AMBER },
  fulfilled: { label: "Fulfilled", ...VIOLET },
  // pledges / schedules / funds
  active: { label: "Active", ...GREEN },
  paused: { label: "Paused", ...GREY },
  cancelled: { label: "Cancelled", ...GREY },
  inactive: { label: "Inactive", ...GREY },
  // campaigns
  live: { label: "Live", ...GREEN },
  ended: { label: "Ended", ...GREY },
  // ledger integrity
  balanced: { label: "Balanced", ...GREEN },
  unbalanced: { label: "Unbalanced", ...ROSE },
};

/** The chip for a status; unknown statuses get a neutral chip with a readable label. */
export function statusChip(status: string | null | undefined): ChipStyle {
  const k = (status ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const known = STATUS_CHIPS[k];
  if (known) return known;
  const words = k.replace(/_/g, " ");
  return { label: words ? words.charAt(0).toUpperCase() + words.slice(1) : "—", ...GREY };
}

export function StatusChip({ status, label, title }: { status: string | null | undefined; label?: string | undefined; title?: string | undefined }): ReactElement {
  const c = statusChip(status);
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 rounded-full"
      style={{ background: c.bg, color: c.color, padding: "3px 9px", fontSize: 11, fontWeight: 700, letterSpacing: 0.2, whiteSpace: "nowrap" }}
    >
      {label ?? c.label}
    </span>
  );
}

/* ====================================================================== */
/* Notices + toasts                                                         */
/* ====================================================================== */

export function Notice({
  tone = "info",
  children,
  onDismiss,
  action,
  style,
}: {
  tone?: Tone | undefined;
  children: ReactNode;
  onDismiss?: (() => void) | undefined;
  action?: ReactNode;
  style?: CSSProperties | undefined;
}): ReactElement {
  const t = TONES[tone];
  const Icon = tone === "ok" ? Check : tone === "info" ? Info : AlertTriangle;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className="flex items-center gap-2 rounded-lg"
      style={{ background: t.bg, color: t.color, border: `1px solid ${t.border}`, fontSize: 12.5, fontWeight: 600, padding: "8px 12px", ...style }}
    >
      <Icon size={14} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      {action}
      {onDismiss ? (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" style={{ background: "transparent", border: "none", color: "inherit", padding: 2, display: "inline-flex" }}>
          <X size={13} />
        </button>
      ) : null}
    </div>
  );
}

export type ShowToast = (text: string, tone?: Tone) => void;
interface ToastItem {
  id: number;
  text: string;
  tone: Tone;
}
const toastMs = (tone: Tone): number => (tone === "error" ? 7_000 : 4_000);

// One module-level toast, so useFinanceToast() works from anywhere — including
// the page component that itself renders <FinancePage> (a context provider
// inside FinancePage would be BELOW that caller and swallow its toasts).
// FinancePage mounts the <FinanceToaster> that shows it.
let toastNow: ToastItem | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let toastSeq = 0;
let toastersMounted = 0;
const toastListeners = new Set<() => void>();
const notifyToast = (): void => toastListeners.forEach((l) => l());
const subscribeToast = (l: () => void): (() => void) => {
  toastListeners.add(l);
  return () => {
    toastListeners.delete(l);
  };
};

/** Show a toast on the mounted FinanceToaster ("Recorded as OR-2026-00042"). */
export const showFinanceToast: ShowToast = (text, tone = "ok") => {
  if (toastTimer) clearTimeout(toastTimer);
  const id = ++toastSeq;
  toastNow = { id, text, tone };
  notifyToast();
  toastTimer = setTimeout(() => {
    toastTimer = null;
    if (toastNow?.id === id) {
      toastNow = null;
      notifyToast();
    }
  }, toastMs(tone));
};

/** A component-local toast (the fallback when no FinanceToaster is mounted). */
function useLocalToast(): [ToastItem | null, ShowToast] {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback<ShowToast>((text, tone = "ok") => {
    if (timer.current) clearTimeout(timer.current);
    const id = ++toastSeq;
    setToast({ id, text, tone });
    timer.current = setTimeout(() => {
      timer.current = null;
      setToast((t) => (t && t.id === id ? null : t));
    }, toastMs(tone));
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return [toast, show];
}

function ToastView({ toast }: { toast: ToastItem }): ReactElement {
  const error = toast.tone === "error";
  const Icon = toast.tone === "ok" ? Check : toast.tone === "info" ? Info : AlertTriangle;
  return (
    <div
      role={error ? "alert" : "status"}
      aria-live={error ? "assertive" : "polite"}
      style={{
        position: "fixed",
        left: "50%",
        bottom: 24,
        transform: "translateX(-50%)",
        zIndex: 95,
        background: error ? FIN.danger : FIN.dark,
        color: "#fff",
        padding: "10px 16px",
        borderRadius: 12,
        fontSize: 13,
        fontWeight: 600,
        boxShadow: "0 10px 30px rgba(7,22,41,0.35)",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        maxWidth: "calc(100vw - 32px)",
      }}
    >
      <Icon size={14} style={{ flexShrink: 0, color: toast.tone === "warn" ? "#F5C77E" : undefined }} />
      <span>{toast.text}</span>
    </div>
  );
}

/** Shows the current Finance toast. FinancePage mounts one; mount it yourself
 *  only on a page that does not use FinancePage. */
export function FinanceToaster(): ReactElement | null {
  const toast = useSyncExternalStore(subscribeToast, () => toastNow, () => null);
  useEffect(() => {
    toastersMounted++;
    return () => {
      toastersMounted--;
    };
  }, []);
  return toast ? <ToastView key={toast.id} toast={toast} /> : null;
}

/** show(text, tone?) — a transient confirmation or error, from anywhere on a
 *  Finance page (including the page component that renders <FinancePage>). */
export function useFinanceToast(): ShowToast {
  return showFinanceToast;
}

/* ====================================================================== */
/* Overlays                                                                 */
/* ====================================================================== */

// Stacked overlays (a ConfirmDialog over a Drawer): Escape closes only the top one.
const overlayStack: number[] = [];
let overlaySeq = 0;

function useOverlay(open: boolean, onEscape: () => void, panel: RefObject<HTMLElement | null>): void {
  const escape = useRef(onEscape);
  useLayoutEffect(() => {
    escape.current = onEscape;
  });
  useEffect(() => {
    if (!open) return;
    const id = ++overlaySeq;
    overlayStack.push(id);
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Focus the first [data-autofocus] control inside, else the panel itself.
    (panel.current?.querySelector<HTMLElement>("[data-autofocus]") ?? panel.current)?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape" || overlayStack[overlayStack.length - 1] !== id) return;
      e.stopPropagation();
      escape.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const i = overlayStack.indexOf(id);
      if (i >= 0) overlayStack.splice(i, 1);
      returnTo?.focus?.();
    };
  }, [open, panel]);
}

/** The right-hand drawer: Escape or the overlay closes it; `footer` holds the actions. */
export function Drawer({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 640,
}: {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number | undefined;
}): ReactElement | null {
  const panel = useRef<HTMLDivElement | null>(null);
  useOverlay(open, onClose, panel);
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 80 }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(7,22,41,0.42)" }} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        tabIndex={-1}
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: `min(${width}px, 100vw)`,
          background: FIN.card,
          display: "flex",
          flexDirection: "column",
          boxShadow: "-20px 0 50px rgba(0,0,0,0.15)",
          outline: "none",
        }}
      >
        <div style={{ padding: "18px 22px", borderBottom: `1px solid ${FIN.border}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: FIN.display, fontSize: 20, color: FIN.navy, lineHeight: 1.2 }}>{title}</div>
            {subtitle ? <div style={{ fontSize: 12.5, color: FIN.muted, marginTop: 4 }}>{subtitle}</div> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: "transparent", border: "none", color: FIN.muted, padding: 4, display: "inline-flex" }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 22 }}>{children}</div>
        {footer ? (
          <div className="flex items-center flex-wrap" style={{ borderTop: `1px solid ${FIN.border}`, padding: 16, gap: 8, justifyContent: "flex-end" }}>
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** A reason the person must give (reversals, voids): trimmed length min..max. */
export interface ReasonRule {
  label?: string | undefined;
  placeholder?: string | undefined;
  min: number;
  max: number;
}

/**
 * Ask before a consequential action. With `reason`, a textarea with a live
 * counter is required (trimmed min..max) and passed to onConfirm. onConfirm may
 * return a promise: the dialog shows a spinner, and if it throws, the server's
 * message is shown in the dialog (the parent closes it on success).
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  reason,
  onConfirm,
  onCancel,
  errorFallback = "That did not go through.",
}: {
  open: boolean;
  title: string;
  body?: ReactNode;
  confirmLabel?: string | undefined;
  cancelLabel?: string | undefined;
  tone?: "default" | "danger" | undefined;
  reason?: ReasonRule | undefined;
  onConfirm: (reason: string | null) => void | Promise<void>;
  onCancel: () => void;
  errorFallback?: string | undefined;
}): ReactElement | null {
  const panel = useRef<HTMLDivElement | null>(null);
  const reasonId = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (open) {
      setText("");
      setError(null);
      setBusy(false);
    }
  }, [open]);
  useOverlay(open, () => {
    if (!busy) onCancel();
  }, panel);
  if (!open) return null;

  const trimmed = text.trim();
  const reasonOk = !reason || (trimmed.length >= reason.min && trimmed.length <= reason.max);
  const submit = async (): Promise<void> => {
    if (!reasonOk || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason ? trimmed : null);
    } catch (e) {
      if (alive.current) setError(financeErrorMessage(e, errorFallback));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 90, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={() => (busy ? undefined : onCancel())} style={{ position: "absolute", inset: 0, background: "rgba(7,22,41,0.5)" }} />
      <div
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{ position: "relative", width: "min(480px, 100%)", maxHeight: "calc(100vh - 32px)", overflowY: "auto", background: FIN.card, borderRadius: 16, boxShadow: "0 24px 60px rgba(7,22,41,0.35)", outline: "none" }}
      >
        <div style={{ padding: "20px 22px 8px" }}>
          <div style={{ fontFamily: FIN.display, fontSize: 20, color: FIN.navy, lineHeight: 1.2 }}>{title}</div>
          {body ? <div style={{ fontSize: 13, color: FIN.navy, lineHeight: 1.55, marginTop: 10 }}>{body}</div> : null}
          {reason ? (
            <div style={{ marginTop: 14 }}>
              <Field label={reason.label ?? "Reason"} htmlFor={reasonId} required>
                <textarea
                  id={reasonId}
                  data-autofocus
                  value={text}
                  maxLength={reason.max}
                  placeholder={reason.placeholder}
                  onChange={(e) => setText(e.target.value)}
                  style={textareaStyle}
                  aria-label={reason.label ?? "Reason"}
                />
              </Field>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 11.5, color: reasonOk || trimmed.length === 0 ? FIN.muted : FIN.warn }}>
                <span>{trimmed.length < reason.min ? `At least ${reason.min} characters.` : ""}</span>
                <span style={{ fontFamily: FIN.mono }}>
                  {trimmed.length} / {reason.max}
                </span>
              </div>
            </div>
          ) : null}
          {error ? (
            <Notice tone="error" style={{ marginTop: 12 }}>
              {error}
            </Notice>
          ) : null}
        </div>
        <div className="flex items-center flex-wrap" style={{ gap: 8, justifyContent: "flex-end", padding: "12px 22px 20px" }}>
          <Button onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={() => void submit()} busy={busy} disabled={!reasonOk}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ====================================================================== */
/* Filters                                                                  */
/* ====================================================================== */

export interface FilterOption {
  value: string;
  label: string;
}
export interface FilterSelect {
  key: string;
  /** Shown before the chosen option: "Fund: Tithe". */
  label: string;
  value: string;
  options: readonly FilterOption[];
  onChange: (value: string) => void;
}

const dateInputStyle: CSSProperties = { ...inputStyle, width: 150, fontFamily: FIN.mono, fontSize: 12.5 };

/**
 * The filter row above a register: a period (preset or custom EAT days), any
 * selects, a debounced search, and "Clear" (shown while `clearable`). Every
 * control is optional; each reports through its own callback.
 */
export function FilterBar({
  period,
  onPeriodChange,
  presets,
  selects,
  search,
  onSearchChange,
  searchPlaceholder = "Search",
  debounceMs = 300,
  clearable = false,
  onClear,
  trailing,
}: {
  period?: PeriodValue | undefined;
  onPeriodChange?: ((period: PeriodValue) => void) | undefined;
  /** Which presets to offer (default: all of DATE_PRESETS). */
  presets?: readonly DatePreset[] | undefined;
  selects?: readonly FilterSelect[] | undefined;
  /** The committed (debounced) search text. */
  search?: string | undefined;
  onSearchChange?: ((q: string) => void) | undefined;
  searchPlaceholder?: string | undefined;
  debounceMs?: number | undefined;
  /** Show "Clear" — the page decides whether any filter differs from its default. */
  clearable?: boolean | undefined;
  onClear?: (() => void) | undefined;
  /** Right end of the row (e.g. an ExportButton). */
  trailing?: ReactNode;
}): ReactElement {
  // search: the text shows at once; the page hears it `debounceMs` later.
  const [text, setText] = useState(search ?? "");
  const committed = useRef(search ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emit = useRef(onSearchChange);
  useLayoutEffect(() => {
    emit.current = onSearchChange;
  });
  useEffect(() => {
    const next = search ?? "";
    if (next !== committed.current) {
      committed.current = next;
      setText(next);
    }
  }, [search]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const onType = (value: string): void => {
    setText(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const q = value.trim();
      if (q === committed.current) return;
      committed.current = q;
      emit.current?.(q);
    }, debounceMs);
  };
  const clear = (): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setText("");
    committed.current = "";
    onClear?.();
  };

  // custom period: edited as a draft, committed only when it is a real range.
  const [draft, setDraft] = useState({ from: period?.from ?? "", to: period?.to ?? "" });
  useEffect(() => {
    setDraft({ from: period?.from ?? "", to: period?.to ?? "" });
  }, [period?.from, period?.to]);
  const custom = period?.preset === "custom";
  const draftError = custom ? rangeError(draft) : null;
  const commitDraft = (next: { from: string; to: string }): void => {
    setDraft(next);
    if (!rangeError(next)) onPeriodChange?.({ preset: "custom", from: next.from, to: next.to });
  };
  const offered = DATE_PRESETS.filter((p) => !presets || presets.includes(p.key));

  return (
    <Card style={{ padding: "12px 14px" }}>
      <div className="flex items-center flex-wrap" style={{ gap: 8 }}>
        {onSearchChange ? (
          <div style={{ position: "relative", flex: "1 1 220px", minWidth: 0, maxWidth: 360 }}>
            <Search size={14} color="#6B7280" style={{ position: "absolute", left: 10, top: 11, pointerEvents: "none" }} />
            <input
              type="search"
              value={text}
              onChange={(e) => onType(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              style={{ ...inputStyle, paddingLeft: 30 }}
            />
          </div>
        ) : null}
        {period && onPeriodChange ? (
          <div className="flex items-center flex-wrap" style={{ gap: 8, minWidth: 0 }}>
            <select
              aria-label="Period"
              value={period.preset}
              onChange={(e) => {
                const p = e.target.value as DatePreset;
                onPeriodChange(p === "custom" ? { preset: "custom", from: period.from, to: period.to } : periodFor(p));
              }}
              style={selectStyle}
            >
              {offered.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
            {custom ? (
              <>
                <input type="date" aria-label="From" value={draft.from} max={draft.to || undefined} onChange={(e) => commitDraft({ ...draft, from: e.target.value })} style={dateInputStyle} />
                <span style={{ color: FIN.muted }}>–</span>
                <input type="date" aria-label="To" value={draft.to} min={draft.from || undefined} onChange={(e) => commitDraft({ ...draft, to: e.target.value })} style={dateInputStyle} />
                {draftError ? (
                  <span role="alert" style={{ fontSize: 11.5, color: FIN.danger, fontWeight: 600 }}>
                    {draftError}
                  </span>
                ) : null}
              </>
            ) : (
              <span style={{ fontSize: 12, color: FIN.muted, fontFamily: FIN.mono, whiteSpace: "nowrap" }}>{fmtRange(period)}</span>
            )}
          </div>
        ) : null}
        {(selects ?? []).map((s) => (
          <select key={s.key} aria-label={s.label} value={s.value} onChange={(e) => s.onChange(e.target.value)} style={selectStyle}>
            {s.options.map((o) => (
              <option key={o.value} value={o.value}>
                {s.label}: {o.label}
              </option>
            ))}
          </select>
        ))}
        {clearable && onClear ? (
          <Button variant="ghost" icon={<X size={13} />} onClick={clear}>
            Clear
          </Button>
        ) : null}
        {trailing ? <div className="flex items-center gap-2 flex-wrap" style={{ marginLeft: "auto" }}>{trailing}</div> : null}
      </div>
    </Card>
  );
}

/* ====================================================================== */
/* DataTable                                                                */
/* ====================================================================== */

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  align?: "left" | "right" | "center" | undefined;
  width?: number | string | undefined;
  /** DM Mono — amounts, dates, codes (and no wrapping). */
  mono?: boolean | undefined;
  nowrap?: boolean | undefined;
  /** Leave the column out (e.g. one only managers need). */
  hidden?: boolean | undefined;
}

export interface DataTableProps<T> {
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  onRowClick?: ((row: T) => void) | undefined;
  /** The row whose drawer is open. */
  selectedKey?: string | null | undefined;
  /** The first page is in flight: skeleton rows when empty, dimmed rows otherwise. */
  loading?: boolean | undefined;
  error?: string | null | undefined;
  onRetry?: (() => void) | undefined;
  /** What an empty result says (e.g. "No gifts match these filters."). */
  empty?: ReactNode;
  hasMore?: boolean | undefined;
  loadingMore?: boolean | undefined;
  moreError?: string | null | undefined;
  onLoadMore?: (() => void) | undefined;
  /** The table's min width; narrower screens scroll the table inside its card. */
  minWidth?: number | undefined;
  /** <tfoot> rows (e.g. a totals row). */
  footer?: ReactNode;
  skeletonRows?: number | undefined;
  ariaLabel?: string | undefined;
}

/**
 * A register table. Put it in a flush SectionCard (or a Card with overflow
 * hidden). Rows are clickable (and keyboard-reachable) when onRowClick is set;
 * "Load more" appears while hasMore — wire it with usePagedList.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  selectedKey,
  loading = false,
  error,
  onRetry,
  empty = "Nothing here yet.",
  hasMore = false,
  loadingMore = false,
  moreError,
  onLoadMore,
  minWidth = 720,
  footer,
  skeletonRows = 6,
  ariaLabel,
}: DataTableProps<T>): ReactElement {
  const cols = columns.filter((c) => !c.hidden);
  const span = Math.max(cols.length, 1);
  const tdBase: CSSProperties = { padding: "10px 16px", fontSize: 12.5, color: FIN.navy, verticalAlign: "middle" };
  const cellStyle = (c: Column<T>): CSSProperties => ({
    ...tdBase,
    textAlign: c.align ?? "left",
    fontFamily: c.mono ? FIN.mono : undefined,
    whiteSpace: c.nowrap || c.mono ? "nowrap" : undefined,
    width: c.width,
  });
  let body: ReactNode;
  if (error) {
    body = (
      <tr>
        <td colSpan={span}>
          <ErrorState message={error} onRetry={onRetry} />
        </td>
      </tr>
    );
  } else if (loading && rows.length === 0) {
    body = Array.from({ length: skeletonRows }, (_, i) => (
      <tr key={`sk-${i}`} style={{ borderTop: `1px solid ${FIN.border}` }}>
        {cols.map((c) => (
          <td key={c.key} style={cellStyle(c)}>
            <Skeleton width={c.align === "right" ? "70%" : "85%"} />
          </td>
        ))}
      </tr>
    ));
  } else if (rows.length === 0) {
    body = (
      <tr>
        <td colSpan={span} style={{ padding: 0 }}>
          <EmptyState>{empty}</EmptyState>
        </td>
      </tr>
    );
  } else {
    body = rows.map((row, i) => {
      const k = rowKey(row);
      const selected = selectedKey != null && selectedKey === k;
      return (
        <tr
          key={k}
          onClick={onRowClick ? () => onRowClick(row) : undefined}
          onKeyDown={
            onRowClick
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onRowClick(row);
                  }
                }
              : undefined
          }
          tabIndex={onRowClick ? 0 : undefined}
          aria-selected={onRowClick ? selected : undefined}
          className={`${onRowClick ? "cursor-pointer " : ""}transition-colors even:bg-[rgba(238,240,243,0.4)] hover:bg-[var(--input-background)]`}
          style={{ borderTop: `1px solid ${FIN.border}`, background: selected ? "#FDF5E5" : undefined, outlineOffset: -2 }}
        >
          {cols.map((c) => (
            <td key={c.key} style={cellStyle(c)}>
              {c.cell(row, i)}
            </td>
          ))}
        </tr>
      );
    });
  }
  return (
    <>
      <div className="r-table-scroll" style={{ overflowX: "auto", maxWidth: "100%" }}>
        <table aria-label={ariaLabel} aria-busy={loading} style={{ width: "100%", borderCollapse: "collapse", minWidth }}>
          <thead>
            <tr style={{ background: FIN.surface }}>
              {cols.map((c) => (
                <th key={c.key} scope="col" style={{ ...thStyle, textAlign: c.align ?? "left", width: c.width }}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody style={{ opacity: loading && rows.length > 0 && !error ? 0.55 : 1, transition: "opacity 150ms" }}>{body}</tbody>
          {footer && !error && rows.length > 0 ? <tfoot>{footer}</tfoot> : null}
        </table>
      </div>
      {!error && (hasMore || moreError) && onLoadMore ? (
        <div className="flex items-center justify-center flex-wrap" style={{ gap: 10, padding: 12, borderTop: `1px solid ${FIN.border}` }}>
          {moreError ? (
            <span role="alert" style={{ fontSize: 12, color: FIN.danger, fontWeight: 600 }}>
              {moreError}
            </span>
          ) : null}
          <Button onClick={onLoadMore} busy={loadingMore} disabled={loading}>
            {moreError ? "Try again" : "Load more"}
          </Button>
        </div>
      ) : null}
    </>
  );
}

/* ====================================================================== */
/* Downloads                                                                */
/* ====================================================================== */

export interface DownloadButtonProps {
  /** API path relative to /v1, e.g. "/admin/finance/transactions.csv". */
  path: string;
  params?: QueryParams | undefined;
  /** Saved as (the extension is added when missing). */
  filename: string;
  kind?: "csv" | "pdf" | undefined;
  label?: string | undefined;
  onDark?: boolean | undefined;
  variant?: ButtonVariant | undefined;
  size?: "sm" | "md" | undefined;
}

/** Fetches with the portal's auth and saves the file; a spinner while it runs,
 *  an error toast (the server's own message) if it fails. */
export function DownloadButton({ path, params, filename, kind = "csv", label, onDark = false, variant = "secondary", size = "md" }: DownloadButtonProps): ReactElement {
  const [busy, setBusy] = useState(false);
  const [localToast, showLocal] = useLocalToast();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await (kind === "pdf" ? downloadPdf : downloadCsv)(path, params, filename);
    } catch (e) {
      const msg = financeErrorMessage(e, kind === "pdf" ? "Could not download the PDF." : "Could not export the CSV.");
      // On a FinancePage the page's toaster shows it; elsewhere (e.g. inside
      // the Partners page) this button shows its own.
      if (toastersMounted > 0) showFinanceToast(msg, "error");
      else if (alive.current) showLocal(msg, "error");
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return (
    <>
      <Button
        onClick={() => void run()}
        busy={busy}
        onDark={onDark}
        variant={variant}
        size={size}
        icon={kind === "pdf" ? <FileText size={13} /> : <Download size={13} />}
      >
        {label ?? (kind === "pdf" ? "Download PDF" : "Export CSV")}
      </Button>
      {localToast ? <ToastView key={localToast.id} toast={localToast} /> : null}
    </>
  );
}

/** A CSV export — rendered only for finance:export (hidden, not greyed, while
 *  /me loads or without the capability). */
export function ExportButton(props: Omit<DownloadButtonProps, "kind">): ReactElement | null {
  const caps = useFinanceCaps();
  if (!caps.export) return null;
  return <DownloadButton {...props} kind="csv" />;
}

/* ====================================================================== */
/* Display helpers                                                          */
/* ====================================================================== */

const firstText = (...xs: (string | null | undefined)[]): string | null => {
  for (const x of xs) if (typeof x === "string" && x.trim()) return x.trim();
  return null;
};

/** Who gave, as every Finance page names them: member name → giver name →
 *  giver phone → "Anonymous" (walk-in and anonymous office gifts have no
 *  member). Register rows already carry this as `display_name`; use this for
 *  shapes that don't (the books' gift result). */
export function giverDisplayName(p: {
  member_name?: string | null | undefined;
  full_name?: string | null | undefined;
  giver_name?: string | null | undefined;
  giver_phone?: string | null | undefined;
}): string {
  return firstText(p.member_name, p.full_name, p.giver_name, p.giver_phone) ?? "Anonymous";
}

/** Readable names for channels (FinanceChannel + office channels). */
export const CHANNEL_LABELS: Readonly<Record<string, string>> = {
  card: "Card",
  stripe: "Card",
  mpesa: "M-Pesa",
  airtel: "Airtel Money",
  paypal: "PayPal",
  manual: "Manual",
  onhand: "Cash",
  bank: "Bank",
  cheque: "Cheque",
  other: "Other",
};
export function channelLabel(channel: string | null | undefined): string {
  if (!channel) return "—";
  return CHANNEL_LABELS[channel] ?? channel.charAt(0).toUpperCase() + channel.slice(1);
}
