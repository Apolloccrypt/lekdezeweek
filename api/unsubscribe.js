// api/unsubscribe.js
// GET /api/unsubscribe?token=xxx → e-mail wordt permanent gewist uit Redis.
// Return: nette HTML-pagina (geen JSON, want dit endpoint wordt vanuit e-mail aangeklikt).

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export default async function handler(req, res) {
  const token = String(req.query?.token || "").trim();

  res.setHeader("Content-Type", "text/html; charset=utf-8");

  if (!token || !/^[a-f0-9]{40,}$/i.test(token)) {
    return res.status(400).send(page({
      title: "Ongeldige link",
      body: "Deze uitschrijflink is niet geldig. Mogelijk is hij verlopen of al eerder gebruikt.",
      tone: "error",
    }));
  }

  try {
    const email = await redis.get(`token:${token}`);

    if (!email) {
      return res.status(200).send(page({
        title: "Al uitgeschreven",
        body: "Je bent al uit onze database verwijderd. Je ontvangt geen e-mails meer van LekDezeWeek.",
        tone: "ok",
      }));
    }

    // Harde delete: zowel user-record als token
    await redis.del(`user:${email}`);
    await redis.del(`token:${token}`);

    return res.status(200).send(page({
      title: "Uitgeschreven.",
      body: "Je e-mailadres en al je selecties zijn permanent gewist. Geen kopie, geen archief, geen spoor. Zo hoort het.",
      tone: "ok",
    }));
  } catch (err) {
    console.error("Unsubscribe error:", err?.message || "unknown");
    return res.status(500).send(page({
      title: "Er ging iets mis",
      body: "Kon je niet uitschrijven door een technische fout. Probeer de link opnieuw of mail ons.",
      tone: "error",
    }));
  }
}

function page({ title, body, tone }) {
  const accent = tone === "ok" ? "#2d6a4f" : "#c8321e";
  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title} · LekDezeWeek</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500&family=IBM+Plex+Sans:wght@400;500&display=swap" rel="stylesheet">
  <style>
    body { margin:0; background:#f4f1ea; color:#1a1814; font-family:"IBM Plex Sans",system-ui,sans-serif; display:flex; min-height:100vh; align-items:center; justify-content:center; padding:24px; }
    .card { max-width:520px; background:#fff; border:1px solid #d9d3c4; padding:48px 40px; text-align:left; }
    .eyebrow { font-family:monospace; font-size:11px; letter-spacing:0.18em; text-transform:uppercase; color:${accent}; margin-bottom:20px; }
    h1 { font-family:"Fraunces",Georgia,serif; font-weight:500; font-size:36px; line-height:1.1; letter-spacing:-0.02em; margin:0 0 20px 0; }
    p { font-size:17px; line-height:1.55; color:#4a453c; margin:0 0 28px 0; }
    a.btn { display:inline-block; padding:14px 22px; background:#1a1814; color:#f4f1ea; text-decoration:none; font-size:14px; font-weight:600; }
    a.btn:hover { background:${accent}; }
    .footer { margin-top:36px; font-size:12px; color:#8b8578; font-family:monospace; }
  </style>
</head>
<body>
  <div class="card">
    <div class="eyebrow">● LekDezeWeek.nl</div>
    <h1>${title}</h1>
    <p>${body}</p>
    <a href="/" class="btn">Terug naar de site →</a>
    <div class="footer">Check Don't Store · Privacy by design</div>
  </div>
</body>
</html>`;
}
