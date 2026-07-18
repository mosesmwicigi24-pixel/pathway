// Shared UI kit for the Events page family (EVENTS_ARCHITECTURE §9) — the
// portal design language pieces (cards, pills, drawers, image fields) that the
// hub, command center, editor and studio all share. Extracted from the old
// monolithic Events.tsx; every control here is real — no cosmetic toggles.
import { useMemo, useState, type ReactElement, type ReactNode } from "react";
import { Image as ImageIcon, Plus, X } from "lucide-react";
import { OpsApi, uploadToCloudinary, type AnnouncementRow, type CalendarOccurrence } from "../../api/client";
import { errorMessage } from "../../util/error";
import { localIso, fmtTime, fmtDateShort, durationLabel } from "../../util/dates";

/* ------------------------------------------------------------------ */
/* Categories & derivation                                            */
/* ------------------------------------------------------------------ */

export type EventCategory = "worship" | "class" | "cell" | "leadership" | "youth" | "special";

export const CATEGORY_META: Record<EventCategory, { label: string; color: string; soft: string }> = {
  worship: { label: "Worship", color: "#C89B3C", soft: "#FBF1DA" },
  class: { label: "Class", color: "#0B1F33", soft: "#E1E6ED" },
  cell: { label: "Cell", color: "#16A34A", soft: "#DCF7E4" },
  leadership: { label: "Leadership", color: "#6366F1", soft: "#E4E5FB" },
  youth: { label: "Youth", color: "#2563EB", soft: "#DBE7FE" },
  special: { label: "Special", color: "#F97316", soft: "#FFE6D2" },
};

/** Category off the wire when present, else inferred from the title so the
 *  calendar pills stay colourful for legacy series without one. */
export function deriveCategory(occ: { title: string; cell_group_id: string | null; category?: string | null }): EventCategory {
  const c = (occ.category ?? "").toLowerCase();
  if (c && c in CATEGORY_META) return c as EventCategory;
  const t = occ.title.toLowerCase();
  if (/worship|service|prayer/.test(t)) return "worship";
  if (/class|discipleship|pathway|lesson|study/.test(t)) return "class";
  if (/leader|training|sync/.test(t)) return "leadership";
  if (/youth|teen|ablaze|fellowship/.test(t)) return "youth";
  if (/cell|home group/.test(t) || occ.cell_group_id) return "cell";
  return "special";
}

/* ------------------------------------------------------------------ */
/* UI occurrence shape (mapped from CalendarOccurrence)                */
/* ------------------------------------------------------------------ */

export type UiOccurrence = {
  id: string;
  seriesId: string;
  originalStartAt: string; // original recurrence instant (exception key)
  title: string;
  category: EventCategory;
  iso: string; // YYYY-MM-DD (local)
  startsAt: string; // raw ISO
  endsAt: string;
  date: string; // "Sun 7 Jun 2026"
  time: string; // "9:00 AM"
  endTime: string;
  duration: string;
  location: string;
  cellGroupId: string | null;
  visibility: string;
  showOnHome: boolean;
  rescheduled: boolean;
};

export function toUi(occ: CalendarOccurrence): UiOccurrence {
  const start = new Date(occ.start_at);
  const end = new Date(occ.end_at);
  return {
    id: occ.occurrence_id,
    seriesId: occ.series_id,
    originalStartAt: occ.original_start_at,
    title: occ.title,
    category: deriveCategory(occ),
    iso: localIso(start),
    startsAt: occ.start_at,
    endsAt: occ.end_at,
    date: fmtDateShort(start),
    time: fmtTime(start),
    endTime: fmtTime(end),
    duration: durationLabel(start, end),
    location: occ.location ?? "Location TBC",
    cellGroupId: occ.cell_group_id,
    visibility: occ.visibility,
    showOnHome: occ.show_on_home ?? false,
    rescheduled: occ.rescheduled ?? false,
  };
}

/* ------------------------------------------------------------------ */
/* Announcement labels                                                 */
/* ------------------------------------------------------------------ */

export type AnnouncementStatusLabel = "Draft" | "Scheduled" | "Sent" | "Cancelled" | "Archived";
export const announcementStatusLabel = (a: Pick<AnnouncementRow, "status" | "archived_at">): AnnouncementStatusLabel => {
  if (a.archived_at) return "Archived";
  if (a.status === "scheduled") return "Scheduled";
  if (a.status === "sent") return "Sent";
  if (a.status === "cancelled") return "Cancelled";
  return "Draft";
};

export const audienceLabel = (a: Pick<AnnouncementRow, "audience_kind" | "audience_cells" | "audience_level">): string => {
  if (a.audience_kind === "cells") return `${a.audience_cells?.length ?? 0} cell${(a.audience_cells?.length ?? 0) === 1 ? "" : "s"}`;
  if (a.audience_kind === "level") return `Level ${a.audience_level ?? "—"}`;
  return "All members";
};

