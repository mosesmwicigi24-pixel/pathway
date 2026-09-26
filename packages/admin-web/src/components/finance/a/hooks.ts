// Hooks shared by the Finance pages of set A (Overview, Transactions, Funds,
// Ledger, Reconciliation, Audit, Settings): a period kept in the URL (so every
// view can be linked to), a single-shot loader that drops stale answers, and
// the funds list most forms and filters need.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FinanceApi, financeErrorMessage, type FinanceFundRow } from "../../../api/finance";
import { DATE_PRESETS, periodFor, rangeError, type DatePreset, type PeriodValue } from "../dates";

/* ---------- a period in the URL ---------- */

const isPreset = (v: string | null): v is DatePreset => v !== null && DATE_PRESETS.some((p) => p.key === v);

/**
 * The page's period, kept in `?period=` (plus `?from=&to=` for a custom range)
 * so a link — an Overview alert, "failed in period" — opens the same view.
 * `prefix` namespaces the params when one page has two periods.
 */
export function usePeriodParam(defaultPreset: DatePreset = "this_month", prefix = ""): [PeriodValue, (p: PeriodValue) => void] {
  const [params, setParams] = useSearchParams();
  const pk = `${prefix}period`;
  const fk = `${prefix}from`;
  const tk = `${prefix}to`;
  const raw = params.get(pk);
  const preset: DatePreset = isPreset(raw) ? raw : defaultPreset;
  const from = params.get(fk) ?? "";
  const to = params.get(tk) ?? "";
  const period = useMemo<PeriodValue>(() => {
    if (preset === "custom") return rangeError({ from, to }) ? periodFor(defaultPreset === "custom" ? "this_month" : defaultPreset) : { preset: "custom", from, to };
    return periodFor(preset);
  }, [preset, from, to, defaultPreset]);
  const set = useCallback(
    (p: PeriodValue) => {
      setParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          if (p.preset === defaultPreset && p.preset !== "custom") n.delete(pk);
          else n.set(pk, p.preset);
          if (p.preset === "custom") {
            n.set(fk, p.from);
            n.set(tk, p.to);
          } else {
            n.delete(fk);
            n.delete(tk);
          }
          return n;
        },
        { replace: true },
      );
    },
    [setParams, pk, fk, tk, defaultPreset],
  );
  return [period, set];
}

/** The query string that reopens `p` on another page ("period=last_month"). */
export function periodQuery(p: PeriodValue): string {
  const q = new URLSearchParams();
  q.set("period", p.preset);
  if (p.preset === "custom") {
    q.set("from", p.from);
    q.set("to", p.to);
  }
  return q.toString();
}

/* ---------- a single read ---------- */

export interface AsyncState<T> {
  data: T | null;
  /** In flight (first load, or after the key changed / reload). Earlier data
   *  stays on screen, dimmed by the page, until the answer lands. */
  loading: boolean;
  /** The read failed — data is cleared (never show stale money as current). */
  error: string | null;
  reload: () => void;
}

/** Load `fetcher()` whenever `key` changes; an answer to an older key is dropped. */
export function useAsync<T>(fetcher: () => Promise<T>, key: string, opts: { enabled?: boolean | undefined; errorFallback?: string | undefined } = {}): AsyncState<T> {
  const enabled = opts.enabled !== false;
  const fallback = opts.errorFallback ?? "Could not load this.";
  const ref = useRef(fetcher);
  useLayoutEffect(() => {
    ref.current = fetcher;
  });
  const gen = useRef(0);
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: enabled, error: null });
  const reload = useCallback(() => {
    const g = ++gen.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    ref.current().then(
      (data) => {
        if (g === gen.current) setState({ data, loading: false, error: null });
      },
      (e: unknown) => {
        if (g === gen.current) setState({ data: null, loading: false, error: financeErrorMessage(e, fallback) });
      },
    );
  }, [fallback]);
  useEffect(() => {
    if (enabled) reload();
    else {
      gen.current++;
      setState((s) => ({ ...s, loading: false }));
    }
  }, [key, enabled, reload]);
  return { ...state, reload };
}

/* ---------- funds ---------- */

export interface FundsState {
  rows: FinanceFundRow[];
  active: FinanceFundRow[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  nameOf: (code: string) => string | null;
}

/** Every fund (GET /admin/finance/funds), optionally with a period for its
 *  income figures. Forms offer `active`; filters offer `rows`. */
export function useFunds(period?: { from: string; to: string } | null): FundsState {
  const key = period ? `${period.from}|${period.to}` : "all";
  const s = useAsync(() => FinanceApi.funds(period ? { from: period.from, to: period.to } : {}), key, { errorFallback: "Could not load the funds." });
  const rows = useMemo(() => s.data?.data ?? [], [s.data]);
  const active = useMemo(() => rows.filter((f) => f.is_active), [rows]);
  const nameOf = useCallback((code: string) => rows.find((f) => f.code === code)?.name ?? null, [rows]);
  return { rows, active, loading: s.loading, error: s.error, reload: s.reload, nameOf };
}
