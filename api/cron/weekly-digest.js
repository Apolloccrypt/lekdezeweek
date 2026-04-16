// api/cron/weekly-digest.js
// ─────────────────────────────────────────────────────────────────
//  WEKELIJKSE DIGEST CRON
// ─────────────────────────────────────────────────────────────────
//
//  Draait elke donderdag 07:00 UTC (= 09:00 NL in zomer, 08:00 winter)
//  via Vercel Cron (schedule staat in vercel.json).
//
//  Wat hij doet:
//    1. Leest data/breaches.js
//    2. Filtert lekken van afgelopen 7 dagen
//    3. Loopt alle gebruikers in Redis door
//    4. Stuurt gepersonaliseerde mail via Resend
//
//  Beveiliging:
//    Vercel Cron stuurt automatisch een `Authorization: Bearer <CRON_SECRET>`
//    header mee. We checken die. Zonder geldige header: 401.
//
//  Handmatig testen:
//    GET /api/cron/weekly-digest?test=1&email=jouw@email.nl
//    Met `Authorization: Bearer <CRON_SECRET>` header.
//    Stuurt dan alleen naar dat ene e-mailadres, niet naar alle users.
//
// ─────────────────────────────────────────────────────────────────

import { Redis } from "@upstash/redis";
import { Resend } from "resend";
import { BREACHES, SERVICE_NAMES } from "../../data/breaches.js";
import { fetchRecentHibpBreaches } from "../../lib/hibp.js";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});
const resend = new Resend(process.env.RESEND_API_KEY);

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  // ── 1. Auth check ─────────────────────────────────────────────
  const authHeader = req.headers.authorization || "";
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // ── 2. Parse test-mode ────────────────────────────────────────
  const isTest = req.query?.test === "1";
  const testEmail = req.query?.email?.toLowerCase();

  try {
    // ── 3. Verzamel lekken: HIBP automatisch + handmatige NL-curatie ──
    const now = Date.now();

    // 3a. Handmatige lekken (NL-specifiek) — laatste 7 dagen
    const manualBreaches = BREACHES.filter((b) => {
      const breachTime = new Date(b.date).getTime();
      return !isNaN(breachTime) && now - breachTime <= SEVEN_DAYS_MS;
    });

    // 3b. HIBP globale feed (automatisch, filter zit al in fetcher)
    const hibpBreaches = await fetchRecentHibpBreaches();

    // 3c. Combineer + dedupe (handmatig wint bij overlap, want jij
    //     hebt waarschijnlijk meer detail / betere actie-advies)
    const byKey = new Map();
    for (const b of hibpBreaches) byKey.set(`${b.service}|${b.date}`, b);
    for (const b of manualBreaches) byKey.set(`${b.service}|${b.date}`, b);
    const recentBreaches = Array.from(byKey.values());

    if (recentBreaches.length === 0 && !isTest) {
      // Geen lekken deze week → geen mails sturen (geen spam)
      return res.status(200).json({
        ok: true,
        sent: 0,
        sources: { manual: manualBreaches.length, hibp: hibpBreaches.length },
        message: "No recent breaches this week — no digest sent.",
      });
    }

    // ── 4. Haal users op uit Redis ──────────────────────────────
    let userKeys = [];
    if (isTest && testEmail) {
      userKeys = [`user:${testEmail}`];
    } else {
      userKeys = await scanAllUserKeys(redis);
    }

    // ── 5. Loop users en stuur mails ────────────────────────────
    const results = { sent: 0, skipped: 0, failed: 0, errors: [] };

    for (const key of userKeys) {
      try {
        const user = await redis.get(key);
        if (!user || !user.email) {
          results.skipped++;
          continue;
        }

        const weekNum = getISOWeek(new Date());
        const dateStr = formatDutchDate(new Date());

        // Splits lekken in "jij bent geraakt" en "overige lekken"
        const affected = recentBreaches.filter((b) =>
          user.selected.includes(b.service)
        );
        const others = recentBreaches.filter(
          (b) => !user.selected.includes(b.service)
        );

        const siteUrl = process.env.SITE_URL || "https://lekdezeweek.nl";
        const unsubUrl = `${siteUrl}/api/unsubscribe?token=${user.unsubscribeToken}`;

        const subject = buildSubject(affected.length, recentBreaches.length);
        const html = digestHtml({
          affected,
          others,
          dateStr,
          weekNum,
          unsubUrl,
          siteUrl,
          totalServices: user.selected.length,
        });
        const text = digestText({ affected, others, dateStr, weekNum, unsubUrl });

        await resend.emails.send({
          from: process.env.FROM_EMAIL || "LekDezeWeek <onboarding@resend.dev>",
          to: user.email,
          subject,
          html,
          text,
        });

        results.sent++;

        // Throttle: Resend free tier = 2 req/sec. Veilig: 500ms tussen mails.
        if (!isTest) await sleep(500);
      } catch (err) {
        results.failed++;
        results.errors.push(err?.message || "unknown");
      }
    }

    return res.status(200).json({
      ok: true,
      test: isTest,
      breachesThisWeek: recentBreaches.length,
      sources: { manual: manualBreaches.length, hibp: hibpBreaches.length },
      usersProcessed: userKeys.length,
      ...results,
    });
  } catch (err) {
    console.error("Cron error:", err?.message || "unknown");
    return res.status(500).json({ error: "Cron execution failed" });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

async function scanAllUserKeys(redis) {
  const keys = [];
  let cursor = "0";
  do {
    const result = await redis.scan(cursor, { match: "user:*", count: 100 });
    // Upstash SDK returnt [cursor, keys]
    const [nextCursor, batchKeys] = Array.isArray(result)
      ? result
      : [result.cursor, result.keys];
    cursor = String(nextCursor);
    if (Array.isArray(batchKeys)) keys.push(...batchKeys);
  } while (cursor !== "0");
  return keys;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

function formatDutchDate(date) {
  const months = [
    "januari", "februari", "maart", "april", "mei", "juni",
    "juli", "augustus", "september", "oktober", "november", "december",
  ];
  const days = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
  return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function buildSubject(affectedCount, totalCount) {
  if (totalCount === 0) return "Deze week geen nieuwe lekken — je radar staat scherp";
  if (affectedCount === 0)
    return `${totalCount} ${totalCount === 1 ? "lek" : "lekken"} deze week — jij bent niet geraakt ✓`;
  if (affectedCount === 1)
    return `⚠️ Deze week geraakt bij 1 van je diensten`;
  return `⚠️ Deze week geraakt bij ${affectedCount} van je diensten`;
}

// ─── E-mail templates ────────────────────────────────────────────

function riskLabel(risk, confirmed) {
  if (risk === "high") return { text: "HOOG RISICO", color: "#c8321e" };
  if (risk === "medium") return { text: "MIDDEL RISICO", color: "#b07a00" };
  if (risk === "low") return { text: "LAAG RISICO", color: "#2d6a4f" };
  if (!confirmed || risk === "unconfirmed")
    return { text: "ONBEVESTIGD", color: "#8b8578" };
  return { text: "ONBEKEND", color: "#8b8578" };
}

function digestHtml({ affected, others, dateStr, weekNum, unsubUrl, siteUrl, totalServices }) {
  const total = affected.length + others.length;

  const intro = affected.length === 0
    ? `Goed nieuws: van de <strong>${total}</strong> ${total === 1 ? "lek" : "lekken"} deze week ben jij bij <strong style="color:#2d6a4f">geen enkel</strong> geraakt.`
    : `Deze week zijn er <strong>${total}</strong> nieuwe lekken. Jij bent geraakt bij <strong style="color:#c8321e">${affected.length}</strong>.`;

  const affectedHtml = affected
    .map((b) => {
      const label = riskLabel(b.risk, b.confirmed);
      return `
      <div style="padding:20px 0;border-top:1px solid #1a1814;">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:12px;margin-bottom:8px;">
          <div>
            <div style="font-family:monospace;font-size:11px;color:#8b8578;letter-spacing:0.08em;margin-bottom:4px;">${b.date}</div>
            <div style="font-size:18px;font-weight:600;color:#1a1814;">${b.serviceName}</div>
          </div>
          <div style="font-family:monospace;font-size:10px;padding:4px 8px;border:1px solid ${label.color};color:${label.color};letter-spacing:0.08em;white-space:nowrap;">${label.text}</div>
        </div>
        <div style="font-size:14px;color:#4a453c;margin-bottom:10px;">
          <strong>Gelekt:</strong> ${b.dataLeaked.join(", ")}
        </div>
        <div style="font-size:14px;color:#c8321e;font-weight:500;margin-bottom:6px;">
          → ${b.action}
        </div>
        ${b.source ? `<div style="font-size:12px;color:#8b8578;font-family:monospace;">Bron: ${b.sourceUrl ? `<a href="${b.sourceUrl}" style="color:#8b8578;">${b.source}</a>` : b.source}</div>` : ""}
      </div>`;
    })
    .join("");

  const othersHtml = others.length === 0
    ? ""
    : `
    <div style="margin-top:32px;padding-top:20px;border-top:1px dashed #d9d3c4;">
      <div style="font-family:monospace;font-size:11px;color:#8b8578;letter-spacing:0.15em;text-transform:uppercase;margin-bottom:12px;">
        Overige lekken deze week · jij niet geraakt
      </div>
      ${others
        .map((b) => {
          const label = riskLabel(b.risk, b.confirmed);
          return `
          <div style="padding:10px 0;font-size:14px;color:#4a453c;display:flex;justify-content:space-between;gap:12px;align-items:center;">
            <span><span style="font-family:monospace;font-size:11px;color:#8b8578;">${b.date}</span> &nbsp; ${b.serviceName}</span>
            <span style="font-family:monospace;font-size:10px;padding:3px 7px;border:1px solid ${label.color};color:${label.color};letter-spacing:0.08em;">${label.text}</span>
          </div>`;
        })
        .join("")}
    </div>`;

  return `<!DOCTYPE html>
<html lang="nl">
<head><meta charset="utf-8"><title>LekDezeWeek</title></head>
<body style="margin:0;padding:0;background:#f4f1ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1814;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #d9d3c4;">
        <tr><td style="padding:28px 36px 20px 36px;border-bottom:1px solid #d9d3c4;">
          <div style="font-size:12px;letter-spacing:0.15em;text-transform:uppercase;color:#8b8578;font-family:monospace;">
            ● LEKDEZEWEEK.NL · week ${weekNum}
          </div>
          <div style="font-size:12px;color:#8b8578;font-family:monospace;margin-top:4px;">${dateStr}</div>
        </td></tr>
        <tr><td style="padding:36px;">
          <h1 style="font-size:24px;line-height:1.2;margin:0 0 12px 0;font-weight:500;letter-spacing:-0.02em;">
            ${affected.length === 0 ? "Jij bent veilig deze week." : "Actie vereist."}
          </h1>
          <p style="font-size:16px;line-height:1.55;color:#4a453c;margin:0 0 24px 0;">${intro}</p>

          ${affected.length > 0 ? `
          <div style="margin-top:24px;">
            <div style="font-family:monospace;font-size:11px;color:#c8321e;letter-spacing:0.15em;text-transform:uppercase;margin-bottom:4px;">
              Jij bent geraakt
            </div>
            ${affectedHtml}
          </div>` : ""}

          ${othersHtml}

          <div style="margin-top:36px;padding:20px;background:#ece7dc;border-left:3px solid #c8321e;">
            <p style="margin:0 0 10px 0;font-size:14px;color:#4a453c;line-height:1.5;">
              <strong>Schadeclaim nodig?</strong> Bij bevestigde datalekken heb je recht op
              schadevergoeding onder <strong>artikel 82 AVG</strong>. Wij kunnen je helpen
              met een voorbeeldbrief — antwoord op deze e-mail.
            </p>
          </div>

          <p style="font-size:13px;color:#8b8578;margin:28px 0 0 0;">
            Je monitort nu <strong>${totalServices} diensten</strong>.
            Lijst aanpassen? <a href="${siteUrl}" style="color:#4a453c;">Log opnieuw in op ${siteUrl.replace("https://", "")}</a>.
          </p>
        </td></tr>
        <tr><td style="padding:20px 36px;background:#f4f1ea;border-top:1px solid #d9d3c4;">
          <p style="margin:0;font-size:12px;color:#8b8578;line-height:1.5;font-family:monospace;">
            <a href="${unsubUrl}" style="color:#c8321e;">Uitschrijven in één klik →</a> · Check Don't Store
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function digestText({ affected, others, dateStr, weekNum, unsubUrl }) {
  const total = affected.length + others.length;
  let txt = `LekDezeWeek · week ${weekNum} · ${dateStr}\n\n`;

  if (affected.length === 0) {
    txt += `Goed nieuws: ${total} ${total === 1 ? "lek" : "lekken"} deze week, jij bent bij geen enkel geraakt.\n\n`;
  } else {
    txt += `Deze week: ${total} nieuwe lekken. Jij bent geraakt bij ${affected.length}.\n\n`;
    txt += `━━━ JIJ BENT GERAAKT ━━━\n\n`;
    for (const b of affected) {
      txt += `[${b.date}] ${b.serviceName}\n`;
      txt += `  Gelekt: ${b.dataLeaked.join(", ")}\n`;
      txt += `  → ${b.action}\n`;
      if (b.source) txt += `  Bron: ${b.source}${b.sourceUrl ? ` (${b.sourceUrl})` : ""}\n`;
      txt += `\n`;
    }
  }

  if (others.length > 0) {
    txt += `━━━ OVERIGE LEKKEN (jij niet geraakt) ━━━\n\n`;
    for (const b of others) {
      txt += `  [${b.date}] ${b.serviceName}\n`;
    }
    txt += `\n`;
  }

  txt += `Uitschrijven: ${unsubUrl}\n`;
  txt += `— LekDezeWeek · Check Don't Store\n`;
  return txt;
}
