// Approximate-location sharing helpers (opt-in, privacy-first; parity gap #4
// Phase 2). The toggle preference is persisted in AsyncStorage under a `prefs:`
// key (same pattern as fontScale / remember-me). When ON we acquire a COARSE,
// foreground-only position and POST it to /me/location, which stores a coarse
// geohash and discards the raw coordinates; when OFF we call DELETE /me/location.
//
// NOTE on the location source: no geolocation native module is bundled in this
// app today (no expo-location / @react-native-community/geolocation /
// react-native-geolocation-service in package.json or src). Adding one needs a
// `pod install` + native rebuild, which is out of scope for this release-ready
// JS-only change. So `acquireCoarseLocation()` is a clearly-marked stub that
// returns null. Everything else — the toggle, persistence, API calls, the
// permission-rationale copy, minor-consent handling and error handling — is fully
// wired and will start capturing real coordinates the moment a coarse geolocation
// dependency is added and this one function is implemented.
import AsyncStorage from "@react-native-async-storage/async-storage";

const PREF_KEY = "prefs:shareLocation";

/** Read the persisted opt-in choice (defaults OFF). */
export async function getShareLocationPref(): Promise<boolean> {
  const v = await AsyncStorage.getItem(PREF_KEY).catch(() => null);
  return v === "1";
}

/** Persist the opt-in choice. */
export async function setShareLocationPref(on: boolean): Promise<void> {
  await AsyncStorage.setItem(PREF_KEY, on ? "1" : "0").catch(() => undefined);
}

export interface CoarseCoords {
  lat: number;
  lng: number;
}

/**
 * Acquire a COARSE, foreground-only position.
 *
 * TODO(location): wire a coarse geolocation source once a native dep is added.
 * Implementation contract when a lib is available:
 *   • request WHEN-IN-USE / "while using the app" authorization only — NEVER
 *     background/always;
 *   • request reduced/coarse accuracy (e.g. iOS `accuracy: "reduced"`,
 *     Android coarse) — we only need a geohash-6 (~1.2 km) bucket;
 *   • resolve to null (don't throw) if permission is denied or a fix times out,
 *     so the caller can leave the toggle pending without crashing.
 *
 * Until then this returns null: the toggle, persistence and API plumbing all
 * work, but no coordinates are captured.
 */
export async function acquireCoarseLocation(): Promise<CoarseCoords | null> {
  return null;
}
