// Finance → Campaigns (/finance/campaigns) — docs/FINANCE_ERP.md §5.
// The church's appeals (financial/campaigns.ts): each with its status, dates,
// goal against what has been raised (succeeded gifts to its fund inside its
// dates), an optional match — always with the person who pledged it — and its
// reach: how many were asked, gave and declined, so a campaign nobody saw can
// be told apart from one people saw and declined. finance:manage creates and
// edits (always as a draft), puts a campaign live, and ends it (final).
import { useMemo, useState, type ReactElement } from "react";
import { Flag, Megaphone, Pencil, Play, Plus, Square, Users } from "lucide-react";
import { FinanceApi, type CampaignRow } from "../../../api/finance";
import {
  Button,
  ConfirmDialog,
  DataTable,
  Drawer,
  ErrorState,
  FIN,
  FilterBar,
  FinancePage,
  KpiStrip,
  KpiTile,
  MoneyText,
  Notice,
  PerCurrency,
  SectionCard,
  Skeleton,
  StatusChip,
  useFinanceCaps,
  useFinanceToast,
  useUrlParam,
  type Column,
} from "../../finance/kit";
import { formatMinor } from "../../finance/money";
import { fmtDay, fmtRange, todayEAT } from "../../finance/dates";
import { useFunds, useResource } from "../../finance/b/hooks";
import { daysBetween, percentOf, sumMinor } from "../../finance/b/logic";
import { CampaignFormDrawer } from "../../finance/b/CampaignForm";
import { FiguresStrip, KeyValues, ProgressBar, Stacked, SubHead } from "../../finance/b/ui";

const STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "live", label: "Live" },
  { value: "ended", label: "Ended" },
] as const;

