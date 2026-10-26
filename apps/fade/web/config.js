/* Fade network settings. Everything here is public (it ships to the browser).
 *
 * Fade Network runs without a server of its own:
 *   - data lives on public Nostr relays as signed (and, for private records, NIP-44 encrypted) events
 *   - shorts and photos are stored on Blossom media servers
 *   - push notifications go through ntfy.sh (free, no account)
 *   - money moves directly between people (PayPal, Venmo, Cash App, Revolut, Wise, bank/QRIS,
 *     Lightning, the barber's own Stripe Payment Link, or cash at the shop). Fade never holds funds
 *     and takes no fee.
 *
 * URL overrides for testing: ?devnet=1 (local server/devnet.py), ?ns=<namespace>,
 * ?relays=wss://a,wss://b, ?blossom=https://x, ?ntfy=https://y, ?offline (demo mode).
 */
window.FADE_CONFIG = {
  ns: 'fade3',
  relays: [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.primal.net',
    'wss://nostr.mom',
    'wss://relay.snort.social',
  ],
  blossom: ['https://blossom.primal.net', 'https://blossom.band', 'https://nostr.download'],
  ntfy: 'https://ntfy.sh',
  // Moderators: hex public keys allowed to publish the moderation list (hide content, ban, verify).
  admins: ['4189482788262062284fc55e0395e11ab64fe851e8ce5294644ea5eff27d79bc'],
  // Largest upload after on-device optimisation.
  maxUploadMb: 50,
};
