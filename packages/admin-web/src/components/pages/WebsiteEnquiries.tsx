// Website Enquiries — what people send from nuruplace.org's connection card,
// contact form and prayer request.
//
// THE UNANSWERED LIST IS THE POINT. Everything else here is decoration around
// one question: who has written to this church and not yet heard back? So the
// default filter is New, ordered newest first, and every row carries the way to
// reach that person — a tappable phone number and email, because the reply
// happens off-platform, by telephone or WhatsApp. There is no reply box on this
// screen and that is deliberate: the sender is a stranger with no account, so
// there is no thread to reply into and pretending otherwise would strand
// messages in a box nobody watches.
//
// "Acknowledge" records WHO picked it up, so two pastors do not both ring the
// same person on a Sunday afternoon.
//
// The language badge is not cosmetic. The site is English and Kiswahili, and
// somebody who wrote in Kiswahili should be answered in Kiswahili.
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import {
  Inbox, Phone, Mail, HandHeart, CalendarCheck, Check, Archive,
  Loader2, RefreshCw, MessageSquare, type LucideIcon,
} from "lucide-react";
import { WebsiteApi, type WebsiteEnquiry } from "../../api/client";

const NAVY = "#1d4e86";
const NAVY_INK = "#0b1f33";
const MUTED = "#5c6b80";

const SHADOW = "0 1px 3px rgba(11,31,51,0.06), 0 1px 2px rgba(11,31,51,0.04)";
const card = (pad = 16): React.CSSProperties => ({
  background: "#fff", border: "1px solid var(--border)", borderRadius: 16, padding: pad, boxShadow: SHADOW,
});

/** What each kind of message is, in the words a pastor would use. */
const KIND: Record<WebsiteEnquiry["kind"], { label: string; icon: LucideIcon; color: string; bg: string }> = {
  connection_card: { label: "Connection card", icon: CalendarCheck, color: "#166534", bg: "#dcfce7" },
  prayer: { label: "Prayer request", icon: HandHeart, color: "#92400e", bg: "#fef3c7" },
  message: { label: "Message", icon: MessageSquare, color: "#1e40af", bg: "#dbeafe" },
};

const STATUS: Record<WebsiteEnquiry["status"], { label: string; color: string; bg: string }> = {
  new: { label: "Unanswered", color: "#991b1b", bg: "#fee2e2" },
  acknowledged: { label: "Picked up", color: "#166534", bg: "#dcfce7" },
  closed: { label: "Closed", color: "#475569", bg: "#f1f5f9" },
};

const LOCALE_LABEL: Record<string, string> = { en: "English", sw: "Kiswahili" };

/** "3 hours ago" reads better than a timestamp when the question is "how long
 *  has this person been waiting?" — which is the only question this list asks. */
