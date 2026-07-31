# Nuru Live — Interactive Stage (L5 interactions · L6 guests)

Owner spec (2026-07-29): make a live broadcast two-way. Builds on the shipped
L0–L4 pipeline (HaishinKit RTMP → MediaMTX on the VPS → HLS via R2 CDN).

## Phases

- **L5 — Interactions (build now):** raise-hand, like/love reactions, live chat.
  Broadcaster controls row gains: ✋ hand-queue icon (badge = raised hands),
  💬 chat icon (sheet), floating reaction overlay. Viewers get: ❤️/👍 reaction
  buttons (float up the screen), ✋ raise/lower hand toggle, 💬 chat sheet.
- **L6 — Guests on stage (next):** broadcaster invites up to **6 viewers** as
  guests. Invited viewer accepts → becomes a temporary co-broadcaster **for the
  duration of the stream only** (per-stream grant, never an RBAC role change —
  server-authoritative, §1.1/§5.4). Speaker takes the big screen (audio-level
  detection), others sit in a thumbnail rail.

## L6 architecture (decided — do not re-litigate)

Guests need sub-second video; RTMP/HLS is one-way and seconds late. MediaMTX
(official image, already deployed) supports WebRTC natively:

1. Flip `webrtc: yes` in `/opt/pathway/mediamtx/mediamtx.yml` + publish 8889/tcp
   (+8189/udp ICE) behind nginx TLS. Auth stays `authMethod: http` → our
   existing `/v1/live/auth` — the backend grants a guest's WHIP publish on path
   `live/<streamId>-guest-<userId>` only while their `live_stream_guests` row is
   `accepted`, and revokes at stream end / removal.
2. Guest device WHIP-publishes camera+mic. Host device WHEP-subscribes to each
   guest, composites locally (HaishinKit multi-track screen objects): active
   speaker large, thumbnail rail for the rest, then publishes the SAME single
   1080p RTMP stream as today. **Viewers, HLS, R2 fan-out: unchanged.**
3. Cap 6 guests (host-side decode+composite budget; fine on A15+).

## Wire contract (PINNED — clients code to this)

All under `/v1`, member auth, stream must be live unless noted.

- `POST /live/streams/:id/reactions` `{emoji: "like"|"love"}` → 204.
  Append-only event; server rate-limits (≥1s/user).
- `POST /live/streams/:id/hand` `{raised: boolean}` → 204. One hand state per
  (stream,user).
- `GET /live/streams/:id/messages?since=<iso>` →
  `{messages:[{message_id, user_id, full_name, avatar_url, body, sent_at}]}`
  (ascending, cap 200/poll). `POST` same path `{body ≤500}` → 201 the message.
- `GET /live/streams/:id/pulse` → `{viewer_count, reactions:{like, love},
  recent_reactions:[{emoji, at}], hands:[{user_id, full_name, avatar_url,
  raised_at}], guests:[{user_id, full_name, avatar_url, status}]}` — one poll
  for the whole overlay (broadcaster 3s, viewer 5s).
- Guests (L6 scaffolding now, video later):
  `POST /live/streams/:id/guests/:userId` (broadcaster only, ≤6 active) →
  invited; `POST /live/streams/:id/guests/respond` `{accept: boolean}` (invitee);
  `DELETE /live/streams/:id/guests/:userId` (broadcaster, or self = leave).
  Status flow: invited → accepted|declined → removed|ended (stream end sweeps
  all → ended).

Tables (one migration): `live_stream_reactions` (stream_id, user_id, emoji,
occurred_at), `live_stream_hands` (PK stream_id+user_id, raised_at,
lowered_at), `live_stream_messages` (message_id uuid PK, stream_id, user_id,
body, sent_at), `live_stream_guests` (PK stream_id+user_id, status,
invited_at, responded_at).

Notifications: a guest invite rides the existing FCM/notification path
(`live_guest_invite` template) so an invited viewer gets a knock even if they
backgrounded the app.

## Definition of done

L5: backend tests green (reactions rate-limit, hand idempotence, messages
cursor, pulse shape, guest state machine + 6-cap + owner-only), OpenAPI
updated, deployed + relations verified; iOS broadcaster + viewer UI live on
device. Android parity follows as its own pass. L6 client video work is its own
phase against this contract.
