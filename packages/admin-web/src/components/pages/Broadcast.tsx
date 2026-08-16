// Broadcast — one word from the pastor to the whole church, and every answer
// to it in one place. SuperAdmin only, and the page itself stays behind the
// §5.3 password step-up: the FIRST thing the page does is confirm the password
// (the server's 15-minute pwd_at window is the single source of truth — any
// 403 password_required from any call drops the page back to the lock).
//
// Layout mirrors the iOS Broadcast: composer up top, the last four posts sent
// beneath it (reach · seen · replied), and a post opens into its detail — the
// response wall and the tick ledger. A response's "Open thread" is a
// navigation to /chat?c=<conversation_id>: the reply already lives in a
// private 1:1 thread seeded with the broadcast as its top message.
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Lock, Megaphone, Send, CheckCheck, Check, MessageCircle, ChevronLeft, Users,
} from "lucide-react";
import {
  BroadcastApi, isPasswordRequired,
  type BroadcastRow, type BroadcastDetailData,
} from "../../api/client";

const GOLD = "var(--nuru-gold)";
const NAVY = "var(--nuru-navy, #0b1f33)";

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function Broadcast(): JSX.Element {
  const navigate = useNavigate();
  // locked → the password gate; open → the console. Any password_required
  // answer from the server flips back to locked (the token's window lapsed).
  const [locked, setLocked] = useState(true);
  const [password, setPassword] = useState("");
  const [gateBusy, setGateBusy] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);

  const [rows, setRows] = useState<BroadcastRow[]>([]);
  const [total, setTotal] = useState(0);
  const [detail, setDetail] = useState<BroadcastDetailData | null>(null);
  const [detailTab, setDetailTab] = useState<"responses" | "recipients">("responses");
  const [loading, setLoading] = useState(false);

  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ body: string; reach: number } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  // The mutation id survives a mid-send re-lock so the retry is the SAME send.
  const mutationId = useRef<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const res = await BroadcastApi.list();
      setRows(res.data);
      setTotal(res.total);
      setLocked(false);
    } catch (e) {
      if (isPasswordRequired(e)) setLocked(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // First visit: try the list with the token we have — a recent unlock (within
  // the server's window) walks straight in; otherwise the 403 shows the gate.
  useEffect(() => {
    void load();
  }, [load]);

  const unlock = async (): Promise<void> => {
    if (!password || gateBusy) return;
    setGateBusy(true);
    setGateError(null);
    try {
      await BroadcastApi.confirmPassword(password);
      setPassword("");
      await load();
    } catch (e) {
      const err = e as { response?: { status?: number; data?: { error?: { message?: string } } } };
      setGateError(
        err.response?.status === 401
          ? "That password isn't right."
          : err.response?.data?.error?.message ?? "Couldn't confirm. Please try again.",
      );
    } finally {
      setGateBusy(false);
    }
  };

  const send = async (): Promise<void> => {
    setConfirming(false);
    if (!draft.trim() || sending) return;
    setSending(true);
    setSendError(null);
    const mid = mutationId.current ?? crypto.randomUUID();
    mutationId.current = mid;
    try {
      const res = await BroadcastApi.send(draft.trim(), mid);
      setSent({ body: res.body, reach: res.recipient_count });
      setDraft("");
      mutationId.current = null;
      await load();
    } catch (e) {
      if (isPasswordRequired(e)) {
        setLocked(true); // draft + mutation id survive; unlocking resumes cleanly
      } else {
        setSendError("Couldn't send the broadcast. Please try again.");
      }
    } finally {
      setSending(false);
    }
  };

  const openDetail = async (id: string): Promise<void> => {
    try {
      const d = await BroadcastApi.detail(id);
      setDetail(d);
      setDetailTab("responses");
    } catch (e) {
      if (isPasswordRequired(e)) setLocked(true);
    }
  };

  // ── The gate ──
  if (locked) {
    return (
      <div className="flex items-center justify-center" style={{ minHeight: "60vh" }}>
        <div
          className="w-full max-w-sm rounded-2xl border bg-white p-8 text-center shadow-sm"
          style={{ borderColor: "rgba(200,155,60,0.35)" }}
        >
          <div
            className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
            style={{ background: "var(--nuru-light-gold)" }}
          >
            <Lock size={22} style={{ color: GOLD }} />
          </div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 20, color: NAVY }}>The Broadcast is locked</div>
          <p className="mt-2 text-[13px] leading-relaxed text-slate-500">
            This room is between the shepherd and the flock. Confirm your password to open it — it stays open for 15
            minutes.
          </p>
          <input
            type="password"
            value={password}
            autoFocus
            placeholder="Your password"
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void unlock();
            }}
            className="mt-5 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-[14px] outline-none focus:border-amber-400"
          />
          {gateError && <div className="mt-2 text-[12px] font-medium text-red-600">{gateError}</div>}
          <button
            onClick={() => void unlock()}
            disabled={!password || gateBusy}
            className="mt-4 w-full rounded-xl py-2.5 text-[13px] font-bold text-white disabled:opacity-50"
            style={{ background: GOLD }}
          >
            {gateBusy ? "Confirming…" : "Open the Broadcast"}
          </button>
        </div>
      </div>
    );
  }

  // ── Detail: one broadcast, its response wall, and the tick ledger ──
  if (detail) {
    const seenPct = detail.recipient_count > 0 ? Math.round((detail.seen_count / detail.recipient_count) * 100) : 0;
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <button
          onClick={() => setDetail(null)}
          className="flex items-center gap-1 text-[13px] font-semibold text-slate-500 hover:text-slate-700"
        >
          <ChevronLeft size={15} /> All broadcasts
        </button>

        <div className="rounded-2xl p-6 text-white shadow-sm" style={{ background: NAVY }}>
          <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-widest" style={{ color: "var(--lum-gold, #e0b85e)" }}>
            <Megaphone size={13} /> Broadcast · {timeAgo(detail.created_at)}
          </div>
          <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed">{detail.body}</p>
          <div className="mt-4 flex flex-wrap gap-4 text-[12px] text-white/70">
            <span className="flex items-center gap-1.5"><Users size={13} /> Reached {detail.recipient_count}</span>
            <span className="flex items-center gap-1.5"><CheckCheck size={14} style={{ color: "#6fb2ff" }} /> Seen by {detail.seen_count} ({seenPct}%)</span>
            <span className="flex items-center gap-1.5"><MessageCircle size={13} /> {detail.responses.length} replies</span>
          </div>
        </div>

        <div className="flex gap-2">
          {(["responses", "recipients"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setDetailTab(t)}
              className="rounded-full px-4 py-1.5 text-[12px] font-bold capitalize"
              style={
                detailTab === t
                  ? { background: GOLD, color: "#fff" }
                  : { background: "#fff", color: "#64748b", border: "1px solid #e2e8f0" }
              }
            >
              {t === "responses" ? `Responses (${detail.responses.length})` : `Recipients (${detail.recipients.length})`}
            </button>
          ))}
        </div>

        {detailTab === "responses" && (
          <div className="space-y-2">
            {detail.responses.length === 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-[13px] text-slate-400">
                No replies yet — the word is still landing.
              </div>
            )}
            {detail.responses.map((r) => (
              <div key={r.message_id} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                <div
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-full text-[11px] font-bold text-white"
                  style={{ background: NAVY }}
                >
                  {r.avatar_url ? (
                    <img src={r.avatar_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    r.full_name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("")
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-bold" style={{ color: NAVY }}>{r.full_name}</span>
                    <span className="flex-shrink-0 text-[11px] text-slate-400">{timeAgo(r.created_at)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[13px] text-slate-600">
                    {r.msg_type === "voice" ? "🎙 Voice note" : r.body}
                  </p>
                </div>
                <button
                  onClick={() => navigate(`/chat?c=${r.conversation_id}`)}
                  className="flex-shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold"
                  style={{ background: "var(--nuru-light-gold)", color: "#8a6a1f" }}
                >
                  Open thread
                </button>
              </div>
            ))}
          </div>
        )}

        {detailTab === "recipients" && (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {detail.recipients.map((m, i) => (
              <div
                key={m.user_id}
                className="flex items-center gap-3 px-4 py-2.5"
                style={i > 0 ? { borderTop: "1px solid #f1f5f9" } : undefined}
              >
                <div
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] font-bold text-white"
                  style={{ background: NAVY }}
                >
                  {m.avatar_url ? (
                    <img src={m.avatar_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    m.full_name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("")
                  )}
                </div>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium" style={{ color: NAVY }}>{m.full_name}</span>
                {m.seen ? (
                  <span className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: "#2f80ed" }}>
                    <CheckCheck size={15} /> Seen
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: "#94a3b8" }}>
                    <Check size={15} style={{ color: "#2f80ed" }} /> Delivered
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── The console: composer + the last posts sent ──
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="rounded-2xl p-6 text-white shadow-sm" style={{ background: NAVY }}>
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl" style={{ background: "rgba(200,155,60,0.25)" }}>
            <Megaphone size={20} style={{ color: "var(--lum-gold, #e0b85e)" }} />
          </div>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 18 }}>Message every member</div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-white/65">
              Reaches every member as a personal message from you. Replies come back to you one-on-one — no one else
              sees them.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <textarea
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setSent(null); }}
          placeholder="Write your message to everyone…"
          rows={5}
          className="w-full resize-none rounded-xl border border-slate-200 p-4 text-[14px] leading-relaxed outline-none focus:border-amber-400"
        />
        <div className="mt-3 flex items-center justify-between">
          <div className="text-[12px]">
            {sent && (
              <span className="font-semibold text-emerald-600">Delivered to {sent.reach} members 🎉</span>
            )}
            {sendError && <span className="font-medium text-red-600">{sendError}</span>}
          </div>
          <button
            onClick={() => setConfirming(true)}
            disabled={!draft.trim() || sending}
            className="flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-bold text-white disabled:opacity-50"
            style={{ background: GOLD }}
          >
            <Send size={14} /> {sending ? "Sending…" : "Send to everyone"}
          </button>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <div className="text-[11px] font-extrabold uppercase tracking-widest text-slate-400">Last posts sent</div>
          {total > rows.length && <div className="text-[11px] text-slate-400">{total} all-time</div>}
        </div>
        {loading && rows.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-[13px] text-slate-400">Loading…</div>
        )}
        {!loading && rows.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-[13px] text-slate-400">
            Nothing sent yet — your first word to the whole church starts above.
          </div>
        )}
        <div className="space-y-2">
          {rows.map((b) => (
            <button
              key={b.broadcast_id}
              onClick={() => void openDetail(b.broadcast_id)}
              className="block w-full rounded-2xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-amber-300"
            >
              <p className="truncate text-[14px] font-medium" style={{ color: NAVY }}>{b.body}</p>
              <div className="mt-2 flex flex-wrap items-center gap-4 text-[11.5px] text-slate-500">
                <span>{timeAgo(b.created_at)}</span>
                <span className="flex items-center gap-1"><Users size={12} /> {b.recipient_count}</span>
                <span className="flex items-center gap-1"><CheckCheck size={13} style={{ color: "#2f80ed" }} /> {b.seen_count} seen</span>
                <span className="flex items-center gap-1"><MessageCircle size={12} /> {b.replied_count} replied</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <div style={{ fontFamily: "var(--font-display)", fontSize: 18, color: NAVY }}>Broadcast to all members?</div>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-500">
              Every member receives this as a personal message from you.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirming(false)}
                className="rounded-full px-4 py-2 text-[13px] font-semibold text-slate-500"
              >
                Cancel
              </button>
              <button
                onClick={() => void send()}
                className="rounded-full px-5 py-2 text-[13px] font-bold text-white"
                style={{ background: GOLD }}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
