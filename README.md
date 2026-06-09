# Enliven Practice Scheduler

Web-based practice management tool for OT & Pilates sessions.  
Stack: Vanilla HTML/CSS/JS → Vercel · Google Apps Script → Google Sheets.

---

## Deployment (one-time setup)

### 1. Create the Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new spreadsheet.
2. Name it **Enliven Scheduler**.
3. Copy the Sheet ID from the URL:  
   `https://docs.google.com/spreadsheets/d/**SHEET_ID_HERE**/edit`

### 2. Deploy the Apps Script API

1. In the Sheet, go to **Extensions → Apps Script**.
2. Delete the default `Code.gs` content and paste the contents of [`api/Code.gs`](api/Code.gs).
3. At the top of `Code.gs`, replace `YOUR_GOOGLE_SHEET_ID_HERE` with the actual Sheet ID from step 1.
4. Click **Run → initialiseSheets** once. This creates the three tabs with correct headers.
5. Click **Deploy → New deployment**.
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Click **Deploy**, authorise the permissions, and copy the **Web App URL**.

### 3. Configure the frontend

Open [`config.js`](config.js) and fill in both values:

```js
var CONFIG = {
  API_URL: 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec',
  PIN: '1234',   // ← change to a 4-digit PIN your mum will remember
};
```

### 4. Push to GitHub & deploy on Vercel

```bash
git init
git add .
git commit -m "Initial Enliven Scheduler"
gh repo create enliven-scheduler --public --push --source=.
```

Then:
1. Go to [vercel.com](https://vercel.com) → **Add New Project**.
2. Import the GitHub repo.
3. Leave all settings at defaults (it's a static site).
4. Click **Deploy**. Done.

---

## Re-deploying after changes

**Frontend changes** — push to GitHub; Vercel auto-deploys.

**Apps Script changes** — in the Apps Script editor:  
Deploy → Manage deployments → Edit the existing deployment → increment the version.  
The Web App URL stays the same.

---

## Google Sheets tabs

| Tab | Purpose |
|-----|---------|
| `appointments` | Every appointment ever — upserted on each save |
| `weeks` | Week registry (id, mondayDate, label) |
| `accounts_summary` | Auto-refreshed totals per week |

---

## File structure

```
enliven-scheduler/
├── index.html        # App shell + PIN gate
├── style.css         # All styles (CSS variables, dark mode, mobile)
├── config.js         # API_URL + PIN (edit this after deploy)
├── api-client.js     # All API calls + offline queue
├── app.js            # All app logic
└── api/
    └── Code.gs       # Google Apps Script (paste into Apps Script editor)
```

---

## What's built

- [x] Weekly grid (Mon–Sat, 7 AM – 7 PM, 30-min slots)
- [x] Daily view with day tabs (easier on mobile)
- [x] Week / Day toggle
- [x] Add / Edit / Cancel / Delete / Reschedule appointments
- [x] Appointment types: My OT · My Pilates · Delegate to team
- [x] Package client, Zoom badge, payment tracking
- [x] Accounts tab: weekly + monthly summary, unpaid warnings
- [x] History tab: all weeks, click to jump
- [x] Team tab: delegated case counts
- [x] Cases tab: filterable list across all weeks
- [x] Export CSV (schedule + accounts)
- [x] PIN gate
- [x] Offline queue — writes survive no connectivity, auto-flush on reconnect
- [x] Google Sheets persistence via Apps Script
- [x] Local cache — app loads instantly from cache, then syncs
- [x] Dark mode (CSS variables)
- [x] Mobile-friendly (44px touch targets, font-size:16px inputs)
