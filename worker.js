/**
 * Minimal Brewhemia worker: handles the two contact form endpoints via Brevo,
 * passes everything else through to static assets.
 * No framework, no CMS. API key comes from the BREVO_API_KEY secret.
 */

const SENDER = { name: "Brewhemia", email: "info@brewhemia.com" };
const NOTIFY = [
  { email: "andreashriver@gmail.com" },
  { email: "info@brewhemia.com" },
  { email: "matt@brewhemia.com" },
  { email: "steve@brewhemia.com" },
  { email: "james.welbes@gmail.com" },
];

function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function autoReplyHtml(name) {
  return `<div style="font-family:Arial,sans-serif;font-size:15px;color:#2b2b2b;line-height:1.6">
    <p>Hi ${esc(name) || "there"},</p>
    <p>Thanks for reaching out to Brewhemia — we've received your message and we'll be in touch soon.</p>
    <p>In the meantime, feel free to stop by:<br/>1202 3rd St SE, Cedar Rapids, IA 52401<br/>Tuesday–Sunday, 8am–2pm</p>
    <p>Warmly,<br/>The Brewhemia team</p>
  </div>`;
}

async function sendBrevo(apiKey, payload) {
  return fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload),
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

async function parseBody(request) {
  const ct = request.headers.get("content-type") || "";
  const data = {};
  let interested = [];
  if (ct.includes("application/json")) {
    const b = await request.json();
    Object.assign(data, b);
    if (Array.isArray(b.interested)) interested = b.interested;
    else if (b.interested) interested = [b.interested];
  } else {
    const f = await request.formData();
    for (const [k, v] of f.entries()) {
      if (k === "interested") interested.push(String(v));
      else data[k] = String(v);
    }
  }
  return { data, interested };
}

// Spam gate: honeypot + submit-speed trap + content scoring.
// Returns { spam: bool, reason: string }. Real submissions score 0.
function spamCheck(data) {
  // 1. Honeypot — hidden field only bots fill.
  if (data.website_hp && String(data.website_hp).trim() !== "") {
    return { spam: true, reason: "honeypot" };
  }
  // 2. Time trap — form render timestamp (ms). Humans take >3s; bots submit instantly.
  const ts = parseInt(data.form_ts, 10);
  if (ts && Number.isFinite(ts)) {
    const elapsed = Date.now() - ts;
    if (elapsed < 3000) return { spam: true, reason: "too-fast" };
    if (elapsed > 1000 * 60 * 60 * 6) return { spam: true, reason: "stale" };
  }
  // 3. Content scoring across all free-text fields.
  const blob = [data.name, data.email, data.subject, data.message, data.details, data.company]
    .filter(Boolean).join(" \n ").toLowerCase();
  let score = 0;
  const linkCount = (blob.match(/https?:\/\/|www\.|\[url|<a\s/gi) || []).length;
  if (linkCount >= 2) score += 2;
  if (linkCount >= 4) score += 3;
  if (/\b(viagra|cialis|casino|porn|crypto|bitcoin|forex|seo services|backlinks|loan|payday|escort|nude|xxx)\b/i.test(blob)) score += 3;
  if (/\b(guaranteed|make money|work from home|weight loss|cheap meds|100% free)\b/i.test(blob)) score += 2;
  if (/[а-яА-Я\u4e00-\u9fff]/.test(blob) && !/[a-z]/i.test(blob.replace(/[^a-zа-яА-Я\u4e00-\u9fff]/g, ""))) score += 2;
  if (/(.)\1{9,}/.test(blob)) score += 2; // long char repeats
  if (score >= 3) return { spam: true, reason: `content-score:${score}` };
  return { spam: false, reason: "" };
}

function uid() {
  return "sub_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// Persist a submission to D1. Never throws — a DB hiccup must not break the email path.
async function saveSubmission(env, row) {
  if (!env.DB) return null;
  try {
    const id = uid();
    await env.DB.prepare(
      `INSERT INTO submissions (id, form_name, name, email, phone, subject, message, company, event_date, guests, extra, is_spam, spam_reason, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))`
    ).bind(
      id,
      row.form_name || "contact",
      row.name || null,
      row.email || null,
      row.phone || null,
      row.subject || null,
      row.message || null,
      row.company || null,
      row.event_date || null,
      row.guests || null,
      row.extra ? JSON.stringify(row.extra) : null,
      row.is_spam ? 1 : 0,
      row.spam_reason || null
    ).run();
    return id;
  } catch (_) {
    return null;
  }
}

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Fire a phone push to the Brewhemia Command Center. Fire-and-forget; never blocks the response.
async function notifyCommandCenter(env, lead) {
  const secret = env.PUSH_NOTIFY_SECRET;
  if (!secret) return;
  const url = env.CC_NOTIFY_URL || "https://cc.crweb.design/api/push/notify";
  try {
    const ts = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      name: lead.name, email: lead.email, site: "brewhemia.com",
      message: lead.message, ts,
    });
    const sig = await hmacHex(secret, `v0:${ts}:${body}`);
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CC-Signature": `t=${ts},v0=${sig}` },
      body,
    });
  } catch (_) { /* CC down — row already saved; ignore */ }
}

