// Device identity for registration (POST /me/devices). Sourced from what core
// React Native exposes cross-platform — NO new native module, so this needs no
// pod install / native rebuild.
//
//   • platform — Platform.OS, narrowed to the backend's enum ("ios" | "android").
//   • model    — Android: Platform.constants.Model (e.g. "Pixel 8"). iOS: core RN
//                does NOT expose the marketing/model string, so it's omitted. A
//                full iOS model string (e.g. "iPhone17,2") requires adding
//                react-native-device-info (native dep) — see NEEDS in the PR.
//   • app_version — the JS bundle's app version (kept in sync with package.json /
//                native build). Optional on the wire; omitted if unknown.
import { Platform } from "react-native";

// App version, kept here as the single JS-side source of truth. Bump alongside
// the native build numbers. (No runtime accessor without a native module.)
export const APP_VERSION = "1.0.0";

/** Backend device platform enum; null when neither ios nor android (e.g. web/test). */
export function devicePlatform(): "ios" | "android" | null {
  return Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : null;
}

/**
 * Best-effort device model from core RN. Android exposes it via
 * Platform.constants.Model; iOS does not (returns undefined). Trimmed and capped
 * at 80 chars to match the server contract; empty/unknown → undefined (omit).
 */
export function deviceModel(): string | undefined {
  if (Platform.OS !== "android") return undefined; // iOS: no core-RN model string
  const constants = Platform.constants as { Model?: string } | undefined;
  const model = constants?.Model?.trim();
  return model ? model.slice(0, 80) : undefined;
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
