import type { APIRoute } from "astro";
import { sendBrevoEmail, esc, SENDER, NOTIFY_TO, AUTOREPLY_HTML } from "../../lib/brevo";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env ?? {};
  const apiKey = env.BREVO_API_KEY as string | undefined;
  if (!apiKey) {
    return json({ ok: false, error: "Email not configured." }, 500);
  }

  const data: Record<string, string> = {};
  let interested: string[] = [];
  try {
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const b = (await request.json()) as any;
      Object.assign(data, b);
      interested = Array.isArray(b.interested) ? b.interested : (b.interested ? [b.interested] : []);
    } else {
      const f = await request.formData();
      for (const [k, v] of f.entries()) {
        if (k === "interested") interested.push(String(v));
        else data[k] = String(v);
      }
    }
  } catch {
    return json({ ok: false, error: "Invalid submission." }, 400);
  }

  const name = data.name || "";
  const email = data.email || "";
  const details = data.details || "";
  if (!name || !email || !data.phone || !details) {
    return json({ ok: false, error: "Please fill in the required fields." }, 400);
  }

  const notifyHtml = `
    <div style="font-family:Arial,sans-serif;font-size:15px;color:#2b2b2b;line-height:1.6">
      <h2 style="margin:0 0 12px">New catering request</h2>
      <p><strong>Name:</strong> ${esc(name)}</p>
      <p><strong>Company:</strong> ${esc(data.company) || "(none)"}</p>
      <p><strong>Phone:</strong> ${esc(data.phone)}</p>
      <p><strong>Email:</strong> ${esc(email)}</p>
      <p><strong>Date of event:</strong> ${esc(data["event-date"]) || "(none)"}</p>
      <p><strong>Headcount:</strong> ${esc(data.headcount) || "(none)"}</p>
      <p><strong>Interested in:</strong> ${esc(interested.join(", ")) || "(none)"}</p>
      <p><strong>Details:</strong><br/>${esc(details).replace(/\n/g, "<br/>")}</p>
    </div>`;

  try {
    const notify = await sendBrevoEmail({
      apiKey,
      sender: SENDER,
      to: [NOTIFY_TO],
      replyTo: { email, name },
      subject: `New catering request: ${name}${data.company ? " / " + data.company : ""}`,
      htmlContent: notifyHtml,
    });
    if (!notify.ok) {
      const t = await notify.text();
      return json({ ok: false, error: "Send failed.", detail: t }, 502);
    }

    await sendBrevoEmail({
      apiKey,
      sender: SENDER,
      to: [{ email, name }],
      subject: "Thanks for your catering inquiry — Brewhemia",
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