/* ------------------------------------------------------------------ */
/* Small UI primitives                                                 */
/* ------------------------------------------------------------------ */

export type PillStatus =
  | "draft"
  | "scheduled"
  | "live"
  | "completed"
  | "cancelled"
  | "rescheduled"
  | "paused"
  | "active"
  | AnnouncementStatusLabel
  | "Verified"
  | "Manual"
  | "Guest";

export function StatusPill({ status }: { status: PillStatus }): ReactElement {
  const map: Record<string, { bg: string; fg: string }> = {
    draft: { bg: "#EEF0F3", fg: "#6B7280" },
    scheduled: { bg: "#E1E6ED", fg: "#0B1F33" },
    live: { bg: "#DCF7E4", fg: "#15803D" },
    active: { bg: "#DCF7E4", fg: "#15803D" },
    completed: { bg: "#DCF7E4", fg: "#15803D" },
    cancelled: { bg: "#FEE2E2", fg: "#B91C1C" },
    rescheduled: { bg: "#FFE6D2", fg: "#9A3412" },
    paused: { bg: "#FFE6D2", fg: "#9A3412" },
    Draft: { bg: "#EEF0F3", fg: "#6B7280" },
    Scheduled: { bg: "#E1E6ED", fg: "#0B1F33" },
    Sent: { bg: "#DCF7E4", fg: "#15803D" },
    Cancelled: { bg: "#FEE2E2", fg: "#B91C1C" },
    Archived: { bg: "#EEF0F3", fg: "#6B7280" },
    Verified: { bg: "#DCF7E4", fg: "#15803D" },
    Manual: { bg: "#FBF1DA", fg: "#A87616" },
    Guest: { bg: "#DBE7FE", fg: "#1D4ED8" },
  };
  const m = map[status] ?? { bg: "#EEF0F3", fg: "#6B7280" };
  return (
    <span className="rounded-full px-2 py-0.5 shrink-0" style={{ background: m.bg, color: m.fg, fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase" }}>
      {status === "live" && <span style={{ color: "#15803D" }}>● </span>}
      {status}
    </span>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }): ReactElement {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export function Card({ children, padded = true, className = "" }: { children: ReactNode; padded?: boolean; className?: string }): ReactElement {
  return (
    <div
      className={`rounded-2xl ${className}`}
      style={{ background: "var(--card)", border: "1px solid var(--border)", padding: padded ? 20 : 0, boxShadow: "0 1px 3px rgba(11,31,51,0.05)", minWidth: 0 }}
    >
      {children}
    </div>
  );
}

export function SectionHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }): ReactElement {
  return (
    <div className="flex items-end justify-between gap-3 flex-wrap mb-3">
      <div>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "var(--foreground)", lineHeight: 1.2 }}>{title}</h2>
        {subtitle && <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

export function Metric({ label, value, color }: { label: string; value: string; color: string }): ReactElement {
  return (
    <div className="rounded-xl p-3" style={{ background: "var(--secondary)" }}>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 4, fontWeight: 700 }}>{label}</div>
    </div>
  );
}

// One compact tinted tile for the insights row: icon chip, big value, overline
// label, tiny hint. Tappable when an onClick is supplied.
export function MergedTile({
  icon,
  value,
  label,
  hint,
  tintBg,
  tintFg,
  onClick,
}: {
  icon: ReactNode;
  value: string;
  label: string;
  hint: string;
  tintBg: string;
  tintFg: string;
  onClick?: () => void;
}): ReactElement {
  const inner = (
    <>
      <div className="rounded-xl flex items-center justify-center" style={{ width: 30, height: 30, background: tintBg, color: tintFg }}>
        {icon}
      </div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)", lineHeight: 1, marginTop: 8 }}>{value}</div>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.4, marginTop: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
      <div style={{ fontSize: 10.5, color: "var(--muted-foreground)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{hint}</div>
    </>
  );
  const baseStyle = { background: "var(--secondary)", border: "1px solid var(--border)", padding: 12, minWidth: 0 } as const;
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="rounded-xl text-left flex flex-col" style={{ ...baseStyle, cursor: "pointer" }}>
        {inner}
      </button>
    );
  }
  return (
    <div className="rounded-xl flex flex-col" style={baseStyle}>
      {inner}
    </div>
  );
}

export function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }): ReactElement {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 12, color: "var(--foreground)", marginTop: 2, fontFamily: mono ? "var(--font-mono)" : undefined }}>{value}</div>
    </div>
  );
}

