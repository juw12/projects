/*
 * Hazel Sped video — draws the 9:16 short (background, beat-reactive visualizer,
 * title, badge, progress) and records it with the rendered audio.
 *
 * The same draw() feeds the live preview and the export, so the preview is
 * what gets posted. Recording uses MediaRecorder in real time: a 26 s edit
 * takes about 26 s and the tab must stay visible while it records.
 */
(function (root) {
  'use strict';
  const H = root.Sped;
  const S = H.shorts;

  const themes = {
    neon: { name: 'Neon', bg: ['#1b0638', '#07070d'], accent: '#ff3d7f', accent2: '#22d3ee', text: '#ffffff' },
    sunset: { name: 'Sunset', bg: ['#ff6a3d', '#3a0b4d'], accent: '#ffd166', accent2: '#ff3d7f', text: '#ffffff' },
    y2k: { name: 'Y2K', bg: ['#c8d7ff', '#6d5dfc'], accent: '#ffffff', accent2: '#ff7ad9', text: '#ffffff' },
    ocean: { name: 'Ocean', bg: ['#0b3d5c', '#03121f'], accent: '#5eead4', accent2: '#60a5fa', text: '#ffffff' },
    mono: { name: 'Mono', bg: ['#1a1a1a', '#000000'], accent: '#ffffff', accent2: '#9ca3af', text: '#ffffff' },
  };
  const visualizers = { bars: 'Bars', wave: 'Wave', ring: 'Ring', none: 'None' };

  const DEFAULT_LOOK = {
    theme: 'neon',
    visualizer: 'bars',
    position: 'center',
    title: '',
    subtitle: '',
    badge: true,
    progress: true,
    imageFit: 'cover',
  };

  function normaliseLook(input) {
    const look = Object.assign({}, DEFAULT_LOOK, input || {});
    if (!themes[look.theme]) {
      look.theme = DEFAULT_LOOK.theme;
    }
    if (!visualizers[look.visualizer]) {
      look.visualizer = DEFAULT_LOOK.visualizer;
    }
    if (S.POSITIONS.indexOf(look.position) < 0) {
      look.position = DEFAULT_LOOK.position;
    }
    look.title = String(look.title || '').slice(0, 120);
    look.subtitle = String(look.subtitle || '').slice(0, 120);
    look.badge = look.badge !== false;
    look.progress = look.progress !== false;
    return look;
  }

  function badgeText(plan) {
    if (!plan) {
      return '';
    }
    const main = plan.tracks && plan.tracks[plan.mainId];
    const ratio = main ? main.tempoRatio : 1;
    const parts = [];
    if (ratio > 1.03) {
      parts.push('SPED UP');
    } else if (ratio < 0.97) {
      parts.push('SLOWED');
    } else {
      parts.push('REMIX');
    }
    parts.push(Math.round(plan.targetBpm) + ' BPM');
    if (plan.targetKey) {
      parts.push(plan.targetKey);
    }
    return parts.join(' · ');
  }

  function wrapLines(g, text, maxWidth, maxLines) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (let i = 0; i < words.length; i++) {
      const next = line ? line + ' ' + words[i] : words[i];
      if (g.measureText(next).width <= maxWidth || !line) {
        line = next;
      } else {
        lines.push(line);
        line = words[i];
      }
      if (lines.length === maxLines) {
        break;
      }
    }
    if (line && lines.length < maxLines) {
      lines.push(line);
    }
    if (lines.length === maxLines && words.length) {
      const last = lines[maxLines - 1];
      if (g.measureText(last).width > maxWidth) {
        let cut = last;
        while (cut.length > 1 && g.measureText(cut + '…').width > maxWidth) {
          cut = cut.slice(0, -1);
        }
        lines[maxLines - 1] = cut + '…';
      }
    }
    return lines;
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  /**
   * Draw one frame at `timeSec` into a 2D context sized for 1080×1920 (the
   * context may be pre-scaled for a smaller preview canvas).
   * scene = { look, platformId, plan, analysis, image, duration, segments, colors, showSafe, placeholder }
   */
  function drawFrame(g, scene, timeSec) {
    const W = S.CANVAS.width;
    const Hh = S.CANVAS.height;
    const look = normaliseLook(scene.look);
    const theme = themes[look.theme];
    const box = S.layout(scene.platformId, look);
    const plan = scene.plan;
    const duration = scene.duration || (plan ? plan.durationSec : 0);
    const t = Math.max(0, timeSec || 0);
    const pulse = plan ? S.beatPulse(t, plan.targetBpm) : 0;
    const bands = S.bandsAt(scene.analysis, t);
    const level = bands ? bands.level : 0;

    // Background: user image (cover-fit, dimmed) or animated theme gradient.
    if (scene.image) {
      const img = scene.image;
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      const scale = (look.imageFit === 'contain' ? Math.min : Math.max)(W / iw, Hh / ih) * (1 + 0.02 * pulse);
      const dw = iw * scale;
      const dh = ih * scale;
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, Hh);
      g.drawImage(img, (W - dw) / 2, (Hh - dh) / 2, dw, dh);
      const shade = g.createLinearGradient(0, 0, 0, Hh);
      shade.addColorStop(0, 'rgba(0,0,0,0.35)');
      shade.addColorStop(0.5, 'rgba(0,0,0,0.15)');
      shade.addColorStop(1, 'rgba(0,0,0,0.55)');
      g.fillStyle = shade;
      g.fillRect(0, 0, W, Hh);
    } else {
      const drift = Math.sin(t * 0.35) * 220;
      const grad = g.createLinearGradient(drift, 0, W - drift, Hh);
      grad.addColorStop(0, theme.bg[0]);
      grad.addColorStop(1, theme.bg[1]);
      g.fillStyle = grad;
      g.fillRect(0, 0, W, Hh);
      const glow = g.createRadialGradient(W / 2, box.visualizer.y + box.visualizer.h / 2, 40, W / 2, box.visualizer.y + box.visualizer.h / 2, 760);
      glow.addColorStop(0, hexAlpha(theme.accent, 0.18 + 0.32 * pulse * (0.4 + level)));
      glow.addColorStop(1, hexAlpha(theme.accent, 0));
      g.fillStyle = glow;
      g.fillRect(0, 0, W, Hh);
    }

    // Visualizer.
    const v = box.visualizer;
    if (look.visualizer !== 'none') {
      const values = bands ? bands.values : null;
      const count = values ? values.length : 32;
      const sample = function (i) {
        if (!values) {
          return scene.placeholder ? 0.25 + 0.2 * Math.sin(i * 0.6 + t * 2) : 0.05;
        }
        return values[i];
      };
      g.save();
      g.shadowColor = theme.accent;
      g.shadowBlur = 24 + 30 * pulse;
      if (look.visualizer === 'bars') {
        const gap = 10;
        const barW = (v.w - gap * (count - 1)) / count;
        for (let i = 0; i < count; i++) {
          const value = Math.pow(sample(i), 1.4);
          const h = Math.max(12, value * v.h * (0.85 + 0.15 * pulse));
          const x = v.x + i * (barW + gap);
          const y = v.y + (v.h - h) / 2;
          const grad = g.createLinearGradient(0, y, 0, y + h);
          grad.addColorStop(0, theme.accent2);
          grad.addColorStop(1, theme.accent);
          g.fillStyle = grad;
          roundRect(g, x, y, barW, h, Math.min(barW / 2, 14));
          g.fill();
        }
      } else if (look.visualizer === 'wave') {
        g.lineWidth = 10;
        g.lineJoin = 'round';
        g.strokeStyle = theme.accent;
        g.beginPath();
        const mid = v.y + v.h / 2;
        for (let i = 0; i <= 120; i++) {
          const k = i / 120;
          const index = Math.min(count - 1, Math.floor(k * count));
          const amp = Math.pow(sample(index), 1.3) * v.h * 0.45 * (0.8 + 0.2 * pulse);
          const y = mid + Math.sin(k * Math.PI * 6 + t * 5) * amp;
          if (i === 0) {
            g.moveTo(v.x + k * v.w, y);
          } else {
            g.lineTo(v.x + k * v.w, y);
          }
        }
        g.stroke();
        g.strokeStyle = theme.accent2;
        g.lineWidth = 4;
        g.stroke();
      } else if (look.visualizer === 'ring') {
        const cx = v.x + v.w / 2;
        const cy = v.y + v.h / 2;
        const radius = Math.min(v.w, v.h) * 0.26 * (1 + 0.06 * pulse);
        g.strokeStyle = theme.accent2;
        g.lineWidth = 8;
        g.beginPath();
        g.arc(cx, cy, radius, 0, Math.PI * 2);
        g.stroke();
        g.lineCap = 'round';
        g.lineWidth = 12;
        g.strokeStyle = theme.accent;
        const spokes = count * 2;
        for (let i = 0; i < spokes; i++) {
          const angle = (i / spokes) * Math.PI * 2 - Math.PI / 2 + t * 0.3;
          const value = Math.pow(sample(i < count ? i : spokes - 1 - i), 1.3);
          const len = 20 + value * Math.min(v.w, v.h) * 0.22;
          g.beginPath();
          g.moveTo(cx + Math.cos(angle) * (radius + 14), cy + Math.sin(angle) * (radius + 14));
          g.lineTo(cx + Math.cos(angle) * (radius + 14 + len), cy + Math.sin(angle) * (radius + 14 + len));
          g.stroke();
        }
      }
      g.restore();
    }

    // Title, subtitle and badge.
    const tb = box.title;
    const title = look.title || (scene.placeholder ? 'Your song title' : '');
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.shadowColor = 'rgba(0,0,0,0.55)';
    g.shadowBlur = 18;
    let cursor = tb.y;
    if (look.badge && plan) {
      g.font = '700 34px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
      const text = badgeText(plan);
      const bw = Math.min(tb.w, g.measureText(text).width + 56);
      const bx = tb.x + (tb.w - bw) / 2;
      g.fillStyle = hexAlpha(theme.accent, 0.92);
      roundRect(g, bx, cursor, bw, 62, 31);
      g.fill();
      g.fillStyle = '#0b0b12';
      g.shadowBlur = 0;
      g.fillText(text, tb.x + tb.w / 2, cursor + 13);
      g.shadowBlur = 18;
      cursor += 92;
    }
    if (title) {
      g.fillStyle = theme.text;
      g.font = '800 84px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
      const lines = wrapLines(g, title, tb.w, 2);
      lines.forEach(function (line) {
        g.fillText(line, tb.x + tb.w / 2, cursor);
        cursor += 96;
      });
    }
    if (look.subtitle) {
      g.fillStyle = hexAlpha(theme.text, 0.82);
      g.font = '500 44px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
      wrapLines(g, look.subtitle, tb.w, 1).forEach(function (line) {
        g.fillText(line, tb.x + tb.w / 2, cursor + 6);
      });
    }
    g.restore();

    // Progress bar with segment colours.
    if (look.progress && duration > 0) {
      const p = box.progress;
      g.fillStyle = 'rgba(255,255,255,0.18)';
      roundRect(g, p.x, p.y, p.w, p.h, p.h / 2);
      g.fill();
      (scene.segments || []).forEach(function (seg) {
        g.fillStyle = hexAlpha(seg.color, 0.35);
        g.fillRect(p.x + (seg.start / duration) * p.w, p.y, (seg.length / duration) * p.w, p.h);
      });
      g.fillStyle = theme.accent;
      roundRect(g, p.x, p.y, Math.max(p.h, Math.min(1, t / duration) * p.w), p.h, p.h / 2);
      g.fill();
    }

    if (scene.showSafe) {
      drawSafeOverlay(g, scene.platformId);
    }
  }

  function drawSafeOverlay(g, platformId) {
    const W = S.CANVAS.width;
    const Hh = S.CANVAS.height;
    const s = S.platform(platformId).safe;
    g.save();
    g.fillStyle = 'rgba(255, 61, 127, 0.16)';
    g.fillRect(0, 0, W, s.top);
    g.fillRect(0, Hh - s.bottom, W, s.bottom);
    g.fillRect(W - s.right, s.top, s.right, Hh - s.top - s.bottom);
    g.fillRect(0, s.top, s.left, Hh - s.top - s.bottom);
    g.setLineDash([18, 14]);
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.strokeRect(s.left, s.top, W - s.left - s.right, Hh - s.top - s.bottom);
    g.setLineDash([]);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.font = '600 30px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    g.textAlign = 'left';
    g.fillText(S.platform(platformId).name + ' UI area (approx.)', s.left + 8, Hh - s.bottom + 46);
    g.restore();
  }

  function hexAlpha(hex, alpha) {
    const value = String(hex).replace('#', '');
    const full = value.length === 3 ? value.split('').map(function (c) { return c + c; }).join('') : value;
    const n = parseInt(full, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + Math.max(0, Math.min(1, alpha)) + ')';
  }

  // ------------------------------------------------------------------ recording

  function canRecord() {
    return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement !== 'undefined' &&
      typeof HTMLCanvasElement.prototype.captureStream === 'function';
  }

  /**
   * Record the scene with the rendered audio in real time.
   * options = { audioContext, audioBuffer, scene, includeAudio, bitrate, onProgress, monitor }
   * Returns { promise, cancel }. The promise resolves to { blob, mimeType, extension, seconds }.
   */
  function record(options) {
    if (!canRecord()) {
      throw new Error('This browser cannot record video. Use a current Chrome, Edge or Safari.');
    }
    const includeAudio = options.includeAudio !== false;
    const format = S.pickMimeType(function (type) { return MediaRecorder.isTypeSupported(type); }, includeAudio);
    if (!format) {
      throw new Error('No supported video format for recording in this browser.');
    }
    const audio = options.audioContext;
    const buffer = options.audioBuffer;
    const duration = buffer.duration;
    const canvas = document.createElement('canvas');
    canvas.width = S.CANVAS.width;
    canvas.height = S.CANVAS.height;
    const g = canvas.getContext('2d');
    const scene = Object.assign({}, options.scene, { showSafe: false, placeholder: false });
    drawFrame(g, scene, 0);
    const stream = canvas.captureStream(S.CANVAS.fps);
    const destination = audio.createMediaStreamDestination();
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(destination);
    if (options.monitor) {
      source.connect(audio.destination);
    }
    if (includeAudio) {
      stream.addTrack(destination.stream.getAudioTracks()[0]);
    }
    const recorder = new MediaRecorder(stream, {
      mimeType: format.mimeType,
      videoBitsPerSecond: options.bitrate || 8000000,
      audioBitsPerSecond: 192000,
    });
    const chunks = [];
    let cancelled = false;
    let frameHandle = null;
    let timerHandle = null;
    recorder.ondataavailable = function (event) {
      if (event.data && event.data.size) {
        chunks.push(event.data);
      }
    };
    const promise = new Promise(function (resolve, reject) {
      let started = 0;
      function stopAll() {
        if (frameHandle) {
          cancelAnimationFrame(frameHandle);
        }
        if (timerHandle) {
          clearInterval(timerHandle);
        }
        try {
          source.stop();
        } catch (err) {
          /* already stopped */
        }
        stream.getTracks().forEach(function (track) { track.stop(); });
      }
      recorder.onerror = function (event) {
        stopAll();
        reject(new Error('Video recording failed: ' + ((event.error && event.error.message) || 'unknown error')));
      };
      recorder.onstop = function () {
        stopAll();
        if (cancelled) {
          reject(new Error('Video export cancelled.'));
          return;
        }
        const blob = new Blob(chunks, { type: format.mimeType.split(';')[0] });
        if (!blob.size) {
          reject(new Error('The recorder produced an empty file. Keep the tab visible while exporting and try again.'));
          return;
        }
        resolve({ blob: blob, mimeType: format.mimeType, extension: format.extension, seconds: duration });
      };
      function paint() {
        const t = Math.max(0, Math.min(duration, audio.currentTime - started));
        drawFrame(g, scene, t);
        if (options.onProgress) {
          options.onProgress(t, duration);
        }
        return t;
      }
      function frame() {
        if (cancelled) {
          return;
        }
        paint();
        frameHandle = requestAnimationFrame(frame);
      }
      source.onended = function () {
        paint();
        // Let the last frame and audio packet flush, but keep the tail short so
        // the posted video loops without a noticeable gap.
        setTimeout(function () {
          if (recorder.state !== 'inactive') {
            recorder.stop();
          }
        }, 60);
      };
      Promise.resolve(audio.state === 'suspended' ? audio.resume() : null).then(function () {
        started = audio.currentTime + 0.01;
        source.start(started);
        recorder.start(500);
        frame();
        // Backup painter for throttled rAF; still needs a visible tab for smooth frames.
        timerHandle = setInterval(function () {
          if (!cancelled && document.hidden) {
            paint();
          }
        }, 1000 / S.CANVAS.fps);
      }).catch(reject);
    });
    return {
      promise: promise,
      format: format,
      cancel: function () {
        cancelled = true;
        if (recorder.state !== 'inactive') {
          recorder.stop();
        }
      },
    };
  }

  function coverBlob(scene, timeSec) {
    const canvas = document.createElement('canvas');
    canvas.width = S.CANVAS.width;
    canvas.height = S.CANVAS.height;
    drawFrame(canvas.getContext('2d'), Object.assign({}, scene, { showSafe: false }), timeSec || 0);
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Could not create the cover image.'));
        }
      }, 'image/png');
    });
  }

  H.video = {
    themes: themes,
    visualizers: visualizers,
    DEFAULT_LOOK: DEFAULT_LOOK,
    normaliseLook: normaliseLook,
    badgeText: badgeText,
    drawFrame: drawFrame,
    canRecord: canRecord,
    record: record,
    coverBlob: coverBlob,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