async function handleContact(request, env) {
  const apiKey = env.BREVO_API_KEY;
  if (!apiKey) return json({ ok: false, error: "Email not configured." }, 500);
  const { data } = await parseBody(request);
  const { name, email, subject, message } = data;
  if (!name || !email || !message) return json({ ok: false, error: "Please fill in the required fields." }, 400);

  // Spam gate — store spam rows (is_spam=1) but don't email or notify.
  const spam = spamCheck(data);
  if (spam.spam) {
    await saveSubmission(env, { form_name: "contact", name, email, subject, message, is_spam: 1, spam_reason: spam.reason });
    return json({ ok: true });
  }

  // Persist the clean submission first (survives even if email/push fail).
  await saveSubmission(env, { form_name: "contact", name, email, subject, message });

  const notifyHtml = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#2b2b2b;line-height:1.6">
    <h2 style="margin:0 0 12px">New contact form submission</h2>
    <p><strong>Name:</strong> ${esc(name)}</p>
    <p><strong>Email:</strong> ${esc(email)}</p>
    <p><strong>Subject:</strong> ${esc(subject) || "(none)"}</p>
    <p><strong>Message:</strong><br/>${esc(message).replace(/\n/g, "<br/>")}</p></div>`;

  const notify = await sendBrevo(apiKey, {
    sender: SENDER, to: NOTIFY, replyTo: { email, name },
    subject: `New contact form: ${subject || name}`, htmlContent: notifyHtml,
  });
  if (!notify.ok) return json({ ok: false, error: "Send failed.", detail: await notify.text() }, 502);

  await sendBrevo(apiKey, {
    sender: SENDER, to: [{ email, name }],
    subject: "Thanks for reaching out to Brewhemia", htmlContent: autoReplyHtml(name),
  });
  try { await notifyCommandCenter(env, { name, email, message: subject ? `${subject}: ${message}` : message }); } catch (_) {}
  return json({ ok: true });
}

async function handleCatering(request, env) {
  const apiKey = env.BREVO_API_KEY;
  if (!apiKey) return json({ ok: false, error: "Email not configured." }, 500);
  const { data, interested } = await parseBody(request);
  const { name, email, phone, details } = data;
  if (!name || !email || !phone || !details) return json({ ok: false, error: "Please fill in the required fields." }, 400);

  // Spam gate — store spam rows (is_spam=1) but don't email or notify.
  const spam = spamCheck(data);
  if (spam.spam) {
    await saveSubmission(env, { form_name: "catering", name, email, phone, message: details, company: data.company,
      event_date: data["event-date"], guests: data.headcount, extra: { interested }, is_spam: 1, spam_reason: spam.reason });
    return json({ ok: true });
  }

  // Persist the clean submission first.
  await saveSubmission(env, { form_name: "catering", name, email, phone, message: details, company: data.company,
    event_date: data["event-date"], guests: data.headcount, extra: { interested } });

  const notifyHtml = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#2b2b2b;line-height:1.6">
    <h2 style="margin:0 0 12px">New catering request</h2>
    <p><strong>Name:</strong> ${esc(name)}</p>
    <p><strong>Company:</strong> ${esc(data.company) || "(none)"}</p>
    <p><strong>Phone:</strong> ${esc(phone)}</p>
    <p><strong>Email:</strong> ${esc(email)}</p>
    <p><strong>Date of event:</strong> ${esc(data["event-date"]) || "(none)"}</p>
    <p><strong>Headcount:</strong> ${esc(data.headcount) || "(none)"}</p>
    <p><strong>Interested in:</strong> ${esc(interested.join(", ")) || "(none)"}</p>
    <p><strong>Details:</strong><br/>${esc(details).replace(/\n/g, "<br/>")}</p></div>`;

  const notify = await sendBrevo(apiKey, {
    sender: SENDER, to: NOTIFY, replyTo: { email, name },
    subject: `New catering request: ${name}${data.company ? " / " + data.company : ""}`, htmlContent: notifyHtml,
  });
  if (!notify.ok) return json({ ok: false, error: "Send failed.", detail: await notify.text() }, 502);

  await sendBrevo(apiKey, {
    sender: SENDER, to: [{ email, name }],
    subject: "Thanks for your catering inquiry — Brewhemia", htmlContent: autoReplyHtml(name),
  });
  try { await notifyCommandCenter(env, { name, email, message: `Catering request${data.company ? " (" + data.company + ")" : ""}: ${details}` }); } catch (_) {}
  return json({ ok: true });
}

