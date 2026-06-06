// Cohort table (spec §1.3) — the portal's defining screen: a cell's members,
// lowest engagement first, read from the engagement_scores snapshot via a single
// indexed query. Bands are colour-coded from the stored value (no client compute).
import { useState, type ReactElement } from "react";
import { PortalApi, type CohortMember } from "../api/client";
import { bandColor, bandLabel, formatPct, sortByEngagement } from "../util/engagement";

export function CohortTable(): ReactElement {
  const [cellId, setCellId] = useState("");
  const [rows, setRows] = useState<CohortMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(): Promise<void> {
    if (!cellId) return;
    setLoading(true);
    setError(null);
    try {
      setRows(sortByEngagement(await PortalApi.cohort(cellId, { order: "asc" })));
    } catch {
      setError("Could not load this cohort (check the cell id and your access).");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          aria-label="Cell group id"
          placeholder="cell_group_id"
          value={cellId}
          onChange={(e) => setCellId(e.target.value)}
          style={{ flex: 1, padding: 8 }}
        />
        <button type="button" onClick={() => void load()} disabled={loading || !cellId}>
          {loading ? "Loading…" : "Load cohort"}
        </button>
      </div>
      {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #e5e7eb" }}>
            <th>Member</th>
            <th>Habits</th>
            <th>Curriculum</th>
            <th>Attendance</th>
            <th>Engagement</th>
            <th>Band</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.user_id} style={{ borderBottom: "1px solid #f3f4f6" }}>
              <td>{m.full_name ?? m.user_id}</td>
              <td>{formatPct(m.h_score)}</td>
              <td>{formatPct(m.c_score)}</td>
              <td>{formatPct(m.a_score)}</td>
              <td>{formatPct(m.e_score)}</td>
              <td>
                <span style={{ color: bandColor(m.band), fontWeight: 600 }}>{bandLabel(m.band)}</span>
              </td>
            </tr>
          ))}
          {rows.length === 0 && !loading ? (
            <tr>
              <td colSpan={6} style={{ color: "#6b7280", paddingTop: 12 }}>
                No members loaded.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}