function waitingFor(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

type Filter = "new" | "acknowledged" | "closed" | "all";

export function WebsiteEnquiries(): ReactElement {
  const [filter, setFilter] = useState<Filter>("new");
  const [rows, setRows] = useState<WebsiteEnquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await WebsiteApi.enquiries(filter === "all" ? {} : { status: filter }));
    } catch {
      // Say so rather than showing an empty list: "nothing to answer" and
      // "we could not check" must never look the same on this screen.
      setError("Could not load enquiries. Refresh to try again.");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, status: "acknowledged" | "closed") => {
    setBusyId(id);
    try {
      await WebsiteApi.acknowledge(id, { status });
      await load();
    } catch {
      setError("That did not save. Refresh and try again.");
    } finally {
      setBusyId(null);
    }
  };

  const unanswered = useMemo(() => rows.filter((r) => r.status === "new").length, [rows]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, color: NAVY_INK }}>Website Enquiries</h1>
          <p style={{ margin: "4px 0 0", color: MUTED, fontSize: 14 }}>
            Sent from nuruplace.org. Replies go by phone or WhatsApp — there is no account to write back to.
          </p>
        </div>
        <button
          onClick={() => void load()}
          style={{
            display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 14px",
            border: "1px solid var(--border)", borderRadius: 10, background: "#fff",
            color: NAVY, cursor: "pointer", minHeight: 40,
          }}
        >
          <RefreshCw size={16} /> Refresh
        </button>
      </header>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(["new", "acknowledged", "closed", "all"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: "8px 14px", borderRadius: 999, minHeight: 40, cursor: "pointer",
              border: `1px solid ${filter === f ? NAVY : "var(--border)"}`,
              background: filter === f ? NAVY : "#fff",
              color: filter === f ? "#fff" : NAVY_INK,
              fontWeight: filter === f ? 600 : 400,
            }}
          >
            {f === "new" ? "Unanswered" : f === "all" ? "All" : STATUS[f].label}
            {f === "new" && unanswered > 0 && filter === "new" ? ` (${unanswered})` : ""}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ ...card(12), borderColor: "#fecaca", background: "#fef2f2", color: "#991b1b" }}>{error}</div>
      )}

      {loading ? (
        <div style={{ ...card(24), display: "flex", alignItems: "center", gap: 10, color: MUTED }}>
          <Loader2 size={18} className="spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div style={{ ...card(32), textAlign: "center", color: MUTED }}>
          <Inbox size={28} style={{ opacity: 0.5 }} />
          <p style={{ margin: "10px 0 0" }}>
            {filter === "new" ? "Nothing waiting for a reply." : "Nothing here."}
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {rows.map((r) => {
            const kind = KIND[r.kind];
            const KindIcon = kind.icon;
            const status = STATUS[r.status];
            return (
              <article key={r.enquiry_id} style={card()}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <strong style={{ color: NAVY_INK, fontSize: 16 }}>{r.full_name}</strong>
                    <span style={{ ...pill(kind.color, kind.bg), display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <KindIcon size={13} /> {kind.label}
                    </span>
                    <span style={pill(status.color, status.bg)}>{status.label}</span>
                    {/* Answer people in the language they wrote in. */}
                    <span style={pill("#3730a3", "#e0e7ff")}>{LOCALE_LABEL[r.locale] ?? r.locale}</span>
                    {r.wants_prayer && <span style={pill("#92400e", "#fef3c7")}>Asked for prayer</span>}
                    {r.planning_visit && <span style={pill("#166534", "#dcfce7")}>Planning to visit</span>}
                  </div>
                  <span style={{ color: MUTED, fontSize: 13, whiteSpace: "nowrap" }}>{waitingFor(r.received_at)}</span>
                </div>

                <p style={{ margin: "12px 0", color: NAVY_INK, whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{r.message}</p>

                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
                  {/* tel: and mailto: because the reply happens off-platform —
                      one tap from the list to the call. */}
                  {r.phone_number && (
                    <a href={`tel:${r.phone_number}`} style={link}>
                      <Phone size={15} /> {r.phone_number}
                    </a>
                  )}
                  {r.email && (
                    <a href={`mailto:${r.email}`} style={link}>
                      <Mail size={15} /> {r.email}
                    </a>
                  )}
                  <span style={{ flex: 1 }} />
                  {r.status === "new" && (
                    <button
                      disabled={busyId === r.enquiry_id}
                      onClick={() => void act(r.enquiry_id, "acknowledged")}
                      style={{ ...btn, background: NAVY, color: "#fff", borderColor: NAVY }}
                    >
                      {busyId === r.enquiry_id ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
                      I'll answer this
                    </button>
                  )}
                  {r.status !== "closed" && (
                    <button
                      disabled={busyId === r.enquiry_id}
                      onClick={() => void act(r.enquiry_id, "closed")}
                      style={btn}
                    >
                      <Archive size={15} /> Close
                    </button>
                  )}
                </div>

                {r.acknowledged_at && (
                  <p style={{ margin: "10px 0 0", color: MUTED, fontSize: 13 }}>
                    Picked up {waitingFor(r.acknowledged_at)}
                    {r.note ? ` — ${r.note}` : ""}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

const pill = (color: string, bg: string): React.CSSProperties => ({
  padding: "3px 9px", borderRadius: 999, fontSize: 12, fontWeight: 600, color, background: bg,
});

const link: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6, color: NAVY,
  textDecoration: "none", fontSize: 14, minHeight: 40,
};

const btn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 14px",
  border: "1px solid var(--border)", borderRadius: 10, background: "#fff",
  color: NAVY_INK, cursor: "pointer", minHeight: 40, fontSize: 14,
};
