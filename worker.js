/**
 * Minimal Brewhemia worker: handles the two contact form endpoints via Brevo,
 * passes everything else through to static assets.
 * No framework, no CMS. API key comes from the BREVO_API_KEY secret.
 */

const SENDER = { name: "Brewhemia", email: "info@brewhemia.com" };
const NOTIFY = { name: "James Welbes", email: "james.welbes@gmail.com" };

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

async function handleContact(request, env) {
  const apiKey = env.BREVO_API_KEY;
  if (!apiKey) return json({ ok: false, error: "Email not configured." }, 500);
  const { data } = await parseBody(request);
  const { name, email, subject, message } = data;
  if (!name || !email || !message) return json({ ok: false, error: "Please fill in the required fields." }, 400);

  const notifyHtml = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#2b2b2b;line-height:1.6">
    <h2 style="margin:0 0 12px">New contact form submission</h2>
    <p><strong>Name:</strong> ${esc(name)}</p>
    <p><strong>Email:</strong> ${esc(email)}</p>
    <p><strong>Subject:</strong> ${esc(subject) || "(none)"}</p>
    <p><strong>Message:</strong><br/>${esc(message).replace(/\n/g, "<br/>")}</p></div>`;

  const notify = await sendBrevo(apiKey, {
    sender: SENDER, to: [NOTIFY], replyTo: { email, name },
    subject: `New contact form: ${subject || name}`, htmlContent: notifyHtml,
  });
  if (!notify.ok) return json({ ok: false, error: "Send failed.", detail: await notify.text() }, 502);

  await sendBrevo(apiKey, {
    sender: SENDER, to: [{ email, name }],
    subject: "Thanks for reaching out to Brewhemia", htmlContent: autoReplyHtml(name),
  });
  return json({ ok: true });
}

async function handleCatering(request, env) {
  const apiKey = env.BREVO_API_KEY;
  if (!apiKey) return json({ ok: false, error: "Email not configured." }, 500);
  const { data, interested } = await parseBody(request);
  const { name, email, phone, details } = data;
  if (!name || !email || !phone || !details) return json({ ok: false, error: "Please fill in the required fields." }, 400);

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
    sender: SENDER, to: [NOTIFY], replyTo: { email, name },
    subject: `New catering request: ${name}${data.company ? " / " + data.company : ""}`, htmlContent: notifyHtml,
  });
  if (!notify.ok) return json({ ok: false, error: "Send failed.", detail: await notify.text() }, 502);

  await sendBrevo(apiKey, {
    sender: SENDER, to: [{ email, name }],
    subject: "Thanks for your catering inquiry — Brewhemia", htmlContent: autoReplyHtml(name),
  });
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/contact") return handleContact(request, env);
    if (request.method === "POST" && url.pathname === "/api/catering") return handleCatering(request, env);
    // Everything else: static assets
    return env.ASSETS.fetch(request);
  },
};