export function SectionDivider({ label }: { label: string }): ReactElement {
  return (
    <div className="flex items-center gap-3">
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--nuru-gold)", textTransform: "uppercase", letterSpacing: 0.8, whiteSpace: "nowrap" }}>{label}</div>
      <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
    </div>
  );
}

/** Controlled toggle — every instance is wired to real state (no cosmetic toggles). */
export function Toggle({ on, onChange, label, icon, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; icon: ReactNode; disabled?: boolean }): ReactElement {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!on)}
      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left w-full"
      style={{ background: "var(--input-background)", border: "1px solid var(--border)", opacity: disabled ? 0.5 : 1, cursor: disabled ? "default" : "pointer" }}
    >
      <span className="rounded-md flex items-center justify-center shrink-0" style={{ width: 32, height: 18, background: on ? "#16A34A" : "#D1D5DB", position: "relative" }}>
        <span className="rounded-full bg-white absolute" style={{ width: 14, height: 14, top: 2, left: on ? 16 : 2, transition: "left 0.15s" }} />
      </span>
      <span style={{ color: "var(--muted-foreground)" }}>{icon}</span>
      <span style={{ fontSize: 13, color: "var(--foreground)" }}>{label}</span>
    </button>
  );
}

export function EmptyState({ icon, title, body, cta, onCta }: { icon: ReactNode; title: string; body: string; cta?: string | undefined; onCta?: (() => void) | undefined }): ReactElement {
  return (
    <div className="flex flex-col items-center text-center py-10">
      <div className="rounded-2xl flex items-center justify-center mb-3" style={{ width: 48, height: 48, background: "var(--secondary)", color: "var(--muted-foreground)" }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--foreground)" }}>{title}</div>
      <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 4, maxWidth: 280 }}>{body}</div>
      {onCta && cta && (
        <button onClick={onCta} className="flex items-center gap-1.5 rounded-xl px-4 py-2 mt-4" style={{ background: "var(--nuru-navy)", color: "#fff", fontSize: 12, fontWeight: 700, border: "none" }}>
          <Plus size={12} /> {cta}
        </button>
      )}
    </div>
  );
}

