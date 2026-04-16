// api/admin/submit.js
// ─────────────────────────────────────────────────────────────────
//  Admin submit endpoint
// ─────────────────────────────────────────────────────────────────
//
//  Ontvangt een breach-object vanuit admin.html, valideert het en
//  maakt een GitHub Pull Request aan die breaches.js aanvult.
//
//  Flow:
//    1. Auth check (X-Admin-Password header)
//    2. Validatie van breach payload
//    3. GitHub API:
//       a. GET current data/breaches.js content (+ SHA)
//       b. Get main branch ref SHA
//       c. Create new branch "breach-{id}-{ts}"
//       d. PUT updated breaches.js on new branch
//       e. Create PR → main
//    4. Return PR URL → admin UI toont link
//
//  Benodigde env vars:
//    ADMIN_PASSWORD    — wachtwoord voor admin panel (zelf kiezen)
//    GITHUB_TOKEN      — Personal Access Token met 'repo' scope
//    GITHUB_REPO       — "Apolloccrypt/lekdezeweek"
//    GITHUB_BRANCH     — "main" (default)
//
// ─────────────────────────────────────────────────────────────────

const GH_API = "https://api.github.com";

const VALID_RISKS = new Set(["low", "medium", "high"]);
const MAX_STR = 500;
const MAX_ARRAY_ITEMS = 30;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── 1. Auth ───────────────────────────────────────────────
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    return res.status(500).json({ error: "ADMIN_PASSWORD niet geconfigureerd" });
  }
  const providedPw = req.headers["x-admin-password"];
  if (providedPw !== adminPassword) {
    return res.status(401).json({ error: "Onjuist wachtwoord" });
  }

  // ── 2. GitHub config check ────────────────────────────────
  const ghToken = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const baseBranch = process.env.GITHUB_BRANCH || "main";
  if (!ghToken || !repo) {
    return res.status(500).json({ error: "GITHUB_TOKEN of GITHUB_REPO ontbreekt" });
  }

  // ── 3. Parse + valideer payload ───────────────────────────
  let breach;
  try {
    breach = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: "Ongeldige JSON" });
  }

  const validation = validateBreach(breach);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }
  const clean = validation.breach;

  // ── 4. GitHub API interacties ─────────────────────────────
  try {
    // 4a. Huidige file content ophalen
    const fileRes = await ghFetch(
      `${GH_API}/repos/${repo}/contents/data/breaches.js?ref=${baseBranch}`,
      { token: ghToken }
    );
    if (!fileRes.ok) {
      return res.status(500).json({
        error: `Kan breaches.js niet ophalen: ${fileRes.status}`,
      });
    }
    const fileData = await fileRes.json();
    const currentContent = base64ToUtf8(fileData.content);
    const fileSha = fileData.sha;

    // 4b. Main branch SHA ophalen
    const refRes = await ghFetch(
      `${GH_API}/repos/${repo}/git/refs/heads/${baseBranch}`,
      { token: ghToken }
    );
    if (!refRes.ok) {
      return res.status(500).json({
        error: `Kan ${baseBranch}-branch niet ophalen`,
      });
    }
    const refData = await refRes.json();
    const baseSha = refData.object.sha;

    // 4c. Nieuwe branch aanmaken
    const branchName = `breach-${clean.id}-${Date.now()}`;
    const createBranchRes = await ghFetch(
      `${GH_API}/repos/${repo}/git/refs`,
      {
        token: ghToken,
        method: "POST",
        body: {
          ref: `refs/heads/${branchName}`,
          sha: baseSha,
        },
      }
    );
    if (!createBranchRes.ok) {
      const errData = await createBranchRes.json().catch(() => ({}));
      return res.status(500).json({
        error: `Branch aanmaken gefaald: ${errData.message || createBranchRes.status}`,
      });
    }

    // 4d. File updaten op nieuwe branch
    const newContent = insertBreachIntoFile(currentContent, clean);
    const updateRes = await ghFetch(
      `${GH_API}/repos/${repo}/contents/data/breaches.js`,
      {
        token: ghToken,
        method: "PUT",
        body: {
          message: `Add breach: ${clean.serviceName} · ${clean.date}`,
          content: utf8ToBase64(newContent),
          sha: fileSha,
          branch: branchName,
        },
      }
    );
    if (!updateRes.ok) {
      const errData = await updateRes.json().catch(() => ({}));
      return res.status(500).json({
        error: `File update gefaald: ${errData.message || updateRes.status}`,
      });
    }

    // 4e. PR aanmaken
    const prBody = buildPrBody(clean);
    const prRes = await ghFetch(
      `${GH_API}/repos/${repo}/pulls`,
      {
        token: ghToken,
        method: "POST",
        body: {
          title: `🔔 ${clean.serviceName} · ${clean.date}`,
          head: branchName,
          base: baseBranch,
          body: prBody,
        },
      }
    );
    if (!prRes.ok) {
      const errData = await prRes.json().catch(() => ({}));
      return res.status(500).json({
        error: `PR aanmaken gefaald: ${errData.message || prRes.status}`,
      });
    }
    const pr = await prRes.json();

    return res.status(200).json({
      ok: true,
      prUrl: pr.html_url,
      prNumber: pr.number,
      branch: branchName,
    });
  } catch (err) {
    console.error("Admin submit error:", err?.message || "unknown");
    return res.status(500).json({
      error: "Interne fout: " + (err?.message || "unknown"),
    });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

async function ghFetch(url, { token, method = "GET", body = null }) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "LekDezeWeek-Admin",
    },
  };
  if (body) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  return fetch(url, opts);
}

