// Finance → Audit (/finance/audit) — docs/FINANCE_ERP.md §5. The finance slice
// of the append-only audit trail (GET /admin/finance/audit): who did what and
// when — gifts recorded and reversed, funds, transfers, opening balances,
// expenses, budgets, claims, webhooks — newest first, keyset-paged. Filters:
// the kind of action, who acted (the system or a person) and the period.
// Nothing here can be changed; that is the point of it.
import { useMemo, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { FinanceApi, type FinanceAuditRow } from "../../../api/finance";
import { DataTable, FIN, FilterBar, FinancePage, SectionCard, pagedTableProps, usePagedList, useUrlParam, type Column, type FilterOption } from "../../finance/kit";
import { fmtDateTimeEAT } from "../../finance/dates";
import { AUDIT_PREFIXES, auditDetails, auditEntityHref, humanizeAction } from "../../finance/a/helpers";
import { usePatchParams, usePeriodParam } from "../../finance/a/hooks";

const ACTORS: readonly FilterOption[] = [
  { value: "", label: "Anyone" },
  { value: "Admin", label: "A person" },
  { value: "System", label: "The system" },
];

export function FinanceAudit(): ReactElement {
  const patch = usePatchParams();
  const [period, setPeriod] = usePeriodParam("last_12_months");
  const [prefix, setPrefix] = useUrlParam("action");
  const [actor, setActor] = useUrlParam("actor");
  const filters = useMemo(
    () => ({
      from: period.from,
      to: period.to,
      action_prefix: AUDIT_PREFIXES.some((p) => p.value === prefix && prefix) ? prefix : null,
      actor: actor === "Admin" || actor === "System" ? actor : null,
    }),
    [period.from, period.to, prefix, actor],
  );
  const list = usePagedList((cursor) => FinanceApi.audit({ ...filters, cursor, limit: 50 }), JSON.stringify(filters), { errorFallback: "Could not load the audit trail." });

  const columns: Column<FinanceAuditRow>[] = [
    { key: "when", header: "When (EAT)", mono: true, cell: (r) => fmtDateTimeEAT(r.occurred_at) },
    {
      key: "who",
      header: "Who",
      cell: (r) =>
        r.actor_type === "System" ? (
          <span style={{ color: FIN.muted }}>The system</span>
        ) : (
          <span style={{ fontWeight: 600 }}>{r.actor_name ?? "A signed-in person"}</span>
        ),
    },
    {
      key: "what",
      header: "What",
      cell: (r) => (
        <span>
          <span style={{ fontWeight: 600 }}>{humanizeAction(r.action)}</span>
          <span style={{ display: "block", fontFamily: FIN.mono, fontSize: 11, color: FIN.muted }}>{r.action}</span>
        </span>
      ),
    },
    {
      key: "entity",
      header: "On",
      cell: (r) => {
        const href = auditEntityHref(r.entity, r.entity_id);
        const id = r.entity_id ? (r.entity_id.length > 12 ? `${r.entity_id.slice(0, 8)}…` : r.entity_id) : null;
        return (
          <span>
            <span>{r.entity.replace(/_/g, " ")}</span>
            {id ? (
              <span style={{ display: "block", fontFamily: FIN.mono, fontSize: 11 }} title={r.entity_id ?? undefined}>
                {href ? (
                  <Link to={href} style={{ color: FIN.navy }}>
                    {id}
                  </Link>
                ) : (
                  <span style={{ color: FIN.muted }}>{id}</span>
                )}
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: "details",
      header: "Details",
      cell: (r) => {
        const d = auditDetails(r.metadata);
        return d.length === 0 ? (
          <span style={{ color: FIN.muted }}>—</span>
        ) : (
          <span style={{ display: "inline-flex", flexWrap: "wrap", gap: "3px 10px", maxWidth: 420, fontSize: 12 }}>
            {d.map((x, i) => (
              <span key={i} style={{ fontFamily: /^-?[A-Z]{3} /.test(x) ? FIN.mono : undefined }}>
                {x}
              </span>
            ))}
          </span>
        );
      },
    },
  ];

  const clearable = Boolean(filters.action_prefix || filters.actor) || period.preset !== "last_12_months";
  return (
    <FinancePage
      title="Audit"
      subtitle="Every change to the money, as it happened — who, what, when (East Africa Time) and the key facts. The trail is append-only: nothing in it can be edited or deleted."
    >
      <FilterBar
        period={period}
        onPeriodChange={setPeriod}
        selects={[
          { key: "action", label: "Kind", value: filters.action_prefix ?? "", options: AUDIT_PREFIXES, onChange: setPrefix },
          { key: "actor", label: "Who", value: filters.actor ?? "", options: ACTORS, onChange: setActor },
        ]}
        clearable={clearable}
        onClear={() => patch({ action: null, actor: null, period: null, from: null, to: null })}
      />
      <SectionCard flush title="Trail" subtitle={list.hasMore ? "Newest first — load more at the bottom." : "Newest first."}>
        <DataTable ariaLabel="Audit trail" columns={columns} rowKey={(r) => String(r.audit_id)} minWidth={900} empty="No finance activity matches these filters." {...pagedTableProps(list)} />
      </SectionCard>
    </FinancePage>
  );
}
