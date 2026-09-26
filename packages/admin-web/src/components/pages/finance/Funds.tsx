// Finance → Funds (/finance/funds) — docs/FINANCE_ERP.md §5. Every fund with
// its balance per currency (credits − debits on fund:<code>, all time, gifts
// AND journals), the period's and year's income, the year's expenses and
// transfers, and its last activity (GET /admin/finance/funds). A row opens the
// fund (?fund=<code>, also Overview's link) with its latest postings. Writes:
// New fund / Edit (finance:manage), Transfer between funds and Opening balance
// (finance:approve). Funds are never deleted — deactivate instead.
import { useMemo, useState, type ReactElement } from "react";
import { ArrowLeftRight, PiggyBank, Plus } from "lucide-react";
import { FinanceApi, type FinanceFundRow } from "../../../api/finance";
import {
  Button,
  DataTable,
  FIN,
  FilterBar,
  FinancePage,
  KpiStrip,
  KpiTile,
  Notice,
  PerCurrency,
  SectionCard,
  StatusChip,
  useFinanceCaps,
  useFinanceToast,
  useUrlParam,
  type Column,
} from "../../finance/kit";
import { formatMinor, totalsByCurrency } from "../../finance/money";
import { fmtDateEAT, fmtRange } from "../../finance/dates";
import { plural } from "../../finance/a/helpers";
import { useAsync, usePeriodParam } from "../../finance/a/hooks";
import { MoneyLines } from "../../finance/a/ui";
import { FundDetailDrawer } from "../../finance/a/FundDetailDrawer";
import { FundFormDrawer } from "../../finance/a/FundFormDrawer";
import { TransferDrawer } from "../../finance/a/TransferDrawer";
import { OpeningBalanceDrawer } from "../../finance/a/OpeningBalanceDrawer";

const PRESETS = ["this_month", "last_month", "this_quarter", "this_year", "last_12_months", "custom"] as const;

type FormState = { mode: "new" } | { mode: "edit"; code: string } | null;

