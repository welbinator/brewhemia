// Shared Brevo transactional email helper.
// API key is read from env (Cloudflare secret) — never hardcoded.

interface BrevoContact {
  email: string;
  name?: string;
}

interface SendArgs {
  apiKey: string;
  sender: BrevoContact;
  to: BrevoContact[];
  subject: string;
  htmlContent: string;
  replyTo?: BrevoContact;
}

export async function sendBrevoEmail(args: SendArgs): Promise<Response> {
  return fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": args.apiKey,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: args.sender,
      to: args.to,
      subject: args.subject,
      htmlContent: args.htmlContent,
      ...(args.replyTo ? { replyTo: args.replyTo } : {}),
    }),
  });
}

export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const SENDER: BrevoContact = { name: "Brewhemia", email: "info@brewhemia.com" };
export const NOTIFY_TO: BrevoContact = { email: "james.welbes@gmail.com", name: "James Welbes" };

export const AUTOREPLY_HTML = (name: string) => `
  <div style="font-family:Arial,sans-serif;font-size:15px;color:#2b2b2b;line-height:1.6">
    <p>Hi ${esc(name) || "there"},</p>
    <p>Thanks for reaching out to Brewhemia — we've received your message and we'll be in touch soon.</p>
    <p>In the meantime, feel free to stop by:<br/>
    1202 3rd St SE, Cedar Rapids, IA 52401<br/>
    Tuesday–Sunday, 8am–2pm</p>
    <p>Warmly,<br/>The Brewhemia team</p>
  </div>
`;
