// lib/hibp.js
// ─────────────────────────────────────────────────────────────────
//  HIBP Breach fetcher
// ─────────────────────────────────────────────────────────────────
//
//  Haalt de publieke HIBP breaches-lijst op en filtert op lekken die
//  in de afgelopen 7 dagen zijn toegevoegd (AddedDate).
//
//  - Geen API key nodig (public endpoint)
//  - User-Agent header is verplicht (HIBP regel)
//  - Zonder matching service-ID wordt lek overgeslagen (alleen noise)
//  - Fetch-fout betekent: lege lijst terug, cron crasht niet
//
//  Gratis en wereldwijd — vult de handmatige NL-lekken aan.
//
// ─────────────────────────────────────────────────────────────────

import { HIBP_TO_SERVICE } from "../data/hibp-mapping.js";
import { SERVICE_NAMES } from "../data/breaches.js";

const HIBP_API = "https://haveibeenpwned.com/api/v3/breaches";
const USER_AGENT = "LekDezeWeek/1.0 (weekly Dutch breach digest)";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

// Data-class vertaling (Engels → Nederlands)
const DATA_CLASS_NL = {
  "Email addresses": "e-mailadressen",
  "Passwords": "wachtwoorden",
  "Usernames": "gebruikersnamen",
  "Names": "namen",
  "Phone numbers": "telefoonnummers",
  "IP addresses": "IP-adressen",
  "Dates of birth": "geboortedata",
  "Physical addresses": "adressen",
  "Credit cards": "creditcardgegevens",
  "Partial credit card data": "creditcardgegevens (deels)",
  "Bank account numbers": "bankrekeningnummers",
  "Genders": "geslacht",
  "Geographic locations": "locaties",
  "Job titles": "functies",
  "Employers": "werkgevers",
  "Private messages": "privéberichten",
  "Browser user agent details": "browserinformatie",
  "Purchases": "aankopen",
  "Biometric data": "biometrische gegevens",
  "Government issued IDs": "overheidsdocumenten",
  "Social security numbers": "BSN/SSN-nummers",
  "Website activity": "website-activiteit",
  "Security questions and answers": "beveiligingsvragen",
  "Historical passwords": "oude wachtwoorden",
  "Password hints": "wachtwoordhints",
  "Device information": "apparaatinformatie",
  "Auth tokens": "auth-tokens",
  "Spoken languages": "talen",
};

// Data-klassen die "hoog risico" impliceren
const HIGH_RISK_CLASSES = new Set([
  "Passwords",
  "Credit cards",
  "Partial credit card data",
  "Bank account numbers",
  "Social security numbers",
  "Government issued IDs",
  "Biometric data",
  "Auth tokens",
  "Security questions and answers",
]);

function translateDataClass(cls) {
  return DATA_CLASS_NL[cls] || cls.toLowerCase();
}

function deriveRisk(dataClasses) {
  const hasHigh = dataClasses.some((c) => HIGH_RISK_CLASSES.has(c));
  if (hasHigh) return "high";
  if (dataClasses.length >= 4) return "medium";
  return "low";
}

function deriveAction(dataClasses) {
  const actions = [];
  const cs = new Set(dataClasses);

  if (cs.has("Passwords") || cs.has("Historical passwords")) {
    actions.push("Verander je wachtwoord (ook waar je het hergebruikt)");
  }
  if (cs.has("Credit cards") || cs.has("Partial credit card data") || cs.has("Bank account numbers")) {
    actions.push("check je bankafschriften op onbekende transacties");
  }
  if (
    cs.has("Dates of birth") ||
    cs.has("Physical addresses") ||
    cs.has("Phone numbers") ||
    cs.has("Social security numbers") ||
    cs.has("Government issued IDs")
  ) {
    actions.push("wees alert op phishing met deze persoonsgegevens");
  }
  if (cs.has("Auth tokens") || cs.has("Security questions and answers")) {
    actions.push("zet 2FA aan waar mogelijk");
  }
  if (actions.length === 0) {
    actions.push("Zet 2FA aan waar mogelijk en gebruik unieke wachtwoorden");
  }
  return actions.join(" · ");
}

function mapHibpToService(breach) {
  const domain = (breach.Domain || "").toLowerCase();
  const name = (breach.Name || "").toLowerCase();
  if (HIBP_TO_SERVICE[domain]) return HIBP_TO_SERVICE[domain];
  if (HIBP_TO_SERVICE[name]) return HIBP_TO_SERVICE[name];
  return null;
}

/**
 * Haalt HIBP breaches op die in de afgelopen 7 dagen zijn toegevoegd
 * én matchen met onze monitored services.
 * @returns {Promise<Array>} Breach objecten in ons eigen format
 */
export async function fetchRecentHibpBreaches() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(HIBP_API, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`[HIBP] fetch failed: HTTP ${res.status}`);
      return [];
    }

    const allBreaches = await res.json();
    if (!Array.isArray(allBreaches)) {
      console.warn("[HIBP] unexpected response shape");
      return [];
    }

    const now = Date.now();
    const recent = [];

    for (const b of allBreaches) {
      // Filter: alleen toegevoegd in laatste 7 dagen
      const addedTime = new Date(b.AddedDate).getTime();
      if (isNaN(addedTime)) continue;
      if (now - addedTime > SEVEN_DAYS_MS) continue;

      // Filter: alleen als wij deze dienst monitoren
      const service = mapHibpToService(b);
      if (!service) continue;

      const dataClasses = Array.isArray(b.DataClasses) ? b.DataClasses : [];

      recent.push({
        id: `hibp-${b.Name}-${b.BreachDate}`,
        service,
        serviceName: SERVICE_NAMES[service] || b.Title || b.Name,
        date: b.BreachDate,
        dataLeaked: dataClasses.map(translateDataClass),
        risk: deriveRisk(dataClasses),
        confirmed: !!b.IsVerified,
        action: deriveAction(dataClasses),
        source: "Have I Been Pwned",
        sourceUrl: `https://haveibeenpwned.com/PwnedWebsites#${encodeURIComponent(b.Name)}`,
      });
    }

    console.log(`[HIBP] ${recent.length} recent breaches matched our services`);
    return recent;
  } catch (err) {
    const msg = err?.name === "AbortError" ? "timeout" : err?.message || "unknown";
    console.warn(`[HIBP] fetch error: ${msg}`);
    return []; // Nooit laten falen — handmatige breaches blijven werken
  }
}
