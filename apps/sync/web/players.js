/* Sync players — one adapter per music source, all with the same shape:
 *   load(source) · play() · pause() · seek(sec) · time() · duration() · paused()
 *   setRate(r) · setVolume(0..1) · destroy()
 * plus `caps` describing how the sync engine may correct drift:
 *   rate           smooth catch-up by nudging playbackRate (only <audio> does this)
 *   softThreshold  drift (s) treated as "in sync"
 *   hardThreshold  drift (s) that triggers a seek
 *   cooldown       seconds to wait after a seek before judging drift again
 *   volume         whether the player can be ducked under voice chat */
(function () {
  'use strict';

  var config = window.SYNC_CONFIG || {};

  function loadScript(src, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onerror = function () {
        reject(new Error('Could not load ' + src));
      };
      document.head.appendChild(script);
      setTimeout(function () {
        reject(new Error('Timed out loading ' + src));
      }, timeoutMs || 15000);
      script.onload = function () {
        resolve();
      };
    });
  }

  /* ---------- your own audio files (shared peer-to-peer) ---------- */

  function FilePlayer(container) {
    this.kind = 'file';
    this.caps = { rate: true, softThreshold: 0.03, hardThreshold: 0.35, cooldown: 0.6, volume: true };
    this.el = document.createElement('audio');
    this.el.preload = 'auto';
    this.el.setAttribute('playsinline', '');
    container.appendChild(this.el);
  }
  FilePlayer.prototype.load = function (url) {
    var el = this.el;
    return new Promise(function (resolve, reject) {
      var done = false;
      el.addEventListener('loadedmetadata', function () {
        done = true;
        resolve();
      }, { once: true });
      el.addEventListener('error', function () {
        if (!done) {
          reject(new Error('This audio file cannot be played in this browser.'));
        }
      }, { once: true });
      el.src = url;
      el.load();
    });
  };
  FilePlayer.prototype.play = function () { return this.el.play(); };
  FilePlayer.prototype.pause = function () { this.el.pause(); };
  FilePlayer.prototype.seek = function (t) { this.el.currentTime = Math.max(0, t); };
  FilePlayer.prototype.time = function () { return this.el.currentTime; };
  FilePlayer.prototype.duration = function () { return isFinite(this.el.duration) ? this.el.duration : null; };
  FilePlayer.prototype.paused = function () { return this.el.paused; };
  FilePlayer.prototype.setRate = function (r) {
    if (Math.abs(this.el.playbackRate - r) > 0.001) {
      this.el.playbackRate = r;
    }
  };
  FilePlayer.prototype.setVolume = function (v) { this.el.volume = Math.max(0, Math.min(1, v)); };
  FilePlayer.prototype.destroy = function () {
    this.el.pause();
    this.el.removeAttribute('src');
    this.el.load();
    this.el.remove();
  };

  /* ---------- YouTube (free, no account) ---------- */

  var youtubeApi = null;
  function loadYouTube() {
    if (youtubeApi) {
      return youtubeApi;
    }
    youtubeApi = new Promise(function (resolve, reject) {
      if (window.YT && window.YT.Player) {
        resolve(window.YT);
        return;
      }
      var previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        if (previous) {
          previous();
        }
        resolve(window.YT);
      };
      loadScript('https://www.youtube.com/iframe_api').catch(reject);
    });
    youtubeApi.catch(function () {
      youtubeApi = null;
    });
    return youtubeApi;
  }

  var YOUTUBE_ERRORS = {
    2: 'That YouTube link looks invalid.',
    5: 'YouTube could not play this video in the browser.',
    100: 'That YouTube video was removed or is private.',
    101: 'The owner blocks this video outside YouTube — try another upload (e.g. the “Topic” audio version).',
    150: 'The owner blocks this video outside YouTube — try another upload (e.g. the “Topic” audio version).',
  };

  function YouTubePlayer(container) {
    this.kind = 'youtube';
    this.caps = { rate: false, softThreshold: 0.2, hardThreshold: 0.2, fineThreshold: 0.08, cooldown: 1.5, volume: true, seekLead: 0.35, adaptiveLead: true };
    this.host = document.createElement('div');
    this.host.className = 'yt-host';
    var inner = document.createElement('div');
    this.host.appendChild(inner);
    this.inner = inner;
    container.appendChild(this.host);
    this.error = null;
  }
  YouTubePlayer.prototype.load = function (videoId, startAt) {
    var self = this;
    return loadYouTube().then(function (YT) {
      return new Promise(function (resolve, reject) {
        self.player = new YT.Player(self.inner, {
          videoId: videoId,
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            playsinline: 1,
            rel: 0,
            start: Math.floor(startAt || 0),
          },
          events: {
            onReady: function () {
              resolve();
            },
            onError: function (event) {
              self.error = YOUTUBE_ERRORS[event.data] || ('YouTube error ' + event.data);
              reject(new Error(self.error));
            },
          },
        });
      });
    });
  };
  YouTubePlayer.prototype.play = function () {
    this.playRequested = performance.now();
    this.player.playVideo();
  };
  // True while YouTube is still getting a requested play going (unstarted / buffering / cued).
  // Seeking again in this window restarts its buffering, so the sync loop waits instead.
  YouTubePlayer.prototype.starting = function () {
    var state = this.player.getPlayerState();
    var now = performance.now();
    var sincePlay = now - (this.playRequested || 0);
    // Buffering (3) gets up to 5 s. Unstarted/cued (-1/5) only 1.5 s: there a plain play() is often
    // ignored and a fresh seek + play (the sync loop's retry) is what gets it going.
    var limit = state === 3 ? 5000 : (state === -1 || state === 5 ? 1500 : 0);
    if (sincePlay >= limit) {
      return false;
    }
    // A play issued right after a seek is sometimes ignored while the video is still "unstarted":
    // press play again (never seek again; that would restart buffering).
    if (state !== 3 && now - (this.lastNudge || 0) > 700) {
      this.lastNudge = now;
      this.player.playVideo();
    }
    return true;
  };
  YouTubePlayer.prototype.pause = function () { this.player.pauseVideo(); };
  YouTubePlayer.prototype.seek = function (t) { this.player.seekTo(Math.max(0, t), true); };
  YouTubePlayer.prototype.time = function () { return this.player.getCurrentTime() || 0; };
  YouTubePlayer.prototype.duration = function () {
    var d = this.player.getDuration();
    return d > 0 ? d : null;
  };
  YouTubePlayer.prototype.paused = function () {
    var s = this.player.getPlayerState();
    return s !== 1 && s !== 3; // 1 playing, 3 buffering
  };
  YouTubePlayer.prototype.setRate = function () {};
  YouTubePlayer.prototype.setVolume = function (v) { this.player.setVolume(Math.round(Math.max(0, Math.min(1, v)) * 100)); };
  YouTubePlayer.prototype.destroy = function () {
    try {
      this.player.destroy();
    } catch (error) {
      // already gone
    }
    this.host.remove();
  };

  /* ---------- Spotify (embed: full tracks for logged-in Premium, else 30 s previews) ---------- */

  var spotifyApi = null;
  function loadSpotify() {
    if (spotifyApi) {
      return spotifyApi;
    }
    spotifyApi = new Promise(function (resolve, reject) {
      window.onSpotifyIframeApiReady = function (IFrameAPI) {
        resolve(IFrameAPI);
      };
      loadScript('https://open.spotify.com/embed/iframe-api/v1').catch(reject);
    });
    spotifyApi.catch(function () {
      spotifyApi = null;
    });
    return spotifyApi;
  }

  function SpotifyPlayer(container) {
    this.kind = 'spotify';
    this.caps = { rate: false, softThreshold: 1.0, hardThreshold: 1.0, cooldown: 3, volume: false };
    this.host = document.createElement('div');
    this.host.className = 'spotify-host';
    var inner = document.createElement('div');
    this.host.appendChild(inner);
    this.inner = inner;
    container.appendChild(this.host);
    this.last = null;
    this.started = false;
  }
  SpotifyPlayer.prototype.load = function (trackId) {
    var self = this;
    return loadSpotify().then(function (IFrameAPI) {
      return new Promise(function (resolve) {
        IFrameAPI.createController(self.inner, {
          uri: 'spotify:track:' + trackId,
          width: '100%',
          height: 152,
        }, function (controller) {
          self.controller = controller;
          controller.addListener('ready', function () {
            resolve();
          });
          controller.addListener('playback_update', function (event) {
            var d = event.data || {};
            self.last = {
              position: (d.position || 0) / 1000,
              duration: (d.duration || 0) / 1000,
              paused: !!d.isPaused,
              buffering: !!d.isBuffering,
              at: performance.now(),
            };
          });
        });
      });
    });
  };
  SpotifyPlayer.prototype.play = function () {
    if (!this.started) {
      this.started = true;
      this.controller.play();
    } else {
      this.controller.resume();
    }
  };
  SpotifyPlayer.prototype.pause = function () { this.controller.pause(); };
  SpotifyPlayer.prototype.seek = function (t) {
    this.controller.seek(Math.max(0, t));
    if (this.last) {
      this.last.position = t;
      this.last.at = performance.now();
    }
  };
  SpotifyPlayer.prototype.time = function () {
    if (!this.last) {
      return 0;
    }
    if (this.last.paused || this.last.buffering) {
      return this.last.position;
    }
    return this.last.position + (performance.now() - this.last.at) / 1000;
  };
  SpotifyPlayer.prototype.duration = function () {
    return this.last && this.last.duration > 0 ? this.last.duration : null;
  };
  SpotifyPlayer.prototype.paused = function () { return !this.last || this.last.paused; };
  // Logged-out / Free listeners get a 30-second preview inside the embed.
  SpotifyPlayer.prototype.isPreview = function (fullDuration) {
    var d = this.duration();
    return !!(d && d <= 31 && (!fullDuration || fullDuration > 40));
  };
  SpotifyPlayer.prototype.setRate = function () {};
  SpotifyPlayer.prototype.setVolume = function () {};
  SpotifyPlayer.prototype.destroy = function () {
    try {
      this.controller.destroy();
    } catch (error) {
      // already gone
    }
    this.host.remove();
  };

  /* ---------- Apple Music (MusicKit JS; needs a developer token in config.js) ---------- */

  var musicKit = null;
  function loadMusicKit() {
    if (musicKit) {
      return musicKit;
    }
    musicKit = new Promise(function (resolve, reject) {
      if (!config.appleDeveloperToken) {
        reject(new Error('Apple Music playback is not set up on this site yet.'));
        return;
      }
      document.addEventListener('musickitloaded', function () {
        Promise.resolve(window.MusicKit.configure({
          developerToken: config.appleDeveloperToken,
          app: { name: 'Sync', build: '1.5.2' },
        })).then(function () {
          resolve(window.MusicKit.getInstance());
        }, reject);
      }, { once: true });
      loadScript('https://js-cdn.music.apple.com/musickit/v3/musickit.js').catch(reject);
    });
    musicKit.catch(function () {
      musicKit = null;
    });
    return musicKit;
  }

  function appleReady() {
    return !!(config.appleDeveloperToken && window.MusicKit && window.MusicKit.getInstance &&
      window.MusicKit.getInstance() && window.MusicKit.getInstance().isAuthorized);
  }

  function connectApple() {
    return loadMusicKit().then(function (instance) {
      return instance.authorize().then(function () {
        return instance.isAuthorized;
      });
    });
  }

  function ApplePlayer() {
    this.kind = 'apple';
    this.caps = { rate: false, softThreshold: 0.5, hardThreshold: 0.5, cooldown: 2, volume: true };
  }
  ApplePlayer.prototype.load = function (songId) {
    var self = this;
    return loadMusicKit().then(function (instance) {
      if (!instance.isAuthorized) {
        throw new Error('Connect Apple Music in Settings first.');
      }
      self.mk = instance;
      return instance.setQueue({ song: songId, startPlaying: false });
    });
  };
  ApplePlayer.prototype.play = function () { return this.mk.play(); };
  ApplePlayer.prototype.pause = function () { this.mk.pause(); };
  ApplePlayer.prototype.seek = function (t) { return this.mk.seekToTime(Math.max(0, t)); };
  ApplePlayer.prototype.time = function () { return this.mk.currentPlaybackTime || 0; };
  ApplePlayer.prototype.duration = function () { return this.mk.currentPlaybackDuration || null; };
  ApplePlayer.prototype.paused = function () {
    return this.mk.playbackState !== window.MusicKit.PlaybackStates.playing;
  };
  ApplePlayer.prototype.setRate = function () {};
  ApplePlayer.prototype.setVolume = function (v) { this.mk.volume = Math.max(0, Math.min(1, v)); };
  ApplePlayer.prototype.destroy = function () {
    try {
      this.mk.stop();
    } catch (error) {
      // nothing playing
    }
  };

  function create(kind, container) {
    if (kind === 'file') {
      return new FilePlayer(container);
    }
    if (kind === 'youtube') {
      return new YouTubePlayer(container);
    }
    if (kind === 'spotify') {
      return new SpotifyPlayer(container);
    }
    if (kind === 'apple') {
      return new ApplePlayer(container);
    }
    throw new Error('Unknown player ' + kind);
  }

  window.SyncPlayers = {
    create: create,
    appleConfigured: function () { return !!config.appleDeveloperToken; },
    appleReady: appleReady,
    connectApple: connectApple,
  };
})();