function base64ToUtf8(b64) {
  return Buffer.from(b64, "base64").toString("utf-8");
}
function utf8ToBase64(str) {
  return Buffer.from(str, "utf-8").toString("base64");
}

function validateBreach(b) {
  if (!b || typeof b !== "object") return { ok: false, error: "Geen object" };

  const requiredStr = ["id", "service", "serviceName", "date", "action", "source"];
  for (const k of requiredStr) {
    if (typeof b[k] !== "string" || !b[k].trim()) {
      return { ok: false, error: `Veld ontbreekt of leeg: ${k}` };
    }
    if (b[k].length > MAX_STR) {
      return { ok: false, error: `Veld te lang: ${k}` };
    }
  }
  if (!/^[a-z0-9_-]+$/i.test(b.service)) {
    return { ok: false, error: "service ID mag alleen letters/cijfers/_- bevatten" };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date)) {
    return { ok: false, error: "datum moet YYYY-MM-DD zijn" };
  }
  if (!Array.isArray(b.dataLeaked) || b.dataLeaked.length === 0) {
    return { ok: false, error: "dataLeaked moet een niet-lege array zijn" };
  }
  if (b.dataLeaked.length > MAX_ARRAY_ITEMS) {
    return { ok: false, error: "Te veel data-items" };
  }
  for (const d of b.dataLeaked) {
    if (typeof d !== "string" || d.length > 100) {
      return { ok: false, error: "Ongeldig data-item" };
    }
  }
  if (!VALID_RISKS.has(b.risk)) {
    return { ok: false, error: "risk moet low/medium/high zijn" };
  }
  if (typeof b.confirmed !== "boolean") {
    return { ok: false, error: "confirmed moet boolean zijn" };
  }
  if (b.sourceUrl && (typeof b.sourceUrl !== "string" || b.sourceUrl.length > MAX_STR)) {
    return { ok: false, error: "Ongeldige sourceUrl" };
  }

  // Sanitize / normalize
  const clean = {
    id: b.id.trim(),
    service: b.service.trim().toLowerCase(),
    serviceName: b.serviceName.trim(),
    date: b.date,
    dataLeaked: b.dataLeaked.map((d) => d.trim()).filter(Boolean),
    risk: b.risk,
    confirmed: b.confirmed,
    action: b.action.trim(),
    source: b.source.trim(),
  };
  if (b.sourceUrl) clean.sourceUrl = b.sourceUrl.trim();

  return { ok: true, breach: clean };
}

function formatBreachEntry(b) {
  const quote = (s) => JSON.stringify(s);
  const dataLeakedStr = "[" + b.dataLeaked.map(quote).join(", ") + "]";
  let entry = `  {
    id: ${quote(b.id)},
    service: ${quote(b.service)},
    serviceName: ${quote(b.serviceName)},
    date: ${quote(b.date)},
    dataLeaked: ${dataLeakedStr},
    risk: ${quote(b.risk)},
    confirmed: ${b.confirmed},
    action: ${quote(b.action)},
    source: ${quote(b.source)},`;
  if (b.sourceUrl) {
    entry += `\n    sourceUrl: ${quote(b.sourceUrl)},`;
  }
  entry += `\n  },`;
  return entry;
}

function insertBreachIntoFile(content, breach) {
  const entry = formatBreachEntry(breach);

  // Zoek de BREACHES array-opener. Vervang door opener + nieuwe entry direct eronder.
  // Werkt voor zowel lege array als bestaande entries.
  const markerRegex = /export const BREACHES = \[\s*(\r?\n)?/;
  const match = content.match(markerRegex);
  if (!match) {
    throw new Error("Kon BREACHES array-marker niet vinden in breaches.js");
  }

  const replaced = content.replace(
    markerRegex,
    `export const BREACHES = [\n${entry}\n`
  );

  return replaced;
}

function buildPrBody(b) {
  return `Auto-generated via admin panel.

**Service:** ${b.serviceName} (\`${b.service}\`)
**Datum:** ${b.date}
**Risico:** ${b.risk}
**Bevestigd:** ${b.confirmed ? "ja" : "nee"}
**Bron:** ${b.source}${b.sourceUrl ? ` — [link](${b.sourceUrl})` : ""}

**Gelekte data:**
${b.dataLeaked.map((d) => `- ${d}`).join("\n")}

**Actie-advies:**
> ${b.action}

---

\`\`\`json
${JSON.stringify(b, null, 2)}
\`\`\`

_Review + merge om deze breach live te zetten. Donderdag-digest pakt hem automatisch op._`;
}
