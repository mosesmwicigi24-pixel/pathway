// Approximate-location sharing helpers (opt-in, privacy-first; parity gap #4
// Phase 2). The toggle preference is persisted in AsyncStorage under a `prefs:`
// key (same pattern as fontScale / remember-me). When ON we acquire a COARSE,
// foreground-only position and POST it to /me/location, which stores a coarse
// geohash and discards the raw coordinates; when OFF we call DELETE /me/location.
//
// The location source is @react-native-community/geolocation, configured for
// WHEN-IN-USE authorization and COARSE (low) accuracy, foreground-only — we only
// ever need a geohash-6 (~1.2 km) bucket, never a precise or background fix.
import AsyncStorage from "@react-native-async-storage/async-storage";
import Geolocation from "@react-native-community/geolocation";

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

// Coarse fix tuning. We don't need precision or speed: a low-accuracy, slightly
// stale (cached) fix is plenty for a geohash-6 bucket and is the gentlest on the
// user's battery and privacy.
const FIX_TIMEOUT_MS = 15_000;
const FIX_MAX_AGE_MS = 5 * 60_000; // accept a cached fix up to 5 min old

let configured = false;

/**
 * Configure the geolocation module once: WHEN-IN-USE authorization only (never
 * "always"/background) and the platform's coarse/low-accuracy provider.
 */
function ensureConfigured(): void {
  if (configured) return;
  try {
    Geolocation.setRNConfiguration({
      skipPermissionRequests: false,
      authorizationLevel: "whenInUse", // NEVER "always" — foreground only
      // Android: use the network/coarse provider rather than precise GPS.
      enableBackgroundLocationUpdates: false,
      locationProvider: "android",
    });
  } catch {
    // setRNConfiguration is unavailable on some platforms/builds — ignore and
    // fall back to defaults (still coarse via getCurrentPosition options below).
  }
  configured = true;
}

/**
 * Acquire a COARSE, foreground-only position.
 *
 *   • requests WHEN-IN-USE authorization only — NEVER background/always;
 *   • low/coarse accuracy (enableHighAccuracy:false) — we only need a geohash-6
 *     (~1.2 km) bucket;
 *   • foreground one-shot getCurrentPosition (no watch / no background updates);
 *   • resolves to null (never throws) on denial, timeout or any failure, so the
 *     caller can leave the toggle pending without crashing.
 */
export async function acquireCoarseLocation(): Promise<CoarseCoords | null> {
  ensureConfigured();

  // requestAuthorization is needed on iOS to surface the WHEN-IN-USE prompt; it's
  // a no-op (or resolves immediately) elsewhere. Wrapped so a missing/rejected
  // permission never throws out of here.
  try {
    await new Promise<void>((resolve) => {
      try {
        Geolocation.requestAuthorization(
          () => resolve(),
          () => resolve(),
        );
      } catch {
        resolve();
      }
    });
  } catch {
    // ignore — getCurrentPosition below will simply fail → null
  }

  return new Promise<CoarseCoords | null>((resolve) => {
    try {
      Geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos?.coords?.latitude;
          const lng = pos?.coords?.longitude;
          if (typeof lat === "number" && typeof lng === "number") {
            resolve({ lat, lng });
          } else {
            resolve(null);
          }
        },
        () => resolve(null), // denial / timeout / unavailable → null, never throw
        {
          enableHighAccuracy: false, // COARSE only
          timeout: FIX_TIMEOUT_MS,
          maximumAge: FIX_MAX_AGE_MS,
        },
      );
    } catch {
      resolve(null);
    }
  });
}
