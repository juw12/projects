/* Sync core — pure, DOM-free logic shared by the app and the tests.
 *
 * The room host is the single source of truth. Its state is a plain object:
 *   { v, queue: [track], index, playing, position, anchor, dj, hostId, members }
 * `position` (seconds) was true at host time `anchor` (ms). Every client turns
 * that into "where should I be right now" with its estimated clock offset.
 */
(function (root) {
  'use strict';

  var CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
  var CODE_LENGTH = 6;
  var MAX_QUEUE = 200;
  var MAX_MEMBERS = 24;
  var SERVICES = ['file', 'youtube', 'spotify', 'apple'];

  function makeCode(random) {
    var rand = random || Math.random;
    var code = '';
    for (var i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
    }
    return code;
  }

  function normalizeCode(text) {
    var code = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return code.length >= 4 && code.length <= 12 ? code : null;
  }

  function makeId(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  /* ---------- clock ---------- */

  // samples: [{ sent, received, remote }] in ms. Returns remote - local offset.
  // The sample with the smallest round trip is the least distorted by queuing.
  function estimateOffset(samples) {
    var best = null;
    for (var i = 0; i < samples.length; i++) {
      var s = samples[i];
      var rtt = s.received - s.sent;
      if (rtt < 0) {
        continue;
      }
      if (!best || rtt < best.rtt) {
        best = { rtt: rtt, offset: s.remote + rtt / 2 - s.received };
      }
    }
    return best;
  }

  function expectedPosition(state, hostNow) {
    if (!state || state.index < 0 || !state.queue[state.index]) {
      return 0;
    }
    if (!state.playing) {
      return state.position;
    }
    return Math.max(0, state.position + (hostNow - state.anchor) / 1000);
  }

  // How a player should correct a drift (seconds, + = ahead of the room).
  function correction(drift, caps) {
    var c = caps || {};
    var soft = c.softThreshold != null ? c.softThreshold : 0.04;
    var hard = c.hardThreshold != null ? c.hardThreshold : 0.35;
    var maxRate = c.maxRate != null ? c.maxRate : 0.05;
    var magnitude = Math.abs(drift);
    if (magnitude > hard || (!c.rate && magnitude > soft)) {
      return { action: 'seek', rate: 1 };
    }
    if (c.rate && magnitude > soft) {
      var adjust = Math.max(-maxRate, Math.min(maxRate, drift * 0.5));
      return { action: 'rate', rate: 1 - adjust };
    }
    return { action: 'none', rate: 1 };
  }

  /* ---------- room state machine (host side) ---------- */

  function initialState(hostId, hostName, now) {
    return {
      v: 1,
      queue: [],
      index: -1,
      playing: false,
      position: 0,
      anchor: now,
      dj: 'everyone',
      hostId: hostId,
      members: [{ id: hostId, name: hostName || 'Host', joinedAt: now, voice: false }],
    };
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  var CONTROL_INTENTS = { play: 1, pause: 1, seek: 1, next: 1, prev: 1, select: 1, remove: 1, move: 1 };

  function canControl(state, actor) {
    return state.dj === 'everyone' || actor === state.hostId;
  }

  function sanitizeTrack(track, actorName) {
    if (!track || typeof track !== 'object') {
      return null;
    }
    var sources = {};
    var given = track.sources || {};
    SERVICES.forEach(function (service) {
      if (given[service]) {
        sources[service] = service === 'file'
          ? {
            fileId: String(given.file.fileId || ''),
            name: String(given.file.name || 'audio').slice(0, 160),
            size: Number(given.file.size) || 0,
            mime: String(given.file.mime || 'audio/mpeg').slice(0, 60),
          }
          : String(given[service]).slice(0, 64);
      }
    });
    if (!Object.keys(sources).length) {
      return null;
    }
    return {
      id: String(track.id || makeId('t')).slice(0, 60),
      title: String(track.title || 'Untitled').slice(0, 200),
      artist: String(track.artist || '').slice(0, 200),
      artwork: /^https:\/\//.test(track.artwork || '') ? String(track.artwork).slice(0, 500) : '',
      duration: Number(track.duration) > 0 ? Number(track.duration) : null,
      addedBy: String(actorName || track.addedBy || '').slice(0, 40),
      sources: sources,
    };
  }

  function setClock(state, position, playing, now) {
    state.position = Math.max(0, Number(position) || 0);
    state.anchor = now;
    state.playing = !!playing;
  }

  function memberName(state, id) {
    for (var i = 0; i < state.members.length; i++) {
      if (state.members[i].id === id) {
        return state.members[i].name;
      }
    }
    return '';
  }

  // Returns { state, changed, error }. Never mutates the input.
  function reduce(input, intent, ctx) {
    var now = ctx.now;
    var actor = ctx.actor;
    var state = clone(input);
    var type = intent && intent.type;
    var hasTrack = state.index >= 0 && state.index < state.queue.length;
    var result = function (changed, error) {
      if (changed) {
        state.v = input.v + 1;
      }
      return { state: changed ? state : input, changed: !!changed, error: error || null };
    };

    if (CONTROL_INTENTS[type] && !canControl(state, actor)) {
      return result(false, 'Only the host can control playback right now.');
    }

    switch (type) {
      case 'join': {
        var member = intent.member || {};
        var existing = state.members.filter(function (m) { return m.id === member.id; })[0];
        if (existing) {
          existing.name = String(member.name || existing.name).slice(0, 40);
          existing.supporter = !!member.supporter;
          return result(true);
        }
        if (state.members.length >= MAX_MEMBERS) {
          return result(false, 'Room is full.');
        }
        state.members.push({
          id: String(member.id),
          name: String(member.name || 'Guest').slice(0, 40),
          joinedAt: now,
          voice: false,
          supporter: !!member.supporter,
        });
        return result(true);
      }
      case 'leave': {
        var before = state.members.length;
        state.members = state.members.filter(function (m) { return m.id !== intent.id; });
        return result(state.members.length !== before);
      }
      case 'voice': {
        var changedVoice = false;
        state.members.forEach(function (m) {
          if (m.id === actor && m.voice !== !!intent.on) {
            m.voice = !!intent.on;
            changedVoice = true;
          }
        });
        return result(changedVoice);
      }
      case 'setDj': {
        if (actor !== state.hostId) {
          return result(false, 'Only the host can change who controls playback.');
        }
        state.dj = intent.mode === 'host' ? 'host' : 'everyone';
        return result(true);
      }
      case 'enqueue': {
        var track = sanitizeTrack(intent.track, memberName(state, actor));
        if (!track) {
          return result(false, 'That track has no playable source.');
        }
        if (state.queue.length >= MAX_QUEUE) {
          return result(false, 'Queue is full.');
        }
        state.queue.push(track);
        if (state.index === -1) {
          state.index = state.queue.length - 1;
          setClock(state, 0, false, now);
        }
        return result(true);
      }
      case 'attach': {
        var target = state.queue.filter(function (t) { return t.id === intent.trackId; })[0];
        if (!target || SERVICES.indexOf(intent.service) < 1 || !intent.value) {
          return result(false, 'Could not attach that link.');
        }
        target.sources[intent.service] = String(intent.value).slice(0, 64);
        if (!target.duration && Number(intent.duration) > 0) {
          target.duration = Number(intent.duration);
        }
        return result(true);
      }
      case 'play':
        if (!hasTrack) {
          return result(false);
        }
        setClock(state, expectedPosition(input, now), true, now);
        return result(true);
      case 'pause':
        if (!hasTrack) {
          return result(false);
        }
        setClock(state, expectedPosition(input, now), false, now);
        return result(true);
      case 'seek':
        if (!hasTrack) {
          return result(false);
        }
        setClock(state, intent.position, state.playing, now);
        return result(true);
      case 'ended': {
        // Every listener reports "ended"; only the first valid report counts.
        if (intent.index !== state.index || !state.playing) {
          return result(false);
        }
        var reportedDuration = Number(intent.duration) || 0;
        if (reportedDuration && expectedPosition(input, now) < reportedDuration - 3) {
          return result(false);
        }
        return advance(state, 1, now, result);
      }
      case 'next':
        return advance(state, 1, now, result);
      case 'prev':
        if (hasTrack && expectedPosition(input, now) > 3) {
          setClock(state, 0, state.playing, now);
          return result(true);
        }
        return advance(state, -1, now, result);
      case 'select': {
        var index = Number(intent.index);
        if (!(index >= 0 && index < state.queue.length)) {
          return result(false);
        }
        state.index = index;
        setClock(state, 0, true, now);
        return result(true);
      }
      case 'remove': {
        var removeAt = Number(intent.index);
        if (!(removeAt >= 0 && removeAt < state.queue.length)) {
          return result(false);
        }
        state.queue.splice(removeAt, 1);
        if (removeAt < state.index) {
          state.index -= 1;
        } else if (removeAt === state.index) {
          if (state.index >= state.queue.length) {
            state.index = state.queue.length - 1;
          }
          setClock(state, 0, state.playing && state.index >= 0, now);
        }
        return result(true);
      }
      case 'move': {
        var from = Number(intent.from);
        var to = Number(intent.to);
        if (!(from >= 0 && from < state.queue.length && to >= 0 && to < state.queue.length) || from === to) {
          return result(false);
        }
        var current = state.queue[state.index];
        var moved = state.queue.splice(from, 1)[0];
        state.queue.splice(to, 0, moved);
        state.index = state.queue.indexOf(current);
        return result(true);
      }
      default:
        return result(false, 'Unknown action.');
    }
  }

  function advance(state, step, now, result) {
    var target = state.index + step;
    if (target >= 0 && target < state.queue.length) {
      state.index = target;
      setClock(state, 0, true, now);
      return result(true);
    }
    if (step > 0) {
      setClock(state, 0, false, now); // end of the queue: stop
      return result(true);
    }
    setClock(state, 0, state.playing, now);
    return result(true);
  }

  // After host migration, convert timestamps from the old host's clock to ours.
  function rebaseState(state, newHostId, offsetMs, members) {
    var next = clone(state);
    next.anchor = state.anchor - offsetMs;
    next.hostId = newHostId;
    if (members) {
      next.members = members;
    }
    next.v = state.v + 1;
    return next;
  }

  // Successor = earliest joined member other than the departed host.
  function successor(state, departedHostId) {
    var candidates = state.members
      .filter(function (m) { return m.id !== departedHostId; })
      .sort(function (a, b) { return a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1); });
    return candidates.length ? candidates[0].id : null;
  }

  /* ---------- sources ---------- */

  // prefs: { service: 'auto'|'youtube'|'spotify'|'apple', appleReady: bool }
  function pickSource(track, prefs) {
    if (!track || !track.sources) {
      return null;
    }
    var s = track.sources;
    var p = prefs || {};
    if (s.file) {
      return 'file';
    }
    var appleOk = !!(s.apple && p.appleReady);
    if (p.service === 'spotify' && s.spotify) {
      return 'spotify';
    }
    if (p.service === 'apple' && appleOk) {
      return 'apple';
    }
    if (p.service === 'youtube' && s.youtube) {
      return 'youtube';
    }
    if (s.youtube) {
      return 'youtube';
    }
    if (appleOk) {
      return 'apple';
    }
    if (s.spotify) {
      return 'spotify';
    }
    return null;
  }

  function parseLink(text) {
    var value = String(text || '').trim();
    var match;
    match = value.match(/^spotify:track:([A-Za-z0-9]{22})$/);
    if (match) {
      return { service: 'spotify', id: match[1] };
    }
    var url;
    try {
      url = new URL(value);
    } catch (error) {
      return null;
    }
    var host = url.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtu.be') {
      match = url.pathname.match(/^\/([A-Za-z0-9_-]{11})/);
      return match ? { service: 'youtube', id: match[1] } : null;
    }
    if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
      var v = url.searchParams.get('v');
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) {
        return { service: 'youtube', id: v };
      }
      match = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/);
      return match ? { service: 'youtube', id: match[1] } : null;
    }
    if (host === 'open.spotify.com') {
      match = url.pathname.match(/^\/(?:intl-[a-z-]+\/)?(?:embed\/)?track\/([A-Za-z0-9]{22})/);
      return match ? { service: 'spotify', id: match[1] } : null;
    }
    if (host === 'music.apple.com' || host === 'itunes.apple.com' || host === 'geo.music.apple.com') {
      var songId = url.searchParams.get('i');
      if (songId && /^\d+$/.test(songId)) {
        return { service: 'apple', id: songId };
      }
      match = url.pathname.match(/\/song\/(?:[^/]+\/)?(\d+)/);
      return match ? { service: 'apple', id: match[1] } : null;
    }
    return null;
  }

  var TITLE_NOISE = /\s*[([](?:official|lyric|lyrics|audio|video|music video|visualizer|hd|hq|4k|mv|explicit|clean|remaster(?:ed)?(?: \d{4})?|color coded)[^)\]]*[)\]]/gi;

  // "The Weeknd - Blinding Lights (Official Video)" -> {artist, title}
  function cleanYouTubeTitle(rawTitle, author) {
    var title = String(rawTitle || '').replace(TITLE_NOISE, '').replace(/\s+/g, ' ').trim();
    var artist = String(author || '').replace(/VEVO$/i, '').replace(/\s*-\s*Topic$/i, '').trim();
    var parts = title.split(/\s+[-–—|]\s+/);
    if (parts.length >= 2) {
      artist = parts[0].trim();
      title = parts.slice(1).join(' - ').trim();
    }
    title = title.replace(/\s*(?:ft\.?|feat\.?)\s.*$/i, '').trim();
    return { artist: artist, title: title };
  }

  function tokens(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\(.*?\)|\[.*?\]/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .filter(function (t) { return t && t !== 'the' && t !== 'feat' && t !== 'ft'; });
  }

  function similarity(a, b) {
    var ta = tokens(a);
    var tb = tokens(b);
    if (!ta.length || !tb.length) {
      return 0;
    }
    var setB = {};
    tb.forEach(function (t) { setB[t] = true; });
    var common = ta.filter(function (t) { return setB[t]; }).length;
    return (2 * common) / (ta.length + tb.length);
  }

  // candidates: [{title, artist, duration}] ; wanted: {title, artist, duration}
  // Returns { candidate, score } or null when nothing is a confident match.
  function bestMatch(candidates, wanted, minScore) {
    var threshold = minScore == null ? 0.6 : minScore;
    var best = null;
    (candidates || []).forEach(function (candidate) {
      var score = similarity(candidate.title, wanted.title) * 0.6;
      if (wanted.artist) {
        score += similarity(candidate.artist, wanted.artist) * 0.4;
      } else {
        score = score / 0.6 * 0.85; // title-only evidence is weaker
      }
      if (wanted.duration && candidate.duration) {
        var diff = Math.abs(candidate.duration - wanted.duration);
        if (diff > 20) {
          score -= 0.25;
        } else if (diff < 4) {
          score += 0.05;
        }
      }
      if (!best || score > best.score) {
        best = { candidate: candidate, score: score };
      }
    });
    return best && best.score >= threshold ? best : null;
  }

  function formatTime(seconds) {
    var s = isFinite(seconds) && seconds > 0 ? seconds : 0;
    var minutes = Math.floor(s / 60);
    var rest = Math.floor(s % 60);
    return minutes + ':' + (rest < 10 ? '0' : '') + rest;
  }

  var api = {
    CODE_LENGTH: CODE_LENGTH,
    SERVICES: SERVICES,
    makeCode: makeCode,
    normalizeCode: normalizeCode,
    makeId: makeId,
    estimateOffset: estimateOffset,
    expectedPosition: expectedPosition,
    correction: correction,
    initialState: initialState,
    canControl: canControl,
    sanitizeTrack: sanitizeTrack,
    reduce: reduce,
    rebaseState: rebaseState,
    successor: successor,
    pickSource: pickSource,
    parseLink: parseLink,
    cleanYouTubeTitle: cleanYouTubeTitle,
    similarity: similarity,
    bestMatch: bestMatch,
    formatTime: formatTime,
  };

  root.SyncCore = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof self !== 'undefined' ? self : this);
