# Mint on WhatsApp

Log expenses by chatting with Mint's WhatsApp number:

```
coffee 25k
grab 18rb
lunch 12 usd yesterday
+5jt salary
```

Mint replies with what it understood, and the entries appear in the chosen budget the next time Mint is open on any
signed-in device (within about 20 seconds if it is already open). One message can hold several entries, one per line.

| You send | What happens |
| --- | --- |
| `coffee 25k`, `25rb grab`, `Rp 25.000 makan siang` | Expense. Category picked from your own history first, then Mint's keyword list (EN / ID / ZH / ES) |
| `+5jt gaji`, `salary 5jt` | Income |
| `lunch 12 usd`, `eur 9 museum`, `rm30 nasi lemak` | Converted into the budget's currency with the daily rate; the original is kept (`txn.fx`) |
| `… yesterday` / `kemarin` / `ayer` / `昨天` | Dated yesterday |
| `undo` / `batal` | Removes your last WhatsApp entry |
| `help` · `stop` · `total` | Help text · unlink this number · explains why Mint can't see totals from WhatsApp |

## How it keeps the budget private

Mint's promise is that the server never stores budget data it can read. WhatsApp keeps that promise:

1. **Connect** (Settings → WhatsApp). The device makes a P-256 *inbox key*. The server receives the public half and
   the private half **sealed with the account's sync key** (which the server never has), so any signed-in device can
   open the inbox and the server cannot.
2. **Link** a number by sending the one-time code (`link MINT-XXXXXX`, valid 15 min) from WhatsApp. Numbers are
   stored as an HMAC plus the last 4 digits for display.
3. **Each message** is sealed to the inbox public key the moment it arrives (ECIES: ephemeral ECDH P-256 → HKDF-SHA-256
   → AES-256-GCM) and only the ciphertext is stored (`wa_inbox`). The reply is built from the message in memory.
4. **A device** opens the items, files them with the same parser and category history as Quick add, writes them into the
   budget (which then syncs and shares as usual) and acknowledges them, which deletes them on the server.
   Every entry's id comes from the WhatsApp message id, so two devices filing the same message write one record.

What is *not* end-to-end: WhatsApp (Meta) carries the chat, and the worker sees each message in transit to answer it.
Totals and balances are never available on WhatsApp, because the server cannot read the budget.

## Setting it up (owner, once)

1. **Meta app.** At [developers.facebook.com](https://developers.facebook.com/) create an app (type *Business*) and add
   the **WhatsApp** product. Note the **Phone number ID** of your sender number (the free test number works for up to
   5 verified recipients; a real number needs business verification and an approved display name).
2. **Access token.** In Business Settings create a *System user*, give it the app with `whatsapp_business_messaging`
   (and `whatsapp_business_management`) permission and generate a **permanent token**. Temporary tokens expire in 24 h.
3. **App secret.** App settings → Basic → *App secret*.
4. **Worker secrets and vars** (from `apps/mint/cloud`):

   ```bash
   npx wrangler secret put WHATSAPP_TOKEN          # the permanent token
   npx wrangler secret put WHATSAPP_APP_SECRET     # verifies X-Hub-Signature-256 on every webhook
   npx wrangler secret put WHATSAPP_VERIFY_TOKEN   # any long random string you choose
   npx wrangler secret put WHATSAPP_HASH_SECRET    # long random string; never change it (phone links are keyed by it)
   npx wrangler secret put WHATSAPP_PHONE_NUMBER_ID
   npx wrangler secret put WHATSAPP_NUMBER         # the number people message, e.g. 6281234567890
   ```

   Optional: `WHATSAPP_GRAPH_BASE` (default `https://graph.facebook.com/v24.0`) to move to a newer Graph API version.
5. **Webhook.** WhatsApp → Configuration → Webhook: callback URL
   `https://mint-api.juw12.workers.dev/api/whatsapp/webhook`, verify token = `WHATSAPP_VERIFY_TOKEN`, then subscribe to
   the **messages** field.
6. **Check.** `GET /api/health` shows `"whatsapp": true` and the number. In Mint: Settings → WhatsApp → Connect.

Until all of `WHATSAPP_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` and
`WHATSAPP_NUMBER` are set, the feature stays off: the webhook answers 404 and the app says it is not switched on.

**Cost.** Mint only ever *replies* inside the 24-hour window that the user's own message opens, so it never sends paid
template messages. Check Meta's current WhatsApp pricing for your region before launch.

## API

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /api/whatsapp/webhook` | Meta verify token | Subscription check (echoes `hub.challenge`) |
| `POST /api/whatsapp/webhook` | `X-Hub-Signature-256` | Incoming messages; replies through the Graph API. Exempt from the per-IP write limit; 60 messages/hour per number |
| `GET /api/whatsapp` | session | `{enabled, number, phones[], key, pending}` |
| `POST /api/whatsapp/key` | session | `{publicKey (JWK), sealed, currency}`; a new key drops items sealed to the old one |
| `POST /api/whatsapp/link` | session | One-time code + `wa.me` link (15 min) |
| `DELETE /api/whatsapp/phones/:id` | session | Unlink one number |
| `GET /api/whatsapp/inbox` | session | Up to 100 sealed items, oldest first (`more` when there are more) |
| `POST /api/whatsapp/inbox/ack` | session | `{ids}`: delete filed items |
| `DELETE /api/whatsapp` | session | Unlink everything, delete the key and anything waiting |

Code: `cloud/src/whatsapp.js` (webhook parsing, signatures, sealing, replies), `MintDB.routeWhatsApp` in
`cloud/src/index.js`, `web/budget/js/whatsapp.js` (opening and filing on the device), `K.parseQuickText` /
`K.parseQuickLines` / `K.chatTxnId` in `web/budget/js/core.js` (shared by the worker and the app).
Tests: `cloud/test/api_test.mjs` (WhatsApp section, against a mock Graph API) and the *chat* checks in
`web/budget/tests.html`.
