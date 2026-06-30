// App-area dwell-time telemetry (parity gap #3, Phase 2). Lightweight, privacy-light
// usage signal: which app AREA the member is in and how long — no PII, no screen
// params, no content ids. We instrument React Navigation: when the active route
// changes, the PREVIOUS route's dwell is computed and an event is enqueued. The
// React Navigation route name is mapped to a small, stable set of coarse AREA
// labels (detail screens collapse into their parent area).
//
// The queue is AsyncStorage-backed so it survives backgrounding, each event carrying
// a uuid client_event_id (idempotency key) + occurred_at (when the dwell ended) +
// duration_ms. Flushed best-effort to POST /me/activity/screens on background and
// when the queue grows past a threshold; on success the flushed items are dropped,
// on failure they're kept (idempotency makes retries safe). The queue is capped so
// it can't grow unbounded.
//
// EVERYTHING here is best-effort and fully swallowed: telemetry must never block,
// crash, or otherwise affect the UX, and it only runs for an authenticated session.
import { AppState, type AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { NuruApi } from "../api/client";
import { getVault } from "../auth/vault";
import { uuidv4 } from "../util/uuid";

const QUEUE_KEY = "dwell:queue";
const MIN_DWELL_MS = 1_000; // ignore sub-second flicker between screens
const MAX_DWELL_MS = 60 * 60 * 1000; // cap a single dwell at 1h (e.g. left app open)
const FLUSH_AT = 25; // flush once this many events have accumulated
const MAX_QUEUE = 500; // hard cap — drop oldest beyond this
const BATCH = 200; // server accepts ≤200 per request

interface DwellEvent {
  screen: string; // the AREA label (≤40 chars)
  duration_ms: number;
  occurred_at: string; // ISO; when the dwell ended
  client_event_id: string; // uuid; idempotency key
}

// In-memory queue, mirrored to AsyncStorage so it survives backgrounding/relaunch.
let queue: DwellEvent[] = [];
let hydrated = false;
let flushing = false;

// The route the member is currently dwelling in, and when that dwell began.
let currentArea: string | null = null;
let enteredAt = 0;

let started = false;

/**
 * Map a React Navigation route name to a coarse, stable AREA label (≤40 chars).
 * Detail/flow screens collapse into their parent area so the set stays small —
 * the goal is "which part of the app", not which exact screen. Unknown routes
 * fall back to a lower-cased, truncated form of the route name.
 */
export function routeToArea(routeName: string | undefined): string {
  switch (routeName) {
    // Primary tabs
    case "Home":
      return "home";
    case "Pathway":
    case "Levels":
    case "Level":
    case "Module":
    case "Quiz":
    case "Reflection":
    case "LevelComplete":
      return "curriculum";
    case "Plans":
    case "ReadingPlans":
    case "PlanDetail":
    case "PlanDay":
    case "Watch":
    case "Devotional":
    case "MemoryVerses":
    case "VerseLibrary":
    case "Resources":
      return "growth";
    case "Events":
    case "Calendar":
    case "EventDetail":
      return "events";
    case "Chat":
    case "ChatThread":
    case "SpacePreview":
    case "NewMessage":
    case "Nuru":
    case "Thread":
    case "CohortDiscussions":
      return "chat";
    case "Give":
    case "GivingStatement":
    case "GivingReceipt":
      return "giving";
    case "Profile":
    case "Gifts":
      return "profile";
    case "PrayerJournal":
    case "PrayerWall":
    case "PrayerWallDetail":
      return "prayer";
    case "Mentor":
      return "mentor";
    case "Notifications":
      return "notifications";
    case "AnnouncementDetail":
      return "announcements";
    case "Login":
      return "auth";
    default:
      return (routeName ?? "unknown").toLowerCase().slice(0, 40);
  }
}

async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DwellEvent[];
      if (Array.isArray(parsed)) queue = parsed.slice(-MAX_QUEUE);
    }
  } catch {
    // ignore — start with an empty queue
  }
}

async function persist(): Promise<void> {
  try {
    if (queue.length === 0) await AsyncStorage.removeItem(QUEUE_KEY);
    else await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // ignore — at worst we lose the queue across a crash, which is acceptable
  }
}

async function enqueue(area: string, durationMs: number): Promise<void> {
  await hydrate();
  queue.push({
    screen: area.slice(0, 40),
    duration_ms: Math.min(Math.max(0, Math.round(durationMs)), MAX_DWELL_MS),
    occurred_at: new Date().toISOString(),
    client_event_id: uuidv4(),
  });
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE); // drop oldest
  await persist();
}

/** Only send for an authenticated session — never post for logged-out users. */
async function isAuthenticated(): Promise<boolean> {
  try {
    return (await getVault().getRefresh()) != null;
  } catch {
    return false;
  }
}

/** Best-effort flush of the queued dwell events. Safe to call often. */
export async function flushDwell(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    await hydrate();
    if (queue.length === 0) return;
    if (!(await isAuthenticated())) return;
    // Send oldest-first, in server-sized batches. Drop a batch from the queue only
    // after it lands; on any failure we keep everything for the next attempt
    // (idempotency on client_event_id makes a later replay a no-op).
    while (queue.length > 0) {
      const batch = queue.slice(0, BATCH);
      await NuruApi.submitActivityScreens(batch);
      queue = queue.slice(batch.length);
      await persist();
    }
  } catch {
    // keep the queue for next time
  } finally {
    flushing = false;
  }
}

/**
 * Record that the active area changed. Computes the dwell of the area we're
 * leaving, enqueues it (when it clears the noise floor), and starts the clock on
 * the new area. Fully swallowed — telemetry never affects the UI.
 */
export function onAreaChange(routeName: string | undefined): void {
  void (async () => {
    try {
      const area = routeToArea(routeName);
      const now = Date.now();
      if (currentArea !== null && enteredAt > 0) {
        const dwell = now - enteredAt;
        if (dwell >= MIN_DWELL_MS) {
          await enqueue(currentArea, dwell);
          if (queue.length >= FLUSH_AT) void flushDwell();
        }
      }
      currentArea = area;
      enteredAt = now;
    } catch {
      // ignore
    }
  })();
}

/**
 * Start dwell tracking. Flushes the queue when the app goes to the background
 * (capturing the in-progress dwell first), and on resume restarts the clock so a
 * long backgrounded stretch isn't counted as in-app time. Returns a stop fn.
 */
export function startDwellTracking(): () => void {
  if (started) return () => {};
  started = true;
  void hydrate();

  const onState = (s: AppStateStatus): void => {
    try {
      if (s === "active") {
        // Resuming: restart the clock on the current area so backgrounded time
        // (which could be hours) isn't attributed as dwell.
        if (currentArea !== null) enteredAt = Date.now();
      } else {
        // Backgrounding: bank the in-progress dwell, then flush best-effort.
        if (currentArea !== null && enteredAt > 0) {
          const dwell = Date.now() - enteredAt;
          if (dwell >= MIN_DWELL_MS) void enqueue(currentArea, dwell);
          enteredAt = 0; // paused while backgrounded
        }
        void flushDwell();
      }
    } catch {
      // ignore
    }
  };

  const sub = AppState.addEventListener("change", onState);
  return () => {
    sub.remove();
    started = false;
    currentArea = null;
    enteredAt = 0;
  };
}
