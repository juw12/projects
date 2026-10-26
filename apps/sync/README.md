# apps/sync — Sync

**Listen to music together in real time, from anywhere.** Same song, same
second, different cities. No shared Wi-Fi or Bluetooth, no account, no server.

- Live: https://juw12.github.io/projects/sync/ (App) ·
  [Web](https://juw12.github.io/projects/sync/web.html) ·
  [Mobile](https://juw12.github.io/projects/sync/mobile.html)
- Open locally: `python3 -m http.server -d apps/sync/web 8000` → http://localhost:8000

## What it does

| | |
| --- | --- |
| **Rooms** | Start a room, share the invite link (`?room=CODE`). Up to ~24 listeners. |
| **Cross-service** | One queue, each listener hears it on their own service: YouTube (free), Spotify (embed), Apple Music (MusicKit, optional). Paste any Spotify / Apple Music / YouTube link, or search the Apple Music catalog. Sync matches the song across services automatically when it can; anyone can attach a missing link for everyone. |
| **Your own files** | Share audio files straight from your device. They're streamed peer-to-peer to the room and play for everyone, no account needed. |
| **Party** | Voice chat (WebRTC mesh) that **lowers the music while friends talk**, live chat, emoji reactions, "who's speaking" rings. |
| **Control** | Everyone can DJ, or host-only mode. Per-listener "My timing" nudge (±0.1 s) for versions with different intros. |
| **Resilient** | If the host leaves, the longest-standing guest takes over the room automatically and playback continues. |

## How the sync works

1. **The host's browser is the source of truth.** Room state is
   `{queue, index, playing, position, anchor}`: `position` seconds were true at
   host time `anchor`.
2. **Clock offset.** Each guest pings the host (burst of 8, then every 3 s) and
   keeps the offset from the lowest-round-trip sample (NTP-style). File
   transfers use a *separate* data channel so big uploads never delay pings.
3. **Drift correction, every 250 ms**, per player type:
   - shared files (`<audio>`): ±5 % playback-rate nudges for 30–350 ms drift, seek above;
   - YouTube / Apple Music: seek beyond 0.35–0.5 s (no smooth rate control);
   - Spotify embed: seek beyond 1 s (its position reports are coarse).
4. **Heartbeats** detect a vanished host within ~9 s (WebRTC alone can take 30 s+).

```
web/
  core.js      pure logic: room state machine, clock math, drift policy, link parsing, matching
  room.js      PeerJS/WebRTC networking: host/guest, files channel, watchdogs, host migration
  players.js   adapters: shared file, YouTube IFrame API, Spotify iFrame API, MusicKit
  voice.js     voice mesh, speaking detection
  catalog.js   iTunes Search/Lookup + YouTube/Spotify oEmbed (all key-free, CORS)
  app.js       UI + sync loop
  config.js    optional: TURN relay, own PeerJS server, Apple developer token, YouTube API key
```

## Verified

- `python3 apps/sync/tests/test_sync.py`: static checks + 62 core unit tests (CI).
- `python3 apps/sync/tools/browser_smoke.py`: two real headless Chrome tabs over
  real WebRTC (needs Chrome + internet). Last run: 17/18 passed:
  - guest clock deliberately skewed by +3.7 s → estimated offset −3700.0 ms
  - shared file: guest vs host **−10 ms** at the same real moment; seek/pause propagate
  - voice connects both ways; host music ducks to 34 % while the guest talks, back to 97 % on mute
  - host tab killed → guest takes over, playback continues (−22 ms), new guests can join
  - YouTube: the foreground listener held −62 ms vs the room clock; the *background* headless
    tab's YouTube player stalled (headless throttling; not yet verified in real background tabs)
  - The test uses a synthetic microphone (macOS blocks mic capture for headless Chrome).

## Honest limits

- **Spotify**: full songs only for listeners logged in to Spotify **Premium** in that
  browser; otherwise 30-second previews. No volume control, so no ducking for Spotify listeners.
- **Apple Music**: full playback needs an Apple Developer token in `config.js`
  ($99/yr program). Without it, Apple Music listeners hear the YouTube version.
- **Auto-matching**: Spotify/YouTube search needs API keys, so songs added from Apple Music
  get a YouTube match only if `youtubeApiKey` is set. Otherwise anyone can paste the link once.
- **Networks**: ~1 in 10 strict networks (corporate / some mobile carriers) need a TURN relay
  (`config.js → iceServers`). Matchmaking uses the free public PeerJS server.
- **Rights**: Sync never hosts music. Shared files go browser-to-browser; only share what you
  have the rights to.
