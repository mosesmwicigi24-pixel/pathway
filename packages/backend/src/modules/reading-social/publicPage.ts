// Public /join/{token} deep-link landing page (spec §6; docs/READING_SOCIAL_PLAN.md
// §5). Dependency-free server-rendered HTML — no framework, mirroring the
// only other server-rendered HTML in this codebase
// (identity/email-templates.ts). Serves three audiences with ONE response:
//   1. An installed app whose Universal Link/App Link infra (not built this
//      phase — needs AASA/assetlinks hosting + native entitlements) would
//      normally intercept the tap before this ever loads.
//   2. A browser (not installed, or verification hasn't happened yet): the
//      inline script attempts the existing `nuru://` custom-scheme deep link,
//      falling back to the platform store after a short timeout.
//   3. A crawler (WhatsApp/iMessage/Slack link-preview bots): reads only the
//      server-rendered <meta property="og:*"> tags — never executes the
//      script — so tiers 2 and 3 are the same response, read two ways.
// Every dynamic value is HTML-escaped (XSS: this renders untrusted user
// content — inviter names, group/invite messages — into a public,
// unauthenticated page).

/** Minimal HTML-escape for values interpolated into markup or attributes. */
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

export interface JoinPageInput {
  token: string;
  joinUrl: string;
  planTitle: string;
  planDescription: string | null;
  planSubtitle: string | null;
  dayCount: number;
  imageUrl: string | null;
  inviterFirstName: string;
  message: string | null;
  appScheme: string;
  androidStoreUrl: string | null;
  iosStoreUrl: string | null;
}

function firstName(fullName: string): string {
  return (fullName.trim().split(/\s+/)[0] ?? fullName).trim() || "A friend";
}

/** Renders the OG-rich landing page for a live invite. */
export function renderJoinPage(input: JoinPageInput): string {
  // Escape the WHOLE composed string once — escaping inviterFirstName/planTitle
  // separately and then again after interpolation would double-escape (&amp;lt;).
  const title = esc(`${input.inviterFirstName} invited you to read "${input.planTitle}"`);
  const descParts = [
    input.message ? input.message : `${input.planSubtitle ?? input.planDescription ?? "Read together on Nuru Pathway."}`,
    `${input.dayCount}-day reading plan`,
  ].filter(Boolean);
  const description = esc(descParts.join(" — "));
  const image = input.imageUrl ? esc(input.imageUrl) : "";
  const deepLink = `${esc(input.appScheme)}://join/${esc(input.token)}`;
  const android = input.androidStoreUrl ? esc(input.androidStoreUrl) : "";
  const ios = input.iosStoreUrl ? esc(input.iosStoreUrl) : "";
  const joinUrl = esc(input.joinUrl);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${joinUrl}">
${image ? `<meta property="og:image" content="${image}">` : ""}
<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
${image ? `<meta name="twitter:image" content="${image}">` : ""}
<style>
  body{margin:0;padding:0;background-color:${PAPER};font-family:Arial,Helvetica,sans-serif;color:${INK};}
  .wrap{max-width:520px;margin:0 auto;padding:48px 20px;text-align:center;}
  .card{background:#FFFFFF;border:1px solid #E3DCC9;border-radius:16px;padding:36px 28px;}
  .wordmark{font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:bold;color:${NAVY};margin-bottom:24px;}
  .cover{width:100%;max-width:320px;border-radius:12px;margin:0 auto 20px;display:block;}
  h1{font-size:22px;line-height:1.3;margin:0 0 12px;color:${NAVY};}
  p{font-size:15px;line-height:1.5;color:${INK_MUTED};margin:0 0 24px;}
  .btn{display:inline-block;padding:14px 28px;background-color:${NAVY};color:#FFFFFF;text-decoration:none;border-radius:10px;font-weight:bold;border-top:2px solid ${GOLD};}
  .fallback{margin-top:20px;font-size:13px;color:${INK_MUTED};}
  .fallback a{color:${NAVY};}
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div class="wordmark">Nuru&nbsp;Place</div>
    ${image ? `<img class="cover" src="${image}" alt="">` : ""}
    <h1>${title}</h1>
    <p>${description}</p>
    <a class="btn" id="open-app" href="${deepLink}">Open in Nuru Pathway</a>
    <div class="fallback">
      Don't have the app?
      ${android ? ` <a href="${android}">Get it on Google Play</a>` : ""}
      ${ios ? ` <a href="${ios}">Download on the App Store</a>` : ""}
    </div>
  </div>
</div>
<script>
(function () {
  var deepLink = ${JSON.stringify(`${input.appScheme}://join/${input.token}`)};
  var android = ${JSON.stringify(input.androidStoreUrl ?? "")};
  var ios = ${JSON.stringify(input.iosStoreUrl ?? "")};
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
  window.location.href = deepLink;
  setTimeout(fallback, 1200);
})();
</script>
</body>
</html>`;
}

/** Renders a friendly 404 for an unknown/expired/revoked/declined token. */
export function renderInviteNotFoundPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Invite not found — Nuru Place</title>
</head>
<body style="margin:0;padding:0;background-color:${PAPER};font-family:Arial,Helvetica,sans-serif;color:${INK};">
<div style="max-width:480px;margin:0 auto;padding:64px 20px;text-align:center;">
  <div style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:bold;color:${NAVY};margin-bottom:24px;">Nuru&nbsp;Place</div>
  <h1 style="font-size:20px;color:${NAVY};">This invite link isn't available</h1>
  <p style="font-size:15px;color:${INK_MUTED};">It may have expired, been revoked, or already been used. Ask your friend to send a fresh one.</p>
</div>
</body>
</html>`;
}

export { firstName };
