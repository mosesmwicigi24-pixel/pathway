// Calendar views for the Events Operations Center (EVENTS_ARCHITECTURE §9):
// Month / Week / Agenda / Year, all rendered from the windowed month cache
// (useCalendarRange) — infinite navigation, no fixed horizon anywhere.
import { useEffect, useMemo, type ReactElement } from "react";
import { CalendarDays, MapPin } from "lucide-react";
import { CATEGORY_META, EmptyState, StatusPill, type UiOccurrence } from "./kit";
import { localIso } from "../../util/dates";

export type CalendarViewKind = "Month" | "Week" | "Agenda" | "Year";

export function buildByDay(events: UiOccurrence[]): Map<string, UiOccurrence[]> {
  const m = new Map<string, UiOccurrence[]>();
  for (const e of events) {
    const arr = m.get(e.iso) ?? [];
    arr.push(e);
    m.set(e.iso, arr);
  }
  for (const arr of m.values()) arr.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return m;
}

/* ------------------------------------------------------------------ */
/* Month grid                                                          */
/* ------------------------------------------------------------------ */

export function MonthGrid({
  month,
  year,
  todayIso,
  selectedIso,
  byDay,
  onSelectDate,
  onSelectOccurrence,
}: {
  month: number;
  year: number;
  todayIso: string;
  selectedIso: string;
  byDay: Map<string, UiOccurrence[]>;
  onSelectDate: (iso: string) => void;
  onSelectOccurrence: (occ: UiOccurrence) => void;
}): ReactElement {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: ({ iso: string; day: number } | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ iso, day: d });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth: 560 }}>
      <div className="grid grid-cols-7 gap-1 mb-2">
        {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((d) => (
          <div key={d} className="text-center" style={{ fontSize: 10, color: "var(--muted-foreground)", letterSpacing: 0.8, fontWeight: 700, paddingBottom: 4 }}>
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          if (!c) return <div key={i} style={{ minHeight: 96 }} />;
          const dayEvents = byDay.get(c.iso) ?? [];
          const isSelected = c.iso === selectedIso;
          const isToday = c.iso === todayIso;
          return (
            <button
              key={i}
              onClick={() => onSelectDate(c.iso)}
              className="rounded-xl text-left p-2 transition-colors"
              style={{
                minHeight: 96,
                background: isSelected ? "var(--secondary)" : isToday ? "#FBF1DA" : "var(--card)",
                border: "1px solid",
                borderColor: isSelected ? "var(--nuru-navy)" : isToday ? "var(--nuru-gold)" : "var(--border)",
                cursor: "pointer",
              }}
            >
              <div className="flex items-center justify-between">
                <span style={{ fontSize: 12, fontWeight: isToday || isSelected ? 700 : 600, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>{c.day}</span>
                {dayEvents.length > 0 && <span style={{ fontSize: 9, color: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}>{dayEvents.length}</span>}
              </div>
              <div className="flex flex-col gap-1 mt-1">
                {dayEvents.slice(0, 2).map((d) => (
                  <span
                    key={d.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectOccurrence(d);
                    }}
                    className="rounded-md px-1.5 py-0.5 truncate"
                    style={{ background: CATEGORY_META[d.category].soft, color: CATEGORY_META[d.category].color, fontSize: 10, fontWeight: 600, cursor: "pointer" }}
                  >
                    <span style={{ fontFamily: "var(--font-mono)" }}>{d.time.split(" ")[0]}</span> {d.title}
                  </span>
                ))}
                {dayEvents.length > 2 && <span style={{ fontSize: 10, color: "var(--muted-foreground)", paddingLeft: 4 }}>+{dayEvents.length - 2} more</span>}
              </div>
            </button>
          );
        })}
      </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Week strip                                                          */
/* ------------------------------------------------------------------ */

export function WeekStrip({
  selectedIso,
  weekStart,
  byDay,
  onSelectDate,
  onSelectOccurrence,
}: {
  selectedIso: string;
  weekStart: Date;
  byDay: Map<string, UiOccurrence[]>;
  onSelectDate: (iso: string) => void;
  onSelectOccurrence: (occ: UiOccurrence) => void;
}): ReactElement {
  const days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return { iso: localIso(d), day: d.getDate(), label: d.toLocaleDateString("en-US", { weekday: "short" }) };
  });
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
      {days.map((d) => {
        const evs = byDay.get(d.iso) ?? [];
        const isSel = d.iso === selectedIso;
        return (
          <button
            key={d.iso}
            onClick={() => onSelectDate(d.iso)}
            className="rounded-xl p-3 text-left"
            style={{ minHeight: 160, background: isSel ? "var(--secondary)" : "var(--card)", border: "1px solid", borderColor: isSel ? "var(--nuru-navy)" : "var(--border)" }}
          >
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted-foreground)", letterSpacing: 0.5, textTransform: "uppercase" }}>{d.label}</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 700, color: "var(--foreground)", lineHeight: 1, marginTop: 2 }}>{d.day}</div>
            <div className="flex flex-col gap-1 mt-3">
              {evs.map((e) => (
                <span
                  key={e.id}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onSelectOccurrence(e);
                  }}
                  className="rounded-md px-1.5 py-1 truncate"
                  style={{ background: CATEGORY_META[e.category].soft, color: CATEGORY_META[e.category].color, fontSize: 10, fontWeight: 600, cursor: "pointer" }}
                >
                  <span style={{ fontFamily: "var(--font-mono)" }}>{e.time.split(" ")[0]}</span> {e.title}
                </span>
              ))}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Agenda — a chronological list of the anchor month (§9)              */
/* ------------------------------------------------------------------ */

export function AgendaView({
  month,
  year,
  todayIso,
  byDay,
  onSelectOccurrence,
  onCreate,
}: {
  month: number;
  year: number;
  todayIso: string;
  byDay: Map<string, UiOccurrence[]>;
  onSelectOccurrence: (occ: UiOccurrence) => void;
  onCreate: () => void;
}): ReactElement {
  const days = useMemo(() => {
    const prefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
    return [...byDay.entries()]
      .filter(([iso, evs]) => iso.startsWith(prefix) && evs.length > 0)
      .sort(([a], [b]) => a.localeCompare(b));
  }, [byDay, month, year]);

  if (days.length === 0) {
    return <EmptyState icon={<CalendarDays size={20} />} title="Nothing this month" body="No occurrences fall in this month. Navigate months freely — the calendar loads as you go." cta="Create event" onCta={onCreate} />;
  }
  return (
    <div className="flex flex-col gap-4">
      {days.map(([iso, evs]) => {
        const d = new Date(`${iso}T00:00:00`);
        const isToday = iso === todayIso;
        return (
          <div key={iso}>
            <div className="flex items-center gap-2 mb-2">
              <span
                className="rounded-lg px-2 py-1"
                style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, background: isToday ? "#FBF1DA" : "var(--secondary)", color: isToday ? "#A87616" : "var(--foreground)" }}
              >
                {d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
              </span>
              {isToday && <span style={{ fontSize: 10, fontWeight: 700, color: "#A87616", textTransform: "uppercase", letterSpacing: 0.5 }}>Today</span>}
            </div>
            <div className="flex flex-col">
              {evs.map((o, i) => (
                <button key={o.id} onClick={() => onSelectOccurrence(o)} className="text-left flex items-center gap-3 py-2.5" style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                  <div className="rounded-md shrink-0" style={{ width: 4, height: 34, background: CATEGORY_META[o.category].color }} />
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: "var(--foreground)", minWidth: 64 }}>{o.time}</span>
                  <div className="flex-1 min-w-0">
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.title}</div>
                    <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                      <MapPin size={10} /> {o.location}
                    </div>
                  </div>
                  {o.rescheduled ? <StatusPill status="rescheduled" /> : null}
                  <span style={{ fontSize: 11, fontWeight: 700, color: CATEGORY_META[o.category].color }}>{CATEGORY_META[o.category].label}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Year — 12 mini-months with event-density dots                       */
/* ------------------------------------------------------------------ */

export function YearView({
  year,
  todayIso,
  byDay,
  onJump,
  ensureYear,
}: {
  year: number;
  todayIso: string;
  byDay: Map<string, UiOccurrence[]>;
  onJump: (year: number, month: number, iso: string) => void;
  ensureYear: (year: number) => void;
}): ReactElement {
  useEffect(() => {
    ensureYear(year);
  }, [year, ensureYear]);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
      {Array.from({ length: 12 }).map((_, m) => (
        <MiniMonth key={m} year={year} month={m} todayIso={todayIso} byDay={byDay} onPick={(iso) => onJump(year, m, iso)} title />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Mini month — shared by the Year view and the sidebar jump calendar  */
/* ------------------------------------------------------------------ */

export function MiniMonth({
  year,
  month,
  todayIso,
  byDay,
  onPick,
  title = false,
}: {
  year: number;
  month: number;
  todayIso: string;
  byDay: Map<string, UiOccurrence[]>;
  onPick: (iso: string) => void;
  title?: boolean;
}): ReactElement {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: ({ iso: string; day: number } | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ iso: `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`, day: d });
  }
  return (
    <div className="rounded-xl p-3" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      {title && (
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--foreground)", marginBottom: 6 }}>
          {new Date(year, month, 1).toLocaleString("en-GB", { month: "long" })}
        </div>
      )}
      <div className="grid grid-cols-7 gap-0.5">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={`${d}-${i}`} className="text-center" style={{ fontSize: 8.5, color: "var(--muted-foreground)", fontWeight: 700 }}>
            {d}
          </div>
        ))}
        {cells.map((c, i) => {
          if (!c) return <div key={i} style={{ height: 22 }} />;
          const n = byDay.get(c.iso)?.length ?? 0;
          const isToday = c.iso === todayIso;
          return (
            <button
              key={i}
              onClick={() => onPick(c.iso)}
              className="rounded-md flex flex-col items-center justify-center"
              style={{
                height: 22,
                background: isToday ? "#FBF1DA" : "transparent",
                border: "none",
                cursor: "pointer",
                fontSize: 10,
                fontFamily: "var(--font-mono)",
                fontWeight: isToday ? 700 : 500,
                color: isToday ? "#A87616" : "var(--foreground)",
                lineHeight: 1,
              }}
              title={n > 0 ? `${n} event${n === 1 ? "" : "s"}` : undefined}
            >
              {c.day}
              <span className="rounded-full" style={{ width: 4, height: 4, marginTop: 1, background: n > 0 ? "var(--nuru-gold)" : "transparent" }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
