// Event detail (Figma "EventDetail"). The full view for a calendar event — navy
// header with date/time chips, a description card, then photo and video galleries.
// Pushed from the Calendar screen with the event id.
import { type ReactElement } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Clock, Image as ImageIcon, MapPin, Play, X } from "lucide-react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { GradientBg, Glow, T } from "../theme/components";
import { findEvent } from "../data/calendar";

export function EventDetailScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { eventId } = useRoute<RouteProp<RootStackParamList, "EventDetail">>().params;
  const event = findEvent(eventId);

  if (!event) {
    return (
      <View style={[st.screen, { alignItems: "center", justifyContent: "center" }]}>
        <T tone="secondary">Event not found.</T>
      </View>
    );
  }

  return (
    <View style={st.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xxl }}>
        <View style={st.header}>
          <Glow size={220} color="rgba(201,162,39,0.10)" style={{ right: -48, top: -48 }} />
          <Pressable onPress={() => nav.goBack()} style={({ pressed }) => [st.closeBtn, pressed && { transform: [{ scale: 0.95 }] }]} accessibilityRole="button" accessibilityLabel="Close">
            <X size={19} color="rgba(255,255,255,0.75)" />
          </Pressable>
          <T variant="micro" tone="gold" style={st.kicker}>EVENT DETAILS</T>
          <T tone="onNavy" style={st.title}>{event.title}</T>
          <View style={st.chips}>
            <Chip>{`June ${event.day}`}</Chip>
            <Chip>{event.time}</Chip>
            {event.urgent ? <Chip danger>Urgent</Chip> : null}
          </View>
        </View>

        <View style={{ paddingHorizontal: spacing.screen, paddingTop: spacing.lg }}>
          {/* Description */}
          <View style={st.card}>
            <T variant="overline" tone="secondary">DESCRIPTION</T>
            <T variant="bodyLg" style={{ marginTop: spacing.sm, color: palette.ink }}>{event.description}</T>
            <View style={{ marginTop: spacing.base, gap: spacing.sm }}>
              <View style={st.metaRow}><Clock size={15} color={palette.ink600} /><T variant="caption" tone="secondary">{event.time}</T></View>
              <View style={st.metaRow}><MapPin size={15} color={palette.ink600} /><T variant="caption" tone="secondary">{event.location}</T></View>
            </View>
          </View>

          {/* Photos */}
          <T variant="overline" tone="secondary" style={{ marginTop: spacing.lg, marginBottom: spacing.md }}>PHOTOS</T>
          <View style={st.photoGrid}>
            {event.photos.map((p) => (
              <View key={p} style={st.photo}>
                <GradientBg colors={["#E8EEF7", "rgba(216,184,77,0.30)"]} radius={24} />
                <ImageIcon size={18} color="rgba(10,37,64,0.55)" />
                <T variant="caption" style={{ marginTop: 40, color: palette.navy, fontWeight: "600" }}>{p}</T>
              </View>
            ))}
          </View>

          {/* Videos */}
          <T variant="overline" tone="secondary" style={{ marginTop: spacing.lg, marginBottom: spacing.md }}>VIDEOS</T>
          <View style={{ gap: spacing.md }}>
            {event.videos.map((v) => (
              <Pressable key={v} style={({ pressed }) => [st.videoRow, pressed && { transform: [{ scale: 0.99 }] }]}>
                <View style={st.videoIcon}>
                  <Play size={18} color={palette.gold} fill={palette.gold} />
                </View>
                <T variant="heading" style={{ flex: 1, fontSize: 15 }}>{v}</T>
                <T variant="caption" tone="secondary">2:14</T>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function Chip({ children, danger }: { children: string; danger?: boolean }): ReactElement {
  return (
    <View style={[st.chip, danger && { backgroundColor: "rgba(212,24,61,0.20)" }]}>
      <T variant="caption" style={{ color: danger ? "#FEC5CF" : "rgba(255,255,255,0.70)" }}>{children}</T>
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.coolPaper },
  header: { backgroundColor: palette.navy, paddingHorizontal: spacing.screen, paddingTop: 52, paddingBottom: spacing.lg, overflow: "hidden" },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center", marginBottom: spacing.base },
  kicker: { letterSpacing: 1.8, textTransform: "uppercase" },
  title: { fontSize: 30, fontWeight: "700", letterSpacing: -1.2, lineHeight: 34, color: palette.onNavy, marginTop: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.base },
  chip: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 6 },
  card: { backgroundColor: palette.white, borderRadius: 24, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  photo: { width: "47%", flexGrow: 1, height: 112, borderRadius: 24, padding: spacing.md, overflow: "hidden", justifyContent: "flex-start" },
  videoRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: palette.white, borderRadius: 24, borderWidth: 1, borderColor: palette.border, padding: spacing.md, ...shadow.card },
  videoIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: palette.navy, alignItems: "center", justifyContent: "center" },
} as const;
