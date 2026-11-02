"use strict";
/* ==========================================================================
   Sortie · icons — a small, consistent line-icon set (24×24, stroke-based).
   Usage: icon("folder") returns an inline <svg> string.
   ========================================================================== */

const ICONS = {
  logo: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M7 10a1.5 1.5 0 0 1 1.5-1.5H11l1.5 1.5h3A1.5 1.5 0 0 1 17 11.5v3A1.5 1.5 0 0 1 15.5 16h-7A1.5 1.5 0 0 1 7 14.5z"/>',
  folder: '<path d="M3 7.5A2 2 0 0 1 5 5.5h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  "folder-plus": '<path d="M3 7.5A2 2 0 0 1 5 5.5h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/>',
  "folder-open": '<path d="M3 17.5v-10a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1.5"/><path d="M3 17.5 5.6 12a2 2 0 0 1 1.8-1.2H20a1 1 0 0 1 .9 1.4l-2.4 5.3a2 2 0 0 1-1.8 1.2H5a2 2 0 0 1-2-1.2z"/>',
  "folder-move": '<path d="M3 7.5A2 2 0 0 1 5 5.5h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 13.5h6M12.5 11l2.5 2.5-2.5 2.5"/>',
  "folder-solid": '<path fill="currentColor" stroke="none" d="M2.5 7.2A2.2 2.2 0 0 1 4.7 5h4.1c.6 0 1.1.2 1.5.6L11.8 7h7.5a2.2 2.2 0 0 1 2.2 2.2v8.6a2.2 2.2 0 0 1-2.2 2.2H4.7a2.2 2.2 0 0 1-2.2-2.2z"/>',
  "folder-open-solid": '<path fill="currentColor" stroke="none" opacity=".5" d="M2.5 7.2A2.2 2.2 0 0 1 4.7 5h4.1c.6 0 1.1.2 1.5.6L11.8 7h7.5a2.2 2.2 0 0 1 2.2 2.2V11H7.8a2 2 0 0 0-1.9 1.3L2.5 19z"/><path fill="currentColor" stroke="none" d="M5.9 12.4A2 2 0 0 1 7.8 11h13.6a.9.9 0 0 1 .86 1.2l-2.1 6.5a2 2 0 0 1-1.9 1.3H3.4a.9.9 0 0 1-.86-1.2z"/>',
  "chevron-down": '<path d="m6 9.5 6 6 6-6"/>',
  "chevron-left": '<path d="m14.5 6-6 6 6 6"/>',
  "more-vert": '<circle cx="12" cy="5.5" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="18.5" r="1.3" fill="currentColor"/>',
  "panel-right": '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M15 4v16"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  "file-text": '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  "file-plus": '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6M9 14h6"/>',
  image: '<rect x="3.5" y="4" width="17" height="16" rx="2"/><circle cx="9" cy="9.5" r="1.6"/><path d="m20.5 15.5-4.5-4.5-9.5 9"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10.5 5-3v9l-5-3"/>',
  music: '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  archive: '<rect x="3" y="4" width="18" height="4.5" rx="1"/><path d="M5 8.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5M10 12.5h4"/>',
  code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
  cube: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m12 12 8-4.5M12 12v9M12 12 4 7.5"/>',
  app: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M6.5 6.5h.01M9.5 6.5h.01"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  database: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.5"/><path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5"/>',
  inbox: '<path d="M4 13 6.5 5.5h11L20 13v5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z"/><path d="M4 13h4l1.5 2.5h5L16 13h4"/>',
  layers: '<path d="m12 3-9 5 9 5 9-5z"/><path d="m3 13 9 5 9-5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  sort: '<path d="M4 6h9M4 12h6M4 18h4M17 4v16M14 17l3 3 3-3"/>',
  wand: '<path d="m4 20 10-10M14 4v2M14 14v2M18 10h2M8 10h2M17 7l1.5-1.5M17 13l1.5 1.5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  restore: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5"/>',
  command: '<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>',
  assistant: '<path d="M12 3.5 13.8 8 18.5 9.8 13.8 11.6 12 16.2l-1.8-4.6L5.5 9.8 10.2 8z"/><path d="m18.5 14.5.8 2.1 2.2.9-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.9z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  more: '<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>',
  menu: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/>',
  send: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  "chevron-right": '<path d="m9.5 6 6 6-6 6"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  "check-square": '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  square: '<rect x="4" y="4" width="16" height="16" rx="3"/>',
  swap: '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  sliders: '<path d="M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h11M19 17.5h1"/><circle cx="15" cy="6.5" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17.5" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  tag: '<path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8-9 9z"/><circle cx="8" cy="8" r="1.4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  chart: '<path d="M3.5 20h17M7 16v-5M12 16V6M17 16v-8"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  pin: '<path d="M12 16.5V21M8.5 3.5h7l-1 5 3 3v2h-11v-2l3-3z"/>',
  palette: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17" fill="currentColor"/>',
  volume: '<path d="M11 5 6.5 9H3.5v6h3L11 19z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18.5 6a8.5 8.5 0 0 1 0 12"/>',
  zap: '<path d="M13 3 5 13.5h6.5L11 21l8-10.5h-6.5z"/>',
  "arrow-up-down": '<path d="M7 4v16M3.5 7.5 7 4l3.5 3.5M17 20V4M13.5 16.5 17 20l3.5-3.5"/>',
  filter: '<path d="M4 5h16l-6.2 7.5V19l-3.6-1.8v-4.7z"/>',
  maximize: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M7.5 14h9"/>',
  plug: '<path d="M9 7.5V3.5M15 7.5V3.5M7 7.5h10v3.5a5 5 0 0 1-10 0zM12 16v5"/>',
  alert: '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4.5M12 17.2h.01"/>',
  "check-circle": '<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.2 2.4 2.4 4.6-5"/>',
  "x-circle": '<circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6M15 9l-6 6"/>',
  play: '<path d="M7 5v14l11-7z"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
};

ICONS.vacuum = ICONS.trash;

function icon(name, className = "") {
  const body = ICONS[name] || ICONS.file;
  return `<svg class="ic${className ? ` ${className}` : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** Fill every element that has data-i="name" with that icon. */
function hydrateIcons(root = document) {
  root.querySelectorAll("[data-i]").forEach(el => {
    el.innerHTML = icon(el.dataset.i);
  });
}
