// Device identity for registration (POST /me/devices).
//
//   • platform — Platform.OS, narrowed to the backend's enum ("ios" | "android").
//   • model    — sourced from react-native-device-info's getModel() on BOTH
//                platforms (e.g. "iPhone 15 Pro", "Pixel 8"). Falls back to the
//                device id string (e.g. "iPhone17,2") when the marketing name is
//                unavailable, and to core RN's Platform.constants.Model as a last
//                resort. Trimmed + capped at 80 chars; unknown → undefined (omit).
//   • app_version — the JS bundle's app version (kept in sync with package.json /
//                native build). Optional on the wire; omitted if unknown.
import { Platform } from "react-native";
import DeviceInfo from "react-native-device-info";

// App version, kept here as the single JS-side source of truth. Bump alongside
// the native build numbers. (No runtime accessor without a native module.)
export const APP_VERSION = "1.0.0";

/** Backend device platform enum; null when neither ios nor android (e.g. web/test). */
export function devicePlatform(): "ios" | "android" | null {
  return Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : null;
}

/**
 * Best-effort device model string, cross-platform via react-native-device-info.
 * Prefers the human-readable marketing name (getModel, e.g. "iPhone 15 Pro"),
 * falling back to the hardware id (getDeviceId, e.g. "iPhone17,2") and finally to
 * core RN's Platform.constants.Model. Trimmed and capped at 80 chars to match the
 * server contract; empty/unknown → undefined (omit). Never throws.
 */
export function deviceModel(): string | undefined {
  const candidates: Array<string | undefined> = [];
  try {
    candidates.push(DeviceInfo.getModel());
  } catch {
    // device-info unavailable (e.g. test/web) — fall through to other sources
  }
  try {
    candidates.push(DeviceInfo.getDeviceId());
  } catch {
    // ignore
  }
  const constants = Platform.constants as { Model?: string } | undefined;
  candidates.push(constants?.Model);

  for (const candidate of candidates) {
    const model = candidate?.trim();
    // react-native-device-info returns "unknown" when it can't resolve a value.
    if (model && model.toLowerCase() !== "unknown") return model.slice(0, 80);
  }
  return undefined;
}

/** The body for POST /me/devices, with empty/unknown fields omitted (all optional bar platform). */
export function deviceRegistration(): {
  platform: "ios" | "android";
  app_version?: string;
  model?: string;
} | null {
  const platform = devicePlatform();
  if (!platform) return null; // not a real device target — skip registration
  const model = deviceModel();
  return {
    platform,
    ...(APP_VERSION ? { app_version: APP_VERSION } : {}),
    ...(model ? { model } : {}), // omit when unavailable (never send "")
  };
}
