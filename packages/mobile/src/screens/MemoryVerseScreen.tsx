// Memory verses (new design, spec §4b). The verse library from the DB
// (useMemoryVerses) with per-member mastery; a type-from-memory practice scores
// the attempt locally (word overlap) and posts it — the SERVER decides mastery
// (≥90% match) and keeps the best score. Real data throughout.
import { useEffect, useState, type ReactElement } from "react";
import { FlatList, Pressable, TextInput, View } from "react-native";
import { ArrowLeft, Check, Sparkles, Trophy } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import { NuruApi } from "../api/client";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { PButton, T } from "../theme/components";
import { useKeyboardInset } from "../components/useKeyboardInset";
import { useMemoryVerses, useWordScore } from "../api/hooks";
import { errorMessage, invalidateQueries, refreshQueries } from "../api/query";
import { ErrorState } from "../components/states";
import { SkeletonList } from "../components/Skeleton";
import { Confetti } from "../components/Confetti";
import { milestoneToCelebrate, nextMilestone } from "./verseMilestones";
import type { MemoryVerseRow } from "../api/types";

/** Rows fed to the list: real verses interleaved with encouragement banners
 *  (one after every 4 cards) so the member keeps an eye on the next milestone. */
type VerseListItem = { kind: "verse"; verse: MemoryVerseRow } | { kind: "banner"; seed: number };

/** Word-overlap match the member sees while practicing; the server re-derives
 *  mastery from the posted pct, so this is presentation only. */
function matchPct(target: string, attempt: string): number {
  const norm = (x: string): string[] => x.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
  const want = norm(target);
  const got = new Set(norm(attempt));
  if (want.length === 0) return 0;
  const hit = want.filter((w) => got.has(w)).length;
  return Math.round((hit / want.length) * 100);
}

