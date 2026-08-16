// Branded transactional email templates (§5.3). Email-client-safe: table-based
// layout, fully inline styles, no external CSS or images (text wordmark only, so
// nothing is blocked by image-proxy / "load remote content" prompts). Brand
// palette mirrors the app: deep navy #0A2540 + gold #C9A227 on warm paper.
// Every template returns both a plaintext and an HTML body — plaintext is what
// keeps us out of spam when a client strips HTML.

const NAVY = "#0A2540";
const NAVY_DEEP = "#071F3B";
const GOLD = "#C9A227";
const PAPER = "#F4F0E8";
const INK = "#0B0B0C";
const INK_MUTED = "#68758A";
const BORDER = "#E3DCC9";

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/** Minimal HTML-escape for values interpolated into the markup. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Shared outer shell: centered card on a paper background with a navy header
 * wordmark and a muted footer. `inner` is trusted, pre-built HTML.
 */
function layout(opts: { preheader: string; inner: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<title>Nuru Place</title>
</head>
<body style="margin:0;padding:0;background-color:${PAPER};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${PAPER};font-size:1px;line-height:1px;">${esc(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${PAPER};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
  <tr><td align="center" style="padding-bottom:20px;">
    <span style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:bold;letter-spacing:0.5px;color:${NAVY};">Nuru&nbsp;Place</span>
    <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background-color:${GOLD};margin:0 0 3px 6px;"></span>
  </td></tr>
  <tr><td style="background-color:#FFFFFF;border:1px solid ${BORDER};border-radius:14px;padding:36px 32px;">
${opts.inner}
  </td></tr>
  <tr><td align="center" style="padding-top:20px;">
    <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:${INK_MUTED};">
      Nuru Place Discipleship Pathway<br>
      You received this email because an action was requested for your account.
    </p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** A navy/gold call-to-action button (bulletproof-ish: table + inline styles). */
function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td align="center" style="border-radius:10px;background-color:${NAVY_DEEP};">
      <a href="${esc(href)}" target="_blank" style="display:inline-block;padding:14px 30px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#FFFFFF;text-decoration:none;border-radius:10px;border-top:2px solid ${GOLD};">${esc(label)}</a>
    </td></tr></table>`;
}

/**
 * Password-reset email — leads with a short, phone-typeable CODE that the member
 * types straight into the Nuru Place app. The reset LINK is only included when
 * `link` is provided (staff/portal users, who reset on the web); members get a
 * code-only email with NO backend link, because they never sign in to the portal
 * and a link there only confuses them. Both credentials redeem the same request.
 */
export function renderPasswordReset(opts: { code: string; link?: string; minutes: number; name?: string }): RenderedEmail {
  const greeting = opts.name ? `Hi ${opts.name},` : "Hi,";
  const subject = `Your Nuru Place reset code: ${opts.code}`;
  const linkText = opts.link
    ? `On a computer instead? Open this link — it shows the code again and lets you set a new password directly:\n${opts.link}\n\n`
    : "";
  const text =
    `${greeting}\n\n` +
    `We received a request to reset the password for your Nuru Place account.\n\n` +
    `Your reset code: ${opts.code}\n` +
    `Open the Nuru Place app, tap "Forgot password", and enter this code to choose a new password. Valid for ${opts.minutes} minutes.\n\n` +
    linkText +
    `If you didn't request this, you can safely ignore this email — your password won't change.\n\n` +
    `— Nuru Place Discipleship Pathway`;
  const codeBlock =
    `<div style="margin:0 0 22px;text-align:center;">` +
    `<div style="display:inline-block;padding:16px 26px;border-radius:12px;background-color:${PAPER};border:1.5px solid ${GOLD};">` +
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:10.5px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${INK_MUTED};margin-bottom:6px;">Your reset code</div>` +
    `<div style="font-family:'Courier New',Courier,monospace;font-size:28px;font-weight:bold;letter-spacing:4px;color:${NAVY};">${esc(opts.code)}</div>` +
    `</div>` +
    `</div>`;
  // The link block only renders for staff (opts.link present). Members get the
  // code + in-app instruction only — no link to a portal they can't sign in to.
  const linkBlock = opts.link
    ? `<hr style="border:none;border-top:1px solid ${BORDER};margin:0 0 20px;">` +
      `<p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:${INK_MUTED};">On a computer instead? Tap below — it'll show your code again and let you set a new password directly.</p>` +
      `<div style="margin:0 0 20px;">${button(opts.link, "Open reset page")}</div>` +
      `<p style="margin:0 0 24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:${INK_MUTED};">If the button doesn't work, copy and paste this link into your browser:<br><a href="${esc(opts.link)}" style="color:${NAVY};word-break:break-all;">${esc(opts.link)}</a></p>`
    : `<p style="margin:0 0 24px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:${INK_MUTED};">Open the Nuru Place app, tap <strong>Forgot password</strong>, and enter the code above to set a new password.</p>`;
  const inner =
    `<p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:${INK};">${esc(greeting)}</p>` +
    `<p style="margin:0 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:${INK};">We received a request to reset the password for your Nuru Place account. Enter this code in the app:</p>` +
    codeBlock +
    `<p style="margin:0 0 22px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:${INK_MUTED};text-align:center;">Valid for <strong>${opts.minutes} minutes</strong>.</p>` +
    linkBlock +
    `<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:${INK_MUTED};">If you didn't request this, you can safely ignore this email — your password won't change.</p>`;
  return {
    subject,
    text,
    html: layout({ preheader: `Your reset code: ${opts.code} (valid for ${opts.minutes} minutes).`, inner }),
  };
}
