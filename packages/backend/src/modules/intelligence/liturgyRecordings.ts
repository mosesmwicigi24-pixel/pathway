// The pastor's own voice on the liturgy (owner request, 2026-08-12) — a small
// admin CRUD surface over `liturgy_recordings` (migration 189). Deliberately
// separate from LiturgyService: that class composes/serves the WORDS (AI,
// per congregation+day); this one manages a standing recorded-audio asset
// PER BAND that, when present, the member payload prefers over synthesis
// (LiturgyService.current() reads this table directly for the current band).
//
// One row per (congregation_id, band) — replaced by upsert, never versioned.
// "Per band, never all-or-nothing": every band is independent, so recording
// (or deleting) one never touches the other six. Mixed coverage — some bands
// his voice, most still the synthesiser — is the expected, permanent steady
// state, not a gap to fill (see the migration's header comment).
import type { Pool } from "pg";
import { many, maybeOne } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { BANDS, type DayBand } from "./liturgy.js";

export interface LiturgyRecording {
  band: DayBand;
  audio_url: string | null;
  duration_sec: number | null;
  recorded_at: string | null;
}

export class LiturgyRecordingService {
  constructor(private readonly pool: Pool) {}

  /** Every band's recording status for this congregation, in clock order —
   *  drives the admin recorder UI ("which bands already have his voice").
   *  Never exposed to members (no recorded_by / no member-facing route). */
  async list(congregationId: string): Promise<LiturgyRecording[]> {
    const rows = await many<{ band: DayBand; audio_url: string; duration_sec: number; recorded_at: string }>(
      this.pool,
      `SELECT band, audio_url, duration_sec, recorded_at FROM liturgy_recordings WHERE congregation_id = $1`,
      [congregationId],
    );
    const byBand = new Map(rows.map((r) => [r.band, r]));
    return BANDS.map((band) => {
      const r = byBand.get(band);
      return r
        ? { band, audio_url: r.audio_url, duration_sec: r.duration_sec, recorded_at: r.recorded_at }
        : { band, audio_url: null, duration_sec: null, recorded_at: null };
    });
  }

  /** Record (or re-record) one band. Upserts — a second call for the same
   *  band REPLACES it (he will re-record). Returns the previous audio_url
   *  (or null) so the route can best-effort unlink the old file from disk. */
  async upsert(
    congregationId: string,
    band: DayBand,
    input: { audioUrl: string; durationSec: number; recordedBy: string },
  ): Promise<{ previousAudioUrl: string | null }> {
    const prev = await maybeOne<{ audio_url: string }>(
      this.pool,
      `SELECT audio_url FROM liturgy_recordings WHERE congregation_id = $1 AND band = $2`,
      [congregationId, band],
    );
    await this.pool.query(
      `INSERT INTO liturgy_recordings (congregation_id, band, audio_url, duration_sec, recorded_by, recorded_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, now(), now())
       ON CONFLICT (congregation_id, band)
       DO UPDATE SET audio_url = $3, duration_sec = $4, recorded_by = $5, recorded_at = now(), updated_at = now()`,
      [congregationId, band, input.audioUrl, input.durationSec, input.recordedBy],
    );
    return { previousAudioUrl: prev?.audio_url ?? null };
  }

  /** Remove a band's recording (falls back to synthesis immediately — no
   *  other band is affected). Returns the removed audio_url for disk cleanup. */
  async remove(congregationId: string, band: DayBand): Promise<{ audio_url: string | null }> {
    const row = await maybeOne<{ audio_url: string }>(
      this.pool,
      `DELETE FROM liturgy_recordings WHERE congregation_id = $1 AND band = $2 RETURNING audio_url`,
      [congregationId, band],
    );
    if (!row) throw new ApiError("NOT_FOUND", "No recording for that band");
    return { audio_url: row.audio_url };
  }
}