export function MemoryVerseScreen(): ReactElement {
  const nav = useNavigation();
  const { data: verses, isLoading, error, refetch } = useMemoryVerses();
  const { data: word } = useWordScore();
  const [practice, setPractice] = useState<MemoryVerseRow | null>(null);
  const [celebrate, setCelebrate] = useState(0); // milestone currently being celebrated (0 = none)

  const mastered = (verses ?? []).filter((v) => v.status === "mastered").length;

  // Fire confetti once whenever the mastered count crosses a new milestone
  // (1 / 10 / 25 / 50 / 75 / 100). The crossing is decided + persisted in
  // verseMilestones so it doesn't re-fire on every render or relaunch.
  useEffect(() => {
    if (!verses) return;
    let alive = true;
    void milestoneToCelebrate(mastered).then((m) => {
      if (alive && m) setCelebrate(m);
    });
    return () => {
      alive = false;
    };
  }, [verses, mastered]);

  // Verses with an encouragement banner re-inserted after every 4 cards.
  const listData: VerseListItem[] = [];
  (verses ?? []).forEach((verse, i) => {
    listData.push({ kind: "verse", verse });
    if ((i + 1) % 4 === 0 && i + 1 < (verses?.length ?? 0)) {
      listData.push({ kind: "banner", seed: Math.floor((i + 1) / 4) });
    }
  });

  return (
    <View style={st.screen}>
      <View style={st.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => nav.goBack()} style={({ pressed }) => [st.backBtn, pressed && { transform: [{ scale: 0.95 }] }]}>
          <ArrowLeft size={20} color={palette.onNavy} />
        </Pressable>
        <T variant="micro" tone="gold" style={st.kicker}>HIDE HIS WORD</T>
        <T serif tone="onNavy" style={{ fontSize: 24, marginTop: 4 }}>Memory verses</T>
      </View>

      <FlatList
        data={listData}
        keyExtractor={(it) => (it.kind === "verse" ? it.verse.memory_verse_id : `banner-${it.seed}`)}
        contentContainerStyle={{ padding: spacing.screen, paddingBottom: spacing.xxl }}
        showsVerticalScrollIndicator={false}
        initialNumToRender={8}
        windowSize={11}
        removeClippedSubviews
        ListHeaderComponent={
          <View>
            {word ? (
            <View style={[st.card, st.scoreCard]}>
              <View style={st.scoreRing}>
                <T serif style={{ fontSize: 26, color: palette.navyDeep }}>{word.score}</T>
                <T variant="micro" style={{ color: palette.ink600, marginTop: -2 }}>/100</T>
              </View>
              <View style={{ flex: 1 }}>
                <T variant="micro" tone="gold" style={{ fontWeight: "700", letterSpacing: 1.2 }}>WORD SCORE</T>
                <T variant="heading" style={{ color: palette.ink, marginTop: 1 }}>{word.band}</T>
                <View style={st.scoreBars}>
                  <ScoreBar label="Consistency" value={word.components.consistency ?? 0} />
                  <ScoreBar label="Memorization" value={word.components.memorization ?? 0} />
                  <ScoreBar label="Breadth" value={word.components.breadth ?? 0} />
                </View>
              </View>
            </View>
            ) : null}
            <EncouragementBanner mastered={mastered} seed={0} header />
          </View>
        }
        renderItem={({ item }) => {
          if (item.kind === "banner") return <EncouragementBanner mastered={mastered} seed={item.seed} />;
          const v = item.verse;
          return (
          <View style={[st.card, { marginBottom: spacing.sm }]}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <T variant="heading" style={{ flex: 1, fontSize: 15, color: palette.goldLo }}>{v.reference}</T>
              {v.status === "mastered" ? (
                <View style={st.masteredChip}>
                  <Check size={11} color={palette.successText} />
                  <T variant="micro" style={{ color: palette.successText, fontWeight: "700" }}>Mastered</T>
                </View>
              ) : v.week_number ? (
                <View style={st.weekChip}><T variant="micro" style={{ color: palette.ink600 }}>{`Week ${v.week_number}`}</T></View>
              ) : null}
            </View>
            <T serif style={{ fontSize: 16, lineHeight: 24, color: palette.ink, marginTop: spacing.sm }}>{v.verse_text}</T>
            <View style={{ marginTop: spacing.md }}>
              <PButton variant={v.status === "mastered" ? "ghost" : "gold"} onPress={() => setPractice(v)}>
                {v.status === "mastered" ? "Practice again" : "Practice"}
              </PButton>
            </View>
          </View>
          );
        }}
        ListEmptyComponent={
          isLoading ? (
            <SkeletonList count={5} />
          ) : error ? (
            <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
          ) : (
            <View style={st.card}>
              <T variant="heading">No verses yet</T>
              <T variant="caption" tone="secondary" style={{ marginTop: 4 }}>Your church will add memory verses here.</T>
            </View>
          )
        }
      />

      {practice ? (
        <PracticeSheet
          verse={practice}
          onClose={() => setPractice(null)}
          onSaved={() => {
            setPractice(null);
            invalidateQueries("memoryVerses");
            refreshQueries("wordScore"); // practice moves the Word score
            void refetch();
          }}
        />
      ) : null}

      <Confetti show={celebrate > 0} count={Math.min(140, 60 + celebrate)} onDone={() => setCelebrate(0)} />
    </View>
  );
}

/** A gentle "keep going" reminder shown above the list and after every 4 cards.
 *  The copy points at the member's next mastery milestone (or congratulates a full
 *  100) and rotates by `seed` so repeated banners don't read identically. */
function EncouragementBanner({ mastered, seed, header = false }: { mastered: number; seed: number; header?: boolean }): ReactElement {
  const next = nextMilestone(mastered);
  const remaining = next ? next - mastered : 0;
  const verseWord = remaining === 1 ? "verse" : "verses";
  const pool = next
    ? [
        { h: `${remaining} ${verseWord} to your next milestone`, s: `Master ${remaining} more to reach ${next}. Keep hiding His Word in your heart.` },
        { h: "Keep the momentum going", s: `You've mastered ${mastered} so far. The ${next}-verse milestone is within reach — practice one today.` },
        { h: "Every verse counts", s: `Just ${remaining} more ${verseWord} and you unlock the ${next} milestone. Small steps, eternal reward.` },
      ]
    : [{ h: "All 100 verses mastered 🎉", s: "You've hidden the full set in your heart. Revisit them to keep them sharp." }];
  const msg = pool[seed % pool.length] ?? pool[0]!;
  const Icon = next ? Sparkles : Trophy;
  return (
    <View style={[st.banner, header ? { marginBottom: spacing.base } : { marginVertical: spacing.sm }]}>
      <View style={st.bannerIcon}>
        <Icon size={18} color={palette.navyDeep} />
      </View>
      <View style={{ flex: 1 }}>
        <T variant="heading" style={{ fontSize: 14, color: palette.navyDeep }}>{msg.h}</T>
        <T variant="caption" style={{ color: palette.ink600, marginTop: 2, lineHeight: 18 }}>{msg.s}</T>
      </View>
    </View>
  );
}

