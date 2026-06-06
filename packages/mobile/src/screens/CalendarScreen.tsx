// Calendar (Figma "CalendarTab"). A month/week grid over the church + pathway
// schedule, with an "urgent events" rail at the top and the selected day's events
// below. Tapping an event opens its detail. Data is presentational today; the
// calendar module owns events server-side once wired (§3).
import { useState, type ReactElement } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { AlertCircle, Bell, CalendarDays, ChevronLeft, ChevronRight, Clock, MapPin } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { Glow, T } from "../theme/components";
import { CALENDAR_EVENTS, type CalendarEvent } from "../data/calendar";

const WEEK_DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const DAYS = Array.from({ length: 30 }, (_, i) => i + 1);

export function CalendarScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [view, setView] = useState<"month" | "week">("month");
  const [selectedDay, setSelectedDay] = useState(8);
  const [monthOffset, setMonthOffset] = useState(0);

  const weekStart = Math.max(1, selectedDay - 3);
  const visibleDays = view === "week" ? DAYS.slice(weekStart - 1, weekStart + 6) : DAYS;
  const selectedEvents = CALENDAR_EVENTS.filter((e) => e.day === selectedDay);
  const urgentEvents = CALENDAR_EVENTS.filter((e) => e.urgent);
  const monthLabel = monthOffset === 0 ? "June 2026" : monthOffset > 0 ? "July 2026" : "May 2026";

  const openEvent = (e: CalendarEvent): void => nav.navigate("EventDetail", { eventId: e.id });

  return (
    <View style={st.screen}>
      {/* Navy header */}
      <View style={st.header}>
        <Glow size={240} color="rgba(201,162,39,0.10)" style={{ right: -64, top: -64 }} />
        <View style={st.headRow}>
          <View>
            <T variant="micro" tone="gold" style={st.kicker}>CALENDAR</T>
            <T tone="onNavy" style={st.monthTitle}>{monthLabel}</T>
          </View>
          <View style={st.navBtns}>
            <Pressable onPress={() => setMonthOffset((m) => m - 1)} style={st.navBtn}>
              <ChevronLeft size={19} color="rgba(255,255,255,0.70)" />
            </Pressable>
            <Pressable onPress={() => setMonthOffset((m) => m + 1)} style={st.navBtn}>
              <ChevronRight size={19} color="rgba(255,255,255,0.70)" />
            </Pressable>
          </View>
        </View>
        <View style={st.toggle}>
          {(["month", "week"] as const).map((opt) => {
            const on = view === opt;
            return (
              <Pressable key={opt} onPress={() => setView(opt)} style={[st.toggleBtn, on && st.toggleOn]}>
                <T variant="label" style={{ color: on ? palette.navy : "rgba(255,255,255,0.55)", textTransform: "capitalize" }}>{opt}</T>
              </Pressable>
            );
          })}
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.screen, paddingBottom: spacing.xxl }}>
        {/* Urgent rail */}
        <View style={st.urgentCard}>
          <View style={st.urgentHead}>
            <Bell size={17} color={palette.urgentText} />
            <T variant="label" style={{ color: palette.urgentText, textTransform: "uppercase", letterSpacing: 1 }}>Urgent events</T>
          </View>
          <View style={{ gap: spacing.sm }}>
            {urgentEvents.map((e) => (
              <Pressable key={e.id} onPress={() => { setSelectedDay(e.day); openEvent(e); }} style={({ pressed }) => [st.urgentRow, pressed && st.press]}>
                <AlertCircle size={18} color={palette.gold} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T variant="heading" style={{ fontSize: 14 }}>{e.title}</T>
                  <T variant="caption" tone="secondary">{`Jun ${e.day} · ${e.time}`}</T>
                </View>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Grid */}
        <View style={st.grid}>
          <View style={st.weekRow}>
            {WEEK_DAYS.map((d, i) => (
              <T key={`${d}-${i}`} variant="micro" tone="tertiary" style={st.weekCell}>{d}</T>
            ))}
          </View>
          <View style={st.daysWrap}>
            {visibleDays.map((day) => {
              const has = CALENDAR_EVENTS.some((e) => e.day === day);
              const urgent = CALENDAR_EVENTS.some((e) => e.day === day && e.urgent);
              const selected = selectedDay === day;
              return (
                <Pressable
                  key={day}
                  onPress={() => { setSelectedDay(day); const first = CALENDAR_EVENTS.find((e) => e.day === day); if (first) openEvent(first); }}
                  style={st.dayCell}
                >
                  <View style={[st.dayInner, selected && { backgroundColor: palette.navy }]}>
                    <T variant="caption" style={{ color: selected ? palette.gold : palette.ink, fontWeight: "600" }}>{day}</T>
                  </View>
                  {has ? <View style={[st.dayDot, { backgroundColor: urgent ? palette.error : palette.gold }]} /> : <View style={st.dayDotSpace} />}
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Selected day events */}
        <View style={st.dayHead}>
          <T variant="title" style={{ fontSize: 18 }}>{`June ${selectedDay}`}</T>
          <T variant="caption" tone="secondary">{`${selectedEvents.length || "No"} events`}</T>
        </View>
        <View style={{ gap: spacing.md }}>
          {selectedEvents.length ? (
            selectedEvents.map((e) => (
              <Pressable key={e.id} onPress={() => openEvent(e)} style={({ pressed }) => [st.eventCard, pressed && st.press]}>
                <View style={st.eventIcon}>
                  <CalendarDays size={20} color={palette.navy} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={st.eventTitleRow}>
                    <T variant="heading" style={{ fontSize: 15, flexShrink: 1 }}>{e.title}</T>
                    {e.urgent ? (
                      <View style={st.urgentBadge}>
                        <T variant="micro" style={{ color: palette.error }}>Urgent</T>
                      </View>
                    ) : null}
                  </View>
                  <View style={st.eventMeta}><Clock size={14} color={palette.ink600} /><T variant="caption" tone="secondary">{e.time}</T></View>
                  <View style={st.eventMeta}><MapPin size={14} color={palette.ink600} /><T variant="caption" tone="secondary">{e.location}</T></View>
                </View>
              </Pressable>
            ))
          ) : (
            <View style={st.empty}>
              <T variant="heading" style={{ fontSize: 15 }}>No events scheduled</T>
              <T variant="caption" tone="secondary" style={{ marginTop: 2, textAlign: "center" }}>Select another day to view services, classes, and reminders.</T>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.coolPaper },
  header: { backgroundColor: palette.navy, paddingHorizontal: spacing.screen, paddingTop: 54, paddingBottom: spacing.lg, overflow: "hidden" },
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  kicker: { letterSpacing: 1.8, textTransform: "uppercase" },
  monthTitle: { fontSize: 32, lineHeight: 36, fontWeight: "700", letterSpacing: -1.3, color: palette.onNavy, marginTop: 4 },
  navBtns: { flexDirection: "row", backgroundColor: "rgba(255,255,255,0.08)", borderRadius: radii.pill, padding: 4 },
  navBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  toggle: { flexDirection: "row", backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 16, padding: 4, marginTop: spacing.lg },
  toggleBtn: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 12 },
  toggleOn: { backgroundColor: palette.white },
  urgentCard: { backgroundColor: palette.urgentBg, borderRadius: 24, borderWidth: 1, borderColor: palette.urgentBorder, padding: spacing.base, marginBottom: spacing.base, ...shadow.card },
  urgentHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: spacing.md },
  urgentRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: "rgba(255,255,255,0.75)", borderRadius: 16, padding: spacing.md },
  grid: { backgroundColor: palette.white, borderRadius: 28, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  weekRow: { flexDirection: "row", marginBottom: spacing.md },
  weekCell: { flex: 1, textAlign: "center", fontWeight: "700" },
  daysWrap: { flexDirection: "row", flexWrap: "wrap" },
  dayCell: { width: `${100 / 7}%`, height: 44, alignItems: "center", justifyContent: "center" },
  dayInner: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  dayDot: { width: 6, height: 6, borderRadius: 3, marginTop: 2 },
  dayDotSpace: { height: 8 },
  dayHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.lg, marginBottom: spacing.md, paddingHorizontal: 4 },
  eventCard: { flexDirection: "row", gap: spacing.md, backgroundColor: palette.white, borderRadius: 24, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  eventIcon: { width: 44, height: 44, borderRadius: 16, backgroundColor: "rgba(10,37,64,0.06)", alignItems: "center", justifyContent: "center" },
  eventTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  urgentBadge: { backgroundColor: "rgba(212,24,61,0.08)", borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 2 },
  eventMeta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: spacing.sm },
  empty: { backgroundColor: "rgba(255,255,255,0.70)", borderRadius: 24, borderWidth: 1, borderStyle: "dashed", borderColor: "rgba(10,37,64,0.15)", padding: spacing.lg, alignItems: "center" },
  press: { transform: [{ scale: 0.99 }] },
} as const;
