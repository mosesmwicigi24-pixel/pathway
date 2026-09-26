// Finance ERP — small data hooks shared by the Pledges … Statements pages.
// Lists that page (registers) use the kit's usePagedList; these cover the
// one-shot reads (claims, schedules, campaigns, budgets, reports) and the
// look-ups every form needs (funds, expense categories, who "me" is).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAppSelector } from "../../../store/hooks";
import { FinanceApi, financeErrorMessage, type BooksExpenseCategory } from "../../../api/finance";

export interface Resource<T> {
  data: T | null;
  /** In flight (first load, a reload, or after the key changed). The last data stays until the answer lands. */
  loading: boolean;
  /** The last load failed (data is cleared — never show stale money as current). */
  error: string | null;
  reload: () => void;
  /** Replace the data locally (e.g. a row's new status after an action). */
  setData: (update: (d: T | null) => T | null) => void;
}

/**
 * One read, re-run whenever `key` changes; an answer to an older key (or an
 * older reload) is dropped so a slow response never overwrites a newer one.
 * `enabled: false` holds the read (and clears nothing).
 */
export function useResource<T>(load: () => Promise<T>, key: string, opts: { enabled?: boolean | undefined; errorFallback?: string | undefined } = {}): Resource<T> {
  const enabled = opts.enabled !== false;
  const fallback = opts.errorFallback ?? "Could not load this.";
  const loadRef = useRef(load);
  useLayoutEffect(() => {
    loadRef.current = load;
  });
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: enabled, error: null });
  const generation = useRef(0);

  const reload = useCallback(() => {
    const gen = ++generation.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    // Through a resolved promise, so a loader that throws synchronously lands
    // in the error state like any failed read instead of breaking the page.
    Promise.resolve()
      .then(() => loadRef.current())
      .then(
        (data) => {
          if (gen === generation.current) setState({ data, loading: false, error: null });
        },
        (e: unknown) => {
          if (gen === generation.current) setState({ data: null, loading: false, error: financeErrorMessage(e, fallback) });
        },
      );
  }, [fallback]);

  useEffect(() => {
    if (enabled) reload();
    else generation.current++;
  }, [key, enabled, reload]);

  const setData = useCallback((update: (d: T | null) => T | null) => {
    setState((s) => ({ ...s, data: update(s.data) }));
  }, []);

  return { data: state.data, loading: state.loading, error: state.error, reload, setData };
}

/**
 * Set several URL params in ONE navigation. react-router's setSearchParams(fn)
 * hands `fn` the params as they were at render, so two kit useUrlParam
 * setters called in the same event do not compose — the second overwrites the
 * first ("Clear" would reset only the last filter). Use this whenever one
 * action changes more than one param. null or "" removes the param (each
 * page's default then applies, exactly as useUrlParam's fallback does).
 */
export function useSetUrlParams(): (patch: Record<string, string | null>) => void {
  const [, setParams] = useSearchParams();
  return useCallback(
    (patch: Record<string, string | null>) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === null || v === "") p.delete(k);
            else p.set(k, v);
          }
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );
}

/** The signed-in person's permission keys; null while /me loads. */
export function usePermissions(): string[] | null {
  return useAppSelector((s) => s.auth.permissions);
}

/** Decode (never verify) the `sub` claim — the user id — from a JWT. The
 *  server re-checks every write; this only lets a page word what it already
 *  knows ("you recorded this, so another person must approve it"). */
export function decodeSubject(token: string | null | undefined): string | null {
  if (!token) return null;
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const padded = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(padded + "===".slice((padded.length + 3) % 4));
    const payload = JSON.parse(json) as { sub?: unknown };
    return typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

export interface MyIdentity {
  /** My user id (the access token's subject), or null when it cannot be read. */
  userId: string | null;
  role: string | null;
  /** SuperAdmin may approve their own expense (§2 "Maker-checker"). */
  isSuperAdmin: boolean;
}

export function useMyIdentity(): MyIdentity {
  const accessToken = useAppSelector((s) => s.auth.accessToken);
  const role = useAppSelector((s) => s.auth.role);
  return useMemo(() => ({ userId: decodeSubject(accessToken), role, isSuperAdmin: role === "SuperAdmin" }), [accessToken, role]);
}

export interface FundOption {
  code: string;
  name: string;
  is_active: boolean;
}

/** Every fund (active and inactive) for selects and code → name look-ups —
 *  GET /admin/finance/config (finance:view, the light read). */
export function useFunds(): { funds: FundOption[]; active: FundOption[]; nameOf: (code: string | null | undefined) => string; loading: boolean; error: string | null } {
  const res = useResource(() => FinanceApi.config().then((c) => c.funds), "funds", { errorFallback: "Could not load the funds." });
  return useMemo(() => {
    const funds = res.data ?? [];
    const byCode = new Map(funds.map((f) => [f.code, f.name]));
    return {
      funds,
      active: funds.filter((f) => f.is_active),
      nameOf: (code: string | null | undefined) => (code ? (byCode.get(code) ?? code) : "—"),
      loading: res.loading,
      error: res.error,
    };
  }, [res.data, res.loading, res.error]);
}

/** Every expense category (active and inactive), by sort then name. */
export function useExpenseCategories(): { categories: BooksExpenseCategory[]; active: BooksExpenseCategory[]; nameOf: (code: string | null | undefined) => string; loading: boolean; error: string | null } {
  const res = useResource(() => FinanceApi.expenseCategories(), "expense-categories", { errorFallback: "Could not load the expense categories." });
  return useMemo(() => {
    const categories = res.data ?? [];
    const byCode = new Map(categories.map((c) => [c.code, c.name]));
    return {
      categories,
      active: categories.filter((c) => c.is_active),
      nameOf: (code: string | null | undefined) => (code ? (byCode.get(code) ?? code) : "—"),
      loading: res.loading,
      error: res.error,
    };
  }, [res.data, res.loading, res.error]);
}