// ─── Support: constants + shared helpers ────────────────────────────────────
const SUPPORT_SITE_ID = "brewhemia";
const SUPPORT_SITE_HOST = "brewhemia.com";
const SUPPORT_HUB_URL = "https://cc.crweb.design/api/support/notify";
const REVIEW_ALLOWED_ORIGINS = new Set([
  "https://welbinator.github.io",
  "https://brewhemia.com",
  "http://localhost:4321",
  "http://127.0.0.1:4321",
]);

function newMsgId() {
  const rand = crypto.getRandomValues(new Uint8Array(8));
  return "msg_" + [...rand].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEq(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function parseSig(header) {
  if (!header) return null;
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const [k, ...rest] = p.trim().split("=");
      return [k, rest.join("=")];
    })
  );
  if (!parts.t || !parts.v0) return null;
  return { ts: parts.t, v0: parts.v0 };
}

// base64url helpers for review tokens (lockstep with support-review-token.ts / cc_ticket_writeback.py)
function b64urlDecodeToString(s) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// Verify a signed staging-review token: base64url(json{tid,sid,exp}).hex_hmac_sha256
async function verifyReviewToken(secret, token, expectedSiteId) {
  const raw = String(token || "").trim();
  const parts = raw.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, error: "Invalid review link" };
  const [bodyB64, sig] = parts;
  const expect = await hmacHex(secret, bodyB64);
  if (!timingSafeEq(expect, sig)) return { ok: false, error: "Invalid review link" };
  let payload;
  try {
    payload = JSON.parse(b64urlDecodeToString(bodyB64));
  } catch {
    return { ok: false, error: "Invalid review link" };
  }
  if (!payload?.tid || !payload?.sid || !payload?.exp) return { ok: false, error: "Invalid review link" };
  if (Math.floor(Date.now() / 1000) > Number(payload.exp)) {
    return { ok: false, error: "This review link has expired. Open the link from your support thread." };
  }
  if (expectedSiteId && payload.sid !== expectedSiteId) {
    return { ok: false, error: "Invalid review link for this site" };
  }
  return { ok: true, payload };
}

// Fire-and-forget signed webhook to the shared hub (approval / disapproval).
async function notifyHubSupport(env, payload) {
  const secret = env.PUSH_NOTIFY_SECRET;
  if (!secret) return;
  try {
    const ts = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ ...payload, ts });
    const sig = await hmacHex(secret, `v0:${ts}:${body}`);
    await fetch(SUPPORT_HUB_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CC-Signature": `t=${ts},v0=${sig}`,
        "User-Agent": "Mozilla/5.0 (BrewhemiaSite Support)",
      },
      body,
    });
  } catch (_) { /* hub down — local row already saved */ }
}

function reviewCors(request) {
  const origin = request.headers.get("Origin") || "";
  const allow = REVIEW_ALLOWED_ORIGINS.has(origin) ? origin : "https://welbinator.github.io";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function jsonCors(request, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...reviewCors(request) },
  });
}

