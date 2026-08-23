// SMS Center — compose, pick who, send, and then see what ACTUALLY happened.
//
// The columns on the report are a state machine, not a mood: `delivered` is
// written only by Africa's Talking's delivery-report webhook, `submitted`
// shows honestly as "awaiting report", `failed` carries their reason verbatim
// ("InsufficientCredit" reads as exactly that), and `suppressed` names why
// someone was never texted (opted out / no phone / duplicate). The compose
// screen shows the bill before the money moves: segments × people, with the
// account balance beside it — all server-computed via /admin/sms/preview, so
// this file never re-implements the GSM-7 arithmetic it would get wrong.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Send, Users, RefreshCw, ChevronLeft, Plus, Trash2, CheckCircle2,
  AlertTriangle, Clock, Ban, Wallet,
} from "lucide-react";
import {
  SmsApi, AdminApi, CurriculumApi, OpsApi,
  type SmsAudience, type SmsPreview, type SmsCampaignRow, type SmsCampaignDetail,
  type SmsRecipientRow, type SmsGroupRow,
  type EngagementCellRow, type AdminLevel, type MemberRow,
} from "../../api/client";
import { errorMessage } from "../../util/error";

const card: React.CSSProperties = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14 };
const input: React.CSSProperties = {
  background: "var(--input-background)", border: "1px solid var(--border)", borderRadius: 10,
  padding: "8px 10px", fontSize: 13, color: "var(--foreground)", width: "100%",
};
const btnPrimary: React.CSSProperties = {
  background: "var(--nuru-navy)", color: "#fff", border: "none", borderRadius: 10,
  padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer",
  display: "inline-flex", alignItems: "center", gap: 6,
};
const btnQuiet: React.CSSProperties = {
  background: "var(--secondary)", color: "var(--foreground)", border: "1px solid var(--border)",
  borderRadius: 10, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer",
  display: "inline-flex", alignItems: "center", gap: 6,
};

const STATUS_STYLE: Record<SmsRecipientRow["status"], { bg: string; fg: string; label: string }> = {
  delivered: { bg: "#DCFCE7", fg: "#15803D", label: "delivered" },
  submitted: { bg: "#DBEAFE", fg: "#1D4ED8", label: "awaiting report" },
  failed: { bg: "#FEE2E2", fg: "#B91C1C", label: "failed" },
  suppressed: { bg: "#FEF3C7", fg: "#92400E", label: "not sent" },
  queued: { bg: "var(--secondary)", fg: "var(--muted-foreground)", label: "queued" },
};