/** Per-zone loading shimmer — one block per pending card (§9 skeleton loading). */
export function Skeleton({ height = 120, className = "" }: { height?: number; className?: string }): ReactElement {
  return (
    <div
      className={`rounded-2xl ${className}`}
      style={{
        height,
        background: "linear-gradient(90deg, var(--secondary) 25%, var(--card) 50%, var(--secondary) 75%)",
        backgroundSize: "200% 100%",
        animation: "nuru-shimmer 1.4s ease-in-out infinite",
        border: "1px solid var(--border)",
      }}
      aria-hidden
    >
      <style>{`@keyframes nuru-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
    </div>
  );
}

export function Drawer({ children, onClose, width }: { children: ReactNode; onClose: () => void; width: number }): ReactElement {
  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "rgba(11,31,51,0.45)" }} onClick={onClose}>
      <div className="h-full overflow-y-auto" style={{ background: "var(--card)", width: `min(${width}px, 100vw)`, maxWidth: "100vw", boxShadow: "-20px 0 60px rgba(0,0,0,0.2)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-end p-3">
          <button onClick={onClose} className="rounded-lg p-2" style={{ background: "var(--secondary)", border: "none" }} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Modal({ children, onClose, width }: { children: ReactNode; onClose: () => void; width: number }): ReactElement {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "rgba(11,31,51,0.55)" }} onClick={onClose}>
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: "var(--card)", width: `min(${width}px, calc(100vw - 32px))`, maxWidth: "calc(100vw - 32px)", maxHeight: "92vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 70px rgba(0,0,0,0.25)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Images field (Cloudinary upload OR pasted URL)                      */
/* ------------------------------------------------------------------ */

export function ImagesField({
  folder,
  primary,
  gallery,
  onPrimary,
  onGallery,
}: {
  folder: "events" | "announcements";
  primary: string;
  gallery: string[];
  onPrimary: (url: string) => void;
  onGallery: (urls: string[]) => void;
}): ReactElement {
  const [busy, setBusy] = useState(false);
  const [uErr, setUErr] = useState<string | null>(null);
  const [pasteUrl, setPasteUrl] = useState("");

  async function uploadFile(file: File): Promise<string | null> {
    if (file.size > 10 * 1024 * 1024) {
      setUErr("Image is larger than 10 MB. Please choose a smaller image.");
      return null;
    }
    setBusy(true);
    setUErr(null);
    try {
      const sign = await OpsApi.signAdminImage(folder);
      const { secure_url } = await uploadToCloudinary(sign, file);
      return secure_url;
    } catch (e) {
      setUErr(errorMessage(e, "Upload failed — paste an image URL instead."));
      return null;
    } finally {
      setBusy(false);
    }
  }

  function pick(onUrl: (url: string) => void): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const f = input.files?.[0];
      if (f) void uploadFile(f).then((url) => url && onUrl(url));
    };
    input.click();
  }

  const thumb = { width: 64, height: 64, borderRadius: 10, objectFit: "cover" as const, border: "1px solid var(--border)" };
  const btn = { fontSize: 12, fontWeight: 600, borderRadius: 10, padding: "8px 12px", border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", cursor: "pointer" };

  return (
    <div className="flex flex-col gap-3">
      {/* Primary */}
      <div className="flex items-center gap-3">
        {primary ? (
          <img src={primary} alt="cover" style={thumb} />
        ) : (
          <div style={{ ...thumb, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--secondary)", color: "var(--muted-foreground)" }}>
            <ImageIcon size={20} />
          </div>
        )}
        <div className="flex flex-col gap-2 flex-1">
          <div className="flex gap-2">
            <button type="button" onClick={() => pick(onPrimary)} disabled={busy} style={btn}>{busy ? "Uploading…" : "Upload cover"}</button>
            {primary ? <button type="button" onClick={() => onPrimary("")} style={{ ...btn, color: "#B91C1C" }}>Remove</button> : null}
          </div>
          <input
            value={primary}
            onChange={(e) => onPrimary(e.target.value)}
            placeholder="…or paste a cover image URL"
            className="w-full rounded-lg px-3 py-2 outline-none"
            style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 12 }}
          />
        </div>
      </div>

      {/* Gallery */}
      <div>
        <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginBottom: 6 }}>More images (up to 5) — shown in the carousel after the cover.</div>
        <div className="flex flex-wrap items-center gap-2">
          {gallery.map((url, i) => (
            <div key={`${url}-${i}`} style={{ position: "relative" }}>
              <img src={url} alt={`gallery ${i + 1}`} style={thumb} />
              <button
                type="button"
                onClick={() => onGallery(gallery.filter((_, j) => j !== i))}
                style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: 10, background: "#B91C1C", color: "#fff", border: "none", cursor: "pointer", fontSize: 11, lineHeight: "20px" }}
              >
                ×
              </button>
            </div>
          ))}
          {gallery.length < 5 ? (
            <button type="button" onClick={() => pick((url) => onGallery([...gallery, url].slice(0, 5)))} disabled={busy} style={{ ...thumb, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--secondary)", color: "var(--muted-foreground)", cursor: "pointer" }}>
              <Plus size={18} />
            </button>
          ) : null}
        </div>
        {gallery.length < 5 ? (
          <div className="flex gap-2 mt-2">
            <input
              value={pasteUrl}
              onChange={(e) => setPasteUrl(e.target.value)}
              placeholder="…or paste an image URL"
              className="flex-1 rounded-lg px-3 py-2 outline-none"
              style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 12 }}
            />
            <button
              type="button"
              onClick={() => {
                const u = pasteUrl.trim();
                if (u) {
                  onGallery([...gallery, u].slice(0, 5));
                  setPasteUrl("");
                }
              }}
              style={btn}
            >
              Add
            </button>
          </div>
        ) : null}
      </div>
      {uErr ? <div style={{ fontSize: 11, color: "#B91C1C" }}>{uErr}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Timeline verb map (command-center activity feed)                    */
/* ------------------------------------------------------------------ */

export function timelineLabel(action: string): string {
  const map: Record<string, string> = {
    "calendar.series_created": "Series created",
    "calendar.series_updated": "Series edited",
    "calendar.series_deleted": "Series deleted",
    "calendar.series_paused": "Series paused",
    "calendar.series_resumed": "Series resumed",
    "calendar.series_split": "Series split (this and following)",
    "calendar.series_featured": "Featured on mobile home",
    "calendar.series_unfeatured": "Removed from mobile home",
    "calendar.series_show_on_home": "Home visibility changed",
    "calendar.exception": "Occurrence changed (exception)",
    "attendance.checked_in": "Member checked in (QR)",
    "attendance.manual_checkin": "Manual check-in recorded",
    "attendance.guest_added": "Guest recorded",
    "attendance.qr_rotated": "QR code rotated",
    "announcement.created": "Announcement created",
    "announcement.updated": "Announcement edited",
    "announcement.sent": "Announcement sent",
    "announcement.cancelled": "Announcement cancelled",
    "announcement.deleted": "Announcement deleted",
    "announcement.duplicated": "Announcement duplicated",
    "announcement.archived": "Announcement archived",
    "announcement.restored": "Announcement restored",
  };
  return map[action] ?? action.replace(/[._]/g, " ");
}

/** Memoised soonest-first sort of UiOccurrences. */
export function useSortedByStart(events: UiOccurrence[]): UiOccurrence[] {
  return useMemo(() => [...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt)), [events]);
}