export function FinanceFunds(): ReactElement {
  const caps = useFinanceCaps();
  const toast = useFinanceToast();
  const [period, setPeriod] = usePeriodParam("this_month");
  const [fundParam, setFundParam] = useUrlParam("fund");
  const page = useAsync(() => FinanceApi.funds({ from: period.from, to: period.to }), `${period.from}|${period.to}`, { errorFallback: "Could not load the funds." });
  const rows = useMemo(() => page.data?.data ?? [], [page.data]);
  const active = useMemo(() => rows.filter((f) => f.is_active), [rows]);
  const [form, setForm] = useState<FormState>(null);
  const [transfer, setTransfer] = useState<{ from: string } | null>(null);
  const [opening, setOpening] = useState<{ fund: string } | null>(null);

  const selected = rows.find((f) => f.code === fundParam) ?? null;
  const editing = form?.mode === "edit" ? (rows.find((f) => f.code === form.code) ?? null) : null;
  const negative = rows.filter((f) => f.balances.some((b) => b.balance_minor < 0));
  const flat = (pick: (f: FinanceFundRow) => { currency: string; amount_minor: number }[]) => totalsByCurrency(rows.flatMap(pick));
  const incomePeriod = flat((f) => f.income.map((i) => ({ currency: i.currency, amount_minor: i.period_minor })));
  const expensesYtd = flat((f) => f.expenses_ytd);
  const first = page.loading && !page.data;

  const columns: Column<FinanceFundRow>[] = [
    {
      key: "fund",
      header: "Fund",
      cell: (f) => (
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
          <span className="inline-flex items-center" style={{ gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600 }}>{f.name}</span>
            {!f.is_active ? <StatusChip status="inactive" /> : null}
          </span>
          <span style={{ fontSize: 11.5, color: FIN.muted }}>
            <span style={{ fontFamily: FIN.mono }}>fund:{f.code}</span>
            {f.name_sw ? ` · ${f.name_sw}` : ""}
          </span>
        </span>
      ),
    },
    { key: "balance", header: "Balance", align: "right", cell: (f) => <MoneyLines strong amounts={f.balances.map((b) => ({ currency: b.currency, amount_minor: b.balance_minor }))} /> },
    { key: "income", header: "Income (period)", align: "right", cell: (f) => <MoneyLines amounts={f.income.filter((i) => i.period_minor !== 0).map((i) => ({ currency: i.currency, amount_minor: i.period_minor }))} /> },
    { key: "ytd", header: "Income (year)", align: "right", cell: (f) => <MoneyLines amounts={f.income.filter((i) => i.ytd_minor !== 0).map((i) => ({ currency: i.currency, amount_minor: i.ytd_minor }))} /> },
    { key: "exp", header: "Expenses (year)", align: "right", cell: (f) => <MoneyLines amounts={f.expenses_ytd} /> },
    {
      key: "transfers",
      header: "Transfers in / out (year)",
      align: "right",
      cell: (f) =>
        f.transfers_in_ytd.length === 0 && f.transfers_out_ytd.length === 0 ? (
          <span style={{ color: FIN.muted }}>—</span>
        ) : (
          <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
            <MoneyLines amounts={f.transfers_in_ytd} empty="" />
            <MoneyLines amounts={f.transfers_out_ytd.map((t) => ({ currency: t.currency, amount_minor: -t.amount_minor }))} empty="" />
          </span>
        ),
    },
    { key: "last", header: "Last activity", nowrap: true, cell: (f) => <span style={{ fontFamily: FIN.mono, fontSize: 12 }}>{f.last_activity_at ? fmtDateEAT(f.last_activity_at) : "—"}</span> },
  ];

  return (
    <FinancePage
      title="Funds"
      subtitle="Where money is given to and spent from. A balance is everything credited to the fund less everything taken out, all time; the other figures are for the period or the year. Funds are never deleted — an unused one is deactivated."
      actions={
        <>
          {caps.manage ? (
            <Button variant="primary" onDark icon={<Plus size={14} />} onClick={() => setForm({ mode: "new" })}>
              New fund
            </Button>
          ) : null}
          {caps.approve ? (
            <Button onDark icon={<ArrowLeftRight size={13} />} onClick={() => setTransfer({ from: "" })}>
              Transfer between funds
            </Button>
          ) : null}
          {caps.approve ? (
            <Button onDark icon={<PiggyBank size={13} />} onClick={() => setOpening({ fund: "" })}>
              Opening balance
            </Button>
          ) : null}
        </>
      }
      hero={
        <KpiStrip>
          <KpiTile label="Held across funds" loading={first} value={page.data ? <PerCurrency amounts={page.data.totals} /> : "—"} hint="Every fund's balance added up, per currency" />
          <KpiTile label="Income in the period" loading={first} value={page.data ? <PerCurrency amounts={incomePeriod} /> : "—"} hint={fmtRange(period)} />
          <KpiTile label="Expenses this year" loading={first} value={page.data ? <PerCurrency amounts={expensesYtd} /> : "—"} hint="Approved, by the day spent" />
          <KpiTile label="Funds" loading={first} value={page.data ? `${active.length} active` : "—"} hint={page.data ? `${plural(rows.length - active.length, "inactive fund")}` : undefined} />
        </KpiStrip>
      }
    >
      <FilterBar period={period} onPeriodChange={setPeriod} presets={PRESETS} />
      {negative.length > 0 ? (
        <Notice tone="warn">
          {plural(negative.length, "fund")} {negative.length === 1 ? "is" : "are"} below zero — more has left {negative.length === 1 ? "it" : "them"} than came in (
          {negative
            .slice(0, 3)
            .map((f) => f.name)
            .join(", ")}
          {negative.length > 3 ? "…" : ""}). Usually an opening balance is missing{caps.approve ? " — post one, or transfer money in" : ""}.
        </Notice>
      ) : null}
      <SectionCard flush title="Funds" subtitle="Ordered as the pickers show them (sort order, then name). Click a fund for its postings.">
        <DataTable
          ariaLabel="Funds"
          columns={columns}
          rows={rows}
          rowKey={(f) => f.code}
          onRowClick={(f) => setFundParam(f.code)}
          selectedKey={fundParam || null}
          loading={page.loading}
          error={page.error}
          onRetry={page.reload}
          minWidth={920}
          empty={caps.manage ? "No funds yet — create the first with New fund." : "No funds yet."}
        />
      </SectionCard>

      {selected ? (
        <FundDetailDrawer
          fund={selected}
          period={period}
          onClose={() => setFundParam("")}
          onEdit={() => setForm({ mode: "edit", code: selected.code })}
          onTransfer={() => setTransfer({ from: selected.code })}
          onOpening={() => setOpening({ fund: selected.code })}
        />
      ) : null}
      {form?.mode === "new" || editing ? (
        <FundFormDrawer
          fund={editing}
          onClose={() => setForm(null)}
          onSaved={(f, action) => {
            setForm(null);
            page.reload();
            if (action === "created") {
              toast(`Fund created — fund:${f.code}.`);
              setFundParam(f.code);
            } else {
              toast(f.is_active ? `${f.name} saved.` : `${f.name} saved — inactive now.`);
            }
          }}
        />
      ) : null}
      {transfer ? (
        <TransferDrawer
          funds={rows}
          defaultFrom={transfer.from}
          onClose={() => setTransfer(null)}
          onPosted={(t) => {
            setTransfer(null);
            page.reload();
            toast(`${t.reused ? "Already posted — nothing new" : "Transfer posted"}: ${formatMinor(t.amount_minor, t.currency)} from ${t.from_fund.name} to ${t.to_fund.name}.`);
          }}
        />
      ) : null}
      {opening ? (
        <OpeningBalanceDrawer
          funds={active}
          defaultFund={opening.fund}
          onClose={() => setOpening(null)}
          onPosted={(j) => {
            setOpening(null);
            page.reload();
            const money = j.totals.map((x) => formatMinor(x.amount_minor, x.currency)).join(" + ");
            toast(j.reused ? `Already posted — nothing new (${money}).` : `Opening balance posted: ${money}.`);
          }}
        />
      ) : null}
    </FinancePage>
  );
}
