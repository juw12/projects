/* Sync catalog — turns links and searches into room tracks, and matches the
 * same song across services using only key-free public endpoints:
 *   iTunes Search / Lookup (Apple Music catalog, CORS-enabled)
 *   YouTube oEmbed and Spotify oEmbed (title + artwork, CORS-enabled)
 * Optional: YouTube Data API (config.youtubeApiKey) for automatic YouTube matches. */
(function () {
  'use strict';

  var core = window.SyncCore;
  var config = window.SYNC_CONFIG || {};
  var ITUNES = 'https://itunes.apple.com/';

  function fetchJson(url, timeoutMs) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs || 8000) : null;
    return fetch(url, controller ? { signal: controller.signal } : {})
      .then(function (response) {
        if (!response.ok) {
          throw new Error('HTTP ' + response.status);
        }
        return response.json();
      })
      .finally(function () {
        if (timer) {
          clearTimeout(timer);
        }
      });
  }

  function appleTrack(result) {
    return {
      title: result.trackName,
      artist: result.artistName,
      album: result.collectionName || '',
      duration: result.trackTimeMillis ? result.trackTimeMillis / 1000 : null,
      artwork: (result.artworkUrl100 || '').replace('100x100bb', '600x600bb'),
      apple: String(result.trackId),
      previewUrl: result.previewUrl || '',
    };
  }

  function searchApple(term, limit) {
    var url = ITUNES + 'search?media=music&entity=song&limit=' + (limit || 12) +
      '&term=' + encodeURIComponent(term);
    return fetchJson(url).then(function (data) {
      return (data.results || []).filter(function (r) { return r.kind === 'song'; }).map(appleTrack);
    });
  }

  function lookupApple(id) {
    return fetchJson(ITUNES + 'lookup?id=' + encodeURIComponent(id)).then(function (data) {
      var song = (data.results || []).filter(function (r) { return r.kind === 'song'; })[0];
      if (!song) {
        throw new Error('Song not found on Apple Music');
      }
      return appleTrack(song);
    });
  }

  function youtubeThumb(videoId) {
    return ['https://i.ytimg.com/vi', videoId, 'hqdefault.jpg'].join('/');
  }

  function youtubeMeta(videoId) {
    var url = 'https://www.youtube.com/oembed?format=json&url=' +
      encodeURIComponent('https://www.youtube.com/watch?v=' + videoId);
    return fetchJson(url).then(function (data) {
      var cleaned = core.cleanYouTubeTitle(data.title, data.author_name);
      return {
        title: cleaned.title || data.title,
        artist: cleaned.artist,
        artwork: youtubeThumb(videoId),
      };
    });
  }

  function spotifyMeta(trackId) {
    var url = 'https://open.spotify.com/oembed?url=' +
      encodeURIComponent('https://open.spotify.com/track/' + trackId);
    return fetchJson(url).then(function (data) {
      return { title: data.title || 'Spotify track', artist: '', artwork: data.thumbnail_url || '' };
    });
  }

  function searchYouTube(query) {
    if (!config.youtubeApiKey) {
      return Promise.resolve(null);
    }
    var url = 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1' +
      '&videoEmbeddable=true&videoCategoryId=10&q=' + encodeURIComponent(query) +
      '&key=' + encodeURIComponent(config.youtubeApiKey);
    return fetchJson(url).then(function (data) {
      var item = (data.items || [])[0];
      return item && item.id ? item.id.videoId : null;
    }).catch(function () {
      return null;
    });
  }

  // Try to find the Apple Music version of a song we only know by title/artist.
  function matchApple(wanted) {
    var term = (wanted.artist ? wanted.artist + ' ' : '') + wanted.title;
    return searchApple(term, 10).then(function (candidates) {
      var match = core.bestMatch(candidates, wanted, wanted.artist ? 0.6 : 0.7);
      return match ? match.candidate : null;
    }).catch(function () {
      return null;
    });
  }

  function trackFrom(meta, sources) {
    return {
      id: core.makeId('t'),
      title: meta.title,
      artist: meta.artist || '',
      artwork: meta.artwork || '',
      duration: meta.duration || null,
      sources: sources,
    };
  }

  // Search result (Apple catalog) -> room track, auto-matching YouTube if possible.
  function fromAppleResult(result) {
    var sources = { apple: result.apple };
    return searchYouTube(result.artist + ' ' + result.title + ' audio').then(function (videoId) {
      if (videoId) {
        sources.youtube = videoId;
      }
      return trackFrom(result, sources);
    });
  }

  // Any pasted link -> room track with as many matching services as we can find.
  function resolveLink(text) {
    var link = core.parseLink(text);
    if (!link) {
      return Promise.reject(new Error('Paste a Spotify, Apple Music, YouTube or YouTube Music song link.'));
    }
    if (link.service === 'apple') {
      return lookupApple(link.id).then(fromAppleResult);
    }
    if (link.service === 'youtube') {
      return youtubeMeta(link.id).catch(function () {
        return { title: 'YouTube video', artist: '', artwork: youtubeThumb(link.id) };
      }).then(function (meta) {
        return matchApple(meta).then(function (apple) {
          var sources = { youtube: link.id };
          if (apple) {
            sources.apple = apple.apple;
            meta.duration = apple.duration;
            meta.artist = meta.artist || apple.artist;
          }
          return trackFrom(meta, sources);
        });
      });
    }
    // Spotify
    return spotifyMeta(link.id).catch(function () {
      return { title: 'Spotify track', artist: '', artwork: '' };
    }).then(function (meta) {
      return matchApple(meta).then(function (apple) {
        var sources = { spotify: link.id };
        if (apple) {
          sources.apple = apple.apple;
          meta.artist = apple.artist;
          meta.duration = apple.duration;
          meta.artwork = meta.artwork || apple.artwork;
        }
        return searchYouTube((meta.artist ? meta.artist + ' ' : '') + meta.title + ' audio').then(function (videoId) {
          if (videoId) {
            sources.youtube = videoId;
          }
          return trackFrom(meta, sources);
        });
      });
    });
  }

  function searchUrl(service, track) {
    var q = encodeURIComponent(((track.artist || '') + ' ' + (track.title || '')).trim());
    if (service === 'youtube') {
      return 'https://www.youtube.com/results?search_query=' + q;
    }
    if (service === 'spotify') {
      return 'https://open.spotify.com/search/' + q;
    }
    return 'https://music.apple.com/search?term=' + q;
  }

  window.SyncCatalog = {
    searchApple: searchApple,
    lookupApple: lookupApple,
    youtubeMeta: youtubeMeta,
    spotifyMeta: spotifyMeta,
    fromAppleResult: fromAppleResult,
    resolveLink: resolveLink,
    searchUrl: searchUrl,
  };
})();
