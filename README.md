# LekDezeWeek.nl

Wekelijkse datalek-radar voor Nederland. Onderdeel van de **Check Don't Store** campagne.

## Wat zit er in deze repo

```
├── api/
│   ├── signup.js         ← POST /api/signup — registratie + welkomstmail
│   └── unsubscribe.js    ← GET  /api/unsubscribe?token=… — één-klik delete
├── index.html            ← Landingspagina (vanilla HTML/CSS/JS)
├── package.json          ← @upstash/redis + resend
├── vercel.json           ← Function runtime config
├── .gitignore
├── .env.example          ← Template voor env vars
└── README.md
```

## Deployment walkthrough — van nul tot live

### 1. Code in GitHub zetten

Via web-interface:
1. Download alle bestanden naar een lokale map
2. Ga naar https://github.com/Apolloccrypt/lekdezeweek
3. **Add file → Upload files** → sleep de hele inhoud
4. Commit met message `Initial backend + frontend`

Of via terminal:
```bash
git clone https://github.com/Apolloccrypt/lekdezeweek.git
cd lekdezeweek
# kopieer alle bestanden uit deze map hierheen
git add .
git commit -m "Initial backend + frontend"
git push origin main
```

### 2. Vercel project aanmaken

1. Ga naar https://vercel.com/new
2. Log in met GitHub (als nog niet gedaan)
3. Importeer `Apolloccrypt/lekdezeweek`
4. Framework preset: **Other** (Vercel detecteert vanzelf)
5. Klik **Deploy**

Eerste deploy zal **falen** op de API functions — dat is verwacht, want de env vars ontbreken nog. De landingspagina zelf werkt al.

### 3. Upstash Redis koppelen (via Vercel Marketplace)

1. In je Vercel dashboard → project → **Storage** tab
2. Klik **Create Database** → kies **Upstash → Redis**
3. Naam: `lekdezeweek-db`, region: **Frankfurt (eu-central-1)** voor lage latency in NL
4. Klik **Create**
5. Vercel vraagt: "Connect to project?" → ja, vink `lekdezeweek` aan

Vercel injecteert nu automatisch `KV_REST_API_URL` en `KV_REST_API_TOKEN` als environment variables. Niks handmatig doen.

**Free tier limieten:** 10.000 commands/dag, 256 MB storage. Genoeg voor ~100k signups.

### 4. Resend account + API key

1. Ga naar https://resend.com/signup (gratis)
2. Verifieer je eigen e-mail
3. Dashboard → **API Keys** → **Create API Key** → naam `lekdezeweek-prod` → **Full access**
4. Kopieer de key (begint met `re_...`) — je ziet hem maar één keer

**Free tier:** 3.000 e-mails/maand, 100/dag. Prima voor eerste 1.000 gebruikers.

### 5. Environment variables in Vercel zetten

Vercel dashboard → project → **Settings** → **Environment Variables**. Voeg toe:

| Naam            | Waarde                                   | Environment          |
|-----------------|------------------------------------------|----------------------|
| `RESEND_API_KEY`| `re_xxxxxx...`                           | Production, Preview  |
| `FROM_EMAIL`    | `LekDezeWeek <onboarding@resend.dev>`    | Production, Preview  |
| `SITE_URL`      | `https://lekdezeweek.nl` (of vercel.app) | Production, Preview  |

`KV_REST_API_URL` en `KV_REST_API_TOKEN` zijn al automatisch gezet door de Upstash integration.

**Let op FROM_EMAIL:** zolang je eigen domein niet geverifieerd is in Resend, gebruik je `onboarding@resend.dev`. Zodra je `lekdezeweek.nl` hebt en in Resend DNS records zet, verander je het naar `radar@lekdezeweek.nl`.

### 6. Redeploy

Vercel dashboard → **Deployments** → laatste deploy → **⋮** (drie puntjes) → **Redeploy**. Nu zijn de env vars actief.

### 7. Testen

Open je `vercel.app` URL:
1. Vink 3 diensten aan
2. Vul je eigen e-mail in
3. Klik **Start mijn wekelijkse radar**
4. Check je inbox — je krijgt de welkomstmail
5. Klik de uitschrijflink onderaan de mail → pagina bevestigt dat je gewist bent
6. Check in Vercel dashboard → Storage → Upstash → **Data Browser**: `user:jouw@email.nl` is verdwenen

Werkt? Mooi. Stap naar domein.

### 8. Domein `lekdezeweek.nl` koppelen

1. Koop het domein bij TransIP (~€8/jaar) of Versio (~€5/jaar)
2. Vercel → project → **Settings** → **Domains** → voeg `lekdezeweek.nl` + `www.lekdezeweek.nl` toe
3. Vercel toont de benodigde DNS records — meestal:
   - `A` op `@` → `76.76.21.21`
   - `CNAME` op `www` → `cname.vercel-dns.com`
4. Zet die bij je registrar, wacht 5-60 minuten op DNS + automatisch SSL
5. Update de `SITE_URL` env var naar `https://lekdezeweek.nl` en redeploy

### 9. Eigen domein voor e-mails (aangeraden)

Ontvangers vertrouwen `radar@lekdezeweek.nl` meer dan `onboarding@resend.dev`.

1. Resend dashboard → **Domains** → **Add Domain** → `lekdezeweek.nl`
2. Resend toont 3-4 DNS records (SPF, DKIM, eventueel DMARC)
3. Zet die bij je registrar naast de Vercel records
4. Wacht op verificatie (meestal <15 min)
5. In Vercel: verander `FROM_EMAIL` naar `LekDezeWeek <radar@lekdezeweek.nl>` → redeploy

## Wat ontbreekt nog (voor echte wekelijkse alerts)

Nu werkt het **registreren** volledig. De **wekelijkse digest** bouw je als laatste:

```
api/cron/weekly-digest.js  ← Nog te maken
```

Dit wordt een Vercel Cron Job (elke donderdag 09:00) die:
1. Alle users uit Redis ophaalt
2. Nieuwe lekken van afgelopen 7 dagen binnenhaalt (handmatig onderhouden lijst, of scraper)
3. Per user checkt of hun `selected` diensten in de lekken zitten
4. Gepersonaliseerde mail stuurt via Resend

Als je hier klaar voor bent: zeg "bouw de cron" en ik schrijf hem.

## Lokaal ontwikkelen

```bash
npm install
npx vercel link           # koppel met je Vercel project
npx vercel env pull .env.local   # download env vars lokaal
npx vercel dev            # start lokale server op localhost:3000
```

## Security notes

- E-mails worden in **plaintext** opgeslagen in Redis (nodig om te mailen).
- Geen logs van e-mailadressen in function output.
- Unsubscribe-tokens zijn 48 hex tekens (192 bits entropy).
- Rate limiting is **niet** ingebouwd. Overweeg `@upstash/ratelimit` toe te voegen als je public traffic verwacht.
- Zet `FROM_EMAIL` nooit hardcoded in de code — altijd via env.