function Pill({ status }: { status: SmsRecipientRow["status"] }): JSX.Element {
  const s = STATUS_STYLE[status];
  return (
    <span style={{ background: s.bg, color: s.fg, borderRadius: 999, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>
      {s.label}
    </span>
  );
}

function audienceLabel(a: SmsAudience): string {
  switch (a.kind) {
    case "all": return "Whole church";
    case "cells": return `${a.cell_group_ids.length} cell group(s)`;
    case "level": return `Level ${a.level_number}`;
    case "group": return "Named group";
    case "individuals": return `${a.user_ids.length} individual(s)`;
    case "event_rsvps": return "Event RSVPs (going)";
  }
}

export function SmsCenter(): JSX.Element {
  const [tab, setTab] = useState<"compose" | "campaigns" | "groups">("compose");
  const [overview, setOverview] = useState<{ configured: boolean; sender_id: string | null; balance: string | null } | null>(null);
  const [openCampaign, setOpenCampaign] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void SmsApi.overview().then(setOverview).catch(() => setOverview({ configured: false, sender_id: null, balance: null }));
  }, []);

  const flash = (setter: (v: string | null) => void, msg: string): void => {
    setter(msg);
    window.setTimeout(() => setter(null), 6000);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 26, color: "var(--foreground)" }}>SMS Center</h1>
          <p style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
            Bulk messages with the truth per person — delivered, awaiting, failed and why.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {overview && !overview.configured && (
            <span style={{ background: "#FEE2E2", color: "#B91C1C", borderRadius: 10, padding: "6px 12px", fontSize: 12, fontWeight: 600 }}>
              Africa&apos;s Talking is not configured — sending is off
            </span>
          )}
          {overview?.balance && (
            <span className="flex items-center gap-1.5" style={{ background: "var(--secondary)", borderRadius: 10, padding: "6px 12px", fontSize: 12, fontWeight: 700, color: "var(--foreground)" }}>
              <Wallet size={13} /> {overview.balance}
            </span>
          )}
          {overview?.sender_id && (
            <span style={{ background: "var(--secondary)", borderRadius: 10, padding: "6px 12px", fontSize: 12, color: "var(--muted-foreground)" }}>
              from <strong style={{ color: "var(--foreground)" }}>{overview.sender_id}</strong>
            </span>
          )}
        </div>
      </div>

      {notice && <div style={{ background: "#DCFCE7", color: "#15803D", borderRadius: 10, padding: "10px 14px", fontSize: 13 }}>{notice}</div>}
      {error && <div style={{ background: "#FEE2E2", color: "#B91C1C", borderRadius: 10, padding: "10px 14px", fontSize: 13 }}>{error}</div>}

      <div className="flex items-center gap-1 rounded-xl p-1 flex-wrap" style={{ background: "var(--secondary)", width: "fit-content" }}>
        {([["compose", "Compose"], ["campaigns", "Campaigns"], ["groups", "Groups"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => { setTab(k); setOpenCampaign(null); }} style={{
            background: tab === k ? "var(--card)" : "transparent", border: "none", borderRadius: 10,
            padding: "6px 14px", fontSize: 12, fontWeight: tab === k ? 700 : 500, color: "var(--foreground)", cursor: "pointer",
          }}>
            {l}
          </button>
        ))}
      </div>

      {tab === "compose" && (
        <Compose
          disabled={overview ? !overview.configured : true}
          onSent={(id) => { setTab("campaigns"); setOpenCampaign(id); flash(setNotice, "Campaign sent — deliveries update as reports arrive."); }}
          onError={(m) => flash(setError, m)}
        />
      )}
      {tab === "campaigns" && (openCampaign
        ? <CampaignReport id={openCampaign} onBack={() => setOpenCampaign(null)} onNotice={(m) => flash(setNotice, m)} onError={(m) => flash(setError, m)} />
        : <CampaignList onOpen={setOpenCampaign} />)}
      {tab === "groups" && <GroupsManager onError={(m) => flash(setError, m)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Compose                                                             */
/* ------------------------------------------------------------------ */

function Compose({ disabled, onSent, onError }: {
  disabled: boolean;
  onSent: (campaignId: string) => void;
  onError: (m: string) => void;
}): JSX.Element {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<SmsAudience["kind"]>("all");
  const [cells, setCells] = useState<EngagementCellRow[]>([]);
  const [levels, setLevels] = useState<AdminLevel[]>([]);
  const [groups, setGroups] = useState<SmsGroupRow[]>([]);
  const [pickedCells, setPickedCells] = useState<Set<string>>(new Set());
  const [level, setLevel] = useState(1);
  const [groupId, setGroupId] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [memberHits, setMemberHits] = useState<MemberRow[]>([]);
  const [picked, setPicked] = useState<Map<string, string>>(new Map()); // user_id -> name
  const [preview, setPreview] = useState<SmsPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const previewSeq = useRef(0);

  useEffect(() => {
    void AdminApi.engagementReport().then((r) => setCells(r.cells)).catch(() => setCells([]));
    void CurriculumApi.levels().then(setLevels).catch(() => setLevels([]));
    void SmsApi.groups().then(setGroups).catch(() => setGroups([]));
  }, []);

  // Member search for the "individuals" audience — server-side, debounced.
  useEffect(() => {
    if (kind !== "individuals" || memberQuery.trim().length < 2) { setMemberHits([]); return; }
    const t = window.setTimeout(() => {
      void OpsApi.members({ search: memberQuery.trim(), limit: 8 }).then((r) => setMemberHits(r.data)).catch(() => setMemberHits([]));
    }, 350);
    return () => window.clearTimeout(t);
  }, [kind, memberQuery]);

  const audience: SmsAudience | null = useMemo(() => {
    switch (kind) {
      case "all": return { kind: "all" };
      case "cells": return pickedCells.size ? { kind: "cells", cell_group_ids: [...pickedCells] } : null;
      case "level": return { kind: "level", level_number: level };
      case "group": return groupId ? { kind: "group", group_id: groupId } : null;
      case "individuals": return picked.size ? { kind: "individuals", user_ids: [...picked.keys()] } : null;
      case "event_rsvps": return null; // composed from an event page later; hidden below
    }
  }, [kind, pickedCells, level, groupId, picked]);

  // The bill, before the money: server-computed, debounced, race-guarded.
  useEffect(() => {
    if (!audience || !body.trim()) { setPreview(null); return; }
    const seq = ++previewSeq.current;
    setPreviewBusy(true);
    const t = window.setTimeout(() => {
      void SmsApi.preview(audience, body)
        .then((p) => { if (seq === previewSeq.current) setPreview(p); })
        .catch(() => { if (seq === previewSeq.current) setPreview(null); })
        .finally(() => { if (seq === previewSeq.current) setPreviewBusy(false); });
    }, 400);
    return () => window.clearTimeout(t);
  }, [audience, body]);

  async function fire(): Promise<void> {
    if (!audience) return;
    setSending(true);
    try {
      const { campaign_id } = await SmsApi.createCampaign({ title: title.trim() || body.slice(0, 60), body: body.trim(), audience });
      await SmsApi.send(campaign_id);
      onSent(campaign_id);
    } catch (e) {
      onError(errorMessage(e, "The campaign could not be sent — nothing went out."));
    } finally {
      setSending(false);
      setConfirming(false);
    }
  }

  const overLimit = body.length > 612;

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(0, 1.4fr) minmax(260px, 1fr)" }}>
      <div style={{ ...card, padding: 20 }} className="flex flex-col gap-4">
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.5 }}>Title (internal)</label>
          <input style={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sunday service reminder" maxLength={120} />
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.5 }}>Message</label>
          <textarea
            style={{ ...input, minHeight: 120, resize: "vertical", fontFamily: "inherit" }}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Karibu! Sunday service starts 9am..."
            maxLength={700}
          />
          <div className="flex items-center justify-between" style={{ fontSize: 11.5, color: overLimit ? "#B91C1C" : "var(--muted-foreground)", marginTop: 4 }}>
            <span>{body.length} characters{overLimit ? " — over the 4-segment limit" : ""}</span>
            {preview && (
              <span style={{ fontWeight: 700, color: preview.septets === null ? "#B45309" : "var(--muted-foreground)" }}>
                {preview.segments} segment{preview.segments === 1 ? "" : "s"} per person
                {preview.septets === null ? " · non-standard characters make texts cost double" : ""}
              </span>
            )}
          </div>
        </div>

        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.5 }}>Send to</label>
          <div className="flex gap-2 flex-wrap" style={{ marginTop: 6 }}>
            {([["all", "Whole church"], ["cells", "Cells"], ["level", "Level"], ["group", "Named group"], ["individuals", "Individuals"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setKind(k)} style={{
                ...btnQuiet,
                background: kind === k ? "var(--nuru-navy)" : "var(--input-background)",
                color: kind === k ? "#fff" : "var(--foreground)",
                borderColor: kind === k ? "var(--nuru-navy)" : "var(--border)",
              }}>
                {l}
              </button>
            ))}
          </div>

          {kind === "cells" && (
            <div className="flex gap-2 flex-wrap" style={{ marginTop: 10 }}>
              {cells.map((c) => {
                const on = pickedCells.has(c.cell_group_id);
                return (
                  <button key={c.cell_group_id} onClick={() => setPickedCells((prev) => { const n = new Set(prev); if (on) n.delete(c.cell_group_id); else n.add(c.cell_group_id); return n; })}
                    style={{ ...btnQuiet, background: on ? "var(--nuru-gold)" : "var(--input-background)", color: on ? "#fff" : "var(--foreground)" }}>
                    {c.name}
                  </button>
                );
              })}
              {cells.length === 0 && <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>No cells found.</span>}
            </div>
          )}
          {kind === "level" && (
            <select style={{ ...input, marginTop: 10, width: 240 }} value={level} onChange={(e) => setLevel(Number(e.target.value))}>
              {(levels.length ? levels : [{ level_number: 1, title: "Level 1" } as AdminLevel]).map((l) => (
                <option key={l.level_number} value={l.level_number}>Level {l.level_number} — {l.title}</option>
              ))}
            </select>
          )}
          {kind === "group" && (
            <select style={{ ...input, marginTop: 10, width: 300 }} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">Choose a group…</option>
              {groups.map((g) => <option key={g.group_id} value={g.group_id}>{g.name} ({g.members})</option>)}
            </select>
          )}
          {kind === "individuals" && (
            <div style={{ marginTop: 10 }} className="flex flex-col gap-2">
              <input style={{ ...input, width: 320 }} value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} placeholder="Search members by name…" />
              {memberHits.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {memberHits.map((m) => (
                    <button key={m.user_id} style={btnQuiet} onClick={() => { setPicked((p) => new Map(p).set(m.user_id, m.full_name)); setMemberQuery(""); }}>
                      <Plus size={12} /> {m.full_name}
                    </button>
                  ))}
                </div>
              )}
              {picked.size > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {[...picked.entries()].map(([id, name]) => (
                    <span key={id} className="flex items-center gap-1" style={{ background: "var(--secondary)", borderRadius: 999, padding: "4px 10px", fontSize: 12 }}>
                      {name}
                      <button onClick={() => setPicked((p) => { const n = new Map(p); n.delete(id); return n; })} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--muted-foreground)" }}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <button
            style={{ ...btnPrimary, opacity: disabled || !audience || !body.trim() || overLimit || sending ? 0.5 : 1 }}
            disabled={disabled || !audience || !body.trim() || overLimit || sending}
            onClick={() => setConfirming(true)}
          >
            <Send size={13} /> Review &amp; send
          </button>
        </div>
      </div>

      {/* The bill, itemised */}
      <div style={{ ...card, padding: 20 }} className="flex flex-col gap-3">
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.5 }}>
          Before you send {previewBusy ? "…" : ""}
        </div>
        {!preview ? (
          <p style={{ fontSize: 13, color: "var(--muted-foreground)" }}>Write the message and choose an audience — the reach and cost appear here.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="will be texted" value={preview.sendable} strong />
              <Stat label="message units" value={preview.message_units} strong />
              <Stat label="opted out" value={preview.suppressed.opted_out} />
              <Stat label="no phone" value={preview.suppressed.no_phone} />
              <Stat label="duplicate number" value={preview.suppressed.duplicate_phone} />
              <Stat label="audience total" value={preview.total} />
            </div>
            {preview.balance && (
              <p style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                Balance: <strong style={{ color: "var(--foreground)" }}>{preview.balance}</strong> · one unit ≈ one standard SMS.
              </p>
            )}
            {preview.sendable === 0 && (
              <p style={{ fontSize: 12.5, color: "#B91C1C" }}>Nobody in this audience can receive a text — nothing would be sent.</p>
            )}
          </>
        )}
      </div>

      {confirming && audience && preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "rgba(11,31,51,0.55)" }} onClick={() => setConfirming(false)}>
          <div style={{ ...card, width: "min(460px, 100%)", padding: 22 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "var(--foreground)" }}>Send this campaign?</h2>
            <p style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 8 }}>
              <strong style={{ color: "var(--foreground)" }}>{preview.sendable}</strong> {preview.sendable === 1 ? "person" : "people"} ·{" "}
              <strong style={{ color: "var(--foreground)" }}>{preview.message_units}</strong> message unit{preview.message_units === 1 ? "" : "s"} ·{" "}
              {audienceLabel(audience)}
            </p>
            <div style={{ background: "var(--secondary)", borderRadius: 10, padding: 12, fontSize: 13, marginTop: 12, whiteSpace: "pre-wrap" }}>{body}</div>
            <div className="flex gap-2 justify-end" style={{ marginTop: 16 }}>
              <button style={btnQuiet} onClick={() => setConfirming(false)}>Cancel</button>
              <button style={{ ...btnPrimary, opacity: sending ? 0.6 : 1 }} disabled={sending} onClick={() => void fire()}>
                <Send size={13} /> {sending ? "Sending…" : `Send ${preview.message_units} unit${preview.message_units === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: number; strong?: boolean }): JSX.Element {
  return (
    <div style={{ background: "var(--secondary)", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: strong ? 22 : 16, fontWeight: 700, color: strong ? "var(--foreground)" : "var(--muted-foreground)" }}>{value}</div>
      <div style={{ fontSize: 10.5, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Campaign list + report                                              */
/* ------------------------------------------------------------------ */

function CampaignList({ onOpen }: { onOpen: (id: string) => void }): JSX.Element {
  const [rows, setRows] = useState<SmsCampaignRow[] | null>(null);
  useEffect(() => {
    void SmsApi.campaigns().then(setRows).catch(() => setRows([]));
  }, []);
  if (rows === null) return <p style={{ fontSize: 13, color: "var(--muted-foreground)" }}>Loading…</p>;
  if (rows.length === 0) return <p style={{ fontSize: 13, color: "var(--muted-foreground)" }}>No campaigns yet — compose the first one.</p>;
  return (
    <div className="flex flex-col gap-2">
      {rows.map((c) => (
        <button key={c.campaign_id} onClick={() => onOpen(c.campaign_id)} className="text-left" style={{ ...card, padding: 16, cursor: "pointer" }}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--foreground)" }}>{c.title}</div>
              <div style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>
                {audienceLabel(c.audience)} · {c.segments} segment{c.segments === 1 ? "" : "s"} · {new Date(c.sent_at ?? c.created_at).toLocaleString()}
              </div>
            </div>
            <div className="flex items-center gap-3" style={{ fontSize: 12 }}>
              <span style={{ color: "#15803D", fontWeight: 700 }}><CheckCircle2 size={12} style={{ display: "inline" }} /> {c.delivered}</span>
              <span style={{ color: "#1D4ED8", fontWeight: 700 }}><Clock size={12} style={{ display: "inline" }} /> {c.awaiting}</span>
              <span style={{ color: "#B91C1C", fontWeight: 700 }}><AlertTriangle size={12} style={{ display: "inline" }} /> {c.failed}</span>
              <span style={{ color: "#92400E", fontWeight: 700 }}><Ban size={12} style={{ display: "inline" }} /> {c.suppressed}</span>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

function CampaignReport({ id, onBack, onNotice, onError }: {
  id: string;
  onBack: () => void;
  onNotice: (m: string) => void;
  onError: (m: string) => void;
}): JSX.Element {
  const [data, setData] = useState<SmsCampaignDetail | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setData(await SmsApi.campaign(id)); } catch (e) { onError(errorMessage(e, "Could not load the campaign report.")); }
  }, [id, onError]);
  useEffect(() => { void load(); }, [load]);
  // Delivery reports trickle in for a minute or two after a send — refresh
  // gently while the tab is open rather than making the admin mash a button.
  useEffect(() => {
    const t = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(t);
  }, [load]);

  if (!data) return <p style={{ fontSize: 13, color: "var(--muted-foreground)" }}>Loading…</p>;
  const failed = data.recipients.filter((r) => r.status === "failed");
  const retryable = failed.filter((r) => r.attempts < 3);

  async function retry(): Promise<void> {
    setBusy(true);
    try {
      const out = await SmsApi.retry(id);
      onNotice(
        `Retrying ${out.retried}. ` +
        (out.skipped_terminal ? `${out.skipped_terminal} need a human first (bad number / blacklist). ` : "") +
        (out.skipped_attempts ? `${out.skipped_attempts} hit the attempt limit.` : ""),
      );
      await load();
    } catch (e) {
      onError(errorMessage(e, "The retry could not be started."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <button style={btnQuiet} onClick={onBack}><ChevronLeft size={13} /> All campaigns</button>
        {failed.length > 0 && (
          <button style={{ ...btnPrimary, opacity: busy || retryable.length === 0 ? 0.5 : 1 }} disabled={busy || retryable.length === 0} onClick={() => void retry()}>
            <RefreshCw size={13} /> Retry {retryable.length} failed
          </button>
        )}
      </div>
      <div style={{ ...card, padding: 18 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--foreground)" }}>{data.title}</div>
        <div style={{ background: "var(--secondary)", borderRadius: 10, padding: 12, fontSize: 13, marginTop: 8, whiteSpace: "pre-wrap" }}>{data.body}</div>
      </div>
      <div style={{ ...card, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: "var(--secondary)", textAlign: "left" }}>
                {["Person", "Phone", "Status", "Why", "Cost", "Tries"].map((h) => (
                  <th key={h} style={{ padding: "10px 12px", fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--muted-foreground)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.recipients.map((r) => (
                <tr key={r.recipient_id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "9px 12px", fontWeight: 600, color: "var(--foreground)" }}>{r.full_name ?? "—"}</td>
                  <td style={{ padding: "9px 12px", fontFamily: "var(--font-mono)", color: "var(--muted-foreground)" }}>{r.phone.startsWith("none:") ? "no number" : r.phone}</td>
                  <td style={{ padding: "9px 12px" }}><Pill status={r.status} /></td>
                  <td style={{ padding: "9px 12px", color: r.status === "failed" ? "#B91C1C" : "var(--muted-foreground)" }}>
                    {r.failure_reason ?? (r.suppress_reason ? r.suppress_reason.replace(/_/g, " ") : r.status === "submitted" ? "awaiting the delivery report" : "")}
                  </td>
                  <td style={{ padding: "9px 12px", fontFamily: "var(--font-mono)", color: "var(--muted-foreground)" }}>{r.cost ?? ""}</td>
                  <td style={{ padding: "9px 12px", color: "var(--muted-foreground)" }}>{r.attempts || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Groups                                                              */
/* ------------------------------------------------------------------ */

function GroupsManager({ onError }: { onError: (m: string) => void }): JSX.Element {
  const [groups, setGroups] = useState<SmsGroupRow[]>([]);
  const [name, setName] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [members, setMembers] = useState<Array<{ user_id: string; full_name: string; phone_number: string | null }>>([]);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<MemberRow[]>([]);

  const load = useCallback(async () => {
    try { setGroups(await SmsApi.groups()); } catch (e) { onError(errorMessage(e, "Could not load the groups.")); }
  }, [onError]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!open) { setMembers([]); return; }
    void SmsApi.groupMembers(open).then(setMembers).catch(() => setMembers([]));
  }, [open]);

  useEffect(() => {
    if (!open || query.trim().length < 2) { setHits([]); return; }
    const t = window.setTimeout(() => {
      void OpsApi.members({ search: query.trim(), limit: 8 }).then((r) => setHits(r.data)).catch(() => setHits([]));
    }, 350);
    return () => window.clearTimeout(t);
  }, [open, query]);

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(240px, 1fr) minmax(0, 1.6fr)" }}>
      <div style={{ ...card, padding: 16 }} className="flex flex-col gap-3">
        <div className="flex gap-2">
          <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="New group name…" maxLength={80} />
          <button style={btnPrimary} disabled={!name.trim()} onClick={() => {
            void SmsApi.createGroup(name.trim()).then(() => { setName(""); void load(); }).catch((e) => onError(errorMessage(e, "Could not create the group — is the name already taken?")));
          }}><Plus size={13} /></button>
        </div>
        {groups.map((g) => (
          <div key={g.group_id} className="flex items-center justify-between gap-2" style={{
            background: open === g.group_id ? "var(--secondary)" : "transparent", borderRadius: 10, padding: "8px 10px",
          }}>
            <button onClick={() => setOpen(g.group_id)} style={{ background: "none", border: "none", cursor: "pointer", textAlign: "left", flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)" }}><Users size={12} style={{ display: "inline" }} /> {g.name}</div>
              <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{g.members} member{g.members === 1 ? "" : "s"}</div>
            </button>
            <button style={{ background: "none", border: "none", cursor: "pointer", color: "#B91C1C" }} title="Delete group" onClick={() => {
              if (!window.confirm(`Delete the group "${g.name}"? Members themselves are untouched.`)) return;
              void SmsApi.deleteGroup(g.group_id).then(() => { if (open === g.group_id) setOpen(null); void load(); }).catch((e) => onError(errorMessage(e, "Could not delete the group.")));
            }}><Trash2 size={14} /></button>
          </div>
        ))}
        {groups.length === 0 && <p style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>No groups yet — name one above ("Ushering team", "Choir"…).</p>}
      </div>

      <div style={{ ...card, padding: 16 }} className="flex flex-col gap-3">
        {!open ? (
          <p style={{ fontSize: 13, color: "var(--muted-foreground)" }}>Pick a group to manage its members.</p>
        ) : (
          <>
            <input style={{ ...input, width: 320 }} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Add members — search by name…" />
            {hits.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {hits.map((m) => (
                  <button key={m.user_id} style={btnQuiet} onClick={() => {
                    void SmsApi.addGroupMembers(open, [m.user_id]).then(() => { setQuery(""); void SmsApi.groupMembers(open).then(setMembers); void load(); }).catch((e) => onError(errorMessage(e, "Could not add that member.")));
                  }}><Plus size={12} /> {m.full_name}</button>
                ))}
              </div>
            )}
            <div className="flex flex-col gap-1">
              {members.map((m) => (
                <div key={m.user_id} className="flex items-center justify-between" style={{ borderTop: "1px solid var(--border)", padding: "8px 2px" }}>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>{m.full_name}</span>
                    <span style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginLeft: 8, fontFamily: "var(--font-mono)" }}>{m.phone_number ?? "no phone"}</span>
                  </div>
                  <button style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)" }} onClick={() => {
                    void SmsApi.removeGroupMember(open, m.user_id).then(() => { void SmsApi.groupMembers(open).then(setMembers); void load(); }).catch((e) => onError(errorMessage(e, "Could not remove that member.")));
                  }}>×</button>
                </div>
              ))}
              {members.length === 0 && <p style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>Nobody in this group yet.</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default SmsCenter;
