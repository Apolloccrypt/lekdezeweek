// data/hibp-mapping.js
// ─────────────────────────────────────────────────────────────────
//  HIBP breach → onze service ID mapping
// ─────────────────────────────────────────────────────────────────
//
//  HIBP identificeert breaches via "Domain" (linkedin.com) of "Name"
//  (LinkedIn). Wij matchen eerst op domain, dan op lowercased name.
//
//  Alleen matches die hier staan verschijnen in de wekelijkse digest.
//  Wil je meer globale diensten meenemen? Voeg ze hier toe.
//
// ─────────────────────────────────────────────────────────────────

export const HIBP_TO_SERVICE = {
  // ─── Fitness ──────────────────────────────────────────────
  "basic-fit.com": "basicfit",
  "basicfit.com": "basicfit",
  "basic-fit": "basicfit",

  // ─── Reizen ───────────────────────────────────────────────
  "booking.com": "booking",
  "airbnb.com": "airbnb",
  "klm.com": "klm",
  "airfrance.com": "klm",
  "tui.nl": "tui",
  "tui.com": "tui",
  "ns.nl": "ns",
  "uber.com": "uber",

  // ─── Zorg ─────────────────────────────────────────────────
  "chipsoft.com": "chipsoft",
  "chipsoft.nl": "chipsoft",

  // ─── Banken ───────────────────────────────────────────────
  "ing.nl": "ing",
  "ing.com": "ing",
  "rabobank.nl": "rabobank",
  "rabobank.com": "rabobank",
  "abnamro.nl": "abnamro",
  "abnamro.com": "abnamro",
  "snsbank.nl": "sns",
  "bunq.com": "bunq",

  // ─── Webshops ─────────────────────────────────────────────
  "bol.com": "bol",
  "coolblue.nl": "coolblue",
  "coolblue.com": "coolblue",
  "zalando.com": "zalando",
  "zalando.nl": "zalando",
  "amazon.com": "amazon",
  "amazon.nl": "amazon",
  "ah.nl": "ah",
  "jumbo.com": "jumbo",

  // ─── Streaming ────────────────────────────────────────────
  "netflix.com": "netflix",
  "spotify.com": "spotify",
  "disneyplus.com": "disney",
  "disney.com": "disney",
  "pathe.nl": "pathe",

  // ─── Telecom ──────────────────────────────────────────────
  "kpn.com": "kpn",
  "vodafone.com": "vodafone",
  "vodafone.nl": "vodafone",
  "t-mobile.com": "tmobile",
  "t-mobile.nl": "tmobile",
  "ziggo.nl": "ziggo",

  // ─── Energie ──────────────────────────────────────────────
  "eneco.nl": "eneco",
  "essent.nl": "essent",

  // ─── Maaltijd ─────────────────────────────────────────────
  "deliveroo.com": "deliveroo",
  "thuisbezorgd.nl": "thuisbezorgd",

  // ─── Social ───────────────────────────────────────────────
  "linkedin.com": "linkedin",
  "linkedin": "linkedin",
  "facebook.com": "facebook",
  "facebook": "facebook",
  "instagram.com": "instagram",
  "instagram": "instagram",

  // ─── Tech ─────────────────────────────────────────────────
  "apple.com": "apple",
  "icloud.com": "apple",
  "google.com": "google",
  "gmail.com": "google",
  "microsoft.com": "microsoft",
  "outlook.com": "microsoft",
  "live.com": "microsoft",

  // ─── Wonen ────────────────────────────────────────────────
  "ikea.com": "ikea",
  "ikea.nl": "ikea",
};
