import type { APIRoute } from "astro";
import { sendBrevoEmail, esc, SENDER, NOTIFY_TO, AUTOREPLY_HTML } from "../../lib/brevo";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env ?? {};
  const apiKey = env.BREVO_API_KEY as string | undefined;
  if (!apiKey) {
    return json({ ok: false, error: "Email not configured." }, 500);
  }

  let name = "", email = "", subject = "", message = "";
  try {
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const b = (await request.json()) as any;
      ({ name, email, subject, message } = b);
    } else {
      const f = await request.formData();
      name = String(f.get("name") || "");
      email = String(f.get("email") || "");
      subject = String(f.get("subject") || "");
      message = String(f.get("message") || "");
    }
  } catch {
    return json({ ok: false, error: "Invalid submission." }, 400);
  }

  if (!name || !email || !message) {
    return json({ ok: false, error: "Please fill in the required fields." }, 400);
  }

  const notifyHtml = `
    <div style="font-family:Arial,sans-serif;font-size:15px;color:#2b2b2b;line-height:1.6">
      <h2 style="margin:0 0 12px">New contact form submission</h2>
      <p><strong>Name:</strong> ${esc(name)}</p>
      <p><strong>Email:</strong> ${esc(email)}</p>
      <p><strong>Subject:</strong> ${esc(subject) || "(none)"}</p>
      <p><strong>Message:</strong><br/>${esc(message).replace(/\n/g, "<br/>")}</p>
    </div>`;

  try {
    // 1) Notify James
    const notify = await sendBrevoEmail({
      apiKey,
      sender: SENDER,
      to: [NOTIFY_TO],
      replyTo: { email, name },
      subject: `New contact form: ${subject || name}`,
      htmlContent: notifyHtml,
    });
    if (!notify.ok) {
      const t = await notify.text();
      return json({ ok: false, error: "Send failed.", detail: t }, 502);
    }

    // 2) Auto-reply to the submitter
    await sendBrevoEmail({
      apiKey,
      sender: SENDER,
      to: [{ email, name }],
      subject: "Thanks for reaching out to Brewhemia",
      htmlContent: AUTOREPLY_HTML(name),
    });

    return json({ ok: true });
  } catch (e: any) {
    return json({ ok: false, error: "Send failed.", detail: String(e) }, 502);
  }
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