const count = (v: number | string | null | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** "12 days left" / "ends today" / "ended 3 days ago" / "starts in 5 days". */
function timing(c: CampaignRow, today: string): string {
  if (c.status === "ended") return "ended";
  if (today < c.starts_on) {
    const d = daysBetween(today, c.starts_on);
    return `starts in ${d} ${d === 1 ? "day" : "days"}`;
  }
  const left = daysBetween(today, c.ends_on);
  if (left > 0) return `${left} ${left === 1 ? "day" : "days"} left`;
  if (left === 0) return "ends today";
  return `end date passed ${-left} ${-left === 1 ? "day" : "days"} ago`;
}

type StatusAction = { campaign: CampaignRow; to: "live" | "ended" };

export function FinanceCampaigns(): ReactElement {
  const caps = useFinanceCaps();
  const toast = useFinanceToast();
  const funds = useFunds();
  const today = todayEAT();
  const res = useResource(() => FinanceApi.campaigns(), "campaigns", { errorFallback: "Could not load the campaigns." });
  const all = res.data ?? [];
  const [statusRaw, setStatus] = useUrlParam("status", "");
  const [selectedId, setSelectedId] = useUrlParam("campaign", "");
  const status = STATUSES.find((s) => s.value === statusRaw)?.value ?? null;
  const rows = status ? all.filter((c) => c.status === status) : all;
  const selected = all.find((c) => c.campaign_id === selectedId) ?? null;

  const [editing, setEditing] = useState<{ campaign: CampaignRow | null } | null>(null);
  const [statusAction, setStatusAction] = useState<StatusAction | null>(null);

  const live = all.filter((c) => c.status === "live");
  // Per currency over the LIVE campaigns: what they aim for and what has come in.
  const liveTotals = useMemo(() => {
    const by = new Map<string, { goal: number[]; raised: number[]; n: number }>();
    for (const c of live) {
      const t = by.get(c.currency) ?? { goal: [], raised: [], n: 0 };
      t.goal.push(c.goal_minor);
      t.raised.push(c.raised_minor);
      t.n += 1;
      by.set(c.currency, t);
    }
    return [...by.entries()].map(([currency, t]) => ({ currency, goal_minor: sumMinor(t.goal), raised_minor: sumMinor(t.raised), n: t.n }));
  }, [live]);

  // Two live campaigns on the same fund (and currency) count the same gifts —
  // each "raised" includes the other's money. Say so (iPad parity).
  const sharedFunds = useMemo(() => {
    const by = new Map<string, CampaignRow[]>();
    for (const c of live) {
      if (!c.fund) continue;
      const k = `${c.fund}|${c.currency}`;
      by.set(k, [...(by.get(k) ?? []), c]);
    }
    return [...by.values()].filter((g) => g.length > 1);
  }, [live]);

  const changeStatus = async (): Promise<void> => {
    if (!statusAction) return;
    const { campaign, to } = statusAction;
    if (to === "live") await FinanceApi.goLive(campaign.campaign_id);
    else await FinanceApi.endCampaign(campaign.campaign_id);
    setStatusAction(null);
    toast(to === "live" ? `“${campaign.title}” is live — members can be invited from now` : `“${campaign.title}” has ended`);
    res.reload();
  };

  const actions = (c: CampaignRow): ReactElement | null => {
    if (!caps.manage || c.status === "ended") return null;
    return (
      <div className="inline-flex flex-wrap" style={{ gap: 6 }} onClick={(e) => e.stopPropagation()}>
        <Button size="sm" icon={<Pencil size={12} />} onClick={() => setEditing({ campaign: c })}>
          Edit
        </Button>
        {c.status === "draft" ? (
          <Button size="sm" variant="primary" icon={<Play size={12} />} onClick={() => setStatusAction({ campaign: c, to: "live" })}>
            Go live
          </Button>
        ) : null}
        <Button size="sm" variant="danger" icon={<Square size={12} />} onClick={() => setStatusAction({ campaign: c, to: "ended" })}>
          End
        </Button>
      </div>
    );
  };

  const columns: Column<CampaignRow>[] = [
    { key: "title", header: "Campaign", cell: (c) => <Stacked primary={c.title} secondary={funds.nameOf(c.fund)} strong />, width: 240 },
    {
      key: "status",
      header: "Status",
      cell: (c) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start" }}>
          <StatusChip status={c.status} />
          <span style={{ fontSize: 11, color: FIN.muted, whiteSpace: "nowrap" }}>{timing(c, today)}</span>
        </div>
      ),
    },
    { key: "dates", header: "Runs", cell: (c) => fmtRange({ from: c.starts_on, to: c.ends_on }), mono: true },
    {
      key: "progress",
      header: <span title="Raised = succeeded gifts to the campaign's fund from its start date through its end date (EAT).">Raised of goal</span>,
      cell: (c) => {
        const pct = percentOf(c.raised_minor, c.goal_minor);
        return (
          <div style={{ minWidth: 220 }}>
            <div className="flex items-baseline justify-between" style={{ gap: 8, fontSize: 12 }}>
              <span>
                <MoneyText amount_minor={c.raised_minor} currency={c.currency} strong /> <span style={{ color: FIN.muted }}>of {formatMinor(c.goal_minor, c.currency)}</span>
              </span>
              <span style={{ fontFamily: FIN.mono, color: FIN.muted }}>{pct === null ? "—" : `${pct}%`}</span>
            </div>
            <div style={{ marginTop: 5 }}>
              <ProgressBar percent={pct} tone={pct !== null && pct >= 100 ? "good" : "default"} width="100%" label={`${c.title}: ${pct ?? 0}% of goal`} />
            </div>
          </div>
        );
      },
    },
    {
      key: "match",
      header: "Match",
      cell: (c) =>
        c.match_minor !== null ? <Stacked primary={<MoneyText amount_minor={c.match_minor} currency={c.currency} />} secondary={c.match_pledger ? `pledged by ${c.match_pledger}` : undefined} /> : <span style={{ color: FIN.muted }}>—</span>,
    },
    {
      key: "reach",
      header: <span title="People the invitation was shown to, and what they did — so a campaign nobody saw is told apart from one people declined.">Asked · gave · declined</span>,
      cell: (c) => (
        <span style={{ fontFamily: FIN.mono, whiteSpace: "nowrap" }}>
          {count(c.people_asked)} · <span style={{ color: FIN.good }}>{count(c.gave)}</span> · <span style={{ color: count(c.declined) > 0 ? FIN.warn : undefined }}>{count(c.declined)}</span>
        </span>
      ),
    },
    { key: "actions", header: "", align: "right", hidden: !caps.manage, cell: (c) => actions(c) },
  ];

  return (
    <FinancePage
      title="Campaigns"
      subtitle="Appeals members can be invited to: goal against raised, any match (always with who pledged it), and how far the invitation actually travelled."
      actions={
        caps.manage ? (
          <Button onDark variant="primary" icon={<Plus size={13} />} onClick={() => setEditing({ campaign: null })}>
            New campaign
          </Button>
        ) : null
      }
      hero={
        <KpiStrip>
          <KpiTile label="Live" icon={<Megaphone size={12} />} tone={live.length > 0 ? "good" : "default"} value={res.loading && !res.data ? "…" : live.length.toLocaleString()} hint="members can be invited" />
          <KpiTile label="Drafts" icon={<Flag size={12} />} value={res.loading && !res.data ? "…" : all.filter((c) => c.status === "draft").length.toLocaleString()} hint="reach nobody yet" />
          <KpiTile label="Raised — live" value={<PerCurrency amounts={liveTotals.map((t) => ({ currency: t.currency, amount_minor: t.raised_minor }))} />} loading={res.loading && !res.data} hint="per currency" />
          <KpiTile
            label="People asked — live"
            icon={<Users size={12} />}
            value={res.loading && !res.data ? "…" : live.reduce((n, c) => n + count(c.people_asked), 0).toLocaleString()}
            hint={`${live.reduce((n, c) => n + count(c.gave), 0).toLocaleString()} gave`}
          />
        </KpiStrip>
      }
    >
      <FilterBar
        selects={[{ key: "status", label: "Status", value: status ?? "", options: [{ value: "", label: "All" }, ...STATUSES], onChange: setStatus }]}
        clearable={Boolean(status)}
        onClear={() => setStatus("")}
      />
      {liveTotals.length > 0 ? (
        <FiguresStrip
          label="Live campaigns"
          groups={liveTotals.map((t) => ({
            currency: t.currency,
            figures: [
              { label: "Goal", amount_minor: t.goal_minor },
              { label: "Raised", amount_minor: t.raised_minor, tone: "good" as const },
            ],
            note: `${t.n} live ${t.n === 1 ? "campaign" : "campaigns"}`,
          }))}
          extra="Each campaign counts gifts to its own fund inside its own dates."
        />
      ) : null}
      {sharedFunds.map((g) => (
        <Notice key={`${g[0]!.fund}|${g[0]!.currency}`} tone="warn">
          {g.map((c) => `“${c.title}”`).join(" and ")} are live on the same fund ({g[0]!.fund}, {g[0]!.currency}) — each one's “raised” counts every gift to that fund in its dates, so the same money shows in both.
        </Notice>
      ))}
      <SectionCard title="Campaigns" subtitle="Newest start first. Open one for its reach." flush>
        <DataTable
          ariaLabel="Campaigns"
          columns={columns}
          rows={rows}
          rowKey={(c) => c.campaign_id}
          onRowClick={(c) => setSelectedId(c.campaign_id)}
          selectedKey={selectedId || null}
          loading={res.loading}
          error={res.error}
          onRetry={res.reload}
          empty={status ? `No ${status} campaigns.` : caps.manage ? "No campaigns yet — start one with “New campaign”; it stays a draft until you put it live." : "No campaigns yet."}
          minWidth={1120}
        />
      </SectionCard>

      <CampaignDrawer
        campaign={selected}
        fundName={selected ? funds.nameOf(selected.fund) : ""}
        today={today}
        onClose={() => setSelectedId("")}
        actions={selected ? actions(selected) : null}
      />
      <CampaignFormDrawer
        open={editing !== null}
        campaign={editing?.campaign ?? null}
        funds={funds.funds}
        onClose={() => setEditing(null)}
        onSaved={(id) => {
          setEditing(null);
          setSelectedId(id);
          res.reload();
        }}
      />
      <ConfirmDialog
        open={statusAction !== null}
        title={statusAction?.to === "live" ? `Put “${statusAction.campaign.title}” live?` : `End “${statusAction?.campaign.title ?? ""}”?`}
        body={
          statusAction?.to === "live" ? (
            <>
              From now on members can be invited to give toward it — within the invitation's own restraint (never a minor, at most three showings, a fortnight between waves, quiet hours).
              Gifts to {funds.nameOf(statusAction.campaign.fund)} from {fmtDay(statusAction.campaign.starts_on)} to {fmtDay(statusAction.campaign.ends_on)} count as raised.
            </>
          ) : (
            <>Members stop being invited. Ending is final — an ended campaign is never reopened; to appeal again, create a new one. What it raised stays on record.</>
          )
        }
        confirmLabel={statusAction?.to === "live" ? "Go live" : "End campaign"}
        tone={statusAction?.to === "ended" ? "danger" : "default"}
        errorFallback={statusAction?.to === "live" ? "Could not put the campaign live." : "Could not end the campaign."}
        onConfirm={changeStatus}
        onCancel={() => setStatusAction(null)}
      />
    </FinancePage>
  );
}

