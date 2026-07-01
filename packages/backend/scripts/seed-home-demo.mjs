// Rich "home / discovery" demo content for the member app so every Home + Events
// card lights up for student1@dev.local (Ada Thriving, congregation "Dev Branch",
// cell "Dev Cell A"). Populates: homepage welcome video, featured cell (+ metadata),
// disciplers carousel, prayer-wall home, event series (+ following + a featured
// event + calendar occurrences), image/video announcements (+ banner deliveries +
// a featured announcement), and moments.
//
// Idempotent: uses fixed demo UUIDs, clears prior demo rows first, and respects the
// single-featured / single-homepage partial-unique invariants. Run AFTER seed-dev:
//   DATABASE_URL=postgres://nuru@localhost:5432/nuru node scripts/seed-home-demo.mjs
import "dotenv/config";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is required"); process.exit(1); }

// ---- stable demo media (public, hotlink-friendly) ----
const img = (seed, w = 1200, h = 800) => `https://picsum.photos/seed/nuru-${seed}/${w}/${h}`;
const avatar = (n) => `https://i.pravatar.cc/240?img=${n}`;
const YT_ID = "ScMzIvxBSi4";

// ---- fixed demo ids (so re-runs are clean) ----
const ID = {
  video: "de300000-0000-0000-0000-000000000001",
  disc1: "de300000-0000-0000-0000-0000000000d1",
  disc2: "de300000-0000-0000-0000-0000000000d2",
  prayer: (i) => `de300000-0000-0000-0000-0000000005${i}0`,
  series: (i) => `de300000-0000-0000-0000-0000000006${i}0`,
  ann: (i) => `de300000-0000-0000-0000-0000000007${i}0`,
  moment: (i) => `de300000-0000-0000-0000-0000000008${i}0`,
};

