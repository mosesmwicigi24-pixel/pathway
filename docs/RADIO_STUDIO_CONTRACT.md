# Radio Broadcast Studio + Virtual Audio Mixer — cross-surface contract

Source of truth for the Radio + Mixer feature. Figma Make design:
`ZMEsnrOJCXXY7rHfTBautI` (routes `/radio` → RadioStudio, `/mixer` → MixerStudio).
This session ships **backend + web portal + iPad**. Mobile (member Radio + player)
is the immediate next step and consumes the member API below.

Palette (both studio pages are intentionally DARK, unlike the rest of the portal):
BG `#0A1120`, panel `linear-gradient(180deg,#131E33,#0F1829)`, border `rgba(255,255,255,.08)`,
gold `#E6C66E` / deep `#C89B3C`, red `#EF4444`, green `#22C55E`, text `#E8EEF7`,
dim `rgba(232,238,247,.55)`. Serif `DM Serif Display`, mono `DM Mono`, body `Manrope`.

## Streaming architecture (real ingest, provider-abstracted)

`StreamProvider` interface with a `FakeStreamProvider` default (no secrets, used in
dev/tests) and a real provider selected by env `RADIO_STREAM_PROVIDER` (`fake` default;
`cloudflare` / `mux` / `rtmp` pluggable later with creds supplied as env secrets).

```
interface StreamProvider {
  provision(programId): { provider, ingestUrl, streamKey, hlsUrl }   // on create
  start(program): void            // go-live
  stop(program): void             // end
  rotateKey(programId): { streamKey }
  health(program): StreamHealth   // cpu/mem/bitrate/latency/dropped/stability/listeners
}
```
FakeStreamProvider: deterministic URLs from program id
(`ingestUrl=rtmp://ingest.local/live`, `streamKey=nuru_<id8>_<rand>`,
`hlsUrl=https://stream.local/hls/<id>.m3u8`), simulated but stable health numbers.
`stream_key` is a SECRET — returned only on admin create/go-live/rotate, NEVER to members.

## Database (new migration, next timestamp)

**radio_programs**
- id uuid pk default gen_random_uuid()
- title text not null · description text · category text not null
  (Sermon|Worship|Prayer|Bible Study|Conference) · speaker text · location text
- artwork_url text · tags text[] not null default '{}'
- visibility text not null default 'public' check (public|members|private)
- scheduled_at timestamptz · duration_min int · repeat text default 'none' · timezone text
- status text not null default 'draft' check (draft|scheduled|live|ended)
- is_live boolean not null default false · live_started_at timestamptz · live_ended_at timestamptz
- record_broadcast boolean not null default false · record_target text (cloud|local|both)
- peak_listeners int not null default 0
- ingest_provider text · ingest_url text · stream_key text · hls_url text
- created_by uuid references users(id) · created_at/updated_at timestamptz default now()
- indexes: (status), (scheduled_at), (is_live) where is_live

**radio_reactions** — id uuid pk · program_id fk radio_programs(id) on delete cascade ·
member_id fk users(id) · kind text check (heart|amen|fire) · client_event_id text unique ·
created_at. Idempotent per client_event_id (§2.1). index (program_id).

**radio_comments** — id uuid pk · program_id fk cascade · member_id fk users(id) ·
body text not null · hidden boolean not null default false · client_event_id text unique ·
created_at. index (program_id, created_at desc).

**mixer_scenes** — id uuid pk · name text not null · hint text ·
channels jsonb not null (array of {id,name,sub,color,level,pan,muted,solo}) ·
is_default boolean not null default false · created_by fk users(id) · created_at/updated_at.

**mixer_jingles** — id uuid pk · label text not null · color text · audio_url text ·
sort int not null default 0 · created_by fk users(id) · created_at.

## API

### Admin (prefix `/admin/radio`, RBAC admin/superadmin, §5.4)
- `GET  /admin/radio/programs?status=` → RadioProgram[] (includes stream_key)
- `POST /admin/radio/programs` {title,description,category,speaker,location,artwork_url,
  tags,visibility,scheduled_at,duration_min,repeat,timezone,record_broadcast,record_target}
  → provisions provider creds, returns RadioProgram
- `GET  /admin/radio/programs/:id` → RadioProgram
- `PATCH /admin/radio/programs/:id` → RadioProgram
- `DELETE /admin/radio/programs/:id`
- `POST /admin/radio/programs/:id/go-live` → status=live,is_live; provider.start; RadioProgram
- `POST /admin/radio/programs/:id/end` → status=ended,is_live=false; provider.stop; RadioProgram
- `POST /admin/radio/programs/:id/rotate-key` → { stream_key }
- `GET  /admin/radio/programs/:id/health` → StreamHealth (live only)
- `GET  /admin/radio/programs/:id/comments` → RadioComment[] (incl hidden)
- `DELETE /admin/radio/comments/:cid` (hide)
- Mixer: `GET|POST /admin/radio/mixer/scenes` · `PATCH|DELETE /admin/radio/mixer/scenes/:id`
  · `GET|POST /admin/radio/mixer/jingles` · `DELETE /admin/radio/mixer/jingles/:id`

### Member (prefix `/radio`, auth member) — for mobile next session
- `GET  /radio/programs` → visible programs (public always; members if authed; never private)
- `GET  /radio/now-playing` → current live program (or next scheduled) — NO stream_key
- `GET  /radio/programs/:id` → RadioProgram public view (hls_url yes, stream_key NO)
- `POST /radio/programs/:id/react` {kind, client_event_id} idempotent → { counts }
- `GET  /radio/programs/:id/comments` → RadioComment[] (non-hidden)
- `POST /radio/programs/:id/comments` {body, client_event_id} idempotent → RadioComment

Public/member DTO (`RadioProgramPublic`) OMITS `stream_key`, `ingest_url`, `ingest_provider`.

## Shared types (@nuru/shared) + OpenAPI
RadioProgram, RadioProgramPublic, RadioReactionKind ('heart'|'amen'|'fire'),
RadioReactionCounts, RadioComment, MixerChannel, MixerScene, MixerJingle, StreamHealth,
and request bodies. Add OpenAPI paths+schemas; `pnpm openapi:lint` must pass.

## Web + iPad pages (faithful to Figma)
**RadioStudio** — broadcast card (artwork/title/desc/category/speaker/location); Audio Source
selector (7 sources w/ status+signal); L/R audio meters; broadcast controls
idle→countdown(3-2-1)→LIVE→paused; LIVE status bar (duration/listeners/bitrate/health from
`/health`); waveform; listener interactions (hearts/amens/fire + latest comments from API);
broadcast form (title/desc/category/speaker/tags/artwork/visibility); schedule
(date/time/duration/repeat/timezone); recording toggle; device manager; stream health
dashboard; emergency controls. Wire the REAL bits to API (programs CRUD, go-live/end,
health, comments, reactions); keep local-only hardware bits (mic gain, source select,
meters/waveform) as client state.
**MixerStudio** — channel strips (level/pan/mute/solo) + master; scene presets
(Preaching/Worship/Prayer/Interview) → persisted mixer_scenes; music bed player; jingle
soundboard w/ upload → mixer_jingles. Persist scenes + jingles via API; live meters are
client-simulated.
