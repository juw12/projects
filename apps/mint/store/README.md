# Mint — store listing kit

Everything needed to fill in the Google Play Console (and later App Store Connect). Copy the text blocks as-is;
character limits are checked by `apps/mint/tests/test_core.py`.

Assets in this folder:

- `graphics/icon-512.png` — app icon, 512 × 512, no transparency (Play “App icon”).
- `graphics/feature-graphic-1024x500.png` — Play “Feature graphic”.
- `screenshots/01-market.png`, `02-template.png`, `03-create.png`, `04-guides.png` — phone screenshots, 1080 × 1920
  (9:16), captured from the live app by `store_screenshots.mjs`.

## Google Play — main store listing

**App name** (≤ 30)

```
Mint: Spreadsheet Templates
```

**Short description** (≤ 80)

```
Make, buy & sell Excel & Google Sheets templates. Create one with AI in minutes.
```

**Full description** (≤ 4000)

```
Mint is a studio and marketplace for spreadsheet templates that work in Excel and Google Sheets.

CREATE IN MINUTES
• Describe what you need — “freelance invoice tracker in rupiah” — and Mint AI drafts the sheet, formulas and a dashboard.
• Tweak columns, themes and sample data, check the live preview, then export a real .xlsx file.

BUY TEMPLATES THAT JUST WORK
• Budget planners, invoice trackers, inventory, CRM, habit trackers, meal plans, workout logs and more.
• Free templates download instantly. Paid ones show a live preview with sample results before you buy.
• Files open in Excel, Google Sheets, Numbers and LibreOffice. Save to Files or Drive, or open straight in Excel.

SELL YOUR OWN
• Publish a template, set your price and get paid directly — to your own payment link, or automatically through your own Midtrans, Xendit or Stripe account.
• Orders unlock the moment the payment provider confirms. Mint never holds your money.

EARN AS AN AFFILIATE
• Share any template with your link and earn the commission the seller sets, tracked for 30 days.

PRIVATE BY DESIGN
• No ads, no trackers, no selling of data. Delete your account any time, in the app or on the web.

Mint is an independent project made in Batam, Indonesia.
```

**Category:** Productivity · **Tags:** Productivity, Business, Finance
**Contact email:** juwen12006@gmail.com · **Website:** https://juw12.github.io/projects/mint/
**Privacy policy URL:** https://juw12.github.io/projects/mint/privacy.html
**Account deletion URL:** https://juw12.github.io/projects/mint/delete-account.html

## Google Play — Bahasa Indonesia (id-ID)

**Nama aplikasi** (≤ 30)

```
Mint: Template Spreadsheet
```

**Deskripsi singkat** (≤ 80)

```
Buat, beli & jual template Excel dan Google Sheets. Bikin dengan AI dalam menit.
```

**Deskripsi lengkap**

```
Mint adalah studio dan marketplace template spreadsheet untuk Excel dan Google Sheets.

BUAT DALAM HITUNGAN MENIT
• Tulis kebutuhanmu — “pelacak invoice freelance dalam rupiah” — dan Mint AI menyiapkan sheet, rumus, dan dashboard.
• Atur kolom, tema, dan data contoh, cek pratinjau langsung, lalu ekspor file .xlsx asli.

BELI TEMPLATE YANG LANGSUNG JALAN
• Anggaran bulanan, invoice, stok barang, CRM, habit tracker, menu mingguan, log latihan, dan banyak lagi.
• Template gratis langsung diunduh. Template berbayar punya pratinjau dengan hasil contoh sebelum dibeli.

JUAL TEMPLATE SENDIRI
• Pasang harga dan terima pembayaran langsung — lewat link pembayaranmu, atau otomatis lewat akun Midtrans, Xendit, atau Stripe milikmu.
• Pesanan terbuka begitu penyedia pembayaran mengonfirmasi. Mint tidak pernah memegang uangmu.

DAPATKAN KOMISI AFILIASI
• Bagikan template dengan link-mu dan dapatkan komisi yang ditentukan penjual, dilacak selama 30 hari.

PRIVASI TERJAGA
• Tanpa iklan, tanpa pelacak, data tidak dijual. Hapus akun kapan saja, di aplikasi atau di web.
```

## Data safety form (answers)

| Question | Answer |
|---|---|
| Collects or shares user data? | Collects: yes. Shares with third parties: no (sellers see a buyer’s name + email only to fulfil that order — Play counts this as part of the service, not “sharing”). |
| Encrypted in transit? | Yes (HTTPS only, `cleartext: false`). |
| Users can request deletion? | Yes — in app and at the account deletion URL. |
| Personal info | Name, Email address — *collected*, required, purpose: Account management, App functionality. |
| Financial info | “Other financial info” (affiliate payout details, seller payment-provider keys) — *collected*, optional, App functionality. Purchase history — *collected*, App functionality. No card or bank numbers. |
| App activity | “Other user-generated content” (templates, listings, reviews, reports) — *collected*, App functionality. |
| Device or other IDs | Push-notification endpoint — *collected*, optional, App functionality. |
| Location, contacts, photos, health, messages, audio, web history | Not collected. |
| Ads / analytics / tracking | None. |

## Content rating questionnaire

Category: *Utility, productivity, communication or other*. No violence, sexual content, profanity, drugs, gambling
or simulated gambling. User-generated content: **yes** (listings and reviews, with reporting and auto-hide).
Users can interact/share content: **yes**. Shares location: no. Digital purchases: **yes** — sellers’ own checkout,
outside Google Play Billing (templates are digital goods bought from third-party sellers; see note below).

## Release checklist

1. Create the Play developer account ($25, identity verification).
2. **Build an AAB**, not an APK (Play requires bundles): `npm run android:prepare` then
   `cd android && ./gradlew bundleRelease` → `android/app/build/outputs/bundle/release/app-release.aab`.
   Capacitor 8.5 targets API 36 (Android 16), which Play requires for new apps from 31 Aug 2026.
   Sign with the backed-up key (`~/Documents/Mint Android signing key/mint-release.p12`, password in Keychain) and
   enrol in Play App Signing using it as the upload key.
3. Fill in the listing, data safety, content rating, target audience (13+), ads: “No ads”.
4. **Closed test:** new personal accounts must run a closed test with **≥ 12 testers opted in for 14 continuous days**
   before applying for production. Invite testers by email/Google Group; ask them to open the app a few times.
5. Apply for production access, roll out.

## Risks to check before submitting

- **Payments policy.** Play requires Google Play Billing for digital goods *sold by the app developer*. Mint is a
  marketplace where third-party sellers sell to buyers with their own checkout, and Mint takes 0% — closer to the
  allowed “peer-to-peer marketplace” case, but reviewers judge case by case. If you later take a platform fee on
  in-app template sales, re-check the Payments policy first.
- **WebView minimum functionality.** The app loads the live site in a WebView. It adds native file sharing, external
  checkout and an offline page; describe these in the review notes. Rejection for “webview spam” is possible.
- **iOS:** App Store Guideline 4.2 (minimum functionality) and 3.1.1 (in-app purchase) are stricter than Play;
  needs Xcode (not installed on this Mac) and the $99/year Apple Developer Program. iPhone users can already use
  Add to Home Screen.
