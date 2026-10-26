/* Unit tests for web/core.js. Runs under Node or macOS JavaScriptCore (jsc).
 * The Python runner prepends core.js to this file. */
(function () {
  'use strict';

  var out = typeof console !== 'undefined' && console.log ? console.log.bind(console) : print;

  // Minimal URL shim for engines without one (jsc). Only what parseLink needs.
  if (typeof URL === 'undefined') {
    this.URL = function (value) {
      var match = /^([a-z]+:)\/\/([^/?#]+)([^?#]*)(\?[^#]*)?/i.exec(value);
      if (!match) {
        throw new TypeError('Invalid URL');
      }
      var query = (match[4] || '').slice(1);
      this.protocol = match[1];
      this.hostname = match[2].toLowerCase();
      this.pathname = match[3] || '/';
      this.searchParams = {
        get: function (key) {
          var parts = query.split('&');
          for (var i = 0; i < parts.length; i++) {
            var pair = parts[i].split('=');
            if (decodeURIComponent(pair[0]) === key) {
              return decodeURIComponent(pair[1] || '');
            }
          }
          return null;
        },
      };
    };
  }

  var S = (typeof SyncCore !== 'undefined') ? SyncCore : this.SyncCore;
  var failures = 0;
  var passes = 0;

  function check(condition, name) {
    if (condition) {
      passes += 1;
    } else {
      failures += 1;
      out('FAIL ' + name);
    }
  }

  function near(a, b, tolerance) {
    return Math.abs(a - b) <= (tolerance || 1e-6);
  }

  function track(id, sources, duration) {
    return { id: id, title: 'Song ' + id, artist: 'Artist', duration: duration || 200, sources: sources || { youtube: 'dQw4w9WgXcQ' } };
  }

  function step(state, intent, actor, now) {
    return S.reduce(state, intent, { actor: actor || 'host', now: now });
  }

  // ---- codes ----
  var code = S.makeCode();
  check(code.length === 6 && /^[A-HJKMNP-Z2-9]+$/.test(code), 'makeCode uses the unambiguous alphabet');
  check(S.normalizeCode(' ab-c12 3 ') === 'ABC123', 'normalizeCode strips spaces/dashes and uppercases');
  check(S.normalizeCode('ab') === null, 'normalizeCode rejects short codes');

  // ---- clock ----
  var estimate = S.estimateOffset([
    { sent: 1000, received: 1300, remote: 6200 },
    { sent: 2000, received: 2040, remote: 7020 },
    { sent: 3000, received: 3200, remote: 8150 },
  ]);
  check(estimate && near(estimate.rtt, 40) && near(estimate.offset, 5000), 'estimateOffset uses the fastest round trip');
  check(S.estimateOffset([]) === null, 'estimateOffset handles no samples');

  // ---- correction ----
  var fileCaps = { rate: true, softThreshold: 0.03, hardThreshold: 0.35, maxRate: 0.05 };
  check(S.correction(0.01, fileCaps).action === 'none', 'small drift needs no correction');
  var slow = S.correction(0.1, fileCaps);
  check(slow.action === 'rate' && slow.rate < 1 && slow.rate >= 0.95, 'ahead by 100 ms slows down gently');
  var fast = S.correction(-0.1, fileCaps);
  check(fast.action === 'rate' && fast.rate > 1 && fast.rate <= 1.05, 'behind by 100 ms speeds up gently');
  check(S.correction(0.6, fileCaps).action === 'seek', 'large drift seeks');
  check(S.correction(0.5, { rate: false, softThreshold: 0.35, hardThreshold: 0.35 }).action === 'seek', 'players without rate control seek');
  check(S.correction(0.2, { rate: false, softThreshold: 0.35, hardThreshold: 0.35 }).action === 'none', 'players without rate control tolerate soft drift');

  // ---- state machine ----
  var t0 = 1000000;
  var state = S.initialState('host', 'Hana', t0);
  check(state.members.length === 1 && state.index === -1, 'initial state has the host only');

  var r = step(state, { type: 'enqueue', track: track('a') }, 'host', t0);
  check(r.changed && r.state.index === 0 && !r.state.playing && r.state.v === 2, 'first enqueue selects the track, paused');
  state = r.state;
  state = step(state, { type: 'enqueue', track: track('b', { file: { fileId: 'f1', name: 'x.mp3', size: 10, mime: 'audio/mpeg' } }) }, 'host', t0).state;
  check(state.queue.length === 2 && state.index === 0, 'second enqueue appends without switching');
  check(step(state, { type: 'enqueue', track: { id: 'z', title: 'none', sources: {} } }, 'host', t0).error, 'tracks without a source are rejected');
  var hostile = step(state, { type: 'enqueue', track: { id: 'h', title: 'x', artwork: 'javascript:alert(1)', sources: { youtube: 'abc' } } }, 'host', t0).state;
  check(hostile.queue[2].artwork === '', 'non-https artwork is dropped');

  state = step(state, { type: 'play' }, 'host', t0).state;
  check(state.playing && near(S.expectedPosition(state, t0 + 10000), 10), 'playing advances with host time');
  state = step(state, { type: 'pause' }, 'host', t0 + 10000).state;
  check(!state.playing && near(state.position, 10) && near(S.expectedPosition(state, t0 + 60000), 10), 'pause freezes the position');
  state = step(state, { type: 'seek', position: 42 }, 'host', t0 + 11000).state;
  check(near(state.position, 42) && !state.playing, 'seek keeps paused state');
  state = step(state, { type: 'play' }, 'host', t0 + 12000).state;

  // guests join, voice, DJ mode
  state = step(state, { type: 'join', member: { id: 'g1', name: 'Gus' } }, 'g1', t0 + 13000).state;
  state = step(state, { type: 'join', member: { id: 'g2', name: 'Gia' } }, 'g2', t0 + 14000).state;
  check(state.members.length === 3, 'guests join');
  check(step(state, { type: 'join', member: { id: 'g1', name: 'Gus2' } }, 'g1', t0).state.members.length === 3, 'rejoin does not duplicate');
  state = step(state, { type: 'voice', on: true }, 'g1', t0 + 15000).state;
  check(state.members[1].voice === true, 'voice flag is set for the actor only');
  var blocked = step(state, { type: 'setDj', mode: 'host' }, 'g1', t0);
  check(!blocked.changed && blocked.error, 'only the host changes DJ mode');
  var hostOnly = step(state, { type: 'setDj', mode: 'host' }, 'host', t0).state;
  check(step(hostOnly, { type: 'pause' }, 'g1', t0 + 16000).error, 'guests cannot control in host-only mode');
  check(step(hostOnly, { type: 'enqueue', track: track('c') }, 'g1', t0 + 16000).changed, 'guests can still add songs in host-only mode');
  check(step(state, { type: 'pause' }, 'g1', t0 + 16000).changed, 'guests control in everyone mode');

  // ended handling
  var playing = step(state, { type: 'select', index: 0 }, 'host', t0 + 20000).state;
  var early = step(playing, { type: 'ended', index: 0, duration: 200 }, 'g1', t0 + 30000);
  check(!early.changed, 'stale/early ended reports are ignored');
  var ended = step(playing, { type: 'ended', index: 0, duration: 200 }, 'g1', t0 + 20000 + 199000);
  check(ended.changed && ended.state.index === 1 && ended.state.playing, 'ended advances to the next song');
  var dup = step(ended.state, { type: 'ended', index: 0, duration: 200 }, 'g2', t0 + 20000 + 199500);
  check(!dup.changed, 'duplicate ended reports are ignored');
  var last = step(ended.state, { type: 'next' }, 'host', t0 + 230000).state;
  check(last.index === 1 && !last.playing, 'next at the end of the queue stops');

  // prev
  var mid = step(playing, { type: 'seek', position: 30 }, 'host', t0 + 21000).state;
  var restarted = step(mid, { type: 'prev' }, 'host', t0 + 22000).state;
  check(restarted.index === 0 && near(restarted.position, 0), 'prev after 3 s restarts the song');

  // remove / move
  var three = step(playing, { type: 'enqueue', track: track('d') }, 'host', t0).state;
  three = step(three, { type: 'select', index: 1 }, 'host', t0).state;
  var removedBefore = step(three, { type: 'remove', index: 0 }, 'host', t0).state;
  check(removedBefore.index === 0 && removedBefore.queue[0].id === three.queue[1].id, 'removing an earlier song keeps the current one');
  var moved = step(three, { type: 'move', from: 2, to: 0 }, 'host', t0).state;
  check(moved.queue[moved.index].id === three.queue[1].id, 'moving songs keeps the current one playing');
  var removedCurrent = step(three, { type: 'remove', index: 1 }, 'host', t0).state;
  check(removedCurrent.index === 1 && near(removedCurrent.position, 0), 'removing the current song moves to the next');

  // attach
  var attached = step(state, { type: 'attach', trackId: state.queue[0].id, service: 'spotify', value: '0VjIjW4GlUZAMYd2vXMi3b' }, 'g2', t0).state;
  check(attached.queue[0].sources.spotify === '0VjIjW4GlUZAMYd2vXMi3b', 'attach adds a service link for everyone');
  check(step(state, { type: 'attach', trackId: state.queue[0].id, service: 'file', value: 'x' }, 'g2', t0).error, 'attach cannot inject files');

  // leave, successor, rebase
  var left = step(state, { type: 'leave', id: 'g2' }, 'host', t0).state;
  check(left.members.length === 2, 'leave removes the member');
  check(S.successor(state, 'host') === 'g1', 'successor is the longest-standing guest');
  var rebased = S.rebaseState(state, 'g1', 2500, [{ id: 'g1', name: 'Gus', joinedAt: 0, voice: false }]);
  check(rebased.hostId === 'g1' && rebased.anchor === state.anchor - 2500 && rebased.v === state.v + 1, 'rebase converts to the new host clock');
  check(near(S.expectedPosition(rebased, t0 + 50000 - 2500), S.expectedPosition(state, t0 + 50000)), 'rebased timeline is continuous');

  // ---- sources ----
  var all = { sources: { youtube: 'y', spotify: 's', apple: 'a' } };
  check(S.pickSource(all, { service: 'spotify' }) === 'spotify', 'spotify listeners get spotify');
  check(S.pickSource(all, { service: 'apple', appleReady: false }) === 'youtube', 'apple without MusicKit falls back to youtube');
  check(S.pickSource(all, { service: 'apple', appleReady: true }) === 'apple', 'apple with MusicKit plays apple');
  check(S.pickSource({ sources: { spotify: 's' } }, { service: 'youtube' }) === 'spotify', 'falls back to any playable source');
  check(S.pickSource({ sources: { apple: 'a' } }, { service: 'auto', appleReady: false }) === null, 'apple-only track without MusicKit has no source');
  check(S.pickSource({ sources: { file: { fileId: 'f' }, youtube: 'y' } }, { service: 'spotify' }) === 'file', 'shared files win for everyone');

  // ---- links ----
  function link(text) {
    var parsed = S.parseLink(text);
    return parsed ? parsed.service + ':' + parsed.id : null;
  }
  check(link('https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b?si=abc') === 'spotify:0VjIjW4GlUZAMYd2vXMi3b', 'spotify track link');
  check(link('https://open.spotify.com/intl-de/track/0VjIjW4GlUZAMYd2vXMi3b') === 'spotify:0VjIjW4GlUZAMYd2vXMi3b', 'spotify intl link');
  check(link('spotify:track:0VjIjW4GlUZAMYd2vXMi3b') === 'spotify:0VjIjW4GlUZAMYd2vXMi3b', 'spotify URI');
  check(link('https://open.spotify.com/album/4yP0hdKOZPNshxUOjY0cZj') === null, 'spotify albums are not tracks');
  check(link('https://www.youtube.com/watch?v=4NRXx6U8ABQ&t=10') === 'youtube:4NRXx6U8ABQ', 'youtube watch link');
  check(link('https://youtu.be/4NRXx6U8ABQ?si=x') === 'youtube:4NRXx6U8ABQ', 'youtu.be link');
  check(link('https://music.youtube.com/watch?v=4NRXx6U8ABQ&list=RD') === 'youtube:4NRXx6U8ABQ', 'youtube music link');
  check(link('https://www.youtube.com/shorts/4NRXx6U8ABQ') === 'youtube:4NRXx6U8ABQ', 'youtube shorts link');
  check(link('https://music.apple.com/us/album/blinding-lights/1499378108?i=1499378615') === 'apple:1499378615', 'apple album?i= link');
  check(link('https://music.apple.com/us/song/blinding-lights/1499378615') === 'apple:1499378615', 'apple song link');
  check(link('not a link') === null && link('https://example.com/x') === null, 'unknown links are rejected');

  // ---- titles + matching ----
  var cleaned = S.cleanYouTubeTitle('The Weeknd - Blinding Lights (Official Video)', 'TheWeekndVEVO');
  check(cleaned.artist === 'The Weeknd' && cleaned.title === 'Blinding Lights', 'cleans "Artist - Title (Official Video)"');
  var topic = S.cleanYouTubeTitle('Blinding Lights', 'The Weeknd - Topic');
  check(topic.artist === 'The Weeknd' && topic.title === 'Blinding Lights', 'uses "- Topic" channel as artist');
  var candidates = [
    { title: 'Blinding Lights', artist: 'Bailey Preston', duration: 196 },
    { title: 'Blinding Lights', artist: 'The Weeknd', duration: 200 },
    { title: 'Save Your Tears', artist: 'The Weeknd', duration: 215 },
  ];
  var best = S.bestMatch(candidates, { title: 'Blinding Lights', artist: 'The Weeknd' });
  check(best && best.candidate.artist === 'The Weeknd', 'bestMatch prefers the right artist');
  check(S.bestMatch(candidates, { title: 'Totally Different Song', artist: 'Nobody' }) === null, 'bestMatch refuses weak matches');
  check(S.formatTime(65.4) === '1:05' && S.formatTime(NaN) === '0:00', 'formatTime');

  out('core.test.js: ' + passes + ' passed, ' + failures + ' failed');
  if (failures) {
    throw new Error(failures + ' core test(s) failed');
  }
}).call(this);
