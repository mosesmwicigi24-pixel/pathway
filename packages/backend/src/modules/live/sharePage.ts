// Public /w/{token} broadcast share page (docs/LIVE_SHARE.md — "Share a
// broadcast"). Dependency-free server-rendered HTML, deliberately mirroring
// reading-social/publicPage.ts (the only other public deep-link landing page
// in this codebase) — same palette, same card layout, same "attempt nuru://
// then fall back to the store" script, so the two families of public pages
// read as one product. Every dynamic value is HTML-escaped: this renders
// untrusted user input (broadcast titles) into a public, unauthenticated
// page, same threat model as publicPage.ts.
//
// Serves three audiences with ONE response, same as the join page:
//   1. An installed app whose Universal Link/App Link infra would normally
//      intercept the tap before this ever loads (not built yet — same gap
//      noted in reading-social).
//   2. A browser: the inline script attempts `nuru://live/replay/{id}`,
//      falling back to the platform store after a short timeout.
//   3. A crawler (WhatsApp/iMessage/Slack/Facebook link-preview bots): reads
//      only the server-rendered <meta property="og:*"> tags — never executes
//      the script.
//
// PRIVACY FIX (the actual point of this file): a scope='cell' broadcast NEVER
// gets a video element, an og:video tag, or a media URL of any kind —
// renderCellRestrictedPage has no mediaUrl parameter at all, so there is no
// code path that could leak one by mistake.

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const NAVY = "#0A2540";
const GOLD = "#C9A227";
const PAPER = "#F4F0E8";
const INK = "#0B0B0C";
const INK_MUTED = "#68758A";

/**
 * Branded fallback poster (docs/LIVE_SHARE.md "Poster thumbnail" follow-up).
 * The backend runtime image (packages/backend/Dockerfile) does not install
 * ffmpeg, and this feature deliberately does NOT add it silently — bundling
 * a native binary into the production image is an infra decision for the
 * operator to make on purpose (image size, CVE surface), not something to
 * sneak into a feature PR. Until that follow-up lands, `poster_url` on every
 * recording stays null (see recordings.ts generatePosterUrl) and every share
 * page falls back to this static SVG. KNOWN LIMITATION: some link-preview
 * crawlers (notably Facebook's) don't rasterize SVG og:image values — an
 * honest interim tradeoff, not a bug, and called out again in the doc.
 */
export const DEFAULT_POSTER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="Nuru Place Live">
<rect width="1200" height="630" fill="${NAVY}"/>
<rect width="1200" height="8" fill="${GOLD}"/>
<text x="600" y="330" font-family="Georgia, 'Times New Roman', serif" font-size="64" font-weight="bold" fill="#FFFFFF" text-anchor="middle">Nuru Place</text>
<text x="600" y="382" font-family="Arial, Helvetica, sans-serif" font-size="24" fill="${GOLD}" text-anchor="middle" letter-spacing="6">L I V E</text>
</svg>`;

function humanDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "Africa/Nairobi" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

const BASE_STYLE = `
  body{margin:0;padding:0;background-color:${PAPER};font-family:Arial,Helvetica,sans-serif;color:${INK};}
  .wrap{max-width:560px;margin:0 auto;padding:32px 20px 48px;text-align:center;}
  .card{background:#FFFFFF;border:1px solid #E3DCC9;border-radius:16px;padding:28px 24px;}
  .wordmark{font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:bold;color:${NAVY};margin-bottom:20px;}
  video{width:100%;border-radius:12px;background:#000;display:block;margin:0 0 20px;}
  .poster-cover{width:100%;border-radius:12px;margin:0 0 20px;display:block;}
  h1{font-size:21px;line-height:1.3;margin:0 0 10px;color:${NAVY};}
  p{font-size:15px;line-height:1.5;color:${INK_MUTED};margin:0 0 22px;}
  .btn{display:inline-block;padding:14px 28px;background-color:${NAVY};color:#FFFFFF;text-decoration:none;border-radius:10px;font-weight:bold;border-top:2px solid ${GOLD};}
  .fallback{margin-top:18px;font-size:13px;color:${INK_MUTED};}
  .fallback a{color:${NAVY};}
`;

function deepLinkScript(deepLink: string, androidStoreUrl: string, iosStoreUrl: string): string {
  return `<script>
(function () {
  var deepLink = ${JSON.stringify(deepLink)};
  var android = ${JSON.stringify(androidStoreUrl)};
  var ios = ${JSON.stringify(iosStoreUrl)};
  var ua = navigator.userAgent || "";
  var store = /android/i.test(ua) ? android : (/iphone|ipad|ipod/i.test(ua) ? ios : "");
  var fellBack = false;
  function fallback() {
    if (fellBack || document.hidden) return;
    fellBack = true;
    if (store) window.location.href = store;
  }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) fellBack = true;
  });
  var openBtn = document.getElementById("open-app");
  if (openBtn) {
    openBtn.addEventListener("click", function (e) {
      e.preventDefault();
      window.location.href = deepLink;
      setTimeout(fallback, 1200);
    });
  }
})();
</script>`;
}

export interface ChurchSharePageInput {
  token: string;
  joinUrl: string;
  title: string;
  congregationName: string;
  startedAt: string;
  mediaUrl: string;
  posterUrl: string;
  streamId: string;
  appScheme: string;
  androidStoreUrl: string;
  iosStoreUrl: string;
}

/** A church-scope broadcast — publicly playable. */
export function renderChurchSharePage(input: ChurchSharePageInput): string {
  const title = esc(`${input.congregationName} — ${input.title}`);
  const description = esc(`${input.congregationName} · ${humanDate(input.startedAt)}`);
  const poster = esc(input.posterUrl);
  const media = esc(input.mediaUrl);
  const joinUrl = esc(input.joinUrl);
  const deepLink = `${input.appScheme}://live/replay/${input.streamId}`;
  const android = esc(input.androidStoreUrl);
  const ios = esc(input.iosStoreUrl);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta property="og:type" content="video.other">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${joinUrl}">
