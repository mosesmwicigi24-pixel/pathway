// Nuru Live — recording-file matching (docs/LIVE_STREAMING.md "Recording").
// MediaMTX writes fMP4 SEGMENTS per path (its default record path template is
// `%path/%Y-%m-%d_%H-%M-%S-%f`), not one file per stream — there is no
// server-side "this segment belongs to that stream" link. The registrar
// (service.ts tryRegisterRecording) lists a stream's path directory and hands
// the filenames here to pick the segment that best covers the stream's
// [started_at, ended_at] window.
//
// Ground truth from prod (2026-07-31 incident): 10 ended streams, only 1 had
// recording_url, while the recordings dir held many .mp4 files — the OLD
// matcher (candidates.length === 1 required a SINGLE file in a [started_at -
// 24h, ended_at] window) failed almost every time, for two compounding
// reasons:
//   1. The 24h look-back window was far too generous — on a VPS running rapid
//      consecutive test streams, files from an entirely unrelated NEIGHBOURING
//      stream (minutes apart) routinely fell inside that window too, so >1
//      "candidate" existed even when only one file actually belonged to the
//      stream.
//   2. Any time a stream legitimately produced >1 file of its own (MediaMTX
//      segment rollover, or the mobile app auto-reconnecting mid-stream after
//      a network hiccup — both routine, not edge cases) the matcher gave up
//      entirely instead of picking the primary segment.
// The fix: a TIGHT window (the stream's own [started_at, ended_at] plus a
// small grace for clock skew) to keep neighbouring streams' files out, plus
// "pick the best of several" instead of "refuse if more than one" for the
// genuinely-this-stream multi-file case. Concatenating multiple segments into
// one VOD is still out of scope for L1 (real video-editing work) — when a
// stream produced several files we register just the primary (best) one and
// accept the limitation.
//
// Filename timestamps are parsed as UTC (the VPS runs UTC; MediaMTX's %Y-%m-%d
// etc. placeholders render in the container's local time, so this assumes
// they agree — true today, and cheap to revisit if that ever changes). A
// file's mtime is deliberately NOT used for matching — mtime lands near when
// the segment FINISHED (close to the stream's ended_at, not started_at), so
// it would be actively misleading as a proxy for "when did this file start".

const SEGMENT_START_RE = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/;

/** A couple of minutes either side — enough to absorb VPS/container clock
 *  skew and MediaMTX's own segment-rotation jitter, tight enough to still
 *  exclude a neighbouring stream's files during rapid consecutive testing. */
export const DEFAULT_MATCH_GRACE_MS = 2 * 60 * 1000;

/** Parse a MediaMTX segment filename's leading timestamp, or null if it doesn't match. */
export function parseSegmentStart(filename: string): Date | null {
  const m = SEGMENT_START_RE.exec(filename);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)));
}

/** A candidate recording file. `sizeBytes`, when known, is used to prefer the
 *  larger (longer) segment when a stream legitimately produced several — the
 *  registrar has no duration anywhere in this schema, so file size is the
 *  best available proxy. A bare filename string is also accepted (sizeBytes
 *  omitted) so tests can stay terse when size doesn't matter to the case. */
export interface CandidateFile {
  name: string;
  sizeBytes?: number;
}

export interface MatchOptions {
  /** Filenames already claimed by some OTHER stream's recording_url in this
   *  same directory — never steal a file another stream already owns, even
   *  if it also falls inside this stream's window (can happen with two very
   *  close-together streams on the same path). */
  claimed?: ReadonlySet<string>;
  /** Override DEFAULT_MATCH_GRACE_MS — exposed for tests. */
  graceMs?: number;
}

/**
 * Pick the best recording segment covering a stream's window, or null if
 * none plausibly belongs to it. A candidate's parsed start timestamp must
 * fall within [started_at - grace, ended_at + grace]. When several
 * candidates qualify (segment rollover, a reconnect mid-stream, or two
 * streams close enough together that both windows catch a file), prefer the
 * largest (longest) file when sizes are known, else the earliest-starting —
 * i.e. always the stream's PRIMARY segment. This never returns more than one
 * filename; concatenating multiple segments into one VOD is out of scope
 * (see module doc).
 */
/**
 * Poster-frame generation for the public share page (docs/LIVE_SHARE.md).
 * NOT IMPLEMENTED: the backend runtime image (packages/backend/Dockerfile,
 * node:20-bookworm-slim) does not install ffmpeg, and this feature
 * deliberately does NOT add it silently — bundling a native binary into the
 * production image (size, CVE surface) is an infra decision for the operator
 * to make on purpose, not something to sneak into a feature PR. Until ffmpeg
 * (or an image-processing dependency) is added, this always returns null and
 * every share page falls back to the static branded poster
 * (sharePage.ts DEFAULT_POSTER_SVG) — see the doc's "Poster thumbnail"
 * follow-up. The call site (service.ts tryRegisterRecording) already treats
 * this as best-effort or catches synchronously-thrown errors: a failure here
 * must never break recording registration, so swapping this one function for
 * a real ffmpeg thumbnail extraction is the entire follow-up.
 */
export async function generatePosterUrl(_recordingUrl: string): Promise<string | null> {
  return null;
}

export function matchRecordingFile(
  files: readonly (string | CandidateFile)[],
  startedAt: Date,
  endedAt: Date,
  options: MatchOptions = {},
): string | null {
  const graceMs = options.graceMs ?? DEFAULT_MATCH_GRACE_MS;
  const claimed = options.claimed ?? new Set<string>();
  const windowStart = startedAt.getTime() - graceMs;
  const windowEnd = endedAt.getTime() + graceMs;

  const candidates = files
    .map((f): CandidateFile => (typeof f === "string" ? { name: f } : f))
    .filter((f) => !claimed.has(f.name))
    .map((f) => ({ ...f, t: parseSegmentStart(f.name) }))
    .filter((x): x is CandidateFile & { t: Date } => x.t !== null)
    .filter((x) => x.t.getTime() >= windowStart && x.t.getTime() <= windowEnd);

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!.name;

  const withKnownSize = candidates.filter((c) => typeof c.sizeBytes === "number");
  if (withKnownSize.length > 0) {
    withKnownSize.sort((a, b) => b.sizeBytes! - a.sizeBytes! || a.t.getTime() - b.t.getTime());
    return withKnownSize[0]!.name;
  }

  candidates.sort((a, b) => a.t.getTime() - b.t.getTime());
  return candidates[0]!.name;
}