// ─── POST /api/support/inbound — hub → site (staff reply + status/staging sync)
async function handleSupportInbound(request, env) {
  const secret = env.PUSH_NOTIFY_SECRET;
  if (!secret) return json({ error: "not configured" }, 503);
  const raw = await request.text();
  const sig = parseSig(request.headers.get("X-CC-Signature"));
  if (!sig) return json({ error: "missing signature" }, 403);
  const tsNum = parseInt(sig.ts, 10);
  if (!Number.isFinite(tsNum)) return json({ error: "bad timestamp" }, 403);
  if (Math.abs(Math.floor(Date.now() / 1000) - tsNum) > 600) return json({ error: "timestamp expired" }, 403);
  const expected = await hmacHex(secret, `v0:${sig.ts}:${raw}`);
  if (!timingSafeEq(expected, sig.v0)) return json({ error: "invalid signature" }, 403);

  let payload;
  try { payload = JSON.parse(raw); } catch { return json({ error: "invalid json" }, 400); }
  const ticketId = String(payload.ticket_id || "").trim();
  if (!ticketId) return json({ error: "ticket_id required" }, 400);
  const db = env.DB;
  if (!db) return json({ error: "db unavailable" }, 500);

  const ticket = await db.prepare(`SELECT id FROM support_tickets WHERE id = ? LIMIT 1`).bind(ticketId).first();
  if (!ticket) return json({ error: "ticket not found" }, 404);

  const ptype = String(payload.type || "staff_message").toLowerCase();
  const status = String(payload.status || "").trim().slice(0, 40);
  const stagingUrl = payload.staging_url !== undefined ? String(payload.staging_url || "").trim().slice(0, 500) : null;
  const updatedAt = String(payload.updated_at || payload.created_at || new Date().toISOString()).slice(0, 40);

  try {
    if (ptype === "ticket_update" || ptype === "status") {
      const updates = ["updated_at = ?"];
      const binds = [updatedAt];
      if (status) { updates.push("status = ?"); binds.push(status); }
      if (stagingUrl !== null) { updates.push("staging_url = ?"); binds.push(stagingUrl); }
      binds.push(ticketId);
      await db.prepare(`UPDATE support_tickets SET ${updates.join(", ")} WHERE id = ?`).bind(...binds).run();
      const note = String(payload.body || "").trim().slice(0, 8000);
      if (note) {
        const id = String(payload.message_id || "").trim() || newMsgId();
        const author = String(payload.author_name || "Support").trim().slice(0, 120);
        await db.prepare(
          `INSERT OR IGNORE INTO support_messages (id, ticket_id, sender, author_name, body, created_at)
           VALUES (?, ?, 'staff', ?, ?, ?)`
        ).bind(id, ticketId, author || "Support", note, updatedAt).run();
      }
      return json({ ok: true, type: "ticket_update" });
    }

    // Default: staff message
    const body = String(payload.body || "").trim().slice(0, 8000);
    const author = String(payload.author_name || "Support").trim().slice(0, 120);
    const createdAt = String(payload.created_at || new Date().toISOString()).slice(0, 40);
    if (!body) return json({ error: "ticket_id and body required" }, 400);
    const id = String(payload.message_id || "").trim() || newMsgId();
    await db.prepare(
      `INSERT OR IGNORE INTO support_messages (id, ticket_id, sender, author_name, body, created_at)
       VALUES (?, ?, 'staff', ?, ?, ?)`
    ).bind(id, ticketId, author || "Support", body, createdAt).run();
    const updates = ["updated_at = ?"];
    const binds = [createdAt];
    if (status) { updates.push("status = ?"); binds.push(status); }
    if (stagingUrl !== null) { updates.push("staging_url = ?"); binds.push(stagingUrl); }
    binds.push(ticketId);
    await db.prepare(`UPDATE support_tickets SET ${updates.join(", ")} WHERE id = ?`).bind(...binds).run();
    return json({ ok: true, id });
  } catch (err) {
    return json({ error: "db write failed" }, 500);
  }
}