/** One campaign: its terms, progress and — read on open — its reach. */
function CampaignDrawer({ campaign, fundName, today, onClose, actions }: { campaign: CampaignRow | null; fundName: string; today: string; onClose: () => void; actions: ReactElement | null }): ReactElement | null {
  const reach = useResource(() => FinanceApi.campaignReach(campaign?.campaign_id ?? ""), campaign?.campaign_id ?? "none", { enabled: campaign !== null, errorFallback: "Could not load the campaign's reach." });
  if (!campaign) return null;
  const pct = percentOf(campaign.raised_minor, campaign.goal_minor);
  const r = reach.data;
  const asked = count(r?.people_asked);
  return (
    <Drawer open title={campaign.title} subtitle={`${fundName} · ${fmtRange({ from: campaign.starts_on, to: campaign.ends_on })} · ${timing(campaign, today)}`} onClose={onClose} footer={actions}>
      <div className="flex items-center flex-wrap" style={{ gap: 8, marginBottom: 12 }}>
        <StatusChip status={campaign.status} />
        {campaign.status === "draft" ? <span style={{ fontSize: 12, color: FIN.muted }}>A draft reaches nobody until it is put live.</span> : null}
      </div>
      {campaign.image_url ? <img src={campaign.image_url} alt="" style={{ width: "100%", maxHeight: 180, objectFit: "cover", borderRadius: 12, marginBottom: 12 }} /> : null}
      <p style={{ fontSize: 13, color: FIN.navy, lineHeight: 1.55, margin: 0 }}>{campaign.blurb}</p>

      <SubHead aside="succeeded gifts to its fund inside its dates">Raised</SubHead>
      <div className="flex items-baseline justify-between" style={{ gap: 8 }}>
        <span>
          <MoneyText amount_minor={campaign.raised_minor} currency={campaign.currency} strong style={{ fontSize: 16 }} /> <span style={{ color: FIN.muted, fontSize: 12.5 }}>of {formatMinor(campaign.goal_minor, campaign.currency)}</span>
        </span>
        <span style={{ fontFamily: FIN.mono, color: FIN.muted }}>{pct === null ? "—" : `${pct}%`}</span>
      </div>
      <div style={{ marginTop: 6 }}>
        <ProgressBar percent={pct} tone={pct !== null && pct >= 100 ? "good" : "default"} width="100%" label={`${pct ?? 0}% of goal`} />
      </div>
      {campaign.match_minor !== null ? (
        <Notice tone="info" style={{ marginTop: 12 }}>
          Matched: {formatMinor(campaign.match_minor, campaign.currency)}, pledged by {campaign.match_pledger}.
        </Notice>
      ) : null}

      <SubHead aside="how far the invitation actually travelled">Reach</SubHead>
      {reach.error ? (
        <ErrorState message={reach.error} onRetry={reach.reload} />
      ) : !r ? (
        <Skeleton width="80%" height={40} />
      ) : (
        <>
          <KeyValues
            columns={3}
            items={[
              { label: "People asked", value: <span style={{ fontFamily: FIN.mono }}>{asked}</span>, title: "Members the invitation was shown to at least once" },
              { label: "Times shown", value: <span style={{ fontFamily: FIN.mono }}>{count(r.times_shown)}</span> },
              { label: "Opened", value: <span style={{ fontFamily: FIN.mono }}>{count(r.opened)}</span> },
              { label: "Gave", value: <span style={{ fontFamily: FIN.mono, color: FIN.good }}>{count(r.gave)}</span> },
              { label: "Dismissed", value: <span style={{ fontFamily: FIN.mono }}>{count(r.dismissed)}</span>, title: "Closed it for now — may be asked again" },
              { label: "Declined", value: <span style={{ fontFamily: FIN.mono, color: count(r.declined) > 0 ? FIN.warn : undefined }}>{count(r.declined)}</span>, title: "Asked not to be asked again — permanent" },
            ]}
          />
          <p style={{ fontSize: 12, color: FIN.muted, marginTop: 10 }}>
            {asked === 0
              ? campaign.status === "live"
                ? "Live, but nobody has been shown it yet — the invitation's restraint (quiet hours, spacing, the first week) decides when."
                : "Nobody has been asked — a draft or ended campaign reaches no one."
              : `${count(r.gave)} of ${asked} people asked gave (${percentOf(count(r.gave), asked) ?? 0}%). A campaign nobody saw and one people declined look the same in the totals — this tells them apart.`}
          </p>
        </>
      )}
    </Drawer>
  );
}
