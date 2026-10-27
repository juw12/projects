/* Sync deployment settings. Everything here is optional — Sync works with the
 * defaults. Values are public (this file ships to the browser), so only put
 * restricted, client-safe credentials here. */
window.SYNC_CONFIG = {
  // PeerJS signaling server used to introduce browsers to each other. Audio,
  // chat and room state then flow directly between browsers (WebRTC).
  // Leave empty to use the free public PeerJS cloud (0.peerjs.com).
  // Self-host: https://github.com/peers/peerjs-server  e.g. { host: 'peer.example.com', port: 443, path: '/', secure: true }
  peerServer: null,

  // STUN finds a direct route between browsers. Roughly 1 in 10 networks
  // (strict corporate / mobile carrier NAT) also need a TURN relay — add one
  // here, e.g. { urls: 'turn:relay.example.com:443', username: '…', credential: '…' }.
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
  ],

  // Apple Music full-track playback (MusicKit JS). Requires an Apple Developer
  // Program membership to mint a developer token (JWT). Empty = Apple Music
  // listeners hear the room through YouTube instead.
  appleDeveloperToken: '',

  // Optional YouTube Data API v3 key (restrict it to your site's referrer).
  // When set, Sync auto-finds a YouTube version for songs added from Spotify
  // or Apple Music. Empty = listeners paste a YouTube link when one is missing.
  youtubeApiKey: '',

  // Largest audio file a listener can share with the room, in megabytes.
  maxUploadMb: 40,

  // ---- Earning (optional; empty = switched off) ----
  // Tip jar: your Ko-fi / Buy Me a Coffee / GitHub Sponsors page or a Stripe Payment Link.
  // Shows "Support Sync" on the web (never inside the store apps, whose payment rules differ),
  // a supporter badge friends can see, and one gentle thank-you prompt after 20 min of listening together.
  supportUrl: '',

  // Apple Services Performance Partners token (the "at" value, https://performance-partners.apple.com).
  // Every song from Apple's catalog gets an "Apple Music" link; you earn a commission when a listener
  // starts an Apple Music subscription from it. Empty = the links still work, without the token.
  appleAffiliateToken: '',
};
