// Reusable voice-note recorder + player (Prayer Wall compose/comment). Records
// with the native recorder, uploads the bytes via the member-accessible chat
// attachment sign → Cloudinary flow (no new backend), and returns the URL. The
// player taps to play/stop. Voice notes need connectivity (bytes upload direct).
import { useRef, useState, type ReactElement } from "react";
import { PermissionsAndroid, Platform, Pressable, View } from "react-native";
import { Mic, Play, Square, X } from "lucide-react-native";
import AudioRecorderPlayer from "react-native-audio-recorder-player";
import { NuruApi } from "../api/client";
import { getConnectivity } from "../net/connectivity";
import { voiceFileName } from "../screens/chatMediaHelpers";
import { palette, radii, spacing } from "../theme/tokens";
import { T } from "../theme/components";

const recorder = AudioRecorderPlayer;

async function micPermission(): Promise<boolean> {
  if (Platform.OS !== "android") return true; // iOS prompts on first record
  const perm = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO ?? "android.permission.RECORD_AUDIO";
  const g = await PermissionsAndroid.request(perm, { title: "Microphone access", message: "Record a voice note for your prayer.", buttonPositive: "Allow" });
  return g === PermissionsAndroid.RESULTS.GRANTED;
}

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export interface VoiceNote {
  recording: boolean;
  recordMs: number;
  uploading: boolean;
  audioUrl: string | null;
  start: () => Promise<string | null>; // returns an error message or null
  cancel: () => Promise<void>;
  stopAndUpload: () => Promise<string | null>; // returns the uploaded url or null
  reset: () => void;
}

export function useVoiceNote(): VoiceNote {
  const [recording, setRecording] = useState(false);
  const [recordMs, setRecordMs] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const pathRef = useRef<string | null>(null);

  async function start(): Promise<string | null> {
    if (!(await getConnectivity().isOnline())) return "You're offline — voice notes need a connection.";
    if (!(await micPermission())) return "Microphone permission is needed to record.";
    setRecordMs(0);
    try {
      const path = await recorder.startRecorder();
      pathRef.current = path;
      recorder.addRecordBackListener((e) => setRecordMs(e.currentPosition));
      setRecording(true);
      return null;
    } catch {
      return "Couldn't start recording.";
    }
  }

  async function cancel(): Promise<void> {
    recorder.removeRecordBackListener();
    setRecording(false);
    setRecordMs(0);
    try { await recorder.stopRecorder(); } catch { /* ignore */ }
    pathRef.current = null;
  }

  async function stopAndUpload(): Promise<string | null> {
    recorder.removeRecordBackListener();
    let uri: string | undefined;
    try { uri = await recorder.stopRecorder(); } catch { /* ignore */ }
    setRecording(false);
    const path = pathRef.current ?? uri;
    pathRef.current = null;
    setRecordMs(0);
    if (!path) return null;
    setUploading(true);
    try {
      const contentType = "audio/m4a";
      const sign = await NuruApi.signChatAttachment({ content_type: contentType, kind: "voice" });
      const up = await NuruApi.uploadChatAttachment(sign, { uri: path, name: voiceFileName(), type: contentType });
      setAudioUrl(up.secure_url);
      return up.secure_url;
    } catch {
      return null;
    } finally {
      setUploading(false);
    }
  }

  function reset(): void {
    setAudioUrl(null);
    setRecordMs(0);
  }

  return { recording, recordMs, uploading, audioUrl, start, cancel, stopAndUpload, reset };
}

/** Compact recorder control for a composer row: mic → recording (timer + stop/✕)
 *  → attached chip. Drives a useVoiceNote() instance passed in. */
export function VoiceRecorderButton({ v, onError }: { v: VoiceNote; onError?: (m: string) => void }): ReactElement {
  if (v.audioUrl) {
    return (
      <View style={chip.attached}>
        <Mic size={14} color={palette.success} />
        <T variant="caption" style={{ color: palette.ink, fontWeight: "600" }}>Voice attached</T>
        <Pressable accessibilityRole="button" accessibilityLabel="Remove voice note" onPress={v.reset} hitSlop={8}>
          <X size={14} color={palette.ink400} />
        </Pressable>
      </View>
    );
  }
  if (v.recording) {
    return (
      <View style={chip.recording}>
        <View style={chip.dot} />
        <T variant="caption" style={{ color: palette.ink, fontWeight: "700" }}>{clock(v.recordMs)}</T>
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel recording" onPress={() => void v.cancel()} hitSlop={8}>
          <X size={16} color={palette.ink600} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Stop recording" onPress={() => void v.stopAndUpload()} style={chip.stop}>
          <Square size={13} color="#fff" fill="#fff" />
        </Pressable>
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Record a voice note"
      disabled={v.uploading}
      onPress={() => void v.start().then((err) => err && onError?.(err))}
      style={[chip.mic, v.uploading && { opacity: 0.5 }]}
    >
      <Mic size={18} color={palette.goldLo} />
    </Pressable>
  );
}

/** Tap-to-play voice-note pill, for rendering an attached audio_url. */
export function VoiceNotePlayer({ url }: { url: string }): ReactElement {
  const [playing, setPlaying] = useState(false);
  async function toggle(): Promise<void> {
    if (playing) {
      recorder.removePlaybackEndListener();
      await recorder.stopPlayer().catch(() => undefined);
      setPlaying(false);
      return;
    }
    try {
      recorder.addPlaybackEndListener(() => { recorder.removePlaybackEndListener(); setPlaying(false); });
      await recorder.startPlayer(url);
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={playing ? "Stop voice note" : "Play voice note"} onPress={() => void toggle()} style={chip.player}>
      {playing ? <Square size={14} color={palette.navyDeep} fill={palette.navyDeep} /> : <Play size={14} color={palette.navyDeep} />}
      <T variant="caption" style={{ color: palette.navyDeep, fontWeight: "700" }}>Voice note</T>
    </Pressable>
  );
}

const chip = {
  mic: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  recording: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.sm, height: 44, borderRadius: radii.control, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.error },
  stop: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: palette.navyDeep },
  attached: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: radii.pill, backgroundColor: palette.successBg },
  player: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 7, borderRadius: radii.pill, backgroundColor: palette.goldChipBg, borderWidth: 1, borderColor: palette.urgentBorder, marginTop: spacing.sm },
} as const;
