// Announcements Studio (EVENTS_ARCHITECTURE §5 + §9): compose with REAL
// audience pickers (cells multi-select, level picker), an honest channel picker
// (SMS/WhatsApp greyed "awaiting provider" — no provider is bound server-side),
// a real schedule input, the series/event/standalone attachment selector,
// duplicate / archive / restore / resend, an Archived tab, and per-channel
// analytics showing only measured numbers (targeted / delivered / queued /
// suppressed+reason / failed / opened-banner).
import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  Bell,
  CalendarDays,
  CheckCircle2,
  Copy,
  Mail,
  MessageSquare,
  Mic2,
  Pencil,
  Phone,
  Plus,
  Send,
  Smartphone,
  Star,
  Trash2,
  X,
} from "lucide-react";
import {
  AnnouncementsApi,
  CurriculumApi,
  AdminApi,
  type AdminLevel,
  type AdminSeriesRow,
  type AnnouncementAudience,
  type AnnouncementChannel,
  type AnnouncementRow,
  type AnnouncementStats,
  type EngagementCellRow,
} from "../../api/client";
import { errorMessage } from "../../util/error";
import { fmtDateTime } from "../../util/dates";
import {
  announcementStatusLabel,
  audienceLabel,
  Card,
  DetailRow,
  Drawer,
  EmptyState,
  Field,
  ImagesField,
  Modal,
  SectionDivider,
  SectionHeader,
  Skeleton,
  StatusPill,
  Toggle,
  type UiOccurrence,
} from "./kit";

/* ------------------------------------------------------------------ */
/* Channel honesty (§5)                                                */
/* ------------------------------------------------------------------ */

/**
 * Labels and icons only. Whether a channel can actually DELIVER is a property
 * of the deployment, not of this file — `available` used to be hardcoded here,
 * so SMS read "awaiting provider" and would have kept saying so after Africa's
 * Talking was wired. The API answers that question now; see useChannels below.
 */
const CHANNEL_DEFS: Array<{ key: AnnouncementChannel; label: string; icon: ReactNode }> = [
  { key: "push", label: "App push", icon: <Smartphone size={14} /> },
  { key: "email", label: "Email", icon: <Mail size={14} /> },
  { key: "banner", label: "In-app banner", icon: <Mic2 size={14} /> },
  { key: "sms", label: "SMS", icon: <Phone size={14} /> },
  { key: "whatsapp", label: "WhatsApp", icon: <MessageSquare size={14} /> },
];

/** What the deployment says it can send on, keyed by channel. */
export type ChannelAvailability = Record<string, { available: boolean; note?: string }>;

/**
 * Ask the API which channels can deliver.
 *
 * Falls back to "only the three that never needed a provider" if the call
 * fails — an optimistic default would offer SMS on a deployment that cannot
 * send it, and every delivery would be silently suppressed.
 */
