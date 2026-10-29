/* Hazel Shorts Publish — opt-in network features (the rest of the studio is offline).
 *
 *  - YouTube: direct upload from the browser via Google OAuth (token client) and the
 *    YouTube Data API v3 resumable upload. Needs your own OAuth Client ID (Web app,
 *    authorised JavaScript origin = where Hazel Shorts runs). Docs: videos.insert —
 *    100 uploads/day per project; unverified projects are not forced to private.
 *  - TikTok / Instagram: their posting APIs need a server-side secret and app review
 *    (TikTok: unaudited apps can only post SELF_ONLY). In the browser we use the
 *    system share sheet (phones: share straight into the TikTok / Instagram app) or
 *    download + copy caption + open the upload page.
 */
(function () {
  "use strict";

  var GIS_SRC = "https://accounts.google.com/gsi/client";
  var YT_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
  var CLIENT_KEY = "shortcraft.ytClientId";
  var token = null;

  function $(id) {
    return document.getElementById(id);
  }

  function studio() {
    return window.ShortcraftStudio;
  }

  function lastExport() {
    var s = studio();
    return s && s.state.lastExport;
  }

  function status(text) {
    $("pub-status").textContent = text;
  }

  function kitParts() {
    var project = studio().state.project;
    var kit = window.SC.postKit(project);
    // YouTube rejects titles over 100 characters and any "<" or ">"; " #Shorts" is appended later.
    var title = (project.title || "Hazel Shorts").replace(/[<>]/g, "").trim().slice(0, 100 - " #Shorts".length) || "Hazel Shorts";
    var caption = kit.split("CAPTION:")[1] || "";
    caption = caption.split("HASHTAGS:")[0].trim();
    var tags = (kit.split("HASHTAGS:")[1] || "").trim();
    return { title: title, caption: caption, hashtags: tags, full: caption + "\n\n" + tags };
  }

  function requireExport() {
    var exp = lastExport();
    if (!exp) {
      status("Export the video first (Export panel), then publish.");
      return null;
    }
    return exp;
  }

  // ---------------- YouTube ----------------
  function loadGis() {
    return new Promise(function (resolve, reject) {
      if (window.google && window.google.accounts && window.google.accounts.oauth2) {
        resolve();
        return;
      }
      var s = document.createElement("script");
      s.src = GIS_SRC;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("Could not load Google sign-in")); };
      document.head.appendChild(s);
    });
  }

  function connectYouTube() {
    var clientId = $("yt-client").value.trim();
    if (!clientId) {
      status("Paste your Google OAuth Client ID first (see the setup guide).");
      return Promise.reject(new Error("no client id"));
    }
    localStorage.setItem(CLIENT_KEY, clientId);
    return loadGis().then(function () {
      return new Promise(function (resolve, reject) {
        var client = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: YT_SCOPE,
          callback: function (resp) {
            if (resp.error) {
              reject(new Error(resp.error));
              return;
            }
            token = resp.access_token;
            $("yt-connect").textContent = "✓ YouTube connected";
            resolve(token);
          }
        });
        client.requestAccessToken();
      });
    });
  }

  function uploadYouTube() {
    var exp = requireExport();
    if (!exp) {
      return;
    }
    var scheduled = $("yt-schedule").value;
    if (scheduled && !(new Date(scheduled).getTime() > Date.now() + 60000)) {
      status("Pick a schedule time in the future (or clear it to publish now).");
      return;
    }
    var ready = token ? Promise.resolve(token) : connectYouTube();
    ready.then(function (accessToken) {
      var kit = kitParts();
      var project = studio().state.project;
      var privacy = $("yt-privacy").value;
      var publishAt = $("yt-schedule").value;
      var meta = {
        snippet: {
          title: kit.title + " #Shorts",
          description: kit.full.replace(/[<>]/g, "").slice(0, 5000),
          tags: kit.hashtags.split(/\s+/).map(function (t) { return t.replace(/^#/, ""); }).filter(Boolean).slice(0, 15),
          categoryId: "27",
          defaultLanguage: project.lang || "en",
          defaultAudioLanguage: project.lang || "en"
        },
        status: {
          privacyStatus: publishAt ? "private" : privacy,
          selfDeclaredMadeForKids: false
        }
      };
      if (publishAt) {
        meta.status.publishAt = new Date(publishAt).toISOString();
      }
      status("Starting YouTube upload…");
      return fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + accessToken,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": exp.blob.type || "video/mp4",
          "X-Upload-Content-Length": String(exp.blob.size)
        },
        body: JSON.stringify(meta)
      }).then(function (resp) {
        if (!resp.ok) {
          return resp.text().then(function (t) { throw new Error("YouTube init failed: " + resp.status + " " + t.slice(0, 200)); });
        }
        var location = resp.headers.get("Location");
        if (!location) {
          throw new Error("YouTube did not return an upload URL");
        }
        return putWithProgress(location, exp.blob, accessToken);
      }).then(function (video) {
        var url = "https://youtube.com/shorts/" + video.id;
        status("Uploaded to YouTube ✓ " + url + (publishAt ? " (scheduled)" : ""));
        $("yt-link").href = url;
        $("yt-link").hidden = false;
      });
    }).catch(function (err) {
      status("YouTube: " + err.message);
    });
  }

  function putWithProgress(url, blob, accessToken) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open("PUT", url);
      xhr.setRequestHeader("Authorization", "Bearer " + accessToken);
      xhr.setRequestHeader("Content-Type", blob.type || "video/mp4");
      xhr.upload.onprogress = function (e) {
        if (e.lengthComputable) {
          status("Uploading to YouTube… " + Math.round((e.loaded / e.total) * 100) + "%");
        }
      };
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          reject(new Error("upload failed " + xhr.status + " " + xhr.responseText.slice(0, 200)));
        }
      };
      xhr.onerror = function () { reject(new Error("network error during upload")); };
      xhr.send(blob);
    });
  }

  // ---------------- TikTok / Instagram ----------------
  function shareToApp() {
    var exp = requireExport();
    if (!exp) {
      return;
    }
    var kit = kitParts();
    var file = new File([exp.blob], exp.filename, { type: exp.blob.type || "video/mp4" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      copyText(kit.full);
      navigator.share({ files: [file], title: kit.title, text: kit.full })
        .then(function () { status("Shared ✓ — caption is on your clipboard, paste it in the app."); })
        .catch(function () { status("Share cancelled."); });
    } else {
      status("This browser can't share files. Use Download + the upload links below (caption copied).");
      copyText(kit.full);
    }
  }

  function copyText(text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(function () { /* ignore */ });
    }
  }

  function init() {
    if (!$("pub-panel")) {
      return;
    }
    $("yt-client").value = localStorage.getItem(CLIENT_KEY) || "";
    $("yt-connect").addEventListener("click", function () {
      connectYouTube().catch(function (err) { status("YouTube: " + err.message); });
    });
    $("yt-upload").addEventListener("click", uploadYouTube);
    $("share-app").addEventListener("click", shareToApp);
    $("copy-caption").addEventListener("click", function () {
      copyText(kitParts().full);
      status("Caption + hashtags copied.");
    });
    document.addEventListener("shortcraft:exported", function () {
      status("Video ready to publish: " + lastExport().filename);
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
