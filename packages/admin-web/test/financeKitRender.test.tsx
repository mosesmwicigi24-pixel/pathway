// @vitest-environment happy-dom
// The Finance kit's behaviour pages depend on: DataTable states and keyset
// "Load more", usePagedList dropping stale answers, ConfirmDialog's required
// reason, and URL-synced tabs.
import { describe, it, expect, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { ConfirmDialog, DataTable, Tabs, usePagedList, useUrlTab, type Column } from "../src/components/finance/kit";

afterEach(cleanup);

interface Row {
  id: string;
  name: string;
  amount_minor: number;
}
const COLUMNS: Column<Row>[] = [
  { key: "name", header: "Name", cell: (r) => r.name },
  { key: "amount", header: "Amount", cell: (r) => String(r.amount_minor), align: "right", mono: true },
];

describe("DataTable", () => {
  it("renders rows and reports a row click", () => {
    const onRowClick = vi.fn();
    render(<DataTable columns={COLUMNS} rows={[{ id: "a", name: "Grace", amount_minor: 100 }]} rowKey={(r) => r.id} onRowClick={onRowClick} />);
    fireEvent.click(screen.getByText("Grace"));
    expect(onRowClick).toHaveBeenCalledWith({ id: "a", name: "Grace", amount_minor: 100 });
  });

  it("shows the empty state, and the error state with Retry", () => {
    const { rerender } = render(<DataTable columns={COLUMNS} rows={[]} rowKey={(r) => r.id} empty="No gifts match these filters." />);
    expect(screen.getByText("No gifts match these filters.")).toBeTruthy();
    const onRetry = vi.fn();
    rerender(<DataTable columns={COLUMNS} rows={[]} rowKey={(r) => r.id} error="Could not load transactions." onRetry={onRetry} />);
    expect(screen.getByRole("alert").textContent).toContain("Could not load transactions.");
    fireEvent.click(screen.getByText("Retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("offers Load more while there is a next page", () => {
    const onLoadMore = vi.fn();
    const { rerender } = render(<DataTable columns={COLUMNS} rows={[{ id: "a", name: "Grace", amount_minor: 1 }]} rowKey={(r) => r.id} hasMore onLoadMore={onLoadMore} />);
    fireEvent.click(screen.getByText("Load more"));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    rerender(<DataTable columns={COLUMNS} rows={[{ id: "a", name: "Grace", amount_minor: 1 }]} rowKey={(r) => r.id} hasMore={false} onLoadMore={onLoadMore} />);
    expect(screen.queryByText("Load more")).toBeNull();
  });
});

type Page = { data: Row[]; next_cursor: string | null; totals: { currency: string; amount_minor: number; count: number }[] };

describe("usePagedList", () => {
  it("loads the first page, appends the next, and keeps the whole-set totals", async () => {
    const pages: Record<string, Page> = {
      first: { data: [{ id: "1", name: "A", amount_minor: 1 }], next_cursor: "c1", totals: [{ currency: "KES", amount_minor: 3, count: 2 }] },
      c1: { data: [{ id: "2", name: "B", amount_minor: 2 }], next_cursor: null, totals: [{ currency: "KES", amount_minor: 3, count: 2 }] },
    };
    const fetchPage = vi.fn((cursor: string | null) => Promise.resolve(pages[cursor ?? "first"] as Page));
    const { result } = renderHook(() => usePagedList(fetchPage, "k"));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows.map((r) => r.id)).toEqual(["1"]);
    expect(result.current.totals).toEqual([{ currency: "KES", amount_minor: 3, count: 2 }]);
    expect(result.current.hasMore).toBe(true);
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows.map((r) => r.id)).toEqual(["1", "2"]));
    expect(result.current.hasMore).toBe(false);
    expect(fetchPage).toHaveBeenLastCalledWith("c1");
  });

  it("drops an answer to an older filter set", async () => {
    let resolveOld: ((p: Page) => void) | null = null;
    const fetchFor = (key: string) => (cursor: string | null): Promise<Page> => {
      void cursor;
      if (key === "old") return new Promise<Page>((r) => (resolveOld = r));
      return Promise.resolve({ data: [{ id: "new", name: "New", amount_minor: 1 }], next_cursor: null, totals: [] });
    };
    const { result, rerender } = renderHook(({ k }: { k: string }) => usePagedList(fetchFor(k), k), { initialProps: { k: "old" } });
    rerender({ k: "new" });
    await waitFor(() => expect(result.current.rows.map((r) => r.id)).toEqual(["new"]));
    await act(async () => {
      resolveOld?.({ data: [{ id: "old", name: "Old", amount_minor: 1 }], next_cursor: "x", totals: [] });
    });
    expect(result.current.rows.map((r) => r.id)).toEqual(["new"]);
    expect(result.current.hasMore).toBe(false);
  });

  it("clears the rows and reports the server's message when the first page fails", async () => {
    const fetchPage = (): Promise<Page> => Promise.reject(new Error("offline"));
    const { result } = renderHook(() => usePagedList(fetchPage, "k", { errorFallback: "Could not load expenses." }));
    await waitFor(() => expect(result.current.error).toBe("Could not load expenses."));
    expect(result.current.rows).toEqual([]);
  });
});

