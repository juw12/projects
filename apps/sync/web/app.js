/* Sync — app shell, UI and the playback sync loop. */
(function () {
  'use strict';

  var core = window.SyncCore;
  var catalog = window.SyncCatalog;
  var Players = window.SyncPlayers;
  var config = window.SYNC_CONFIG || {};
  var VERSION = '1.0.0';
  var TICK_MS = 250;
  var DUCK_LEVEL = 0.3;
  var REACTIONS = ['🔥', '😍', '🙌', '💃', '😂', '🎉'];
  var SERVICE_LABELS = { file: 'Shared file', youtube: 'YouTube', spotify: 'Spotify', apple: 'Apple Music' };

  var root = document.getElementById('app');
  var room = null;
  var voice = null;
  var tickTimer = null;
  var lastMembers = null;
  var openAttach = null;

  /* ---------- preferences ---------- */

  var prefs = (function () {
    var saved = {};
    try {
      saved = JSON.parse(localStorage.getItem('sync.prefs') || '{}');
    } catch (error) {
      saved = {};
    }
    return {
      name: saved.name || '',
      service: saved.service || 'auto',
      duck: saved.duck !== false,
      volume: saved.volume != null ? saved.volume : 1,
      nudge: 0,
    };
  })();

  function savePrefs() {
    localStorage.setItem('sync.prefs', JSON.stringify({
      name: prefs.name,
      service: prefs.service,
      duck: prefs.duck,
      volume: prefs.volume,
    }));
  }

  /* ---------- helpers ---------- */

  function $(selector, scope) {
    return (scope || document).querySelector(selector);
  }

  function $all(selector, scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function hue(text) {
    var h = 0;
    for (var i = 0; i < text.length; i++) {
      h = (h * 31 + text.charCodeAt(i)) % 360;
    }
    return h;
  }

  function initials(name) {
    var parts = String(name || '?').trim().split(/\s+/);
    return ((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }

  function toast(message, kind, action) {
    var box = $('#toasts');
    if (!box) {
      return;
    }
    var el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = message;
    if (action) {
      var button = document.createElement('button');
      button.textContent = action.label;
      button.onclick = action.run;
      el.appendChild(button);
    }
    box.appendChild(el);
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { el.remove(); }, 400);
    }, action ? 12000 : 4200);
  }

  function inviteLink(code) {
    return location.origin + location.pathname + '?room=' + code;
  }

  function myId() {
    return room && room.myId();
  }

  function isHost() {
    return !!(room && room.isHost);
  }

  function canControl() {
    return !!(room && room.state && core.canControl(room.state, myId()));
  }

  /* ================= landing ================= */

  function renderLanding(prefillCode) {
    stopRoom();
    document.title = 'Sync — listen together, live';
    root.innerHTML =
      '<main class="landing">' +
      '  <section class="hero">' +
      '    <div class="brand"><span class="logo-mark" aria-hidden="true"></span><h1>Sync</h1></div>' +
      '    <p class="tagline">Listen together in real time, from anywhere.</p>' +
      '    <ul class="pitch">' +
      '      <li><span>🎧</span>Same song, same second, different cities. No shared Wi-Fi or Bluetooth.</li>' +
      '      <li><span>🔀</span>Spotify, Apple Music and YouTube listeners in one room.</li>' +
      '      <li><span>🎙️</span>Voice chat that lowers the music while friends talk.</li>' +
      '    </ul>' +
      '  </section>' +
      '  <section class="card join-card">' +
      (prefillCode ? '<p class="invite-note">You were invited to room <b>' + esc(prefillCode) + '</b></p>' : '') +
      '    <label class="field"><span>Your name</span><input id="name" maxlength="40" autocomplete="nickname" placeholder="e.g. Maya"></label>' +
      '    <label class="field"><span>I listen on</span>' +
      '      <select id="service">' +
      '        <option value="auto">Anything that works (free)</option>' +
      '        <option value="spotify">Spotify</option>' +
      '        <option value="apple">Apple Music</option>' +
      '        <option value="youtube">YouTube / YouTube Music</option>' +
      '      </select></label>' +
      (prefillCode
        ? '    <button id="join-invite" class="primary big">Join room ' + esc(prefillCode) + '</button>' +
          '    <div class="or"><span>or</span></div>' +
          '    <button id="create" class="ghost">Start my own room</button>'
        : '    <button id="create" class="primary big">Start a room</button>' +
          '    <div class="or"><span>or join a friend</span></div>' +
          '    <form id="join-form" class="row"><input id="code" placeholder="Room code" maxlength="12" autocapitalize="characters" autocomplete="off" spellcheck="false"><button type="submit">Join</button></form>') +
      '    <p class="fine">No account or install. Music, voice and chat go directly between browsers.</p>' +
      '  </section>' +
      '  <section class="how">' +
      '    <div><b>1</b><p>Start a room and send the invite link.</p></div>' +
      '    <div><b>2</b><p>Search a song, paste a link or share your own file.</p></div>' +
      '    <div><b>3</b><p>Everyone hears it at the same moment. Join voice to talk over it.</p></div>' +
      '  </section>' +
      '  <footer class="foot">Sync ' + VERSION + ' · <a href="https://github.com/juwpegatron/projects/tree/main/apps/sync" target="_blank" rel="noopener">Source</a></footer>' +
      '</main>' +
      '<div id="toasts" class="toasts" aria-live="polite"></div>';

    $('#name').value = prefs.name;
    $('#service').value = prefs.service;

    function begin(code, create) {
      var name = $('#name').value.trim();
      if (!name) {
        $('#name').focus();
        toast('Add your name so friends know who joined.', 'warn');
        return;
      }
      prefs.name = name;
      prefs.service = $('#service').value;
      savePrefs();
      unlockAudio();
      enterRoom(code, create);
    }

    $('#create').onclick = function () {
      begin(core.makeCode(), true);
    };
    if (prefillCode) {
      $('#join-invite').onclick = function () {
        begin(prefillCode, false);
      };
    } else {
      $('#join-form').onsubmit = function (event) {
        event.preventDefault();
        var code = core.normalizeCode($('#code').value);
        if (!code) {
          toast('Room codes are 6 letters or numbers.', 'warn');
          return;
        }
        begin(code, false);
      };
    }
  }

  // Play a silent buffer inside the click so mobile browsers allow audio later.
  function unlockAudio() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        var ctx = new Ctx();
        var buffer = ctx.createBuffer(1, 1, 22050);
        var source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
        setTimeout(function () { ctx.close(); }, 500);
      }
    } catch (error) {
      // best effort
    }
  }

  /* ================= room ================= */

  function enterRoom(code, create) {
    renderRoomShell(code);
    history.replaceState(null, '', '?room=' + code);
    document.title = 'Sync · Room ' + code;

    room = new window.SyncRoom.Room({ code: code, name: prefs.name, create: create });
    voice = new window.SyncVoice.Voice(room);

    room.on('ready', function (info) {
      toast(info.host ? 'Room ready. Send friends the invite link!' : 'You joined room ' + code + '.', 'good');
    });
    room.on('state', onState);
    room.on('status', function (status) {
      var pill = $('#conn');
      if (pill) {
        pill.className = 'pill ' + status.level;
        pill.textContent = status.text;
      }
    });
    room.on('chat', function (msg) {
      addChat(msg.name, msg.text, msg.from === myId());
    });
    room.on('react', function (msg) {
      floatReaction(msg.emoji, msg.name);
    });
    room.on('error', function (message) {
      toast(message, 'bad');
    });
    room.on('call', function (call) {
      voice.handleIncoming(call);
    });
    room.on('not-found', function () {
      toast('Room ' + code + ' isn’t live. Check the code, or ask the host to open Sync.', 'bad');
      renderLanding();
    });
    room.on('code-taken', function () {
      room.leave();
      enterRoom(core.makeCode(), true);
    });
    room.on('file-ready', function () {
      tick();
      renderQueue();
    });
    room.on('file-progress', function (info) {
      if (info.direction === 'down') {
        renderQueue();
      }
    });

    voice.addListener('change', renderVoice);
    voice.addListener('speaking', renderSpeaking);
    voice.addListener('needs-gesture', showGesture);

    room.start();
    tickTimer = setInterval(tick, TICK_MS);
  }

  function stopRoom() {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    teardownPlayer();
    if (voice) {
      voice.leave();
      voice = null;
    }
    if (room) {
      room.leave();
      room = null;
    }
    lastMembers = null;
  }

  function renderRoomShell(code) {
    root.innerHTML =
      '<div class="room">' +
      '  <header class="topbar">' +
      '    <div class="brand small"><span class="logo-mark" aria-hidden="true"></span><b>Sync</b></div>' +
      '    <button id="invite" class="code-chip" title="Copy invite link">Room <b>' + esc(code) + '</b><span>Invite</span></button>' +
      '    <div id="avatars" class="avatars"></div>' +
      '    <span id="conn" class="pill warn">Connecting…</span>' +
      '    <button id="settings-btn" class="icon-btn" aria-label="Settings" title="Settings">⚙</button>' +
      '    <button id="leave" class="icon-btn" aria-label="Leave room" title="Leave room">✕</button>' +
      '  </header>' +
      '  <section class="stage card">' +
      '    <div id="media" class="media">' +
      '      <img id="art" alt="" hidden>' +
      '      <div id="art-empty" class="art-empty"><span class="logo-mark big" aria-hidden="true"></span></div>' +
      '      <div id="video-slot" class="video-slot"></div>' +
      '      <div id="reactions" class="reactions" aria-hidden="true"></div>' +
      '    </div>' +
      '    <div class="np-info">' +
      '      <div class="np-titles"><h2 id="np-title">Nothing playing yet</h2><p id="np-artist" class="muted">Add a song below to get the party started</p></div>' +
      '      <div class="np-badges"><span id="np-source" class="badge" hidden></span><span id="sync-pill" class="pill" hidden></span></div>' +
      '      <div id="embed-slot" class="embed-slot"></div>' +
      '      <div id="np-notice" class="notice" hidden></div>' +
      '      <div class="progress"><span id="t-now">0:00</span><input id="seek" type="range" min="0" max="100" step="0.1" value="0" aria-label="Seek"><span id="t-total">0:00</span></div>' +
      '      <div class="controls">' +
      '        <button id="prev" class="round" aria-label="Previous">⏮</button>' +
      '        <button id="play" class="round primary big-round" aria-label="Play">▶</button>' +
      '        <button id="next" class="round" aria-label="Next">⏭</button>' +
      '      </div>' +
      '      <div class="react-bar">' + REACTIONS.map(function (e) {
        return '<button class="react" data-emoji="' + e + '" aria-label="React ' + e + '">' + e + '</button>';
      }).join('') + '</div>' +
      '      <div class="fine-tune"><span>My timing</span><button data-nudge="-0.1" aria-label="Play earlier">−0.1s</button><b id="nudge-val">0.0s</b><button data-nudge="0.1" aria-label="Play later">+0.1s</button></div>' +
      '    </div>' +
      '  </section>' +
      '  <section class="add card">' +
      '    <div class="tabs" role="tablist">' +
      '      <button role="tab" data-tab="search" class="active">Search</button>' +
      '      <button role="tab" data-tab="link">Paste link</button>' +
      '      <button role="tab" data-tab="upload">Share a file</button>' +
      '    </div>' +
      '    <div data-pane="search"><form id="search-form" class="row"><input id="search-q" placeholder="Search songs or artists" autocomplete="off"><button type="submit">Search</button></form><div id="results" class="results"></div></div>' +
      '    <div data-pane="link" hidden><form id="link-form" class="row"><input id="link-input" placeholder="Spotify, Apple Music or YouTube song link" autocomplete="off"><button type="submit">Add</button></form>' +
      '      <p class="fine">Sync finds the same song on other services when it can, so everyone hears it on the service they use.</p></div>' +
      '    <div data-pane="upload" hidden><label class="drop" id="drop"><input id="file-input" type="file" accept="audio/*" multiple hidden>' +
      '      <b>Drop audio files or tap to browse</b><small>Your own music. It’s sent straight to everyone in the room and plays for all, no account needed. Only share music you have the rights to.</small></label></div>' +
      '  </section>' +
      '  <section class="queue card"><h3>Up next <span id="queue-count" class="muted"></span></h3><ol id="queue" class="queue-list"></ol></section>' +
      '  <aside class="party card">' +
      '    <h3>Party</h3>' +
      '    <div class="voice-row"><button id="voice-btn" class="primary">🎙️ Join voice</button><button id="mute-btn" hidden>Mute</button></div>' +
      '    <label class="toggle"><input id="duck" type="checkbox"><span>Lower music when friends talk</span></label>' +
      '    <p class="fine" id="voice-hint">Headphones recommended so your mic doesn’t pick up the music.</p>' +
      '    <ul id="members" class="members"></ul>' +
      '    <div class="chat"><div id="chat-log" class="chat-log" aria-live="polite"></div>' +
      '      <form id="chat-form" class="row"><input id="chat-input" placeholder="Say something…" maxlength="500" autocomplete="off"><button type="submit">Send</button></form></div>' +
      '  </aside>' +
      '  <dialog id="settings" class="sheet">' +
      '    <form method="dialog">' +
      '      <h3>Settings</h3>' +
      '      <label class="field"><span>I listen on</span><select id="set-service">' +
      '        <option value="auto">Anything that works (free)</option><option value="spotify">Spotify</option>' +
      '        <option value="apple">Apple Music</option><option value="youtube">YouTube / YouTube Music</option></select></label>' +
      '      <div id="apple-box" class="fine"></div>' +
      '      <label class="field"><span>Volume</span><input id="set-volume" type="range" min="0" max="1" step="0.05"></label>' +
      '      <label class="field" id="dj-field"><span>Who can control playback</span><select id="set-dj"><option value="everyone">Everyone</option><option value="host">Only me (host)</option></select></label>' +
      '      <p class="fine">Spotify plays full songs if you’re logged in to Spotify Premium in this browser, otherwise 30-second previews. Volume and auto-lowering don’t work in the Spotify player.</p>' +
      '      <p class="fine">Privacy: there’s no Sync server. Room state, chat, voice and shared files go directly between browsers. A public matchmaking server only introduces the browsers to each other.</p>' +
      '      <div class="row end"><button value="close" class="primary">Done</button></div>' +
      '    </form>' +
      '  </dialog>' +
      '  <div id="gesture" class="gesture" hidden><button id="gesture-btn" class="primary big">🔊 Tap to start audio</button><p>Your browser needs one tap before it plays sound.</p></div>' +
      '  <div id="toasts" class="toasts" aria-live="polite"></div>' +
      '</div>';
    wireRoom(code);
  }

  function wireRoom(code) {
    $('#invite').onclick = function () {
      var link = inviteLink(code);
      if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
        navigator.share({ title: 'Listen with me on Sync', text: 'Join my Sync room ' + code, url: link }).catch(function () {});
        return;
      }
      (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject())
        .then(function () {
          toast('Invite link copied. Send it to your friends!', 'good');
        }, function () {
          window.prompt('Send this link to your friends:', link);
        });
    };
    $('#leave').onclick = function () {
      history.replaceState(null, '', location.pathname);
      renderLanding();
    };
    $('#settings-btn').onclick = openSettings;

    $('#play').onclick = function () {
      unlockAudio();
      room.intent({ type: room.state && room.state.playing ? 'pause' : 'play' });
    };
    $('#prev').onclick = function () { room.intent({ type: 'prev' }); };
    $('#next').onclick = function () { room.intent({ type: 'next' }); };
    var seek = $('#seek');
    seek.addEventListener('input', function () {
      seek.dataset.dragging = '1';
      $('#t-now').textContent = core.formatTime(Number(seek.value));
    });
    seek.addEventListener('change', function () {
      delete seek.dataset.dragging;
      room.intent({ type: 'seek', position: Number(seek.value) });
    });

    $all('.react').forEach(function (button) {
      button.onclick = function () {
        room.react(button.dataset.emoji);
      };
    });
    $all('[data-nudge]').forEach(function (button) {
      button.onclick = function () {
        prefs.nudge = Math.round((prefs.nudge + Number(button.dataset.nudge)) * 10) / 10;
        prefs.nudge = Math.max(-3, Math.min(3, prefs.nudge));
        $('#nudge-val').textContent = (prefs.nudge > 0 ? '+' : '') + prefs.nudge.toFixed(1) + 's';
      };
    });

    $all('[data-tab]').forEach(function (tab) {
      tab.onclick = function () {
        $all('[data-tab]').forEach(function (t) { t.classList.toggle('active', t === tab); });
        $all('[data-pane]').forEach(function (pane) { pane.hidden = pane.dataset.pane !== tab.dataset.tab; });
      };
    });

    $('#search-form').onsubmit = function (event) {
      event.preventDefault();
      runSearch($('#search-q').value.trim());
    };
    $('#link-form').onsubmit = function (event) {
      event.preventDefault();
      addFromLink($('#link-input').value.trim());
    };
    $('#file-input').onchange = function (event) {
      shareFiles(event.target.files);
      event.target.value = '';
    };
    var drop = $('#drop');
    ['dragenter', 'dragover'].forEach(function (name) {
      drop.addEventListener(name, function (event) {
        event.preventDefault();
        drop.classList.add('over');
      });
    });
    ['dragleave', 'drop'].forEach(function (name) {
      drop.addEventListener(name, function (event) {
        event.preventDefault();
        drop.classList.remove('over');
      });
    });
    drop.addEventListener('drop', function (event) {
      shareFiles(event.dataTransfer.files);
    });

    $('#voice-btn').onclick = function () {
      if (voice.on) {
        voice.leave();
        return;
      }
      voice.join().catch(function (error) {
        toast(error.message, 'bad');
      });
    };
    $('#mute-btn').onclick = function () {
      voice.setMuted(!voice.muted);
    };
    $('#duck').checked = prefs.duck;
    $('#duck').onchange = function (event) {
      prefs.duck = event.target.checked;
      savePrefs();
    };

    $('#chat-form').onsubmit = function (event) {
      event.preventDefault();
      var input = $('#chat-input');
      room.chat(input.value);
      input.value = '';
    };

    $('#gesture-btn').onclick = function () {
      hideGesture();
      unlockAudio();
      engine.playTries = 0;
      engine.lastPlayTry = 0;
      if (engine.player && room.state && room.state.playing) {
        try {
          engine.player.seek(core.expectedPosition(room.state, room.hostNow()) + prefs.nudge);
          var attempt = engine.player.play();
          if (attempt && attempt.catch) {
            attempt.catch(function () {});
          }
        } catch (error) {
          // retried by the sync loop
        }
      }
      $all('audio.voice-audio').forEach(function (el) {
        el.play().catch(function () {});
      });
    };
  }

  /* ---------- settings ---------- */

  function openSettings() {
    var dialog = $('#settings');
    $('#set-service').value = prefs.service;
    $('#set-volume').value = prefs.volume;
    var djField = $('#dj-field');
    $('#set-dj').value = room.state ? room.state.dj : 'everyone';
    $('#set-dj').disabled = !isHost();
    djField.title = isHost() ? '' : 'Only the host can change this';
    var appleBox = $('#apple-box');
    if (Players.appleConfigured()) {
      appleBox.innerHTML = Players.appleReady()
        ? 'Apple Music connected ✓'
        : '<button type="button" id="apple-connect">Connect Apple Music</button> to play full songs from your subscription.';
      var connect = $('#apple-connect');
      if (connect) {
        connect.onclick = function () {
          Players.connectApple().then(function () {
            toast('Apple Music connected.', 'good');
            engine.key = null;
            openSettings();
          }, function (error) {
            toast(error.message || 'Could not connect Apple Music.', 'bad');
          });
        };
      }
    } else {
      appleBox.textContent = 'Apple Music listeners: full-song Apple Music playback isn’t enabled on this site yet, so you’ll hear the YouTube version in sync.';
    }
    $('#set-service').onchange = function (event) {
      prefs.service = event.target.value;
      savePrefs();
      engine.key = null; // rebuild the player with the new preference
      renderQueue();
    };
    $('#set-volume').oninput = function (event) {
      prefs.volume = Number(event.target.value);
      savePrefs();
    };
    $('#set-dj').onchange = function (event) {
      room.intent({ type: 'setDj', mode: event.target.value });
    };
    if (dialog.showModal) {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  /* ---------- adding music ---------- */

  function runSearch(term) {
    var box = $('#results');
    if (!term) {
      return;
    }
    box.innerHTML = '<p class="muted">Searching…</p>';
    catalog.searchApple(term, 12).then(function (results) {
      if (!results.length) {
        box.innerHTML = '<p class="muted">No songs found. Try another spelling, or paste a link.</p>';
        return;
      }
      box.innerHTML = '';
      results.forEach(function (result) {
        var row = document.createElement('div');
        row.className = 'result';
        row.innerHTML =
          '<img src="' + esc(result.artwork.replace('600x600', '120x120')) + '" alt="" loading="lazy">' +
          '<div class="meta"><b>' + esc(result.title) + '</b><span>' + esc(result.artist) + ' · ' + core.formatTime(result.duration) + '</span></div>' +
          '<button type="button">+ Add</button>';
        $('button', row).onclick = function (event) {
          var button = event.currentTarget;
          button.disabled = true;
          button.textContent = 'Adding…';
          catalog.fromAppleResult(result).then(function (track) {
            room.intent({ type: 'enqueue', track: track });
            button.textContent = 'Added ✓';
          }, function () {
            button.disabled = false;
            button.textContent = '+ Add';
            toast('Could not add that song.', 'bad');
          });
        };
        box.appendChild(row);
      });
    }, function () {
      box.innerHTML = '<p class="muted">Search is unavailable right now. You can still paste a link.</p>';
    });
  }

  function addFromLink(text) {
    if (!text) {
      return;
    }
    var button = $('#link-form button');
    button.disabled = true;
    button.textContent = 'Matching…';
    catalog.resolveLink(text).then(function (track) {
      room.intent({ type: 'enqueue', track: track });
      var found = Object.keys(track.sources).map(function (s) { return SERVICE_LABELS[s]; });
      toast('Added “' + track.title + '” · available on ' + found.join(', '), 'good');
      $('#link-input').value = '';
    }, function (error) {
      toast(error.message || 'Could not read that link.', 'bad');
    }).finally(function () {
      button.disabled = false;
      button.textContent = 'Add';
    });
  }

  function audioDuration(file) {
    return new Promise(function (resolve) {
      var probe = document.createElement('audio');
      var url = URL.createObjectURL(file);
      var finish = function (value) {
        URL.revokeObjectURL(url);
        resolve(value);
      };
      probe.preload = 'metadata';
      probe.onloadedmetadata = function () {
        finish(isFinite(probe.duration) ? probe.duration : null);
      };
      probe.onerror = function () {
        finish(undefined);
      };
      probe.src = url;
    });
  }

  function shareFiles(fileList) {
    var maxBytes = (config.maxUploadMb || 40) * 1024 * 1024;
    Array.prototype.slice.call(fileList || []).forEach(function (file) {
      if (!/^audio\//.test(file.type) && !/\.(mp3|m4a|aac|wav|ogg|oga|flac|opus|webm)$/i.test(file.name)) {
        toast(file.name + ' isn’t an audio file.', 'warn');
        return;
      }
      if (file.size > maxBytes) {
        toast(file.name + ' is larger than ' + (config.maxUploadMb || 40) + ' MB.', 'warn');
        return;
      }
      shareFile(file).catch(function (error) {
        toast(error.message || 'Could not share ' + file.name, 'bad');
      });
    });
  }

  function shareFile(file) {
    return audioDuration(file).then(function (duration) {
      if (duration === undefined) {
        throw new Error('This browser can’t play ' + file.name + '.');
      }
      if (!room.isHost) {
        toast('Sending “' + file.name + '” to the room…');
      }
      return room.shareFile(file).then(function (source) {
        var title = file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
        var parts = title.split(/\s+-\s+/);
        var track = {
          id: core.makeId('t'),
          title: parts.length > 1 ? parts.slice(1).join(' - ') : title,
          artist: parts.length > 1 ? parts[0] : 'Shared by ' + prefs.name,
          duration: duration,
          sources: { file: source },
        };
        room.intent({ type: 'enqueue', track: track });
        return track;
      });
    });
  }

  /* ---------- state rendering ---------- */

  function onState(state) {
    announceMembership(state);
    renderNowPlaying();
    renderQueue();
    renderMembers();
    renderControls();
    if (voice) {
      voice.reconcile(state);
    }
    tick();
  }

  function announceMembership(state) {
    var current = {};
    state.members.forEach(function (m) { current[m.id] = m.name; });
    if (lastMembers) {
      Object.keys(current).forEach(function (id) {
        if (!lastMembers[id] && id !== myId()) {
          addSystem(current[id] + ' joined');
        }
      });
      Object.keys(lastMembers).forEach(function (id) {
        if (!current[id] && id !== myId()) {
          addSystem(lastMembers[id] + ' left');
        }
      });
    }
    lastMembers = current;
  }

  function currentTrack() {
    var state = room && room.state;
    return state && state.index >= 0 ? state.queue[state.index] : null;
  }

  function renderNowPlaying() {
    var track = currentTrack();
    $('#np-title').textContent = track ? track.title : 'Nothing playing yet';
    $('#np-artist').textContent = track ? (track.artist || ' ') : 'Add a song below to get the party started';
    var art = $('#art');
    if (track && track.artwork) {
      if (art.getAttribute('src') !== track.artwork) {
        art.src = track.artwork;
      }
      art.hidden = false;
    } else {
      art.hidden = true;
      art.removeAttribute('src');
    }
    $('#art-empty').hidden = !!(track && track.artwork);
  }

  function renderControls() {
    var state = room.state;
    var allowed = canControl();
    $('#play').textContent = state.playing ? '⏸' : '▶';
    $('#play').setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
    ['#play', '#prev', '#next', '#seek'].forEach(function (sel) {
      $(sel).disabled = !allowed || !currentTrack();
    });
    $('#play').title = allowed ? '' : 'The host controls playback';
  }

  function sourceChips(track) {
    return core.SERVICES.filter(function (s) { return track.sources[s]; }).map(function (s) {
      return '<span class="chip chip-' + s + '">' + SERVICE_LABELS[s] + '</span>';
    }).join('');
  }

  function renderQueue() {
    var list = $('#queue');
    if (!list || !room || !room.state) {
      return;
    }
    var state = room.state;
    $('#queue-count').textContent = state.queue.length ? state.queue.length + ' song' + (state.queue.length > 1 ? 's' : '') : '';
    if (!state.queue.length) {
      list.innerHTML = '<li class="empty">The queue is empty. Search, paste a link or share a file to add a song.</li>';
      return;
    }
    var allowed = canControl();
    list.innerHTML = '';
    state.queue.forEach(function (track, index) {
      var item = document.createElement('li');
      item.className = 'q-item' + (index === state.index ? ' current' : '') + (index < state.index ? ' played' : '');
      var mine = core.pickSource(track, { service: prefs.service, appleReady: Players.appleReady() });
      var wanted = prefs.service === 'auto' ? null : prefs.service;
      var missing = wanted && !track.sources.file && !track.sources[wanted] && !(wanted === 'apple' && !Players.appleConfigured());
      var fileState = '';
      if (track.sources.file && room) {
        var progress = room.fileProgress(track.sources.file.fileId);
        fileState = progress >= 1 ? '' : progress > 0 ? ' · downloading ' + Math.round(progress * 100) + '%' : '';
      }
      item.innerHTML =
        '<span class="q-num">' + (index === state.index && state.playing ? '<i class="eq"><b></b><b></b><b></b></i>' : index + 1) + '</span>' +
        (track.artwork ? '<img src="' + esc(track.artwork.replace('600x600', '120x120')) + '" alt="" loading="lazy">' : '<span class="q-art"></span>') +
        '<div class="q-meta"><b>' + esc(track.title) + '</b><span>' + esc(track.artist || '') +
        (track.addedBy ? ' · added by ' + esc(track.addedBy) : '') + esc(fileState) + '</span>' +
        '<div class="chips">' + sourceChips(track) +
        (mine ? '' : '<span class="chip chip-missing">No source for you</span>') + '</div></div>' +
        '<div class="q-actions">' +
        (missing ? '<button class="mini attach" type="button">+ ' + SERVICE_LABELS[wanted] + ' link</button>' : '') +
        (allowed && index !== state.index ? '<button class="mini play-this" type="button" aria-label="Play now">▶</button>' : '') +
        (allowed ? '<button class="mini remove" type="button" aria-label="Remove">✕</button>' : '') +
        '</div>';
      var playThis = $('.play-this', item);
      if (playThis) {
        playThis.onclick = function () { room.intent({ type: 'select', index: index }); };
      }
      var remove = $('.remove', item);
      if (remove) {
        remove.onclick = function () { room.intent({ type: 'remove', index: index }); };
      }
      var attach = $('.attach', item);
      if (attach) {
        attach.onclick = function () {
          openAttach = openAttach === track.id ? null : track.id;
          renderQueue();
        };
      }
      list.appendChild(item);
      if (openAttach === track.id && missing) {
        list.appendChild(attachForm(track, wanted));
      }
    });
  }

  function attachForm(track, service) {
    var li = document.createElement('li');
    li.className = 'attach-form';
    li.innerHTML =
      '<p>Find “' + esc(track.title) + '” on ' + SERVICE_LABELS[service] + ', copy the song link and paste it here. Everyone on ' +
      SERVICE_LABELS[service] + ' will get it.</p>' +
      '<div class="row"><a class="btn-link" target="_blank" rel="noopener" href="' + esc(catalog.searchUrl(service, track)) + '">Search ' + SERVICE_LABELS[service] + ' ↗</a>' +
      '<input placeholder="Paste ' + SERVICE_LABELS[service] + ' link"><button type="button">Attach</button></div>';
    $('button', li).onclick = function () {
      var link = core.parseLink($('input', li).value);
      if (!link || link.service !== service) {
        toast('That isn’t a ' + SERVICE_LABELS[service] + ' song link.', 'warn');
        return;
      }
      room.intent({ type: 'attach', trackId: track.id, service: service, value: link.id });
      openAttach = null;
      toast('Linked. ' + SERVICE_LABELS[service] + ' listeners will hear this one now.', 'good');
    };
    return li;
  }

  function renderMembers() {
    var state = room.state;
    var speaking = voice ? voice.speaking : new Set();
    $('#avatars').innerHTML = state.members.slice(0, 6).map(function (m) {
      return '<span class="avatar' + (speaking.has(m.id) ? ' speaking' : '') + '" style="--h:' + hue(m.id) + '" title="' + esc(m.name) + '">' + esc(initials(m.name)) + '</span>';
    }).join('') + (state.members.length > 6 ? '<span class="avatar more">+' + (state.members.length - 6) + '</span>' : '');
    $('#members').innerHTML = state.members.map(function (m) {
      return '<li data-id="' + esc(m.id) + '" class="' + (speaking.has(m.id) ? 'speaking' : '') + '">' +
        '<span class="avatar" style="--h:' + hue(m.id) + '">' + esc(initials(m.name)) + '</span>' +
        '<span class="m-name">' + esc(m.name) + (m.id === myId() ? ' <em>(you)</em>' : '') + '</span>' +
        (m.id === state.hostId ? '<span class="tag-host" title="Host">host</span>' : '') +
        (m.voice ? '<span class="m-voice" title="In voice">🎙️</span>' : '') +
        '</li>';
    }).join('');
  }

  function renderSpeaking() {
    if (room && room.state) {
      renderMembers();
    }
  }

  function renderVoice() {
    if (!voice || !$('#voice-btn')) {
      return;
    }
    $('#voice-btn').textContent = voice.on ? 'Leave voice' : '🎙️ Join voice';
    $('#voice-btn').classList.toggle('primary', !voice.on);
    $('#mute-btn').hidden = !voice.on;
    $('#mute-btn').textContent = voice.muted ? 'Unmute' : 'Mute';
    $('#mute-btn').classList.toggle('danger', voice.muted);
    var peers = voice.connectedPeers().length;
    $('#voice-hint').textContent = voice.on
      ? (peers ? 'Talking with ' + peers + ' friend' + (peers > 1 ? 's' : '') + '. Headphones recommended.' : 'You’re in voice. Waiting for friends to join…')
      : 'Headphones recommended so your mic doesn’t pick up the music.';
  }

  /* ---------- chat + reactions ---------- */

  function addChat(name, text, mine) {
    var log = $('#chat-log');
    if (!log) {
      return;
    }
    var line = document.createElement('div');
    line.className = 'msg' + (mine ? ' mine' : '');
    line.innerHTML = '<b style="--h:' + hue(name) + '">' + esc(name) + '</b> ' + esc(text);
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  function addSystem(text) {
    var log = $('#chat-log');
    if (!log) {
      return;
    }
    var line = document.createElement('div');
    line.className = 'msg system';
    line.textContent = text;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  function floatReaction(emoji, name) {
    var layer = $('#reactions');
    if (!layer) {
      return;
    }
    var el = document.createElement('span');
    el.className = 'float';
    el.textContent = emoji;
    el.title = name || '';
    el.style.left = (10 + Math.random() * 80) + '%';
    el.style.setProperty('--drift', (Math.random() * 60 - 30) + 'px');
    layer.appendChild(el);
    setTimeout(function () { el.remove(); }, 2600);
  }

  /* ================= playback sync engine ================= */

  var engine = {
    key: null,
    player: null,
    kind: null,
    loading: false,
    error: null,
    lastSeek: 0,
    lastPlayTry: 0,
    playTries: 0,
    endedFor: null,
    duck: 1,
    appliedVolume: null,
    drift: null,
  };

  function teardownPlayer() {
    if (engine.player) {
      try {
        engine.player.destroy();
      } catch (error) {
        // ignore
      }
    }
    engine.player = null;
    engine.kind = null;
    engine.loading = false;
    engine.key = null;
  }

  function ensurePlayer(track) {
    var kind = track ? core.pickSource(track, { service: prefs.service, appleReady: Players.appleReady() }) : null;
    var fileReady = '';
    if (kind === 'file') {
      fileReady = room.fileUrl(track.sources.file.fileId) ? 'ready' : 'waiting';
    }
    var key = track ? [track.id, kind, fileReady].join(':') : 'none';
    if (key === engine.key) {
      return;
    }
    teardownPlayer();
    engine.key = key;
    engine.error = null;
    engine.endedFor = null;
    engine.playTries = 0;
    engine.lastPlayTry = 0;
    engine.appliedVolume = null;
    showMediaFor(kind);
    if (!track || !kind) {
      return;
    }
    var source;
    if (kind === 'file') {
      source = room.fileUrl(track.sources.file.fileId);
      if (!source) {
        room.requestFile(track.sources.file.fileId);
        return;
      }
    } else {
      source = track.sources[kind];
    }
    var container = kind === 'youtube' ? $('#video-slot') : $('#embed-slot');
    var player;
    try {
      player = Players.create(kind, container);
    } catch (error) {
      engine.error = error.message;
      return;
    }
    engine.player = player;
    engine.kind = kind;
    engine.loading = true;
    var startAt = core.expectedPosition(room.state, room.hostNow()) + prefs.nudge;
    player.load(source, startAt).then(function () {
      if (engine.player === player) {
        engine.loading = false;
        tick();
      }
    }, function (error) {
      if (engine.player === player) {
        engine.loading = false;
        engine.error = error.message || 'Could not load this song.';
      }
    });
  }

  function showMediaFor(kind) {
    var media = $('#media');
    if (media) {
      media.dataset.kind = kind || 'none';
    }
    var badge = $('#np-source');
    if (badge) {
      badge.hidden = !kind;
      badge.className = 'badge chip-' + (kind || '');
      badge.textContent = kind ? 'via ' + SERVICE_LABELS[kind] : '';
    }
  }

  function setSync(level, text) {
    var pill = $('#sync-pill');
    if (!pill) {
      return;
    }
    pill.hidden = !text;
    pill.className = 'pill ' + level;
    pill.textContent = text;
  }

  function setNotice(text) {
    var notice = $('#np-notice');
    if (!notice) {
      return;
    }
    if (notice.textContent !== (text || '')) {
      notice.textContent = text || '';
    }
    notice.hidden = !text;
  }

  function showGesture() {
    var el = $('#gesture');
    if (el) {
      el.hidden = false;
    }
  }

  function hideGesture() {
    var el = $('#gesture');
    if (el) {
      el.hidden = true;
    }
  }

  function applyVolume(player) {
    if (!player.caps.volume) {
      return;
    }
    var target = prefs.duck && voice && voice.othersSpeaking() ? DUCK_LEVEL : 1;
    engine.duck += (target - engine.duck) * 0.45;
    var volume = Math.round(prefs.volume * engine.duck * 100) / 100;
    if (engine.appliedVolume === null || Math.abs(volume - engine.appliedVolume) >= 0.01) {
      try {
        player.setVolume(volume);
        engine.appliedVolume = volume;
      } catch (error) {
        // player not ready
      }
    }
  }

  function updateProgress(position, duration) {
    var seek = $('#seek');
    if (!seek) {
      return;
    }
    var total = duration || 0;
    seek.max = total || 100;
    if (!seek.dataset.dragging) {
      seek.value = Math.min(position, total || 0);
      $('#t-now').textContent = core.formatTime(position);
    }
    $('#t-total').textContent = core.formatTime(total);
  }

  function tick() {
    if (!room || !room.state || !$('#seek')) {
      return;
    }
    var state = room.state;
    var track = currentTrack();
    ensurePlayer(track);
    var player = engine.player;
    var expected = core.expectedPosition(state, room.hostNow());
    var duration = (player && !engine.loading && player.duration && player.duration()) || (track && track.duration) || 0;
    updateProgress(expected, duration);

    if (!track) {
      setSync('', '');
      setNotice('');
      return;
    }
    if (!engine.kind && !engine.player) {
      if (track.sources.file) {
        var pct = Math.round(room.fileProgress(track.sources.file.fileId) * 100);
        setSync('warn', 'Getting song from the room… ' + pct + '%');
        setNotice('');
      } else {
        setSync('bad', 'No source for you');
        setNotice(prefs.service === 'spotify'
          ? 'This song has no Spotify link yet. Tap “+ Spotify link” in the queue, or switch to “Anything that works” in Settings.'
          : 'No playable version for your service. Paste a YouTube link for it, or change your service in Settings.');
      }
      return;
    }
    if (engine.error) {
      setSync('bad', 'Can’t play');
      setNotice(engine.error);
      return;
    }
    if (!player || engine.loading) {
      setSync('warn', 'Loading…');
      return;
    }

    var now = performance.now();
    var target = expected + prefs.nudge;
    var caps = player.caps;
    applyVolume(player);

    var playerDuration = player.duration();
    if (engine.kind === 'spotify' && player.isPreview && player.isPreview(track.duration)) {
      setNotice('Spotify is playing a 30-second preview. Log in to Spotify Premium in this browser for full songs, or pick YouTube in Settings.');
    } else {
      setNotice('');
    }

    if (playerDuration && target >= playerDuration - 0.25) {
      if (!player.paused()) {
        player.pause();
      }
      if (state.playing && engine.endedFor !== state.v) {
        engine.endedFor = state.v;
        room.intent({ type: 'ended', index: state.index, duration: playerDuration });
      }
      setSync('good', 'Song finished');
      return;
    }

    if (!state.playing) {
      if (!player.paused()) {
        player.pause();
      }
      if (Math.abs(player.time() - target) > Math.max(0.5, caps.hardThreshold) && now - engine.lastSeek > 1000) {
        player.seek(Math.max(0, target));
        engine.lastSeek = now;
      }
      player.setRate(1);
      setSync('good', 'Paused · in sync');
      hideGesture();
      return;
    }

    if (player.paused()) {
      if (now - engine.lastPlayTry > 1500) {
        engine.lastPlayTry = now;
        engine.playTries += 1;
        player.seek(Math.max(0, target + (caps.seekLead || 0)));
        engine.lastSeek = now;
        try {
          var attempt = player.play();
          if (attempt && attempt.catch) {
            attempt.catch(function () {
              showGesture();
            });
          }
        } catch (error) {
          showGesture();
        }
        if (engine.playTries >= 3) {
          showGesture();
        }
      }
      setSync('warn', 'Starting…');
      return;
    }

    engine.playTries = 0;
    hideGesture();
    if (now - engine.lastSeek < caps.cooldown * 1000) {
      setSync('warn', 'Syncing…');
      return;
    }
    var drift = player.time() - target;
    engine.drift = drift;
    var fix = core.correction(drift, caps);
    if (fix.action === 'seek') {
      player.seek(Math.max(0, target + (caps.seekLead || 0)));
      player.setRate(1);
      engine.lastSeek = now;
      setSync('warn', 'Re-syncing…');
      return;
    }
    player.setRate(fix.rate);
    var ms = Math.round(drift * 1000);
    setSync(Math.abs(drift) <= caps.softThreshold ? 'good' : 'warn', 'In sync · ' + (ms > 0 ? '+' : '') + ms + ' ms');
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      tick();
    }
  });

  /* ---------- service worker (installable app + offline shell) ---------- */

  function registerWorker() {
    if (!('serviceWorker' in navigator) || location.protocol !== 'https:') {
      return;
    }
    navigator.serviceWorker.register('sw.js').then(function (registration) {
      registration.addEventListener('updatefound', function () {
        var worker = registration.installing;
        if (!worker) {
          return;
        }
        worker.addEventListener('statechange', function () {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            toast('A new version of Sync is ready.', '', {
              label: 'Update',
              run: function () {
                worker.postMessage({ type: 'ACTIVATE_UPDATE' });
              },
            });
          }
        });
      });
    }).catch(function () {});
    var reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!reloaded) {
        reloaded = true;
        location.reload();
      }
    });
  }

  /* ---------- boot ---------- */

  window.__sync = {
    version: VERSION,
    room: function () { return room; },
    voice: function () { return voice; },
    engine: engine,
    prefs: prefs,
    shareFile: function (file) { return shareFile(file); },
    enter: function (code, create, name) {
      prefs.name = name || prefs.name || 'Tester';
      enterRoom(code, create);
    },
  };

  var params = new URLSearchParams(location.search);
  renderLanding(core.normalizeCode(params.get('room')));
  registerWorker();
})();