/** One labelled progress bar inside the Word-score card. */
function ScoreBar({ label, value }: { label: string; value: number }): ReactElement {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
      <T variant="micro" style={{ color: palette.ink600, width: 84 }}>{label}</T>
      <View style={st.barTrack}>
        <View style={[st.barFill, { width: `${Math.max(0, Math.min(100, value))}%` }]} />
      </View>
    </View>
  );
}

function PracticeSheet({ verse, onClose, onSaved }: { verse: MemoryVerseRow; onClose: () => void; onSaved: () => void }): ReactElement {
  const [attempt, setAttempt] = useState("");
  const [busy, setBusy] = useState(false);
  const kbInset = useKeyboardInset();
  const pct = matchPct(verse.verse_text, attempt);

  async function save(): Promise<void> {
    setBusy(true);
    try {
      await NuruApi.practiceVerse(verse.memory_verse_id, pct);
      onSaved();
    } catch {
      setBusy(false);
    }
  }

  return (
    <View style={st.sheetWrap}>
      <Pressable style={st.sheetScrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={[st.sheet, { marginBottom: kbInset }]}>
        <View style={st.grab} />
        <T variant="micro" tone="secondary" style={{ letterSpacing: 1.2 }}>TYPE FROM MEMORY</T>
        <T variant="heading" style={{ color: palette.goldLo, marginTop: 4 }}>{verse.reference}</T>
        <TextInput
          value={attempt}
          onChangeText={setAttempt}
          placeholder="Begin typing the verse…"
          placeholderTextColor={palette.ink400}
          multiline
          autoFocus
          style={st.input}
          accessibilityLabel="Your attempt"
        />
        <View style={st.matchTrack}>
          <View style={{ width: `${pct}%`, height: "100%", borderRadius: 3, backgroundColor: pct >= 90 ? palette.success : palette.gold }} />
        </View>
        <T variant="micro" tone="tertiary" style={{ marginTop: 4 }}>{`${pct}% match${pct >= 90 ? " · mastered!" : ""}`}</T>
        <View style={{ marginTop: spacing.md }}>
          <PButton variant="gold" onPress={() => void save()} disabled={busy || attempt.trim().length === 0}>
            {busy ? "Saving…" : "Save practice"}
          </PButton>
        </View>
      </View>
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.coolPaper },
  header: { backgroundColor: palette.navy, paddingHorizontal: spacing.lg, paddingTop: 54, paddingBottom: spacing.lg },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  kicker: { letterSpacing: 1.8, textTransform: "uppercase" },
  card: { backgroundColor: palette.white, borderRadius: 16, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  masteredChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: palette.successBg, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4 },
  banner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: palette.verseBg, borderWidth: 1, borderColor: palette.gold, borderRadius: 14, padding: spacing.base },
  bannerIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: palette.white, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.gold },
  weekChip: { backgroundColor: palette.surface, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4 },
  sheetWrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "flex-end" },
  sheetScrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { backgroundColor: palette.white, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: spacing.lg, paddingBottom: spacing.xxl },
  grab: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "rgba(10,37,64,0.15)", marginBottom: spacing.base },
  input: { marginTop: spacing.md, minHeight: 90, borderRadius: radii.control, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.coolPaper, padding: spacing.base, fontSize: 16, lineHeight: 24, textAlignVertical: "top", color: palette.ink },
  matchTrack: { marginTop: spacing.md, height: 6, borderRadius: 3, backgroundColor: palette.track, overflow: "hidden" },
  scoreCard: { flexDirection: "row", alignItems: "center", gap: spacing.base, marginBottom: spacing.base },
  scoreRing: { width: 72, height: 72, borderRadius: 36, borderWidth: 3, borderColor: palette.gold, alignItems: "center", justifyContent: "center", backgroundColor: palette.verseBg },
  scoreBars: { marginTop: spacing.sm, gap: 6 },
  barTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: palette.track, overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3, backgroundColor: palette.gold },
} as const;
