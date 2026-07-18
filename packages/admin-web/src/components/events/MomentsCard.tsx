// Moments — curated photo gallery for the mobile Events tab carousel.
// Self-contained manager: list (newest first), post (Cloudinary upload OR
// pasted URL + optional caption/tag), delete. Moved intact from the old
// Events.tsx during the §9 page-family split.
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Image as ImageIcon, Plus, Trash2 } from "lucide-react";
import { OpsApi, uploadToCloudinary, type MomentRow } from "../../api/client";
import { errorMessage } from "../../util/error";
import { Card, EmptyState, SectionHeader } from "./kit";

export function MomentsCard(): ReactElement {
  const [moments, setMoments] = useState<MomentRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [listErr, setListErr] = useState<string | null>(null);

  const [imageUrl, setImageUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false); // uploading bytes
  const [posting, setPosting] = useState(false); // creating the moment
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const rows = await OpsApi.moments();
      setMoments(rows);
      setListErr(null);
    } catch (e) {
      setListErr(errorMessage(e, "Could not load moments."));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function uploadFile(file: File): Promise<void> {
    if (file.size > 10 * 1024 * 1024) {
      setFormErr("Image is larger than 10 MB. Please choose a smaller image.");
      return;
    }
    setBusy(true);
    setFormErr(null);
    try {
      const sign = await OpsApi.signAdminImage("moments");
      const { secure_url } = await uploadToCloudinary(sign, file);
      setImageUrl(secure_url);
    } catch (e) {
      setFormErr(errorMessage(e, "Upload failed — paste an image URL instead."));
    } finally {
      setBusy(false);
    }
  }

  function pickImage(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const f = input.files?.[0];
      if (f) void uploadFile(f);
    };
    input.click();
  }

  async function post(): Promise<void> {
    const url = imageUrl.trim();
    if (!url) return;
    setPosting(true);
    setFormErr(null);
    try {
      const cap = caption.trim();
      const t = tag.trim();
      await OpsApi.createMoment({ image_url: url, ...(cap ? { caption: cap } : {}), ...(t ? { tag: t } : {}) });
      setImageUrl("");
      setCaption("");
      setTag("");
      await refresh();
    } catch (e) {
      setFormErr(errorMessage(e, "Could not post moment."));
    } finally {
      setPosting(false);
    }
  }

  async function remove(id: string): Promise<void> {
    setDeletingId(id);
    setFormErr(null);
    try {
      await OpsApi.deleteMoment(id);
      await refresh();
    } catch (e) {
      setFormErr(errorMessage(e, "Could not delete moment."));
    } finally {
      setDeletingId(null);
    }
  }

  const thumb = { width: 64, height: 64, borderRadius: 10, objectFit: "cover" as const, border: "1px solid var(--border)" };
  const input = { background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 12 };
  const btn = { fontSize: 12, fontWeight: 600, borderRadius: 10, padding: "8px 12px", border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", cursor: "pointer" };

  return (
    <Card>
      <SectionHeader title="Moments" subtitle="Curated photo gallery shown in the mobile Events tab carousel" />

      {/* Add a moment */}
      <div className="rounded-xl p-3 mb-4" style={{ background: "var(--secondary)" }}>
        <div className="flex items-start gap-3">
          {imageUrl ? (
            <img src={imageUrl} alt="moment preview" style={thumb} />
          ) : (
            <div style={{ ...thumb, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--card)", color: "var(--muted-foreground)" }}>
              <ImageIcon size={20} />
            </div>
          )}
          <div className="flex flex-col gap-2 flex-1 min-w-0">
            <div className="flex gap-2">
              <button type="button" onClick={pickImage} disabled={busy} style={{ ...btn, background: "var(--card)" }} aria-label="Upload moment image">
                {busy ? "Uploading…" : "Upload image"}
              </button>
              {imageUrl ? (
                <button type="button" onClick={() => setImageUrl("")} style={{ ...btn, background: "var(--card)", color: "#B91C1C" }} aria-label="Remove selected image">
                  Remove
                </button>
              ) : null}
            </div>
            <input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="…or paste an image URL"
              aria-label="Moment image URL"
              className="w-full rounded-lg px-3 py-2 outline-none"
              style={input}
            />
            <input
              value={caption}
              onChange={(e) => setCaption(e.target.value.slice(0, 280))}
              placeholder="Caption (optional)"
              aria-label="Moment caption"
              maxLength={280}
              className="w-full rounded-lg px-3 py-2 outline-none"
              style={input}
            />
            <input
              value={tag}
              onChange={(e) => setTag(e.target.value.slice(0, 60))}
              placeholder="Tag (optional) — e.g. Baptism Sunday"
              aria-label="Moment tag"
              maxLength={60}
              className="w-full rounded-lg px-3 py-2 outline-none"
              style={input}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void post()}
                disabled={busy || posting || !imageUrl.trim()}
                className="flex items-center gap-1.5 rounded-lg px-4 py-2"
                style={{
                  background: "var(--nuru-navy)",
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 700,
                  border: "none",
                  opacity: busy || posting || !imageUrl.trim() ? 0.5 : 1,
                  cursor: busy || posting || !imageUrl.trim() ? "default" : "pointer",
                }}
                aria-label="Post moment"
              >
                <Plus size={12} /> {posting ? "Posting…" : "Post moment"}
              </button>
            </div>
            {formErr ? <div style={{ fontSize: 11, color: "#B91C1C" }}>{formErr}</div> : null}
          </div>
        </div>
      </div>

      {/* Existing moments */}
      {listErr ? <div style={{ fontSize: 11, color: "#B91C1C", marginBottom: 8 }}>{listErr}</div> : null}
      {loaded && moments.length === 0 && !listErr ? (
        <EmptyState icon={<ImageIcon size={20} />} title="No moments yet" body="Post a photo from a recent gathering — it shows up in the mobile Events tab carousel." />
      ) : (
        <div className="flex flex-col">
          {moments.map((m, i) => (
            <div key={m.moment_id} className="flex items-center gap-3 py-3" style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
              <img src={m.image_url} alt={m.caption ?? "moment"} style={thumb} />
              <div className="flex-1 min-w-0">
                <div style={{ fontSize: 13, color: "var(--foreground)", overflow: "hidden", textOverflow: "ellipsis" }}>{m.caption || <span style={{ color: "var(--muted-foreground)" }}>No caption</span>}</div>
                {m.tag ? (
                  <span className="inline-block rounded-md px-2 py-0.5 mt-1" style={{ background: "var(--secondary)", color: "var(--foreground)", fontSize: 10, fontWeight: 700 }}>{m.tag}</span>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => void remove(m.moment_id)}
                disabled={deletingId === m.moment_id}
                className="flex items-center gap-1 rounded-lg px-3 py-1.5"
                style={{ background: "#FEE2E2", color: "#B91C1C", fontSize: 12, fontWeight: 600, border: "1px solid #FECACA", cursor: deletingId === m.moment_id ? "default" : "pointer", opacity: deletingId === m.moment_id ? 0.6 : 1 }}
                aria-label={`Delete moment${m.caption ? `: ${m.caption}` : ""}`}
              >
                <Trash2 size={12} /> {deletingId === m.moment_id ? "Deleting…" : "Delete"}
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
