// api/signup.js
// POST { email, selected: ["basicfit", "ing", ...] } → opslaan + welkomstmail
//
// Privacy by design:
//   - E-mail wordt in plaintext opgeslagen (nodig om mail te versturen)
//     maar verder: geen tracking, geen logs van e-mails, één-klik uitschrijven.
//   - Unsubscribe-token is cryptografisch random (24 bytes hex).
//
// Benodigde env vars (Vercel zet Upstash automatisch, Resend + SITE_URL zelf):
//   KV_REST_API_URL       ← auto via Upstash Marketplace integration
//   KV_REST_API_TOKEN     ← auto via Upstash Marketplace integration
//   RESEND_API_KEY        ← zelf toevoegen
//   FROM_EMAIL            ← bv. "LekDezeWeek <radar@lekdezeweek.nl>" (of Resend test-adres)
//   SITE_URL              ← bv. "https://lekdezeweek.nl"

import { Redis } from "@upstash/redis";
import { Resend } from "resend";
import crypto from "node:crypto";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});
const resend = new Resend(process.env.RESEND_API_KEY);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_SERVICES = 60;

export default async function handler(req, res) {
  // CORS safety (als je ooit vanaf een ander domein POSTs: prima, eigen site only voor nu)
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const email = String(body?.email || "").trim().toLowerCase();
    const selected = Array.isArray(body?.selected) ? body.selected : [];

    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "Ongeldig e-mailadres." });
    }
    if (selected.length === 0) {
      return res.status(400).json({ error: "Selecteer minstens één dienst." });
    }
    if (selected.length > MAX_SERVICES) {
      return res.status(400).json({ error: "Te veel diensten geselecteerd." });
    }

    // Sanitize: alleen strings, alleen letters/cijfers/underscore, max 40 tekens
    const cleanSelected = [
      ...new Set(
        selected
          .filter((s) => typeof s === "string")
          .map((s) => s.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 40))
          .filter(Boolean)
      ),
    ];

    const userKey = `user:${email}`;
    const existing = await redis.get(userKey);

    const unsubscribeToken =
      existing?.unsubscribeToken || crypto.randomBytes(24).toString("hex");

    const user = {
      email,
      selected: cleanSelected,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      unsubscribeToken,
    };

    // Opslaan: user-record + reverse-lookup voor unsubscribe
    await redis.set(userKey, user);
    await redis.set(`token:${unsubscribeToken}`, email);

    // Welkomstmail (best-effort: als dit faalt is user wel geregistreerd)
    const siteUrl = process.env.SITE_URL || "https://lekdezeweek.nl";
    const from = process.env.FROM_EMAIL || "LekDezeWeek <onboarding@resend.dev>";
    const unsubUrl = `${siteUrl}/api/unsubscribe?token=${unsubscribeToken}`;

    try {
      await resend.emails.send({
        from,
        to: email,
        subject: "Je radar staat aan — eerste alert komt donderdag",
        html: welcomeEmail({
          count: cleanSelected.length,
          isNew: !existing,
          unsubUrl,
          siteUrl,
        }),
        text: welcomeText({
          count: cleanSelected.length,
          isNew: !existing,
          unsubUrl,
        }),
      });
    } catch (mailErr) {
      // Log zonder e-mail te lekken in logs
      console.error("Resend error:", mailErr?.message || "unknown");
      // Niet falen — inschrijving is ok, mail komt later wel via weekly digest
    }

    return res.status(200).json({
      ok: true,
      count: cleanSelected.length,
      returning: !!existing,
    });
  } catch (err) {
    console.error("Signup error:", err?.message || "unknown");
    return res.status(500).json({ error: "Er ging iets mis. Probeer later opnieuw." });
  }
}

// ─────────────────────────────────────────────────────────
//  E-mail templates (inline — geen build step nodig)
// ─────────────────────────────────────────────────────────

function welcomeEmail({ count, isNew, unsubUrl, siteUrl }) {
  const greeting = isNew
    ? "Welkom bij LekDezeWeek."
    : "Je selectie is bijgewerkt.";

  return `<!DOCTYPE html>
<html lang="nl">
<head><meta charset="utf-8"><title>LekDezeWeek</title></head>
<body style="margin:0;padding:0;background:#f4f1ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1814;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #d9d3c4;">
        <tr><td style="padding:32px 36px 24px 36px;border-bottom:1px solid #d9d3c4;">
          <div style="font-size:12px;letter-spacing:0.15em;text-transform:uppercase;color:#8b8578;font-family:monospace;">
            ● LEKDEZEWEEK.NL
          </div>
        </td></tr>
        <tr><td style="padding:36px;">
          <h1 style="font-size:28px;line-height:1.15;margin:0 0 16px 0;font-weight:500;letter-spacing:-0.02em;">
            ${greeting}
          </h1>
          <p style="font-size:16px;line-height:1.55;color:#4a453c;margin:0 0 20px 0;">
            We monitoren nu <strong style="color:#1a1814">${count} ${count === 1 ? "dienst" : "diensten"}</strong>
            voor jou. Elke <strong>donderdag</strong> ontvang je één e-mail:
          </p>
          <ul style="font-size:15px;line-height:1.7;color:#4a453c;padding-left:20px;margin:0 0 28px 0;">
            <li>Welke NL-lekken deze week nieuw zijn</li>
            <li>Of jij geraakt bent (jouw diensten vs. de lek)</li>
            <li>Exact welke data gelekt is</li>
            <li>Wat je <em>nu</em> moet doen</li>
          </ul>
          <p style="font-size:15px;line-height:1.55;color:#4a453c;margin:0 0 28px 0;">
            Geen spam. Geen tracking pixels. Eén klik om je uit te schrijven —
            dan wordt je e-mail direct gewist.
          </p>
          <div style="padding:20px;background:#ece7dc;border-left:3px solid #c8321e;margin:0 0 28px 0;">
            <p style="margin:0;font-size:14px;color:#4a453c;line-height:1.5;">
              <strong>Waarom dit bestaat:</strong> Have I Been Pwned pikt Nederlandse lekken
              (Basic-Fit, ChipSoft, Booking.com) vaak weken te laat op. Wij crawlen Z-CERT,
              Tweakers en NOS wekelijks.
            </p>
          </div>
          <p style="font-size:13px;color:#8b8578;margin:0;">
            Initiatief van <a href="${siteUrl}" style="color:#4a453c;">Check Don't Store</a> ·
            Privacy by design.
          </p>
        </td></tr>
        <tr><td style="padding:20px 36px;background:#f4f1ea;border-top:1px solid #d9d3c4;">
          <p style="margin:0;font-size:12px;color:#8b8578;line-height:1.5;font-family:monospace;">
            Geen interesse? <a href="${unsubUrl}" style="color:#c8321e;">Uitschrijven in één klik →</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function welcomeText({ count, isNew, unsubUrl }) {
  return `${isNew ? "Welkom bij LekDezeWeek." : "Je selectie is bijgewerkt."}

We monitoren nu ${count} ${count === 1 ? "dienst" : "diensten"} voor jou.
Elke donderdag ontvang je één e-mail met:
  → Welke NL-lekken deze week nieuw zijn
  → Of jij geraakt bent
  → Exact welke data gelekt is
  → Wat je nu moet doen

Geen spam. Geen tracking. Uitschrijven in één klik:
${unsubUrl}

— LekDezeWeek · Check Don't Store`;
}