describe("ConfirmDialog", () => {
  it("requires a reason within its bounds and passes it trimmed", async () => {
    const onConfirm = vi.fn(() => Promise.resolve());
    render(<ConfirmDialog open title="Reverse this gift?" reason={{ label: "Reason", min: 5, max: 300 }} confirmLabel="Reverse" onConfirm={onConfirm} onCancel={() => undefined} />);
    const confirm = screen.getByText("Reverse").closest("button") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "  typo  " } });
    expect(confirm.disabled).toBe(true); // "typo" is 4 characters once trimmed
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "  wrong fund  " } });
    expect(confirm.disabled).toBe(false);
    expect(screen.getByText("10 / 300")).toBeTruthy();
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(onConfirm).toHaveBeenCalledWith("wrong fund");
  });

  it("keeps itself open and shows why when the action fails", async () => {
    const onConfirm = vi.fn(() => Promise.reject(new Error("nope")));
    render(<ConfirmDialog open title="Approve?" onConfirm={onConfirm} onCancel={() => undefined} errorFallback="Could not approve the expense." />);
    await act(async () => {
      fireEvent.click(screen.getByText("Confirm"));
    });
    expect(screen.getByText("Could not approve the expense.")).toBeTruthy();
  });
});

describe("Tabs + useUrlTab", () => {
  function Probe(): ReactNode {
    const [tab, setTab] = useUrlTab(["postings", "journals", "trial"] as const, "postings");
    const loc = useLocation();
    return (
      <>
        <Tabs
          tabs={[
            { key: "postings", label: "Postings" },
            { key: "journals", label: "Journals" },
            { key: "trial", label: "Trial balance" },
          ]}
          value={tab}
          onChange={setTab}
        />
        <output data-testid="where">{`${tab}|${loc.search}`}</output>
      </>
    );
  }

  it("reads ?tab=, writes it, and keeps the default out of the URL", () => {
    render(
      <MemoryRouter initialEntries={["/finance/ledger?tab=journals&account=cash:mpesa"]}>
        <Probe />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("where").textContent).toBe("journals|?tab=journals&account=cash:mpesa");
    fireEvent.click(screen.getByText("Trial balance"));
    expect(screen.getByTestId("where").textContent).toBe("trial|?tab=trial&account=cash%3Ampesa");
    fireEvent.click(screen.getByText("Postings"));
    expect(screen.getByTestId("where").textContent).toBe("postings|?account=cash%3Ampesa");
  });

  it("reads an unknown tab as the default", () => {
    render(
      <MemoryRouter initialEntries={["/finance/ledger?tab=nope"]}>
        <Probe />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("where").textContent?.startsWith("postings|")).toBe(true);
  });
});