function useChannels(): ChannelAvailability {
  const [state, setState] = useState<ChannelAvailability>({
    push: { available: true },
    email: { available: true },
    banner: { available: true },
    sms: { available: false, note: "checking…" },
    whatsapp: { available: false, note: "checking…" },
  });
  useEffect(() => {
    let alive = true;
    void AnnouncementsApi.channels()
      .then((rows) => {
        if (!alive) return;
        const next: ChannelAvailability = {};
        for (const c of rows) next[c.key] = { available: c.available, ...(c.note ? { note: c.note } : {}) };
        setState(next);
      })
      .catch(() => {
        if (!alive) return;
        setState((s) => ({
          ...s,
          sms: { available: false, note: "could not check" },
          whatsapp: { available: false, note: "could not check" },
        }));
      });
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

/* ------------------------------------------------------------------ */
/* Cost guard — the number you see before you spend the church's money  */
/* ------------------------------------------------------------------ */

type Reach = { total: number; sms: number; email: number; sms_unreachable: number };

/** Does sending this announcement cost anything? Only SMS does, today. */
function costsMoney(channels: string[]): boolean {
  return channels.includes("sms");
}

/**
 * Confirm an SMS send by showing how many texts it will actually produce.
 *
 * Push, email and banners are free and reversible-ish; a text is neither. The
 * figure that matters is not the audience size — a member with no number on
 * file costs nothing and receives nothing — so this asks the API for the count
 * of people who can genuinely be reached, and refuses to guess.
 */
function SmsSendConfirm({
  id,
  channels,
  onCancel,
  onConfirm,
}: {
  id: string;
  channels: string[];
  onCancel: () => void;
  onConfirm: () => void;
}): ReactElement {
  const [reach, setReach] = useState<Reach | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void AnnouncementsApi.reach(id)
      .then((r) => alive && setReach(r))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [id]);

  const free = channels.filter((c) => c !== "sms");
  const loading = !reach && !failed;

  return (
    <Modal onClose={onCancel} width={460}>
      <div className="px-6 py-5" style={{ borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--nuru-gold)", letterSpacing: 0.5, textTransform: "uppercase" }}>
          This send costs money
        </div>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "var(--foreground)" }}>Send by SMS?</h2>
      </div>
      <div className="px-6 py-5 flex flex-col gap-4">
        {loading ? (
          <Skeleton height={72} />
        ) : failed ? (
          // The count is a read-only query; if it fails we say so rather than
          // showing a made-up number, and rather than blocking a legitimate
          // send behind a hiccup in a figure that is only advisory.
          <div className="rounded-xl p-4" style={{ background: "#FEF3C7", color: "#92400E", fontSize: 13, lineHeight: 1.5 }}>
            Could not check how many people this would text. Sending will still work — you just
            will not see the number first.
          </div>
        ) : (
          <>
            <div className="rounded-xl p-4 text-center" style={{ background: "var(--secondary)" }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 34, fontWeight: 700, color: "var(--foreground)", lineHeight: 1.1 }}>
                {reach!.sms}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted-foreground)", fontWeight: 600 }}>
                {reach!.sms === 1 ? "text message" : "text messages"} will be sent
              </div>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.6 }}>
              This announcement is addressed to <strong style={{ color: "var(--foreground)" }}>{reach!.total}</strong>{" "}
              {reach!.total === 1 ? "person" : "people"}.
              {reach!.sms_unreachable > 0 ? (
                <>
                  {" "}
                  <strong style={{ color: "var(--foreground)" }}>{reach!.sms_unreachable}</strong> of them{" "}
                  {reach!.sms_unreachable === 1 ? "has" : "have"} no phone number on file and will not be texted.
                </>
              ) : null}
              {free.length > 0 ? <> The {free.join(", ")} {free.length === 1 ? "channel" : "channels"} cost nothing.</> : null}
            </div>
            {reach!.sms === 0 ? (
              <div className="rounded-xl p-3" style={{ background: "#FEE2E2", color: "#B91C1C", fontSize: 12.5, lineHeight: 1.5 }}>
                Nobody in this audience has a phone number on file, so no text would be sent.
              </div>
            ) : null}
          </>
        )}
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="rounded-lg px-3 py-2" style={{ background: "var(--secondary)", color: "var(--foreground)", border: "1px solid var(--border)", fontSize: 12, fontWeight: 600 }}>
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2"
            style={{ background: "var(--nuru-navy)", color: "#fff", border: "none", fontSize: 12, fontWeight: 600, opacity: loading ? 0.5 : 1 }}
          >
            <Send size={12} />
            {reach ? `Send ${reach.sms} ${reach.sms === 1 ? "text" : "texts"}` : "Send anyway"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Studio (list + tabs + drawer + composer)                            */
/* ------------------------------------------------------------------ */

type StudioTab = "all" | "draft" | "scheduled" | "sent" | "archived";

export function AnnouncementsStudio({
  seriesOptions,
  eventOptions,
  onNotice,
  onError,
}: {
  seriesOptions: AdminSeriesRow[];
  eventOptions: UiOccurrence[];
  onNotice: (m: string) => void;
  onError: (m: string) => void;
}): ReactElement {
  const [tab, setTab] = useState<StudioTab>("all");
  const [rows, setRows] = useState<AnnouncementRow[] | null>(null);
  const channelAvailability = useChannels();
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editing, setEditing] = useState<AnnouncementRow | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const data = await AnnouncementsApi.list(
        tab === "archived" ? { archived: true } : tab === "all" ? {} : { status: tab },
      );
      setRows(data);
    } catch (e) {
      onError(errorMessage(e, "Could not load announcements."));
      setRows([]);
    }
  }, [tab, onError]);

  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  const drawerRow = drawerId ? rows?.find((r) => r.announcement_id === drawerId) ?? null : null;

  return (
    <>
      <Card>
        <SectionHeader
          title="Announcements studio"
          subtitle="Compose, schedule and track updates across push, email and in-app banners"
          action={
            <button onClick={() => { setEditing(null); setComposerOpen(true); }} className="flex items-center gap-1 rounded-lg px-3 py-1.5" style={{ background: "var(--nuru-navy)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none" }}>
              <Plus size={12} /> New announcement
            </button>
          }
        />
        <div className="flex items-center gap-1 rounded-xl p-1 mb-4 flex-wrap" style={{ background: "var(--secondary)", width: "fit-content" }}>
          {(
            [
              { k: "all", l: "All" },
              { k: "draft", l: "Drafts" },
              { k: "scheduled", l: "Scheduled" },
              { k: "sent", l: "Sent" },
              { k: "archived", l: "Archived" },
            ] as Array<{ k: StudioTab; l: string }>
          ).map((t) => (
            <button key={t.k} onClick={() => setTab(t.k)} className="rounded-lg px-3 py-1.5" style={{ background: tab === t.k ? "var(--card)" : "transparent", color: "var(--foreground)", fontSize: 12, fontWeight: tab === t.k ? 700 : 500, boxShadow: tab === t.k ? "0 1px 3px rgba(0,0,0,0.06)" : "none", border: "none" }}>
              {t.l}
            </button>
          ))}
        </div>

        {rows === null ? (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
            <Skeleton height={120} />
            <Skeleton height={120} />
            <Skeleton height={120} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Bell size={20} />}
            title={tab === "archived" ? "Nothing archived" : "No announcements here"}
            body={tab === "archived" ? "Archived announcements land here — restore them anytime." : "Send updates, reminders, and event notices to the right audience."}
            cta={tab === "archived" ? undefined : "Create announcement"}
            onCta={tab === "archived" ? undefined : () => { setEditing(null); setComposerOpen(true); }}
          />
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
            {rows.map((a) => (
              <button key={a.announcement_id} onClick={() => setDrawerId(a.announcement_id)} className="text-left rounded-xl p-3 flex flex-col" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)" }}>{a.title}</span>
                  <StatusPill status={announcementStatusLabel(a)} />
                </div>
                <div className="flex flex-wrap gap-1 mb-2">
                  {a.channels.map((c) => {
                    const live = channelAvailability[c]?.available !== false;
                    return (
                      <span key={c} className="rounded-md px-2 py-0.5" style={{ background: "var(--secondary)", fontSize: 10, color: live ? "var(--foreground)" : "var(--muted-foreground)", fontWeight: 600 }}>
                        {c}
                        {live ? "" : " ·  no provider"}
                      </span>
                    );
                  })}
                  {a.series_id ? <span className="rounded-md px-2 py-0.5" style={{ background: "#E4E5FB", color: "#4F46E5", fontSize: 10, fontWeight: 700 }}>series</span> : null}
                  {a.event_occurrence_id ? <span className="rounded-md px-2 py-0.5" style={{ background: "#DBE7FE", color: "#1D4ED8", fontSize: 10, fontWeight: 700 }}>event</span> : null}
                  {a.is_featured ? <span className="rounded-md px-2 py-0.5" style={{ background: "#FBF1DA", color: "#A87616", fontSize: 10, fontWeight: 700 }}>featured</span> : null}
                </div>
                <div className="flex items-center justify-between mt-auto" style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                  <span><span style={{ fontWeight: 600 }}>To:</span> {audienceLabel(a)}</span>
                  <span style={{ fontFamily: "var(--font-mono)" }}>{fmtDateTime(a.sent_at ?? a.scheduled_at)}</span>
                </div>
                {a.delivered_count !== undefined && (
                  <div className="mt-2 pt-2 flex items-center justify-between" style={{ borderTop: "1px solid var(--border)", fontSize: 11 }}>
                    <span style={{ color: "var(--muted-foreground)" }}>
                      Delivered <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--foreground)" }}>{a.delivered_count}</span>
                    </span>
                    {a.opened_count !== undefined && (
                      <span style={{ color: "#15803D", fontWeight: 700 }}>
                        <span style={{ fontFamily: "var(--font-mono)" }}>{a.opened_count}</span> opened
                      </span>
                    )}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </Card>

      {drawerRow ? (
        <AnnouncementDrawer
          row={drawerRow}
          onClose={() => setDrawerId(null)}
          onChanged={async (msg) => {
            onNotice(msg);
            setDrawerId(null);
            await load();
          }}
          onEdit={(a) => {
            setDrawerId(null);
            setEditing(a);
            setComposerOpen(true);
          }}
          onError={onError}
        />
      ) : null}

      {composerOpen ? (
        <AnnouncementComposer
          editing={editing}
          seriesOptions={seriesOptions}
          eventOptions={eventOptions}
          onClose={() => { setComposerOpen(false); setEditing(null); }}
          onSaved={async (msg) => {
            onNotice(msg);
            setComposerOpen(false);
            setEditing(null);
            await load();
          }}
          onError={onError}
        />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Drawer — detail + real per-channel analytics + lifecycle actions    */
/* ------------------------------------------------------------------ */

export function AnnouncementDrawer({
  row,
  onClose,
  onChanged,
  onEdit,
  onError,
}: {
  row: AnnouncementRow;
  onClose: () => void;
  onChanged: (message: string) => void;
  onEdit: (a: AnnouncementRow) => void;
  onError: (m: string) => void;
}): ReactElement {
  const [detail, setDetail] = useState<(AnnouncementRow & { stats: AnnouncementStats[] }) | null>(null);
  const [busy, setBusy] = useState(false);
  /** A send that is waiting on the cost confirmation. */
  const [pendingSend, setPendingSend] = useState<null | { run: () => Promise<void> }>(null);
  useEffect(() => {
    void AnnouncementsApi.get(row.announcement_id).then(setDetail).catch(() => setDetail(null));
  }, [row.announcement_id]);
  const a = detail ?? row;
  const id = row.announcement_id;
  const archived = !!a.archived_at;

  async function run(fn: () => Promise<unknown>, msg: string, fallback: string): Promise<void> {
    setBusy(true);
    try {
      await fn();
      onChanged(msg);
    } catch (e) {
      onError(errorMessage(e, fallback));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Send, but show the bill first when there is one.
   *
   * Free channels go straight through — an extra dialog in front of a push
   * teaches admins to click past dialogs, which is exactly what you do not want
   * in front of the one that costs money.
   */
  function guardedSend(fn: () => Promise<unknown>, msg: string, fallback: string): void {
    const go = (): Promise<void> => run(fn, msg, fallback);
    if (!costsMoney(a.channels)) {
      void go();
      return;
    }
    setPendingSend({ run: go });
  }

  const btn = (bg: string, fg: string, border = "none"): Record<string, string | number> => ({
    background: bg,
    color: fg,
    fontSize: 12,
    fontWeight: 600,
    border,
  });

  return (
    <Drawer onClose={onClose} width={540}>
      <div className="px-6 py-5" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between mb-2">
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6 }}>Announcement</span>
          <StatusPill status={announcementStatusLabel(a)} />
        </div>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)", lineHeight: 1.2 }}>{a.title}</h2>
      </div>
      <div className="px-6 py-5">
        <div className="rounded-xl p-4" style={{ background: "var(--secondary)", fontSize: 13, color: "var(--foreground)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{a.body}</div>
        <div className="grid grid-cols-2 gap-3 mt-4">
          <DetailRow label="Audience" value={audienceLabel(a)} />
          <DetailRow label="Channels" value={a.channels.join(", ")} />
          <DetailRow label="Send time" value={fmtDateTime(a.sent_at ?? a.scheduled_at)} mono />
          <DetailRow
            label="Attachment"
            value={a.series_id ? "Attached to a series" : a.event_occurrence_id ? "Attached to an occurrence" : "Standalone"}
          />
        </div>

        {detail && detail.stats.length > 0 && (
          <div className="mt-4">
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Per-channel delivery (measured only)</div>
            <div className="flex flex-col gap-2">
              {detail.stats.map((s) => {
                const reasons = Object.entries(s.suppressed_reasons ?? {});
                return (
                  <div key={s.channel} className="rounded-lg px-3 py-2.5" style={{ background: "var(--secondary)", fontSize: 12 }}>
                    <div className="flex items-center justify-between">
                      <span style={{ fontWeight: 700, color: "var(--foreground)", textTransform: "capitalize" }}>{s.channel}</span>
                      <span style={{ color: "var(--muted-foreground)", fontFamily: "var(--font-mono)", fontSize: 11 }}>{s.targeted} targeted</span>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap mt-1.5" style={{ fontSize: 11 }}>
                      <span style={{ color: "#15803D", fontWeight: 600 }}>{s.delivered} delivered</span>
                      {s.queued > 0 ? <span style={{ color: "#0B1F33", fontWeight: 600 }}>{s.queued} queued</span> : null}
                      {s.suppressed > 0 ? <span style={{ color: "#B45309", fontWeight: 600 }}>{s.suppressed} suppressed</span> : null}
                      {s.failed > 0 ? <span style={{ color: "#B91C1C", fontWeight: 600 }}>{s.failed} failed</span> : null}
                      {s.channel === "banner" ? <span style={{ color: "var(--muted-foreground)" }}>{s.opened} opened</span> : null}
                    </div>
                    {reasons.length > 0 ? (
                      <div className="mt-1" style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>
                        {reasons.map(([why, n]) => `${why.replace(/_/g, " ")}: ${n}`).join(" · ")}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 mt-5">
          {!archived && (a.status === "draft" || a.status === "scheduled") && (
            <button onClick={() => guardedSend(() => AnnouncementsApi.send(id), "Announcement sent.", "Could not send announcement.")} disabled={busy} className="flex items-center gap-1.5 rounded-lg px-3 py-2" style={btn("var(--nuru-navy)", "#fff")}>
              <Send size={12} /> Send now
            </button>
          )}
          {!archived && a.status === "scheduled" && (
            <button onClick={() => void run(() => AnnouncementsApi.cancel(id), "Scheduled send cancelled.", "Could not cancel.")} disabled={busy} className="rounded-lg px-3 py-2" style={btn("#FEE2E2", "#B91C1C")}>
              Cancel scheduled send
            </button>
          )}
          {!archived && (a.status === "draft" || a.status === "scheduled") && (
            <button onClick={() => onEdit(a)} disabled={busy} className="flex items-center gap-1.5 rounded-lg px-3 py-2" style={btn("var(--secondary)", "var(--foreground)", "1px solid var(--border)")}>
              <Pencil size={12} /> Edit
            </button>
          )}
          <button onClick={() => void run(() => AnnouncementsApi.duplicate(id), "Duplicated as a new draft.", "Could not duplicate.")} disabled={busy} className="flex items-center gap-1.5 rounded-lg px-3 py-2" style={btn("var(--secondary)", "var(--foreground)", "1px solid var(--border)")}>
            <Copy size={12} /> Duplicate
          </button>
          {a.status === "sent" && !archived && (
            <button
              onClick={() =>
                guardedSend(
                  async () => {
                    const dup = await AnnouncementsApi.duplicate(id);
                    await AnnouncementsApi.send(dup.announcement_id);
                  },
                  "Announcement re-sent (as a fresh copy).",
                  "Could not resend.",
                )
              }
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2"
              style={btn("var(--secondary)", "var(--foreground)", "1px solid var(--border)")}
            >
              <Send size={12} /> Resend
            </button>
          )}
          {archived ? (
            <button onClick={() => void run(() => AnnouncementsApi.restore(id), "Announcement restored.", "Could not restore.")} disabled={busy} className="flex items-center gap-1.5 rounded-lg px-3 py-2" style={btn("var(--secondary)", "var(--foreground)", "1px solid var(--border)")}>
              <ArchiveRestore size={12} /> Restore
            </button>
          ) : (
            <button onClick={() => void run(() => AnnouncementsApi.archive(id), "Announcement archived.", "Could not archive.")} disabled={busy} className="flex items-center gap-1.5 rounded-lg px-3 py-2" style={btn("var(--secondary)", "var(--foreground)", "1px solid var(--border)")}>
              <Archive size={12} /> Archive
            </button>
          )}
          <button
            onClick={() => {
              if (!window.confirm("Delete this announcement? This cannot be undone.")) return;
              void run(() => AnnouncementsApi.remove(id), "Announcement deleted.", "Could not delete announcement.");
            }}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2"
            style={btn("#FEE2E2", "#B91C1C")}
          >
            <Trash2 size={12} /> Delete
          </button>
        </div>
      </div>
      {pendingSend ? (
        <SmsSendConfirm
          id={id}
          channels={a.channels}
          onCancel={() => setPendingSend(null)}
          onConfirm={() => {
            const go = pendingSend.run;
            setPendingSend(null);
            void go();
          }}
        />
      ) : null}
    </Drawer>
  );
}

/* ------------------------------------------------------------------ */
/* Composer — real audience / schedule / attachment / honest channels  */
/* ------------------------------------------------------------------ */

type AttachMode = "standalone" | "series" | "event";

/** ISO for a datetime-local input value, or undefined when blank/invalid. */
function localInputToIso(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** datetime-local input value for an ISO instant. */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function AnnouncementComposer({
  editing,
  seriesOptions,
  eventOptions,
  initialAttachment,
  onClose,
  onSaved,
  onError,
}: {
  editing?: AnnouncementRow | null;
  seriesOptions: AdminSeriesRow[];
  eventOptions: UiOccurrence[];
  /** Pre-select an attachment (e.g. composing from a series command center). */
  initialAttachment?: { series_id?: string; event_occurrence_id?: string };
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (m: string) => void;
}): ReactElement {
  const isEdit = !!editing;
  const [title, setTitle] = useState(editing?.title ?? "");
  const [body, setBody] = useState(editing?.body ?? "");
  const [channels, setChannels] = useState<Set<AnnouncementChannel>>(
    () => new Set(editing?.channels ?? (["push", "banner"] as AnnouncementChannel[])),
  );
  const [audienceKind, setAudienceKind] = useState<"all" | "cells" | "level">(editing?.audience_kind ?? "all");
  const [audienceCells, setAudienceCells] = useState<Set<string>>(() => new Set(editing?.audience_cells ?? []));
  const [audienceLevel, setAudienceLevel] = useState<number>(editing?.audience_level ?? 1);
  const [cells, setCells] = useState<EngagementCellRow[]>([]);
  const [levels, setLevels] = useState<AdminLevel[]>([]);
  const [scheduleOn, setScheduleOn] = useState(!!editing?.scheduled_at);
  const [scheduledAt, setScheduledAt] = useState<string>(() => isoToLocalInput(editing?.scheduled_at ?? null));
  const [attachMode, setAttachMode] = useState<AttachMode>(
    editing?.series_id || initialAttachment?.series_id ? "series" : editing?.event_occurrence_id || initialAttachment?.event_occurrence_id ? "event" : "standalone",
  );
  const [attachSeriesId, setAttachSeriesId] = useState<string>(editing?.series_id ?? initialAttachment?.series_id ?? "");
  const [attachEventId, setAttachEventId] = useState<string>(editing?.event_occurrence_id ?? initialAttachment?.event_occurrence_id ?? "");
  const [primaryImage, setPrimaryImage] = useState(editing?.primary_image_url ?? "");
  const [gallery, setGallery] = useState<string[]>(editing?.gallery_image_urls ?? []);
  const [featured, setFeatured] = useState(editing?.is_featured ?? false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const channelAvailability = useChannels();

  useEffect(() => {
    void AdminApi.engagementReport().then((r) => setCells(r.cells)).catch(() => setCells([]));
    void CurriculumApi.levels().then(setLevels).catch(() => setLevels([]));
  }, []);

  const previewChannel = useMemo(() => (channels.has("push") ? "Push notification" : channels.has("email") ? "Email" : "In-app banner"), [channels]);

  function audiencePayload(): AnnouncementAudience {
    if (audienceKind === "cells") return { kind: "cells", cell_group_ids: [...audienceCells] };
    if (audienceKind === "level") return { kind: "level", level_number: audienceLevel };
    return { kind: "all" };
  }

  async function save(): Promise<void> {
    setErr(null);
    if (!title.trim() || !body.trim()) return setErr("Announcement title and body are required.");
    if (channels.size === 0) return setErr("Pick at least one channel.");
    if (audienceKind === "cells" && audienceCells.size === 0) return setErr("Pick at least one cell for a cell-targeted announcement.");
    const scheduledIso = scheduleOn ? localInputToIso(scheduledAt) : undefined;
    if (scheduleOn && !scheduledIso) return setErr("Pick a valid schedule time, or turn scheduling off.");

    const payload: Record<string, unknown> = {
      title: title.trim(),
      body: body.trim(),
      channels: [...channels],
      audience: audiencePayload(),
      primary_image_url: primaryImage.trim() || null,
      gallery_image_urls: gallery.filter(Boolean),
      series_id: attachMode === "series" && attachSeriesId ? attachSeriesId : null,
      event_occurrence_id: attachMode === "event" && attachEventId ? attachEventId : null,
      ...(scheduledIso ? { scheduled_at: scheduledIso } : {}),
    };

    setBusy(true);
    try {
      let id: string;
      if (isEdit) {
        await AnnouncementsApi.update(editing!.announcement_id, payload);
        id = editing!.announcement_id;
      } else {
        const created = await AnnouncementsApi.create(payload);
        id = created.announcement_id;
      }
      if (featured !== (editing?.is_featured ?? false)) {
        if (featured) await AnnouncementsApi.setHomepage(id).catch(() => undefined);
        else await AnnouncementsApi.clearHomepage(id).catch(() => undefined);
      }
      onSaved(
        isEdit
          ? "Announcement updated."
          : scheduledIso
            ? `Announcement scheduled for ${fmtDateTime(scheduledIso)}.`
            : "Announcement saved as a draft — send it when ready.",
      );
    } catch (e) {
      const msg = errorMessage(e, isEdit ? "Could not update announcement." : "Could not create announcement.");
      setErr(msg);
      onError(msg);
    } finally {
      setBusy(false);
    }
  }

  const input = { background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 13 } as const;

  return (
    <Modal onClose={onClose} width={720}>
      <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--nuru-gold)", letterSpacing: 0.5, textTransform: "uppercase" }}>{isEdit ? "Edit announcement" : "New announcement"}</div>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)" }}>{isEdit ? "Edit announcement" : "Create announcement"}</h2>
        </div>
        <button onClick={onClose} className="rounded-lg p-2" style={{ background: "var(--secondary)", border: "none" }} aria-label="Close">
          <X size={16} />
        </button>
      </div>
      <div className="px-6 py-5 flex flex-col gap-5" style={{ overflowY: "auto" }}>
        <SectionDivider label="Message" />
        <Field label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sunday Service Reminder" className="w-full rounded-xl px-4 py-2.5 outline-none" style={input} />
        </Field>
        <Field label="Body">
          <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Tomorrow we gather for worship at 9:00 AM…" className="w-full rounded-xl px-3 py-2.5 outline-none resize-none" style={{ ...input, lineHeight: 1.5 }} />
        </Field>

        <SectionDivider label="Attachment" />
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { k: "standalone", l: "Standalone" },
              { k: "series", l: "This series" },
              { k: "event", l: "One event" },
            ] as Array<{ k: AttachMode; l: string }>
          ).map((m) => (
            <button
              key={m.k}
              onClick={() => setAttachMode(m.k)}
              className="rounded-xl px-3 py-2"
              style={{ background: attachMode === m.k ? "var(--nuru-navy)" : "var(--input-background)", color: attachMode === m.k ? "#fff" : "var(--foreground)", border: "1px solid", borderColor: attachMode === m.k ? "var(--nuru-navy)" : "var(--border)", fontSize: 12, fontWeight: 600 }}
            >
              {m.l}
            </button>
          ))}
        </div>
        {attachMode === "series" ? (
          <Field label="Series" hint="Shown under the series in the command center; sending is unchanged.">
            <select value={attachSeriesId} onChange={(e) => setAttachSeriesId(e.target.value)} className="w-full rounded-xl px-3 py-2.5 outline-none" style={input}>
              <option value="">Choose a series…</option>
              {seriesOptions.map((s) => (
                <option key={s.series_id} value={s.series_id}>{s.title} · {s.cadence}</option>
              ))}
            </select>
          </Field>
        ) : null}
        {attachMode === "event" ? (
          <Field label="Event occurrence">
            <select value={attachEventId} onChange={(e) => setAttachEventId(e.target.value)} className="w-full rounded-xl px-3 py-2.5 outline-none" style={input}>
              <option value="">Choose an occurrence…</option>
              {eventOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.title} · {o.date} {o.time}</option>
              ))}
            </select>
          </Field>
        ) : null}

        <SectionDivider label="Channels" />
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {CHANNEL_DEFS.map((c) => {
            const on = channels.has(c.key);
            const meta = channelAvailability[c.key];
            const available = meta?.available ?? false;
            return (
              <button
                key={c.key}
                disabled={!available}
                title={
                  available
                    ? meta?.note
                    : `${meta?.note ?? "No provider connected"} — deliveries on this channel would be suppressed.`
                }
                onClick={() =>
                  setChannels((prev) => {
                    const next = new Set(prev);
                    if (next.has(c.key)) next.delete(c.key);
                    else next.add(c.key);
                    return next;
                  })
                }
                className="rounded-xl py-3 flex flex-col items-center gap-1"
                style={{
                  background: on ? "var(--nuru-navy)" : "var(--input-background)",
                  color: on ? "#fff" : available ? "var(--foreground)" : "var(--muted-foreground)",
                  border: "1px solid",
                  borderColor: on ? "var(--nuru-navy)" : "var(--border)",
                  fontSize: 11,
                  fontWeight: 600,
                  opacity: available ? 1 : 0.55,
                  cursor: available ? "pointer" : "not-allowed",
                }}
              >
                {c.icon}
                {c.label}
                {!available && meta?.note ? (
                  <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3 }}>{meta.note}</span>
                ) : null}
              </button>
            );
          })}
        </div>

        <SectionDivider label="Audience" />
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { key: "all", label: "All members" },
              { key: "cells", label: "Specific cells" },
              { key: "level", label: "Specific level" },
            ] as const
          ).map((a) => {
            const on = audienceKind === a.key;
            return (
              <button key={a.key} onClick={() => setAudienceKind(a.key)} className="rounded-xl px-3 py-2" style={{ background: on ? "var(--nuru-gold)" : "var(--input-background)", color: on ? "#fff" : "var(--foreground)", border: "1px solid", borderColor: on ? "var(--nuru-gold)" : "var(--border)", fontSize: 12, fontWeight: 600 }}>
                {a.label}
              </button>
            );
          })}
        </div>
        {audienceKind === "cells" ? (
          <Field label={`Cells (${audienceCells.size} selected)`}>
            <div className="flex flex-col gap-1 rounded-xl p-2" style={{ background: "var(--input-background)", border: "1px solid var(--border)", maxHeight: 180, overflowY: "auto" }}>
              {cells.length === 0 ? <span style={{ fontSize: 12, color: "var(--muted-foreground)", padding: 6 }}>Loading cells…</span> : null}
              {cells.map((c) => {
                const on = audienceCells.has(c.cell_group_id);
                return (
                  <label key={c.cell_group_id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 cursor-pointer" style={{ background: on ? "var(--secondary)" : "transparent" }}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setAudienceCells((prev) => {
                          const next = new Set(prev);
                          if (next.has(c.cell_group_id)) next.delete(c.cell_group_id);
                          else next.add(c.cell_group_id);
                          return next;
                        })
                      }
                    />
                    <span style={{ fontSize: 13, color: "var(--foreground)", fontWeight: on ? 700 : 500 }}>{c.name}</span>
                    <span style={{ fontSize: 11, color: "var(--muted-foreground)", marginLeft: "auto" }}>{c.members} members</span>
                  </label>
                );
              })}
            </div>
          </Field>
        ) : null}
        {audienceKind === "level" ? (
          <Field label="Level">
            <select value={audienceLevel} onChange={(e) => setAudienceLevel(Number(e.target.value))} className="w-full rounded-xl px-3 py-2.5 outline-none" style={input}>
              {(levels.length > 0 ? levels.map((l) => ({ n: l.level_number, t: l.title })) : [1, 2, 3, 4, 5, 6].map((n) => ({ n, t: `Level ${n}` }))).map((l) => (
                <option key={l.n} value={l.n}>L{l.n} — {l.t}</option>
              ))}
            </select>
          </Field>
        ) : null}

        <SectionDivider label="Schedule" />
        <Toggle label="Schedule for later (otherwise saved as a draft you send manually)" on={scheduleOn} onChange={setScheduleOn} icon={<CalendarDays size={13} />} />
        {scheduleOn ? (
          <Field label="Send at">
            <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="w-full rounded-xl px-3 py-2.5 outline-none" style={{ ...input, fontFamily: "var(--font-mono)" }} />
          </Field>
        ) : null}

        <SectionDivider label="Images" />
        <ImagesField folder="announcements" primary={primaryImage} gallery={gallery} onPrimary={setPrimaryImage} onGallery={setGallery} />

        <SectionDivider label="Homepage" />
        <Toggle on={featured} onChange={setFeatured} label="Feature this announcement on the mobile homepage" icon={<Star size={13} />} />

        <SectionDivider label="Live preview" />
        <div className="rounded-xl p-4" style={{ background: "var(--nuru-navy)", color: "#fff" }}>
          <div style={{ fontSize: 11, color: "rgba(232,239,245,0.7)", textTransform: "uppercase", letterSpacing: 0.5 }}>Nuru Church · {previewChannel}</div>
          <div style={{ fontSize: 14, fontWeight: 700, marginTop: 6 }}>{title || "Announcement title"}</div>
          <div style={{ fontSize: 12, color: "rgba(232,239,245,0.85)", marginTop: 4, lineHeight: 1.5 }}>{body || "Your message preview appears here."}</div>
        </div>
      </div>

      {err ? (
        <div className="mx-6 mb-1 rounded-lg" role="alert" style={{ background: "#FDECEC", color: "#A8281F", fontSize: 12.5, padding: "9px 12px", border: "1px solid #F5C6C2" }}>{err}</div>
      ) : null}
      <div className="px-6 py-4 flex items-center justify-end gap-2" style={{ background: "var(--secondary)", borderTop: "1px solid var(--border)" }}>
        <button onClick={onClose} className="rounded-xl px-4 py-2.5" style={{ fontSize: 13, fontWeight: 600, background: "transparent", border: "none", color: "var(--foreground)" }}>Cancel</button>
        <button onClick={() => void save()} disabled={busy} className="flex items-center gap-2 rounded-xl px-5 py-2.5" style={{ background: "var(--nuru-navy)", color: "#fff", fontSize: 13, fontWeight: 700, border: "none", opacity: busy ? 0.6 : 1 }}>
          <CheckCircle2 size={13} /> {busy ? "Saving…" : isEdit ? "Save changes" : scheduleOn ? "Schedule" : "Save draft"}
        </button>
      </div>
    </Modal>
  );
}