// ─── POST /api/support/review — token-based approve/disapprove from staging bar
async function handleSupportReview(request, env) {
  const secret = env.PUSH_NOTIFY_SECRET || "";
  if (!secret) return jsonCors(request, { ok: false, error: "Server misconfigured" }, 500);
  let body;
  try { body = await request.json(); } catch { return jsonCors(request, { ok: false, error: "Invalid JSON" }, 400); }

  const token = String(body.token || "").trim();
  const action = String(body.action || "").trim().toLowerCase();
  const reason = String(body.reason || body.body || "").trim().slice(0, 8000);
  if (!token) return jsonCors(request, { ok: false, error: "Missing review token" }, 400);
  if (action !== "approve" && action !== "disapprove") {
    return jsonCors(request, { ok: false, error: "action must be approve or disapprove" }, 400);
  }
  if (action === "disapprove" && reason.length < 3) {
    return jsonCors(request, { ok: false, error: "Please explain what you’d like changed (a short note is fine)." }, 400);
  }

  const verified = await verifyReviewToken(secret, token, SUPPORT_SITE_ID);
  if (!verified.ok) return jsonCors(request, { ok: false, error: verified.error }, 401);

  const ticketId = verified.payload.tid;
  const db = env.DB;
  if (!db) return jsonCors(request, { ok: false, error: "Database unavailable" }, 500);

  try {
    const ticket = await db.prepare(
      `SELECT id, subject, user_id, user_email, user_name, status, staging_url, approved_at
       FROM support_tickets WHERE id = ? LIMIT 1`
    ).bind(ticketId).first();
    if (!ticket) return jsonCors(request, { ok: false, error: "Request not found" }, 404);

    const st = String(ticket.status || "");
    const staging = String(ticket.staging_url || "").trim();
    const userEmail = ticket.user_email || "";
    const userName = ticket.user_name || userEmail || "Client";
    const now = new Date().toISOString();
    const msgId = newMsgId();

    if (action === "approve") {
      if (st === "approved" || ticket.approved_at) {
        return jsonCors(request, { ok: true, already: true, action: "approve", ticket: { id: ticket.id, status: "approved", staging_url: staging } });
      }
      if (st === "done" || st === "closed") return jsonCors(request, { ok: false, error: "This request is already closed." }, 400);
      if (st !== "staging") {
        return jsonCors(request, { ok: false, error: "This preview isn’t waiting for approval right now. Check your support thread for the latest status." }, 400);
      }
      const bodyText = staging
        ? `I reviewed the preview and approve these changes.\n\nPreview: ${staging}`
        : "I reviewed the preview and approve these changes.";
      await db.batch([
        db.prepare(`UPDATE support_tickets SET status = 'approved', approved_at = ?, updated_at = ? WHERE id = ?`).bind(now, now, ticketId),
        db.prepare(`INSERT INTO support_messages (id, ticket_id, sender, author_name, body, created_at) VALUES (?, ?, 'client', ?, ?, ?)`).bind(msgId, ticketId, userName, bodyText, now),
      ]);
      await notifyHubSupport(env, {
        type: "approval", ticket_id: ticketId, message_id: msgId, site_id: SUPPORT_SITE_ID, site: SUPPORT_SITE_HOST,
        subject: ticket.subject, body: bodyText, message: bodyText, staging_url: staging, status: "approved",
        user_email: userEmail, user_name: userName, created_at: now, approved_at: now,
      });
      return jsonCors(request, { ok: true, action: "approve", ticket: { id: ticketId, status: "approved", staging_url: staging, approved_at: now } });
    }

    // disapprove
    if (st === "done" || st === "closed") return jsonCors(request, { ok: false, error: "This request is already closed." }, 400);
    if (st === "approved") return jsonCors(request, { ok: false, error: "You already approved this preview. Open your support thread if you need a new change." }, 400);
    if (st !== "staging") {
      return jsonCors(request, { ok: false, error: "This preview isn’t waiting for review right now. Check your support thread for the latest status." }, 400);
    }
    const bodyText = staging
      ? `I reviewed the preview and need changes before going live.\n\nWhat I didn’t like / what to fix:\n${reason}\n\nPreview: ${staging}`
      : `I reviewed the preview and need changes before going live.\n\nWhat I didn’t like / what to fix:\n${reason}`;
    await db.batch([
      db.prepare(`UPDATE support_tickets SET status = 'changes_requested', approved_at = '', updated_at = ? WHERE id = ?`).bind(now, ticketId),
      db.prepare(`INSERT INTO support_messages (id, ticket_id, sender, author_name, body, created_at) VALUES (?, ?, 'client', ?, ?, ?)`).bind(msgId, ticketId, userName, bodyText, now),
    ]);
    await notifyHubSupport(env, {
      type: "disapproval", ticket_id: ticketId, message_id: msgId, site_id: SUPPORT_SITE_ID, site: SUPPORT_SITE_HOST,
      subject: ticket.subject, body: bodyText, message: bodyText, reason, staging_url: staging, status: "changes_requested",
      user_email: userEmail, user_name: userName, created_at: now,
    });
    return jsonCors(request, { ok: true, action: "disapprove", ticket: { id: ticketId, status: "changes_requested", staging_url: staging, approved_at: "" } });
  } catch (err) {
    return jsonCors(request, { ok: false, error: "Could not submit review" }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/contact") return handleContact(request, env);
    if (request.method === "POST" && url.pathname === "/api/catering") return handleCatering(request, env);
    if (request.method === "POST" && url.pathname === "/api/support/inbound") return handleSupportInbound(request, env);
    if (request.method === "OPTIONS" && url.pathname === "/api/support/review") return new Response(null, { status: 204, headers: reviewCors(request) });
    if (request.method === "POST" && url.pathname === "/api/support/review") return handleSupportReview(request, env);
    // Everything else: static assets
    return env.ASSETS.fetch(request);
  },
};
