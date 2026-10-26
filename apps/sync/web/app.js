/* Sync — app shell, UI and the playback sync loop. */
(function () {
  'use strict';

  var core = window.SyncCore;
  var catalog = window.SyncCatalog;
  var Players = window.SyncPlayers;
  var config = window.SYNC_CONFIG || {};
  var VERSION = '1.3.0';
  var TICK_MS = 250;
  var DUCK_LEVEL = 0.3;
  var REACTIONS = ['❤️', '🔥', '😍', '🙌', '💃', '😂', '🎉'];
  var PIP_CORNERS = ['br', 'bl', 'tr', 'tl'];
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
      videoView: saved.videoView === true,
      pipCorner: PIP_CORNERS.indexOf(saved.pipCorner) >= 0 ? saved.pipCorner : 'br',
      nudge: 0,
    };
  })();

  function savePrefs() {
    localStorage.setItem('sync.prefs', JSON.stringify({
      name: prefs.name,
      service: prefs.service,
      duck: prefs.duck,
      volume: prefs.volume,
      videoView: prefs.videoView,
      pipCorner: prefs.pipCorner,
    }));
  }

  /* ---------- icons (inline SVG, stroke = currentColor) ---------- */

  var ICON_PATHS = {
    play: '<path d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.6-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
    prev: '<path d="M18 6.5v11a1 1 0 0 1-1.55.83L9 13v4.5" fill="none"/><path d="M18 6.5v11a1 1 0 0 1-1.55.83L9.6 12.8a1 1 0 0 1 0-1.6l6.85-4.53A1 1 0 0 1 18 6.5z" fill="currentColor" stroke="none"/><rect x="5.5" y="6" width="2.4" height="12" rx="1" fill="currentColor" stroke="none"/>',
    next: '<path d="M6 6.5v11a1 1 0 0 0 1.55.83l6.85-4.53a1 1 0 0 0 0-1.6L7.55 5.67A1 1 0 0 0 6 6.5z" fill="currentColor" stroke="none"/><rect x="16.1" y="6" width="2.4" height="12" rx="1" fill="currentColor" stroke="none"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    leave: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.2 1.2"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.2-1.2"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
    micOff: '<path d="M15 9.5V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.9 2.3M5.5 11a6.5 6.5 0 0 0 10.4 5.2M18.5 11a6.4 6.4 0 0 1-.5 2.4M12 17.5V21M3 3l18 18"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    upload: '<path d="M12 15V4M7 9l5-5 5 5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    queue: '<path d="M4 6h12M4 12h12M4 18h7"/><circle cx="18" cy="17" r="2.5"/><path d="M20.5 17V9l-2.5-1"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M21.5 20a6.5 6.5 0 0 0-4-6"/>',
    disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    music: '<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
    send: '<path d="M21 3L10 14M21 3l-6.5 18-4.5-7-7-4.5z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    shuffle: '<path d="M16 4h4v4M4 20L20 4M20 16v4h-4M14.5 14.5L20 20M4 4l5 5"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    playSmall: '<path d="M9 6.5v11l9-5.5z" fill="currentColor" stroke="none"/>',
    grip: '<circle cx="9" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.3" fill="currentColor" stroke="none"/>',
    heart: '<path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.5 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.5 0 5.6 3.5 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" fill="currentColor" stroke="none"/>',
  };

  function icon(name) {
    return '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON_PATHS[name] || '') + '</svg>';
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
      '<div class="ambient" aria-hidden="true"><span></span><span></span><span></span></div>' +
      '<div class="landing">' +
      '  <nav class="landing-nav">' +
      '    <span class="brand"><span class="logo" aria-hidden="true"></span>Sync</span>' +
      '    <a class="src" href="https://github.com/juw12/projects/tree/main/apps/sync" target="_blank" rel="noopener">Source</a>' +
      '  </nav>' +
      '  <main class="landing-main">' +
      '    <section>' +
      '      <p class="eyebrow">Real-time listening rooms</p>' +
      '      <h1 class="headline">Same song.<br>Same second.<br><em>Anywhere.</em></h1>' +
      '      <p class="lede">Start a room, send the link, and hear every beat together, even if you’re in different cities. No account, no app, no shared Wi-Fi.</p>' +
      '      <div class="join-card">' +
      (prefillCode ? '<p class="invite-note">You’re invited to room <b>' + esc(prefillCode) + '</b></p>' : '') +
      '        <div class="split">' +
      '          <label class="field"><span>Your name</span><input id="name" maxlength="40" autocomplete="nickname" placeholder="Maya"></label>' +
      '          <label class="field"><span>I listen on</span>' +
      '            <select id="service">' +
      '              <option value="auto">Anything</option>' +
      '              <option value="spotify">Spotify</option>' +
      '              <option value="apple">Apple Music</option>' +
      '              <option value="youtube">YouTube</option>' +
      '            </select></label>' +
      '        </div>' +
      (prefillCode
        ? '        <button id="join-invite" class="accent big">Join room ' + esc(prefillCode) + '</button>' +
          '        <button id="create" class="ghost">or start your own room</button>'
        : '        <button id="create" class="accent big">Start a room</button>' +
          '        <div class="or">or join a friend</div>' +
          '        <form id="join-form" class="row"><input id="code" class="code-input" placeholder="Room code" maxlength="12" autocapitalize="characters" autocomplete="off" spellcheck="false"><button type="submit">Join</button></form>') +
      '      </div>' +
      '      <ul class="features">' +
      '        <li>' + icon('shuffle') + 'Spotify, Apple Music &amp; YouTube in one room</li>' +
      '        <li>' + icon('mic') + 'Voice chat that lowers the music</li>' +
      '        <li>' + icon('upload') + 'Share your own tracks</li>' +
      '      </ul>' +
      '    </section>' +
      '    <div class="hero-visual" aria-hidden="true">' +
      '      <div class="ring"></div><div class="ring"></div>' +
      '      <div class="record"></div>' +
      '      <div class="listener l1"><span class="av" style="--h:340">M</span><div>Maya<small>Jakarta · 0:42</small></div><span class="bars"><b></b><b></b><b></b></span></div>' +
      '      <div class="listener l2"><span class="av" style="--h:200">K</span><div>Kenji<small>Tokyo · 0:42</small></div><span class="bars"><b></b><b></b><b></b></span></div>' +
      '      <div class="listener l3"><span class="av" style="--h:40">L</span><div>Lena<small>Berlin · 0:42</small></div><span class="bars"><b></b><b></b><b></b></span></div>' +
      '    </div>' +
      '  </main>' +
      '  <footer class="landing-foot">' +
      '    <span><b>1</b> Start a room</span><span><b>2</b> Share the link</span><span><b>3</b> Press play together</span>' +
      '    <span>Sync ' + VERSION + '</span>' +
      '  </footer>' +
      '</div>' +
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
        pill.className = 'status ' + status.level;
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
      '<div class="room" data-view="stage">' +
      '  <div class="ambient" aria-hidden="true"><span></span><span></span><span></span></div>' +
      '  <header class="topbar">' +
      '    <span class="brand"><span class="logo" aria-hidden="true"></span><span class="word">Sync</span></span>' +
      '    <button id="invite" class="room-chip" title="Copy invite link"><span class="code">' + esc(code) + '</span><span class="copy">' + icon('link') + 'Invite</span></button>' +
      '    <span class="spacer"></span>' +
      '    <div id="avatars" class="avatars"></div>' +
      '    <span id="conn" class="status warn">Connecting</span>' +
      '    <button id="settings-btn" class="icon" aria-label="Settings" title="Settings">' + icon('settings') + '</button>' +
      '    <button id="leave" class="icon" aria-label="Leave room" title="Leave room">' + icon('leave') + '</button>' +
      '  </header>' +
      '  <div id="video-pip-anchor" class="video-anchor pip" aria-hidden="true"></div>' +
      '  <div id="video-float" class="video-float" hidden><button id="pip-grip" class="pip-grip" type="button" aria-label="Drag to move the video" title="Drag to move"><span></span></button><div id="video-slot" class="video-slot"></div></div>' +
      '  <main class="room-grid">' +
      '    <aside class="panel queue-panel">' +
      '      <div class="panel-head"><h3>Up next<small id="queue-count"></small></h3><button class="add-open icon sm" aria-label="Add music" title="Add music">' + icon('plus') + '</button></div>' +
      '      <div class="panel-body"><ol id="queue" class="queue-list"></ol></div>' +
      '    </aside>' +
      '    <section class="stage">' +
      '      <div class="art-wrap" id="art-wrap">' +
      '        <div class="vinyl" aria-hidden="true"></div>' +
      '        <div id="media" class="media">' +
      '          <img id="art" alt="" hidden>' +
      '          <div id="art-empty" class="art-empty">' + icon('disc') + '</div>' +
      '        </div>' +
      '        <div id="art-heart" class="art-heart" aria-hidden="true">' + icon('heart') + '</div>' +
      '        <div id="swipe-hint" class="swipe-hint" aria-hidden="true"></div>' +
      '      </div>' +
      '      <div id="video-hero-anchor" class="video-anchor hero" aria-hidden="true"></div>' +
      '      <div class="np-titles"><h2 id="np-title">Nothing playing yet</h2><p id="np-artist">Add a song to get the party started</p></div>' +
      '      <div class="np-badges"><span id="np-source" class="badge" hidden></span><span id="sync-pill" class="badge" hidden></span><button id="view-toggle" class="view-toggle" hidden></button></div>' +
      '      <div id="embed-slot" class="embed-slot"></div>' +
      '      <div id="np-notice" class="notice" hidden></div>' +
      '      <div id="stage-cta" class="empty-cta"><button class="add-open accent">' + icon('plus') + 'Add music</button></div>' +
      '      <div id="player-ui" class="empty-cta" hidden>' +
      '        <div class="progress"><span id="t-now">0:00</span><div class="seek-wrap"><input id="seek" type="range" min="0" max="100" step="0.1" value="0" aria-label="Seek"><output id="scrub" class="scrub" hidden></output></div><span id="t-total">0:00</span></div>' +
      '        <div class="controls">' +
      '          <button id="prev" class="icon" aria-label="Previous">' + icon('prev') + '</button>' +
      '          <button id="play" class="play-btn" aria-label="Play">' + icon('play') + '</button>' +
      '          <button id="next" class="icon" aria-label="Next">' + icon('next') + '</button>' +
      '        </div>' +
      '        <div class="under">' +
      '          <div id="reactions" class="reactions" aria-hidden="true"></div>' +
      '          <div class="react-bar">' + REACTIONS.map(function (e) {
        return '<button class="react" data-emoji="' + e + '" aria-label="React ' + e + '">' + e + '</button>';
      }).join('') + '</div>' +
      '          <div class="fine-tune" title="Nudge your playback if your version of the song starts earlier or later">Timing<button data-nudge="-0.1" aria-label="Play earlier">−0.1</button><b id="nudge-val">0.0s</b><button data-nudge="0.1" aria-label="Play later">+0.1</button></div>' +
      '        </div>' +
      '      </div>' +
      '      <div id="video-dock-anchor" class="video-anchor dock" aria-hidden="true"></div>' +
      '    </section>' +
      '    <aside class="panel party-panel">' +
      '      <div class="panel-head"><h3>Party<small id="party-count"></small></h3></div>' +
      '      <div class="voice-card">' +
      '        <div class="voice-row"><button id="voice-btn" class="primary">' + icon('mic') + 'Join voice</button><button id="mute-btn" hidden>' + icon('mic') + 'Mute</button></div>' +
      '        <label class="toggle"><span>Lower music when friends talk</span><input id="duck" type="checkbox"></label>' +
      '        <p class="fine" id="voice-hint">Headphones recommended so your mic doesn’t pick up the music.</p>' +
      '      </div>' +
      '      <ul id="members" class="members"></ul>' +
      '      <div class="divider"></div>' +
      '      <div class="chat"><div id="chat-log" class="chat-log" aria-live="polite"></div>' +
      '        <form id="chat-form" class="chat-form"><input id="chat-input" placeholder="Say something…" maxlength="500" autocomplete="off"><button type="submit" class="primary" aria-label="Send">' + icon('send') + '</button></form></div>' +
      '    </aside>' +
      '  </main>' +
      '  <div class="mini" id="mini" role="button" tabindex="0" aria-label="Open now playing"><span id="mini-art" class="q-art">' + icon('music') + '</span><div class="meta"><b id="mini-title"></b><span id="mini-artist"></span></div><button id="mini-play" aria-label="Play or pause">' + icon('play') + '</button><i class="mini-progress" aria-hidden="true"></i></div>' +
      '  <nav class="tabbar" aria-label="Room sections"><span class="tab-ink" aria-hidden="true"></span>' +
      '    <button data-show="stage" class="active">' + icon('disc') + 'Playing</button>' +
      '    <button data-show="queue">' + icon('queue') + 'Queue</button>' +
      '    <button data-show="party">' + icon('users') + 'Party</button>' +
      '  </nav>' +
      '  <dialog id="add-sheet" class="sheet"><div class="sheet-grab" aria-hidden="true"></div>' +
      '    <div class="sheet-head"><h3>Add music</h3><button class="icon sm" id="add-close" aria-label="Close">' + icon('x') + '</button></div>' +
      '    <div class="sheet-body">' +
      '      <div class="segmented" role="tablist">' +
      '        <button role="tab" data-tab="search" class="active">Search</button>' +
      '        <button role="tab" data-tab="link">Paste link</button>' +
      '        <button role="tab" data-tab="upload">Your file</button>' +
      '      </div>' +
      '      <div data-pane="search"><form id="search-form" class="search-box">' + icon('search') + '<input id="search-q" placeholder="Songs or artists" autocomplete="off"><button type="submit" class="primary">Search</button></form><div id="results" class="results"></div></div>' +
      '      <div data-pane="link" hidden><form id="link-form" class="search-box">' + icon('link') + '<input id="link-input" placeholder="Spotify, Apple Music or YouTube link" autocomplete="off"><button type="submit" class="primary">Add</button></form>' +
      '        <p class="fine" style="margin-top:10px">Sync finds the same song on other services when it can, so everyone hears it on the service they use.</p></div>' +
      '      <div data-pane="upload" hidden><label class="drop" id="drop"><input id="file-input" type="file" accept="audio/*" multiple hidden>' + icon('upload') +
      '        <b>Drop audio files or tap to browse</b><small>Sent straight to everyone in the room and plays for all, no account needed. Only share music you have the rights to.</small></label></div>' +
      '    </div>' +
      '  </dialog>' +
      '  <dialog id="settings" class="sheet settings"><div class="sheet-grab" aria-hidden="true"></div>' +
      '    <form method="dialog">' +
      '      <h3>Settings</h3>' +
      '      <label class="field"><span>I listen on</span><select id="set-service">' +
      '        <option value="auto">Anything that works (free)</option><option value="spotify">Spotify</option>' +
      '        <option value="apple">Apple Music</option><option value="youtube">YouTube / YouTube Music</option></select></label>' +
      '      <div id="apple-box" class="fine"></div>' +
      '      <label class="field"><span>Volume</span><input id="set-volume" type="range" min="0" max="1" step="0.05"></label>' +
      '      <label class="field" id="dj-field"><span>Who can control playback</span><select id="set-dj"><option value="everyone">Everyone</option><option value="host">Only me (host)</option></select></label>' +
      '      <p class="fine">Spotify plays full songs if you’re logged in to Spotify Premium in this browser, otherwise 30-second previews. Volume and auto-lowering don’t work in the Spotify player.</p>' +
      '      <p class="fine">Privacy: there’s no Sync server. Room state, chat, voice and shared files go directly between browsers.</p>' +
      '      <div class="row end"><button value="close" class="primary">Done</button></div>' +
      '    </form>' +
      '  </dialog>' +
      '  <div id="gesture" class="gesture" hidden><button id="gesture-btn" class="accent big">Tap to start audio</button><p>Your browser needs one tap before it plays sound.</p></div>' +
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
      var value = Number(seek.value);
      var max = Number(seek.max) || 1;
      var pct = Math.min(100, (value / max) * 100);
      $('#t-now').textContent = core.formatTime(value);
      seek.style.setProperty('--pct', pct.toFixed(2) + '%');
      var scrub = $('#scrub');
      scrub.textContent = core.formatTime(value);
      scrub.style.left = pct.toFixed(2) + '%';
      scrub.hidden = false;
    });
    seek.addEventListener('change', function () {
      delete seek.dataset.dragging;
      $('#scrub').hidden = true;
      haptic();
      room.intent({ type: 'seek', position: Number(seek.value) });
    });

    $all('.react').forEach(function (button) {
      button.onclick = function () {
        haptic();
        button.classList.remove('pop');
        void button.offsetWidth;
        button.classList.add('pop');
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

    $all('.segmented [data-tab]').forEach(function (tab) {
      tab.onclick = function () {
        $all('.segmented [data-tab]').forEach(function (t) { t.classList.toggle('active', t === tab); });
        $all('[data-pane]').forEach(function (pane) { pane.hidden = pane.dataset.pane !== tab.dataset.tab; });
        var input = $('[data-pane="' + tab.dataset.tab + '"] input:not([type=file])');
        if (input) {
          input.focus();
        }
      };
    });
    var sheet = $('#add-sheet');
    root.addEventListener('click', function (event) {
      var opener = event.target.closest && event.target.closest('.add-open');
      if (opener) {
        if (sheet.showModal) {
          sheet.showModal();
        } else {
          sheet.setAttribute('open', '');
        }
        setTimeout(function () {
          var first = $('#search-q');
          if (first && !$('[data-pane="search"]').hidden) {
            first.focus();
          }
        }, 50);
      }
    });
    $('#add-close').onclick = function () {
      sheet.close();
    };
    sheet.addEventListener('click', function (event) {
      if (event.target === sheet) {
        sheet.close(); // click on the backdrop
      }
    });
    $all('.tabbar [data-show]').forEach(function (tab) {
      tab.onclick = function () {
        switchTab(tab.dataset.show);
      };
    });
    $('#view-toggle').onclick = function () {
      prefs.videoView = !prefs.videoView;
      savePrefs();
      applyVideoView();
    };
    applyVideoView();
    if (!placeVideo.timer) {
      placeVideo.timer = setInterval(placeVideo, 400);
    }
    $('.stage').addEventListener('scroll', placeVideo, { passive: true });
    window.addEventListener('resize', placeVideo);
    if (window.ResizeObserver) {
      var anchorObserver = new ResizeObserver(placeVideo);
      $all('.video-anchor, .stage').forEach(function (el) { anchorObserver.observe(el); });
    }
    $('#mini-play').onclick = function (event) {
      event.stopPropagation();
      haptic();
      $('#play').click();
    };
    $('#mini').addEventListener('click', function () {
      switchTab('stage');
    });
    $('#mini').addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        switchTab('stage');
      }
    });
    wireInteractions();

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
      toast('Added “' + track.title + '” · on ' + found.join(', '), 'good');
      $('#link-input').value = '';
      var sheetEl = $('#add-sheet');
      if (sheetEl && sheetEl.open) {
        sheetEl.close();
      }
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
    var roomEl = $('.room');
    if (roomEl) {
      roomEl.classList.toggle('has-track', !!track);
    }
    var trackKey = track ? track.id : '';
    if (trackKey !== renderNowPlaying.lastKey) {
      renderNowPlaying.lastKey = trackKey;
      retrigger($('.np-titles'), 'swap');
      retrigger($('#media'), 'swap');
    }
    $('#np-title').textContent = track ? track.title : 'Nothing playing yet';
    $('#np-artist').textContent = track ? (track.artist || ' ') : 'Add a song to get the party started';
    $('#stage-cta').hidden = !!track;
    $('#player-ui').hidden = !track;
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
    $('#mini-title').textContent = track ? track.title : '';
    $('#mini-artist').textContent = track ? (track.artist || '') : '';
    var mini = $('#mini-art');
    mini.outerHTML = track && track.artwork
      ? '<img id="mini-art" src="' + esc(track.artwork.replace('600x600', '120x120')) + '" alt="">'
      : '<span id="mini-art" class="q-art">' + icon('music') + '</span>';
    applyTint(track);
  }

  /* ---------- ambient tint from cover art ---------- */

  var tintCache = {};
  var tintKey = null;

  function setTint(rgb) {
    var roomEl = $('.room');
    if (!roomEl || !rgb) {
      return;
    }
    var hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    var sat = Math.max(55, Math.min(90, hsl[1]));
    var light = Math.max(52, Math.min(66, hsl[2]));
    document.documentElement.style.setProperty('--tint', 'hsl(' + hsl[0] + ' ' + sat + '% ' + light + '%)');
    document.documentElement.style.setProperty('--tint-2', 'hsl(' + ((hsl[0] + 48) % 360) + ' ' + sat + '% ' + (light - 6) + '%)');
  }

  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var h = 0;
    var s = 0;
    var l = (max + min) / 2;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) {
        h = (g - b) / d + (g < b ? 6 : 0);
      } else if (max === g) {
        h = (b - r) / d + 2;
      } else {
        h = (r - g) / d + 4;
      }
      h *= 60;
    }
    return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
  }

  // Most vivid average colour of the artwork (saturated pixels weigh more).
  function sampleArtwork(url) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = 24;
          canvas.height = 24;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, 24, 24);
          var data = ctx.getImageData(0, 0, 24, 24).data;
          var total = [0, 0, 0];
          var weight = 0;
          for (var i = 0; i < data.length; i += 4) {
            var max = Math.max(data[i], data[i + 1], data[i + 2]);
            var min = Math.min(data[i], data[i + 1], data[i + 2]);
            var w = (max - min) / 255 + 0.05;
            if (max < 25) {
              w *= 0.2;
            }
            total[0] += data[i] * w;
            total[1] += data[i + 1] * w;
            total[2] += data[i + 2] * w;
            weight += w;
          }
          resolve([total[0] / weight, total[1] / weight, total[2] / weight]);
        } catch (error) {
          resolve(null);
        }
      };
      img.onerror = function () {
        resolve(null);
      };
      img.src = url;
    });
  }

  function applyTint(track) {
    var key = track ? (track.artwork || track.id) : 'none';
    if (key === tintKey) {
      return;
    }
    tintKey = key;
    if (!track) {
      document.documentElement.style.removeProperty('--tint');
      document.documentElement.style.removeProperty('--tint-2');
      return;
    }
    var fallback = function () {
      var h = hue(track.title + track.artist);
      var rgbFromHue = hslToRgb(h, 75, 60);
      setTint(rgbFromHue);
    };
    if (!track.artwork) {
      fallback();
      return;
    }
    if (tintCache[track.artwork]) {
      setTint(tintCache[track.artwork]);
      return;
    }
    sampleArtwork(track.artwork.replace('600x600', '100x100')).then(function (rgb) {
      if (tintKey !== key) {
        return;
      }
      if (rgb) {
        tintCache[track.artwork] = rgb;
        setTint(rgb);
      } else {
        fallback();
      }
    });
  }

  function hslToRgb(h, s, l) {
    s /= 100;
    l /= 100;
    var k = function (n) { return (n + h / 30) % 12; };
    var a = s * Math.min(l, 1 - l);
    var f = function (n) { return l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); };
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
  }

  function renderControls() {
    var state = room.state;
    var allowed = canControl();
    var roomEl = $('.room');
    if (roomEl) {
      roomEl.classList.toggle('is-playing', !!(state.playing && currentTrack()));
    }
    if (renderControls.lastPlaying !== !!state.playing) {
      renderControls.lastPlaying = !!state.playing;
      retrigger($('#play'), 'pop');
    }
    $('#play').innerHTML = icon(state.playing ? 'pause' : 'play');
    $('#mini-play').innerHTML = icon(state.playing ? 'pause' : 'play');
    $('#play').setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
    ['#play', '#prev', '#next', '#seek', '#mini-play'].forEach(function (sel) {
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
    if (queueDrag) {
      queueDrag.dirty = true;
      return;
    }
    var list = $('#queue');
    if (!list || !room || !room.state) {
      return;
    }
    var state = room.state;
    $('#queue-count').textContent = state.queue.length ? String(state.queue.length) : '';
    if (!state.queue.length) {
      list.innerHTML = '<li class="empty">' + icon('music') + '<span>Nothing queued yet.<br>Search a song, paste a link or share a file.</span>' +
        '<button class="add-open primary">' + icon('plus') + 'Add music</button></li>';
      return;
    }
    var allowed = canControl();
    list.innerHTML = '';
    state.queue.forEach(function (track, index) {
      var item = document.createElement('li');
      item.className = 'q-item' + (index === state.index ? ' current' : '') + (index < state.index ? ' played' : '') + (allowed ? ' sortable' : '');
      item.dataset.index = String(index);
      var mine = core.pickSource(track, { service: prefs.service, appleReady: Players.appleReady() });
      var wanted = prefs.service === 'auto' ? null : prefs.service;
      var missing = wanted && !track.sources.file && !track.sources[wanted] && !(wanted === 'apple' && !Players.appleConfigured());
      var fileState = '';
      if (track.sources.file && room) {
        var progress = room.fileProgress(track.sources.file.fileId);
        fileState = progress >= 1 ? '' : progress > 0 ? ' · ' + Math.round(progress * 100) + '%' : '';
      }
      item.innerHTML =
        '<span class="q-num">' + (index === state.index && state.playing ? '<i class="eq"><b></b><b></b><b></b></i>' : index + 1) + '</span>' +
        (track.artwork ? '<img src="' + esc(track.artwork.replace('600x600', '120x120')) + '" alt="" loading="lazy">' : '<span class="q-art">' + icon('music') + '</span>') +
        '<div class="q-meta"><b>' + esc(track.title) + '</b><span>' + esc(track.artist || '') +
        (track.addedBy ? ' · ' + esc(track.addedBy) : '') + esc(fileState) + '</span>' +
        '<div class="chips">' + sourceChips(track) +
        (mine ? '' : '<span class="chip chip-missing">No source for you</span>') + '</div></div>' +
        '<div class="q-actions' + (missing ? ' always' : '') + '">' +
        (missing ? '<button class="attach" type="button">+ ' + SERVICE_LABELS[wanted] + '</button>' : '') +
        (allowed && index !== state.index ? '<button class="play-this" type="button" aria-label="Play now" title="Play now">' + icon('playSmall') + '</button>' : '') +
        (allowed ? '<button class="remove" type="button" aria-label="Remove" title="Remove">' + icon('x') + '</button>' : '') +
        '</div>' +
        (allowed && state.queue.length > 1 ? '<button class="q-grip" type="button" aria-label="Drag to reorder" title="Drag to reorder">' + icon('grip') + '</button>' : '');
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
    $('#party-count').textContent = String(state.members.length);
    $('#avatars').innerHTML = state.members.slice(0, 5).map(function (m) {
      return '<span class="av' + (speaking.has(m.id) ? ' speaking' : '') + '" style="--h:' + hue(m.id) + '" title="' + esc(m.name) + '">' + esc(initials(m.name)) + '</span>';
    }).join('') + (state.members.length > 5 ? '<span class="av more">+' + (state.members.length - 5) + '</span>' : '');
    $('#members').innerHTML = state.members.map(function (m) {
      return '<li data-id="' + esc(m.id) + '" class="' + (speaking.has(m.id) ? 'speaking' : '') + '">' +
        '<span class="av" style="--h:' + hue(m.id) + '">' + esc(initials(m.name)) + '</span>' +
        '<span class="m-name">' + esc(m.name) + (m.id === myId() ? ' <em>you</em>' : '') + '</span>' +
        (m.id === state.hostId ? '<span class="tag-host" title="Host">Host</span>' : '') +
        (m.voice ? '<span class="m-voice" title="In voice">' + icon('mic') + '</span>' : '') +
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
    $('#voice-btn').innerHTML = voice.on ? icon('leave') + 'Leave voice' : icon('mic') + 'Join voice';
    $('#voice-btn').className = voice.on ? '' : 'primary';
    $('#mute-btn').hidden = !voice.on;
    $('#mute-btn').innerHTML = voice.muted ? icon('micOff') + 'Unmute' : icon('mic') + 'Mute';
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
    var previous = log.lastElementChild;
    var continued = !!(previous && previous.dataset.name === name && !previous.classList.contains('system'));
    line.className = 'msg' + (mine ? ' mine' : '') + (continued ? ' cont' : '');
    line.dataset.name = name;
    line.innerHTML = '<b style="--h:' + hue(name) + '">' + esc(name) + '</b><span>' + esc(text) + '</span>';
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


  /* ---------- YouTube video placement ----------
     YouTube's embed rules: the player must stay visible (at least 200x200 px) with nothing drawn
     over it. The iframe is created once inside #video-float and never moved in the DOM (moving an
     iframe reloads it), so we position the float over whichever anchor is visible: the hero spot
     (Video view), a card under the controls (Cover view), or a mini window on the phone's other tabs. */
  /* ================= interactions (gestures, haptics, motion) ================= */

  var REDUCED_MOTION = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var TAB_ORDER = ['stage', 'queue', 'party'];
  var queueDrag = null;
  var pipDrag = null;

  function haptic(pattern) {
    // Android browsers buzz; iOS Safari has no vibration API and ignores this.
    if (navigator.vibrate && !REDUCED_MOTION) {
      try {
        navigator.vibrate(pattern || 8);
      } catch (error) {
        // unsupported or blocked: purely cosmetic
      }
    }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function retrigger(el, className) {
    if (!el) {
      return;
    }
    el.classList.remove(className);
    void el.offsetWidth; // restart the CSS animation
    el.classList.add(className);
  }

  function isPhoneLayout() {
    return !!(window.matchMedia && window.matchMedia('(max-width: 960px)').matches) ||
      document.body.classList.contains('layout-mobile');
  }

  function switchTab(name) {
    var roomEl = $('.room');
    if (!roomEl || TAB_ORDER.indexOf(name) < 0) {
      return;
    }
    if (roomEl.dataset.view !== name) {
      haptic(6);
    }
    roomEl.dataset.view = name;
    $all('.tabbar [data-show]').forEach(function (tab) {
      var active = tab.dataset.show === name;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-current', active ? 'page' : 'false');
    });
    var tabbar = $('.tabbar');
    if (tabbar) {
      tabbar.style.setProperty('--tab', String(TAB_ORDER.indexOf(name)));
    }
    placeVideo();
  }

  function wireInteractions() {
    wireArtGestures();
    wireQueueDrag();
    wirePipDrag();
    $all('dialog.sheet').forEach(wireSheetDrag);
  }

  // Cover art: swipe left/right to skip (if you can control playback), double-tap to send a heart.
  function wireArtGestures() {
    var wrap = $('#art-wrap');
    var media = $('#media');
    var hint = $('#swipe-hint');
    if (!wrap || !media || !hint) {
      return;
    }
    var art = $('#art');
    if (art) {
      art.draggable = false;
    }
    var gesture = null;
    var lastTap = 0;

    wrap.addEventListener('pointerdown', function (event) {
      if (event.button !== 0 || !currentTrack()) {
        return;
      }
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, swiping: false };
    });

    wrap.addEventListener('pointermove', function (event) {
      if (!gesture || event.pointerId !== gesture.id) {
        return;
      }
      var dx = event.clientX - gesture.x;
      var dy = event.clientY - gesture.y;
      if (!gesture.swiping) {
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.3 && canControl()) {
          gesture.swiping = true;
          wrap.setPointerCapture(event.pointerId);
          media.classList.add('dragging');
        } else if (Math.abs(dy) > 12) {
          gesture = null; // vertical scroll wins
          return;
        } else {
          return;
        }
      }
      gesture.dx = dx;
      media.style.transform = 'translateX(' + dx + 'px) rotate(' + (dx / 24).toFixed(2) + 'deg)';
      hint.dataset.side = dx < 0 ? 'right' : 'left';
      hint.innerHTML = dx < 0 ? 'Next' + icon('next') : icon('prev') + 'Previous';
      hint.style.opacity = String(clamp(Math.abs(dx) / 90, 0, 1));
    });

    function finish(event) {
      if (!gesture || event.pointerId !== gesture.id) {
        return;
      }
      var done = gesture;
      gesture = null;
      hint.style.opacity = '0';
      media.classList.remove('dragging');
      if (done.swiping) {
        var commit = event.type === 'pointerup' && Math.abs(done.dx) > Math.min(110, wrap.offsetWidth * 0.3);
        if (commit) {
          var direction = done.dx < 0 ? -1 : 1;
          media.style.transform = 'translateX(' + (direction * wrap.offsetWidth * 1.2) + 'px) rotate(' + (direction * 14) + 'deg)';
          media.style.opacity = '0';
          haptic(12);
          room.intent({ type: direction < 0 ? 'next' : 'prev' });
          setTimeout(function () {
            media.style.transform = '';
            media.style.opacity = '';
          }, 260);
        } else {
          media.style.transform = '';
        }
        return;
      }
      if (event.type !== 'pointerup') {
        return;
      }
      var now = Date.now();
      if (now - lastTap < 320) {
        lastTap = 0;
        sendLove();
      } else {
        lastTap = now;
      }
    }
    wrap.addEventListener('pointerup', finish);
    wrap.addEventListener('pointercancel', finish);
  }

  function sendLove() {
    if (!room || !currentTrack()) {
      return;
    }
    haptic([10, 40, 14]);
    retrigger($('#art-heart'), 'show');
    room.react('❤️');
  }

  // Queue: drag the grip to reorder (anyone who can control playback).
  function wireQueueDrag() {
    var list = $('#queue');
    if (!list) {
      return;
    }
    list.addEventListener('pointerdown', function (event) {
      var grip = event.target.closest('.q-grip');
      if (!grip || !canControl()) {
        return;
      }
      event.preventDefault();
      var item = grip.closest('.q-item');
      var items = $all('.q-item', list);
      var from = items.indexOf(item);
      queueDrag = {
        id: event.pointerId,
        item: item,
        items: items,
        rects: items.map(function (el) { return el.getBoundingClientRect(); }),
        from: from,
        to: from,
        startY: event.clientY,
        dirty: false,
      };
      grip.setPointerCapture(event.pointerId);
      item.classList.add('lifted');
      list.classList.add('sorting');
      haptic(10);
    });

    list.addEventListener('pointermove', function (event) {
      var drag = queueDrag;
      if (!drag || event.pointerId !== drag.id) {
        return;
      }
      var dy = event.clientY - drag.startY;
      var origin = drag.rects[drag.from];
      var center = origin.top + origin.height / 2 + dy;
      drag.item.style.transform = 'translateY(' + dy + 'px) scale(1.02)';
      var to = drag.from;
      drag.rects.forEach(function (rect, i) {
        var middle = rect.top + rect.height / 2;
        if (i > drag.from && center > middle) {
          to = Math.max(to, i);
        }
        if (i < drag.from && center < middle) {
          to = Math.min(to, i);
        }
      });
      if (to !== drag.to) {
        drag.to = to;
        haptic(4);
      }
      var shift = origin.height + 2;
      drag.items.forEach(function (el, i) {
        if (el === drag.item) {
          return;
        }
        var offset = 0;
        if (drag.from < drag.to && i > drag.from && i <= drag.to) {
          offset = -shift;
        } else if (drag.from > drag.to && i >= drag.to && i < drag.from) {
          offset = shift;
        }
        el.style.transform = offset ? 'translateY(' + offset + 'px)' : '';
      });
    });

    function drop(event) {
      var drag = queueDrag;
      if (!drag || event.pointerId !== drag.id) {
        return;
      }
      queueDrag = null;
      list.classList.remove('sorting');
      var moved = event.type === 'pointerup' && drag.to !== drag.from;
      if (moved) {
        // Reorder the DOM right away so the row lands where it was dropped; the state update re-renders it.
        var target = drag.items[drag.to];
        list.insertBefore(drag.item, drag.to > drag.from ? target.nextSibling : target);
      }
      drag.items.forEach(function (el) {
        el.style.transform = '';
        el.classList.remove('lifted');
      });
      if (moved) {
        haptic(12);
        room.intent({ type: 'move', from: drag.from, to: drag.to });
      } else if (drag.dirty) {
        renderQueue();
      }
    }
    list.addEventListener('pointerup', drop);
    list.addEventListener('pointercancel', drop);
  }

  // Phone mini video: drag the handle and it snaps to the nearest corner (remembered).
  // The handle sits outside the 200x200 player so nothing is ever drawn over the video.
  function wirePipDrag() {
    var grip = $('#pip-grip');
    var float = $('#video-float');
    if (!grip || !float) {
      return;
    }
    function settle() {
      savePrefs();
      float.classList.add('snapping');
      placeVideo();
      setTimeout(function () {
        float.classList.remove('snapping');
      }, 380);
    }
    grip.addEventListener('pointerdown', function (event) {
      if (!float.classList.contains('is-pip')) {
        return;
      }
      event.preventDefault();
      var rect = float.getBoundingClientRect();
      pipDrag = {
        id: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        width: rect.width,
        height: rect.height,
      };
      grip.setPointerCapture(event.pointerId);
      float.classList.add('dragging');
      haptic(8);
    });
    grip.addEventListener('pointermove', function (event) {
      if (!pipDrag || event.pointerId !== pipDrag.id) {
        return;
      }
      float.style.left = clamp(event.clientX - pipDrag.offsetX, 8, window.innerWidth - pipDrag.width - 8) + 'px';
      float.style.top = clamp(event.clientY - pipDrag.offsetY, 8, window.innerHeight - pipDrag.height - 8) + 'px';
    });
    function release(event) {
      if (!pipDrag || event.pointerId !== pipDrag.id) {
        return;
      }
      var rect = float.getBoundingClientRect();
      var centerX = rect.left + rect.width / 2;
      var centerY = rect.top + rect.height / 2;
      prefs.pipCorner = (centerY < window.innerHeight / 2 ? 't' : 'b') + (centerX < window.innerWidth / 2 ? 'l' : 'r');
      pipDrag = null;
      float.classList.remove('dragging');
      haptic(10);
      settle();
    }
    grip.addEventListener('pointerup', release);
    grip.addEventListener('pointercancel', release);
    grip.addEventListener('click', function (event) {
      if (event.detail === 0) {
        // keyboard: cycle through the corners
        prefs.pipCorner = PIP_CORNERS[(PIP_CORNERS.indexOf(prefs.pipCorner) + 1) % PIP_CORNERS.length];
        settle();
      }
    });
  }

  // Phone bottom sheets: drag the handle or header down to dismiss.
  function wireSheetDrag(sheet) {
    var handles = [$('.sheet-grab', sheet), $('.sheet-head', sheet)].filter(Boolean);
    var drag = null;
    function reset() {
      sheet.style.transition = '';
      sheet.style.transform = '';
    }
    sheet.addEventListener('close', reset);
    handles.forEach(function (handle) {
      handle.addEventListener('pointerdown', function (event) {
        if (!isPhoneLayout() || event.target.closest('button')) {
          return;
        }
        drag = { id: event.pointerId, y: event.clientY, t: Date.now(), dy: 0 };
        handle.setPointerCapture(event.pointerId);
        sheet.style.transition = 'none';
      });
      handle.addEventListener('pointermove', function (event) {
        if (!drag || event.pointerId !== drag.id) {
          return;
        }
        drag.dy = Math.max(0, event.clientY - drag.y);
        sheet.style.transform = 'translateY(' + drag.dy + 'px)';
      });
      function end(event) {
        if (!drag || event.pointerId !== drag.id) {
          return;
        }
        var velocity = drag.dy / Math.max(1, Date.now() - drag.t);
        var dismiss = drag.dy > 120 || (drag.dy > 40 && velocity > 0.6);
        drag = null;
        sheet.style.transition = 'transform 0.24s cubic-bezier(0.2, 0.8, 0.2, 1)';
        if (dismiss) {
          sheet.style.transform = 'translateY(100%)';
          haptic(8);
          setTimeout(function () {
            sheet.close();
          }, 220);
        } else {
          sheet.style.transform = '';
        }
      }
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
    });
  }

  function applyVideoView() {
    var roomEl = $('.room');
    var toggle = $('#view-toggle');
    if (!roomEl || !toggle) {
      return;
    }
    roomEl.classList.toggle('view-video', !!prefs.videoView);
    toggle.innerHTML = prefs.videoView ? icon('disc') + 'Cover art' : icon('play') + 'Watch video';
    toggle.setAttribute('aria-pressed', prefs.videoView ? 'true' : 'false');
    placeVideo();
  }

  // Visible band of the stage between the top bar and the tab bar. The docked
  // player is clipped to it so it scrolls like page content and is never
  // painted over the header or the tab bar.
  function stageBand() {
    var top = 0;
    var bottom = window.innerHeight;
    var stage = $('.stage');
    if (stage && stage.getClientRects().length) {
      var stageRect = stage.getBoundingClientRect();
      top = Math.max(top, stageRect.top);
      bottom = Math.min(bottom, stageRect.bottom);
    }
    var topbar = $('.topbar');
    if (topbar && topbar.getClientRects().length) {
      top = Math.max(top, topbar.getBoundingClientRect().bottom);
    }
    var tabbar = $('.tabbar');
    if (tabbar && getComputedStyle(tabbar).display !== 'none') {
      bottom = Math.min(bottom, tabbar.getBoundingClientRect().top);
    }
    return { top: top, bottom: bottom };
  }

  function placeVideo() {
    var float = $('#video-float');
    var roomEl = $('.room');
    if (!float || !roomEl) {
      return;
    }
    if (pipDrag) {
      return; // the user is dragging the mini window; don't snap it back mid-gesture
    }
    var pipAnchor = $('#video-pip-anchor');
    if (pipAnchor) {
      pipAnchor.dataset.corner = prefs.pipCorner;
    }
    float.dataset.corner = prefs.pipCorner;
    var anchor = null;
    if (roomEl.classList.contains('yt')) {
      anchor = Array.prototype.filter.call($all('.video-anchor'), function (el) {
        return el.getClientRects().length > 0;
      })[0] || null;
    }
    float.hidden = !anchor;
    if (!anchor) {
      return;
    }
    var rect = anchor.getBoundingClientRect();
    float.style.left = rect.left + 'px';
    float.style.top = rect.top + 'px';
    float.style.width = rect.width + 'px';
    float.style.height = rect.height + 'px';
    var isPip = anchor.classList.contains('pip');
    float.classList.toggle('is-pip', isPip);
    var clipTop = 0;
    var clipBottom = 0;
    if (!isPip) {
      var band = stageBand();
      clipTop = Math.max(0, band.top - rect.top);
      clipBottom = Math.max(0, rect.bottom - band.bottom);
    }
    float.style.clipPath = (clipTop || clipBottom)
      ? 'inset(' + Math.round(clipTop) + 'px 0 ' + Math.round(clipBottom) + 'px 0 round 16px)'
      : '';
    float.style.visibility = (clipTop + clipBottom >= rect.height) ? 'hidden' : '';
  }

  function showMediaFor(kind) {
    var media = $('#media');
    if (media) {
      media.dataset.kind = kind || 'none';
    }
    var roomEl = $('.room');
    if (roomEl) {
      roomEl.classList.toggle('yt', kind === 'youtube');
      $('#view-toggle').hidden = kind !== 'youtube';
      placeVideo();
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
    pill.className = 'badge ' + level;
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
    var pct = total ? Math.min(100, (Number(seek.value) / total) * 100) : 0;
    seek.style.setProperty('--pct', pct.toFixed(2) + '%');
    var mini = $('#mini');
    if (mini) {
      mini.style.setProperty('--pct', pct.toFixed(2) + '%');
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
