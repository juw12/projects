/* Kitty UI kit: escaping, icons and hand-rolled SVG charts (no libraries). */
(function (root) {
  'use strict';
  const K = root.Kitty;
  const ui = (K.ui = {});

  ui.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  };
  const esc = ui.esc;

  ui.PALETTE = ['#6c5ce7', '#00b8a9', '#f39c12', '#e84393', '#0984e3', '#20bf6b', '#fd79a8', '#e17055', '#a29bfe', '#fdcb6e', '#00cec9', '#ff7675', '#74b9ff', '#b8e994'];
  ui.MEMBER_COLORS = ['#6c5ce7', '#e84393', '#00b8a9', '#f39c12', '#0984e3', '#20bf6b', '#e17055', '#a29bfe'];

  ui.catColor = function (cat, index) {
    if (cat && cat.color) return cat.color;
    const i = index != null ? index : cat && cat.order != null ? cat.order : 0;
    return ui.PALETTE[Math.abs(i) % ui.PALETTE.length];
  };

  // ---------------------------------------------------------------- icons (24px, stroke)
  const P = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h5v-6h4v6h5V9.5"/>',
    sheet: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 4v16M15 4v16"/>',
    wallet: '<path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11"/><path d="M16 13.5h2"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    upload: '<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    check: '<path d="m5 12 5 5L20 7"/>',
    alert: '<path d="M12 3 2 21h20L12 3z"/><path d="M12 10v5M12 18v.5"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5.5 6.5-5.5s5.5 2 6.5 5.5"/><circle cx="17" cy="9" r="2.8"/><path d="M16.5 14.6c2.6.2 4.4 2 5 5"/>',
  };
  ui.icon = function (name, size) {
    const s = size || 20;
    return (
      '<svg class="ic" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (P[name] || '') +
      '</svg>'
    );
  };

  ui.avatar = function (member, size) {
    const m = member || {};
    const name = String(m.name || '?');
    const initials = name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('') || '?';
    const s = size || 28;
    return (
      '<span class="avatar" title="' + esc(name) + '" style="--av:' + esc(m.color || '#6c5ce7') + ';width:' + s + 'px;height:' + s + 'px;font-size:' + Math.round(s * 0.4) + 'px">' +
      esc(initials) +
      '</span>'
    );
  };

  ui.timeAgo = function (ms) {
    const d = Math.max(0, Date.now() - ms) / 1000;
    if (d < 45) return 'just now';
    if (d < 3600) return Math.round(d / 60) + 'm ago';
    if (d < 86400) return Math.round(d / 3600) + 'h ago';
    return Math.round(d / 86400) + 'd ago';
  };

  // ---------------------------------------------------------------- charts
  function arcPath(cx, cy, r, a0, a1) {
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return 'M' + x0.toFixed(2) + ' ' + y0.toFixed(2) + 'A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x1.toFixed(2) + ' ' + y1.toFixed(2);
  }

  /** Donut chart. segments: [{value, color, label}] */
  ui.donut = function (segments, opts) {
    const o = opts || {};
    const size = o.size || 180;
    const th = o.thickness || 22;
    const r = size / 2 - th / 2 - 2;
    const c = size / 2;
    const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
    let svg = '<svg class="donut" viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" role="img" aria-label="' + esc(o.label || 'Breakdown') + '">';
    svg += '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke="var(--track)" stroke-width="' + th + '"/>';
    if (total > 0) {
      let a = -Math.PI / 2;
      const gap = segments.length > 1 ? 0.025 : 0;
      segments.forEach((sg) => {
        const v = Math.max(0, sg.value);
        if (!v) return;
        const span = (v / total) * Math.PI * 2;
        if (span >= Math.PI * 2 - 0.001) {
          svg += '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke="' + esc(sg.color) + '" stroke-width="' + th + '"><title>' + esc(sg.label) + '</title></circle>';
        } else if (span > gap * 1.5) {
          svg += '<path d="' + arcPath(c, c, r, a + gap / 2, a + span - gap / 2) + '" fill="none" stroke="' + esc(sg.color) + '" stroke-width="' + th + '" stroke-linecap="round"><title>' + esc(sg.label) + '</title></path>';
        }
        a += span;
      });
    }
    if (o.center) svg += '<text x="50%" y="' + (c - 2) + '" text-anchor="middle" class="donut-big">' + esc(o.center) + '</text>';
    if (o.sub) svg += '<text x="50%" y="' + (c + 18) + '" text-anchor="middle" class="donut-sub">' + esc(o.sub) + '</text>';
    return svg + '</svg>';
  };

  /** Progress ring. */
  ui.ring = function (pct, opts) {
    const o = opts || {};
    const size = o.size || 72;
    const th = o.thickness || 8;
    const r = (size - th) / 2;
    const circ = 2 * Math.PI * r;
    const p = Math.max(0, Math.min(1, pct || 0));
    return (
      '<svg class="ring" viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" aria-hidden="true">' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="var(--track)" stroke-width="' + th + '"/>' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + esc(o.color || 'var(--accent)') + '" stroke-width="' + th + '" stroke-linecap="round" stroke-dasharray="' + (circ * p).toFixed(2) + ' ' + circ.toFixed(2) + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/>' +
      (o.label ? '<text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" class="ring-label">' + esc(o.label) + '</text>' : '') +
      '</svg>'
    );
  };

  /** Cumulative spending vs. an even pace line. */
  ui.paceChart = function (opts) {
    const W = 640;
    const H = 230;
    const padL = 8;
    const padR = 8;
    const padT = 16;
    const padB = 26;
    const dim = opts.dim;
    const upto = opts.day || 0;
    const series = opts.cumulative.slice(0, Math.max(upto, 0));
    const budget = opts.budget || 0;
    const maxY = Math.max(budget, series[series.length - 1] || 0, 1) * 1.08;
    const x = (i) => padL + (i / Math.max(1, dim - 1)) * (W - padL - padR);
    const y = (v) => padT + (1 - v / maxY) * (H - padT - padB);
    let svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Cumulative spending this month">';
    svg += '<defs><linearGradient id="gArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".35"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>';
    for (let g = 0; g <= 4; g++) {
      const gy = padT + (g / 4) * (H - padT - padB);
      svg += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + gy + '" y2="' + gy + '" class="grid"/>';
    }
    if (budget > 0) {
      svg += '<line x1="' + x(0) + '" y1="' + y(budget / dim) + '" x2="' + x(dim - 1) + '" y2="' + y(budget) + '" class="pace"/>';
      svg += '<text x="' + (padL + 4) + '" y="' + (y(budget) + 4) + '" text-anchor="start" class="axis">Budget ' + esc(K.fmt(budget, opts.cur, true)) + '</text>';
      svg += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(budget) + '" y2="' + y(budget) + '" class="grid" stroke-dasharray="2 4"/>';
    }
    if (series.length) {
      let line = '';
      series.forEach((v, i) => {
        line += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1);
      });
      const area = line + 'L' + x(series.length - 1).toFixed(1) + ' ' + y(0) + 'L' + x(0) + ' ' + y(0) + 'Z';
      svg += '<path d="' + area + '" fill="url(#gArea)"/>';
      svg += '<path d="' + line + '" class="spend"/>';
      const last = series.length - 1;
      svg += '<circle cx="' + x(last) + '" cy="' + y(series[last]) + '" r="5" class="dot"/>';
    }
    [1, Math.ceil(dim / 2), dim].forEach((d) => {
      svg += '<text x="' + x(d - 1) + '" y="' + (H - 6) + '" text-anchor="' + (d === 1 ? 'start' : d === dim ? 'end' : 'middle') + '" class="axis">' + d + '</text>';
    });
    return svg + '</svg>';
  };

  /** Multi-line chart: lines [{values, color, label, fill}] with x labels. */
  ui.lineChart = function (lines, opts) {
    const o = opts || {};
    const W = 640;
    const H = o.height || 220;
    const padL = 8;
    const padR = 8;
    const padT = 14;
    const padB = 26;
    const n = Math.max.apply(null, lines.map((l) => l.values.length));
    const maxY = Math.max.apply(null, lines.map((l) => Math.max.apply(null, l.values.concat([1])))) * 1.08;
    const x = (i) => padL + (i / Math.max(1, n - 1)) * (W - padL - padR);
    const y = (v) => padT + (1 - v / maxY) * (H - padT - padB);
    let svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.label || 'Chart') + '">';
    for (let g = 0; g <= 4; g++) {
      const gy = padT + (g / 4) * (H - padT - padB);
      svg += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + gy + '" y2="' + gy + '" class="grid"/>';
    }
    lines.forEach((l, li) => {
      let d = '';
      l.values.forEach((v, i) => {
        d += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1);
      });
      if (l.fill) {
        const gid = 'gl' + li + Math.round(Math.random() * 1e6);
        svg += '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + esc(l.color) + '" stop-opacity=".3"/><stop offset="1" stop-color="' + esc(l.color) + '" stop-opacity="0"/></linearGradient></defs>';
        svg += '<path d="' + d + 'L' + x(l.values.length - 1) + ' ' + y(0) + 'L' + x(0) + ' ' + y(0) + 'Z" fill="url(#' + gid + ')"/>';
      }
      svg += '<path d="' + d + '" fill="none" stroke="' + esc(l.color) + '" stroke-width="' + (l.width || 3) + '" stroke-linecap="round" stroke-linejoin="round"' + (l.dash ? ' stroke-dasharray="6 6"' : '') + '/>';
    });
    (o.xLabels || []).forEach((lab) => {
      svg += '<text x="' + x(lab.i) + '" y="' + (H - 6) + '" text-anchor="' + (lab.i === 0 ? 'start' : lab.i === n - 1 ? 'end' : 'middle') + '" class="axis">' + esc(lab.t) + '</text>';
    });
    return svg + '</svg>';
  };

  /** Horizontal progress bar with status colouring. */
  ui.bar = function (pct, status, color) {
    const p = Math.max(0, Math.min(1, isFinite(pct) ? pct : 1));
    const cls = status && status !== 'ok' ? ' is-' + status : '';
    return '<div class="bar' + cls + '"><span style="width:' + (p * 100).toFixed(1) + '%;' + (color && (!status || status === 'ok') ? 'background:' + esc(color) : '') + '"></span></div>';
  };

  ui.confetti = function (host) {
    const colors = ui.PALETTE;
    let html = '<div class="confetti" aria-hidden="true">';
    for (let i = 0; i < 60; i++) {
      html +=
        '<i style="left:' + (Math.random() * 100).toFixed(1) + '%;background:' + colors[i % colors.length] +
        ';animation-delay:' + (Math.random() * 0.6).toFixed(2) + 's;animation-duration:' + (1.6 + Math.random() * 1.4).toFixed(2) +
        's;transform:rotate(' + Math.round(Math.random() * 360) + 'deg)"></i>';
    }
    html += '</div>';
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    const el = wrap.firstChild;
    (host || document.body).appendChild(el);
    setTimeout(() => el.remove(), 3600);
  };
})(window);
