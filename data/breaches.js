// data/breaches.js
// ─────────────────────────────────────────────────────────────────
//  Lekken-database voor LekDezeWeek
// ─────────────────────────────────────────────────────────────────
//
//  Dit bestand wordt wekelijks handmatig bijgewerkt door de beheerder.
//  De wekelijkse cron (api/cron/weekly-digest.js) leest dit bestand en
//  stuurt op donderdag-ochtend de gepersonaliseerde digest naar alle
//  ingeschreven gebruikers.
//
//  ─── HOE WERK JE DIT BIJ? ───────────────────────────────────────
//
//  1. Voeg nieuwe lek-objecten toe bovenaan de array
//  2. Git commit + push naar main → Vercel deployt automatisch
//  3. De cron pakt vrijdag-donderdag alleen lekken uit de afgelopen 7 dagen
//
//  ─── VELDEN PER LEK ─────────────────────────────────────────────
//
//  id           Unieke string, bv. "basicfit-2026-04-13"
//  service      ID dat matcht met SERVICES in index.html
//                 (basicfit, ing, chipsoft, booking, bol, etc.)
//  serviceName  Leesbare naam voor in de e-mail
//  date         Datum van het lek in YYYY-MM-DD
//                 → alleen lekken <= 7 dagen oud worden verzonden
//  dataLeaked   Array van strings: welke data is gelekt
//  risk         "high" | "medium" | "low" | "unconfirmed"
//  confirmed    true of false (bron bevestigd?)
//  action       Actie-advies voor de gebruiker (1 regel)
//  source       Naam van de bron, bv. "Z-CERT", "Tweakers", "NOS"
//  sourceUrl    Optioneel: link naar bron-artikel
//
//  ─── VEILIGHEIDSNOTE ────────────────────────────────────────────
//
//  Publiceer ALLEEN geverifieerde informatie. Dit bestand wordt
//  rechtstreeks naar gebruikers gemaild. Onjuiste claims kunnen
//  bedrijven beschadigen én de geloofwaardigheid van LekDezeWeek.
//
// ─────────────────────────────────────────────────────────────────

export const BREACHES = [

  // ─── VOORBEELD — VERWIJDER OF VERVANG VOOR JE LIVE GAAT ───────
  //
  // {
  //   id: "voorbeeld-2026-04-13",
  //   service: "basicfit",
  //   serviceName: "Basic-Fit",
  //   date: "2026-04-13",
  //   dataLeaked: ["naam", "e-mailadres", "lidmaatschapsnummer"],
  //   risk: "medium",
  //   confirmed: true,
  //   action: "Verander je wachtwoord en zet 2FA aan waar mogelijk.",
  //   source: "Z-CERT",
  //   sourceUrl: "https://www.z-cert.nl/...",
  // },

];

// ─── SERVICES mapping — moet overeenkomen met index.html ─────────
// Niet wijzigen tenzij je ook index.html aanpast.
export const SERVICE_NAMES = {
  basicfit: "Basic-Fit",
  fit20: "Fit20",
  booking: "Booking.com",
  airbnb: "Airbnb",
  klm: "KLM / Air France",
  tui: "TUI",
  ns: "NS",
  uber: "Uber",
  chipsoft: "ChipSoft",
  epd: "EPD-systeem",
  ing: "ING Bank",
  rabobank: "Rabobank",
  abnamro: "ABN AMRO",
  sns: "SNS Bank",
  bunq: "bunq",
  bol: "Bol.com",
  coolblue: "Coolblue",
  zalando: "Zalando",
  amazon: "Amazon",
  ah: "Albert Heijn",
  jumbo: "Jumbo",
  netflix: "Netflix",
  spotify: "Spotify",
  disney: "Disney+",
  pathe: "Pathé",
  kpn: "KPN",
  vodafone: "Vodafone",
  tmobile: "T-Mobile",
  ziggo: "Ziggo",
  eneco: "Eneco",
  essent: "Essent",
  deliveroo: "Deliveroo",
  thuisbezorgd: "Thuisbezorgd.nl",
  linkedin: "LinkedIn",
  facebook: "Facebook / Meta",
  instagram: "Instagram",
  apple: "Apple ID / iCloud",
  google: "Google Account",
  microsoft: "Microsoft Account",
  ikea: "IKEA",
};