<meta property="og:image" content="${poster}">
<meta property="og:video" content="${media}">
<meta property="og:video:url" content="${media}">
<meta property="og:video:secure_url" content="${media}">
<meta property="og:video:type" content="video/mp4">
<meta property="og:video:width" content="1280">
<meta property="og:video:height" content="720">
<meta name="twitter:card" content="player">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${poster}">
<meta name="twitter:player" content="${joinUrl}">
<meta name="twitter:player:width" content="1280">
<meta name="twitter:player:height" content="720">
<meta name="twitter:player:stream" content="${media}">
<meta name="twitter:player:stream:content_type" content="video/mp4">
<style>${BASE_STYLE}</style>
</head>
<body>
<div class="wrap">
  <div class="wordmark">Nuru&nbsp;Place</div>
  <div class="card">
    <video controls playsinline preload="metadata" poster="${poster}">
      <source src="${media}" type="video/mp4">
    </video>
    <h1>${title}</h1>
    <p>${description}</p>
    <a class="btn" id="open-app" href="${esc(deepLink)}">Open in the Nuru app</a>
    <div class="fallback">
      Don't have the app?
      ${input.androidStoreUrl ? ` <a href="${android}">Get it on Google Play</a>` : ""}
      ${input.iosStoreUrl ? ` <a href="${ios}">Download on the App Store</a>` : ""}
    </div>
  </div>
</div>
${deepLinkScript(deepLink, input.androidStoreUrl, input.iosStoreUrl)}
</body>
</html>`;
}

export interface CellRestrictedPageInput {
  joinUrl: string;
  title: string;
  cellName: string;
  posterUrl: string;
  streamId: string;
  appScheme: string;
  androidStoreUrl: string;
  iosStoreUrl: string;
}

/**
 * The privacy fix, spelled out in HTML: a scope='cell' broadcast NEVER gets a
 * video element, an og:video tag, or a media URL — this function's own
 * signature has no mediaUrl parameter to leak, by construction.
 */
export function renderCellRestrictedPage(input: CellRestrictedPageInput): string {
  const heading = esc(`This broadcast is for members of ${input.cellName}`);
  const description = esc(`"${input.title}" is a cell broadcast — only ${input.cellName} members can watch it, inside the Nuru app.`);
  const poster = esc(input.posterUrl);
  const joinUrl = esc(input.joinUrl);
  const deepLink = `${input.appScheme}://live/replay/${input.streamId}`;
  const android = esc(input.androidStoreUrl);
  const ios = esc(input.iosStoreUrl);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${heading}</title>
<meta property="og:type" content="website">
<meta property="og:title" content="${heading}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${joinUrl}">
<meta property="og:image" content="${poster}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${heading}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${poster}">
<style>${BASE_STYLE}</style>
</head>
<body>
<div class="wrap">
  <div class="wordmark">Nuru&nbsp;Place</div>
  <div class="card">
    <img class="poster-cover" src="${poster}" alt="">
    <h1>${heading}</h1>
    <p>${description}</p>
    <a class="btn" id="open-app" href="${esc(deepLink)}">Open in Nuru</a>
    <div class="fallback">
      Don't have the app?
      ${input.androidStoreUrl ? ` <a href="${android}">Get it on Google Play</a>` : ""}
      ${input.iosStoreUrl ? ` <a href="${ios}">Download on the App Store</a>` : ""}
    </div>
  </div>
</div>
${deepLinkScript(deepLink, input.androidStoreUrl, input.iosStoreUrl)}
</body>
</html>`;
}

/** Unknown/revoked token, or a recording that no longer exists (deleted). */
export function renderShareNotFoundPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>This broadcast isn't available — Nuru Place</title>
</head>
<body style="margin:0;padding:0;background-color:${PAPER};font-family:Arial,Helvetica,sans-serif;color:${INK};">
<div style="max-width:480px;margin:0 auto;padding:64px 20px;text-align:center;">
  <div style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:bold;color:${NAVY};margin-bottom:24px;">Nuru&nbsp;Place</div>
  <h1 style="font-size:20px;color:${NAVY};">This broadcast isn't available</h1>
  <p style="font-size:15px;color:${INK_MUTED};">The link may have been revoked, or the recording is no longer available. Ask whoever shared it to send a fresh link.</p>
</div>
</body>
</html>`;
}
