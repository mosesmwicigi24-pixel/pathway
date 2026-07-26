// Nuru Live — recording-file matching (docs/LIVE_STREAMING.md "Recording").
// MediaMTX writes fMP4 SEGMENTS per path (its default record path template is
// `%path/%Y-%m-%d_%H-%M-%S-%f`), not one file per stream — there is no
// server-side "this segment belongs to that stream" link. The registrar
// (service.ts sweepRecordings) lists a stream's path directory and hands the
// filenames here to decide whether exactly ONE segment plausibly covers the
// stream's [started_at, ended_at] window.
//
// Deliberately conservative: concatenating/renaming multiple segments into one
// VOD is real video-editing work (spec: "pick/concat is overkill") — out of
// scope for L1. When more than one segment could plausibly belong to the
// stream (a broadcast spanning an MediaMTX segment boundary), we leave
// recording_url null rather than guess; a future phase can stitch them.
//
// Filename timestamps are parsed as UTC (the VPS runs UTC; MediaMTX's %Y-%m-%d
// etc. placeholders render in the container's local time, so this assumes
// they agree — true today, and cheap to revisit if that ever changes).

const SEGMENT_START_RE = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/;

/** Parse a MediaMTX segment filename's leading timestamp, or null if it doesn't match. */
export function parseSegmentStart(filename: string): Date | null {
  const m = SEGMENT_START_RE.exec(filename);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)));
}

/**
 * Pick the single recording segment covering a stream's window, or null if
 * zero or more-than-one candidate exists. A candidate is a segment that
 * started no later than the stream ended, and not implausibly (>24h) before
 * the stream started — generous bounds since MediaMTX's segment duration is
 * an ops-side config we don't control here.
 */
export function matchRecordingFile(filenames: string[], startedAt: Date, endedAt: Date): string | null {
  const dayMs = 24 * 60 * 60 * 1000;
  const candidates = filenames
    .map((f) => ({ f, t: parseSegmentStart(f) }))
    .filter((x): x is { f: string; t: Date } => x.t !== null)
    .filter((x) => x.t.getTime() <= endedAt.getTime() && x.t.getTime() >= startedAt.getTime() - dayMs)
    .sort((a, b) => a.t.getTime() - b.t.getTime());
  return candidates.length === 1 ? candidates[0]!.f : null;
}