// ---- date helpers (wall-clock local strings for TIMESTAMP columns) ----
const pad = (n) => String(n).padStart(2, "0");
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
/** The most recent past `weekday` (0=Sun..6=Sat) at hour:min, as a wall-clock string. */
function lastWeekdayAt(weekday, hour, min = 0) {
  const d = new Date();
  d.setHours(hour, min, 0, 0);
  const diff = (d.getDay() - weekday + 7) % 7;
  d.setDate(d.getDate() - diff);
  return fmt(d);
}
function plusDaysAt(days, hour, min = 0) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, min, 0, 0);
  return fmt(d);
}
const untilPlusDays = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T235900Z`;
};

const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  await c.query("BEGIN");

  const stu = (await c.query(
    "SELECT user_id, congregation_id, cell_group_id FROM users WHERE email='student1@dev.local'",
  )).rows[0];
  if (!stu) throw new Error("student1@dev.local not found — run `pnpm db:seed:dev` first");
  const { user_id: me, congregation_id: cong, cell_group_id: cell } = stu;
  const leader = (await c.query("SELECT user_id FROM users WHERE email='leader@dev.local'")).rows[0]?.user_id;

  // --- clean prior demo rows (children first) ---
  await c.query("DELETE FROM prayer_wall_reactions WHERE post_id = ANY($1)", [[0,1,2,3,4].map(ID.prayer)]);
  await c.query("DELETE FROM prayer_wall_posts     WHERE post_id = ANY($1)", [[0,1,2,3,4].map(ID.prayer)]);
  await c.query("DELETE FROM announcement_deliveries WHERE announcement_id = ANY($1)", [[0,1,2].map(ID.ann)]);
  await c.query("DELETE FROM announcements         WHERE announcement_id = ANY($1)", [[0,1,2].map(ID.ann)]);
  await c.query("DELETE FROM event_series_follows  WHERE series_id = ANY($1)", [[0,1,2,3].map(ID.series)]);
  await c.query("DELETE FROM event_series          WHERE series_id = ANY($1)", [[0,1,2,3].map(ID.series)]);
  await c.query("DELETE FROM event_moments         WHERE moment_id = ANY($1)", [[0,1,2,3,4,5].map(ID.moment)]);
  await c.query("DELETE FROM rbac_user_roles       WHERE user_id = ANY($1)", [[ID.disc1, ID.disc2]]);
  await c.query("DELETE FROM users                 WHERE user_id = ANY($1)", [[ID.disc1, ID.disc2]]);
  await c.query("DELETE FROM media_assets          WHERE media_asset_id = $1", [ID.video]);

  // --- clear single-instance invariants before setting demo rows ---
  await c.query("UPDATE media_assets SET is_homepage=false WHERE is_homepage=true");
  await c.query("UPDATE event_series SET is_featured=false WHERE is_featured=true");
  await c.query("UPDATE announcements SET is_featured=false WHERE is_featured=true");
  await c.query("UPDATE cell_groups  SET is_featured=false WHERE is_featured=true");

  // ---------------------------------------------------------------- 1. welcome video
  await c.query(
    `INSERT INTO media_assets (media_asset_id, cloudinary_id, kind, status, provider,
        video_source, external_url, external_video_id, caption, thumbnail_url, duration_sec, is_homepage)
     VALUES ($1,'external','vod','ready','youtube','youtube',$2,$3,$4,$5,$6,true)`,
    [ID.video, `https://www.youtube.com/watch?v=${YT_ID}`, YT_ID,
     "Welcome home — a word for your week from Pastor Miriam", `https://img.youtube.com/vi/${YT_ID}/maxresdefault.jpg`, 143],
  );

  // ---------------------------------------------------------------- 2. featured cell + metadata
  await c.query(
    `UPDATE cell_groups
        SET is_featured=true, leader_user_id=COALESCE(leader_user_id,$2),
            discipler_name='Pastor Miriam Okoth', discipler_role='Cell Discipler',
            focus='Foundations of Faith — knowing God as Father',
            level_label='Level 1 · Foundations', meets='Wednesdays · 6:30 PM',
            room='Upper Room B', next_session='This Wed · Two Roads',
            tone='gold', image_url=$3
      WHERE cell_group_id=$1`,
    [cell, leader, img("cell", 1000, 640)],
  );

  // ---------------------------------------------------------------- 3. disciplers carousel
  const disciplers = [
    { id: ID.disc1, name: "Pastor Miriam Okoth", role: "Instructor", av: avatar(45),
      msg: "So proud of your consistency, Ada. Let's finish Foundations strong this week." },
    { id: ID.disc2, name: "David Mwangi", role: "Instructor", av: avatar(12),
      msg: "Praying for you daily. Reach out any time — we walk this together." },
  ];
  for (const d of disciplers) {
    await c.query(
      `INSERT INTO users (user_id, full_name, role, congregation_id, cell_group_id, avatar_url, discipler_message, account_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'active')`,
      [d.id, d.name, d.role, cong, cell, d.av, d.msg],
    );
    await c.query(
      "INSERT INTO rbac_user_roles (user_id, role_key) VALUES ($1,'discipler') ON CONFLICT DO NOTHING",
      [d.id],
    );
  }
  // promote the seeded leader too (gives a 3rd real discipler with the member link)
  if (leader) {
    await c.query(
      `UPDATE users SET avatar_url=COALESCE(avatar_url,$2),
          discipler_message=COALESCE(discipler_message,'Keep walking in the light — I''m cheering you on.')
        WHERE user_id=$1`,
      [leader, avatar(33)],
    );
    await c.query("INSERT INTO rbac_user_roles (user_id, role_key) VALUES ($1,'discipler') ON CONFLICT DO NOTHING", [leader]);
  }

  // ---------------------------------------------------------------- 4. prayer wall (home + wall)
  const authors = [leader || me, ID.disc1, me, ID.disc2, me];
  const prayers = [
    { t: "Praying for Upperroom Studios", b: "Believing God for the launch — that it reaches a generation that needs Him." },
    { t: "Strength for my family", b: "My mum has been unwell. Asking for healing and peace over our home this week." },
    { t: "Wisdom for a big decision", b: "A new job offer is on the table. Praying for clear direction and open doors." },
    { t: "Thankful!", b: "Two roads reflection hit home today. Grateful for this cell and how far God has brought me." },
    { t: "Boldness to share", b: "Pray I'd have courage to invite my neighbour to Sunday service." },
  ];
  for (let i = 0; i < prayers.length; i++) {
    const pid = ID.prayer(i);
    await c.query(
      `INSERT INTO prayer_wall_posts (post_id, author_user_id, congregation_id, title, body, is_answered, is_hidden)
       VALUES ($1,$2,$3,$4,$5,$6,false)`,
      [pid, authors[i % authors.length], cong, prayers[i].t, prayers[i].b, i === 3],
    );
    // a spread of 🙏 reactions so pray_count + home ordering look real
    const prayers_by = [me, leader, ID.disc1, ID.disc2].slice(0, (i % 4) + 1);
    for (const u of prayers_by) {
      if (!u) continue;
      await c.query(
        "INSERT INTO prayer_wall_reactions (post_id, user_id, emoji) VALUES ($1,$2,'🙏') ON CONFLICT DO NOTHING",
        [pid, u],
      );
    }
  }

  // ---------------------------------------------------------------- 5. event series (+ occurrences + following + featured)
  const series = [
    { i: 0, title: "Sunday Celebration Service", cat: "Worship", loc: "Main Auditorium",
      dtstart: lastWeekdayAt(0, 9), rrule: `FREQ=WEEKLY;BYDAY=SU;UNTIL=${untilPlusDays(120)}`,
      img: img("worship", 1200, 700), featured: true, follow: true,
      desc: "Gather with the whole house for worship, the Word, and communion." },
    { i: 1, title: "Midweek Discipleship", cat: "Cell", loc: "Upper Room B",
      dtstart: lastWeekdayAt(3, 18, 30), rrule: `FREQ=WEEKLY;BYDAY=WE;UNTIL=${untilPlusDays(120)}`,
      img: img("cellmeet", 1200, 700), featured: false, follow: true,
      desc: "Foundations of Faith, together — this week: Two Roads." },
    { i: 2, title: "Youth Alight", cat: "Youth", loc: "The Hangar",
      dtstart: lastWeekdayAt(5, 17), rrule: `FREQ=WEEKLY;BYDAY=FR;UNTIL=${untilPlusDays(120)}`,
      img: img("youth", 1200, 700), featured: false, follow: false,
      desc: "High-energy worship and real talk for the next generation." },
    { i: 3, title: "Leaders Summit 2026", cat: "Leaders", loc: "Conference Hall",
      dtstart: plusDaysAt(9, 9), rrule: null, img: img("summit", 1200, 700), featured: false, follow: false,
      desc: "A one-day gathering to sharpen and send every multiplier." },
  ];
  for (const s of series) {
    await c.query(
      `INSERT INTO event_series (series_id, congregation_id, cell_group_id, title, description, location,
          timezone, dtstart_local, duration_min, rrule, visibility, created_by, category, status,
          is_paused, primary_image_url, is_featured)
       VALUES ($1,$2,NULL,$3,$4,$5,'Africa/Nairobi',$6,90,$7,'congregation',$8,$9,'active',false,$10,$11)`,
      [ID.series(s.i), cong, s.title, s.desc, s.loc, s.dtstart, s.rrule, leader || me, s.cat, s.img, s.featured],
    );
    if (s.follow) {
      await c.query(
        "INSERT INTO event_series_follows (user_id, series_id, last_seen_at) VALUES ($1,$2, now() - interval '3 days') ON CONFLICT DO NOTHING",
        [me, ID.series(s.i)],
      );
    }
  }

  // ---------------------------------------------------------------- 6/8. announcements (+ banner deliveries + featured)
  const anns = [
    { i: 0, t: "The Andrew Project — Month of Invitation", featured: true,
      b: "This month is our month of inviting family, friends, neighbours and strangers into the love of Christ. Bring one — the **#AndrewProject** starts Sunday.",
      primary: img("andrew", 1200, 700), gallery: [img("andrew-a", 900, 600), img("andrew-b", 900, 600)], video: `https://www.youtube.com/watch?v=${YT_ID}` },
    { i: 1, t: "Sunday Gathering Moved to 9 AM", featured: false,
      b: "Please note the new start time for the main celebration service — **9:00 AM** from this Sunday.",
      primary: img("time", 1200, 700), gallery: [], video: null },
    { i: 2, t: "Baptism Class Opens", featured: false,
      b: "Ready for the next step? Baptism class begins next week. Talk to your discipler to register.",
      primary: img("baptism", 1200, 700), gallery: [img("baptism-a", 900, 600)], video: null },
  ];
  for (const a of anns) {
    await c.query(
      `INSERT INTO announcements (announcement_id, title, body, channels, audience_kind, status, sent_at,
          created_by, primary_image_url, gallery_image_urls, video_url, is_featured)
       VALUES ($1,$2,$3, ARRAY['push','banner']::text[], 'all','sent', now() - ($4 || ' hours')::interval,
          $5,$6,$7,$8,$9)`,
      [ID.ann(a.i), a.t, a.b, String(a.i * 20), leader || me, a.primary, a.gallery, a.video, a.featured],
    );
    await c.query(
      `INSERT INTO announcement_deliveries (announcement_id, user_id, channel, status, delivered_at)
       VALUES ($1,$2,'banner','delivered', now()) ON CONFLICT (announcement_id, user_id, channel) DO NOTHING`,
      [ID.ann(a.i), me],
    );
  }

  // ---------------------------------------------------------------- 7. moments
  const moments = [
    { i: 0, cap: "Sunday worship — the house lifted high", tag: "Worship" },
    { i: 1, cap: "Cell night: Foundations, together", tag: "Cell" },
    { i: 2, cap: "Youth Alight lit up the Hangar", tag: "Youth" },
    { i: 3, cap: "Baptism Sunday — new life!", tag: "Baptism" },
    { i: 4, cap: "Serving our neighbours", tag: "Outreach" },
    { i: 5, cap: "Leaders sharpening leaders", tag: "Leaders" },
  ];
  for (const m of moments) {
    await c.query(
      `INSERT INTO event_moments (moment_id, congregation_id, image_url, caption, tag, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6, now() - ($7 || ' days')::interval)`,
      [ID.moment(m.i), cong, img(`moment-${m.i}`, 900, 900), m.cap, m.tag, leader || me, String(m.i)],
    );
  }

  await c.query("COMMIT");
  console.log("✓ seeded home/discovery demo content for student1@dev.local");
  console.log("  welcome video · featured cell · 3 disciplers · 5 prayers · 4 series (1 featured, 2 followed) · 3 announcements (1 featured) · 6 moments");
} catch (e) {
  await c.query("ROLLBACK").catch(() => {});
  console.error("seed-home-demo failed:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
