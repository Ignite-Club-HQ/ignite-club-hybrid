export interface WelcomeEmailValues {
  teamName: string;
  clubName: string;
  competitionName: string;
  recipientName: string;
}

function interpolate(value: string, values: WelcomeEmailValues): string {
  return value.replace(/\{\{(teamName|clubName|competitionName|recipientName)\}\}/g, (_, key: keyof WelcomeEmailValues) => values[key] ?? "");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

export function buildWelcomeEmail(template: { subject: string; message: string }, values: WelcomeEmailValues) {
  const subject = interpolate(template.subject, values).slice(0, 160);
  const message = interpolate(template.message, values).slice(0, 4000);
  const fallback = `You are now part of ${values.teamName || values.competitionName}.`;
  const greeting = `Welcome, ${values.recipientName}!`;
  const body = message || fallback;
  const text = [greeting, body, values.clubName].filter(Boolean).join("\n\n");
  const html = `<p>${escapeHtml(greeting)}</p><p>${escapeHtml(body).replace(/\n/g, "<br>")}</p><p>${escapeHtml(values.clubName)}</p>`;
  return { subject, text, html };
}

// The idempotency key makes a retried request a no-op at the provider.
export async function sendWithResend(
  apiKey: string,
  message: { from: string; to: string; subject: string; text: string; html: string; idempotencyKey: string },
): Promise<string | null> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": message.idempotencyKey,
    },
    body: JSON.stringify({
      from: message.from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Email provider returned HTTP ${response.status}`);
  return typeof result.id === "string" ? result.id : null;
}
