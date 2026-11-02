"use strict";
/* ==========================================================================
   Sortie · effects — flying cards, folder gulps, the vacuum cleaner,
   dust, sparkles, confetti and the rename flip.
   ========================================================================== */

const fx = $("#fx");
const vac = $("#vac");

function cloneGhost(cardEl, rect) {
  const ghost = cardEl.cloneNode(true);
  ghost.classList.remove("sel", "lift", "ghosted", "ai-match");
  ghost.hidden = false;
  Object.assign(ghost.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    visibility: "visible",
  });
  fx.append(ghost);
  return ghost;
}

function iconRect(entry) {
  const rect = entry.el.querySelector(".ficon").getBoundingClientRect();
  const visible = rect.width > 0 && rect.right > 0 && rect.left < innerWidth;
  return visible ? rect : $("#btnHamburger").getBoundingClientRect();
}

/** A card arcs through the air and drops into a folder. */
async function flyInto(file, entry, fromRect) {
  const rect = fromRect || file.el.getBoundingClientRect();
  const ghost = cloneGhost(file.el, rect);
  file.el.style.visibility = "hidden";
  const from = centerOf(rect);
  const to = centerOf(iconRect(entry));
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const spin = Math.random() * 40 - 20;
  const lift = -Math.min(170, 60 + Math.abs(dx) * 0.25);
  openFolderAnim(entry);
  Snd.whoosh();
  await ghost.animate([
    { transform: "translate(0,0) scale(1) rotate(0deg)" },
    { transform: `translate(${dx * 0.45}px, ${dy * 0.45 + lift}px) scale(.85) rotate(${spin}deg)`, offset: 0.45 },
    { transform: `translate(${dx}px, ${dy - 14}px) scale(.35) rotate(${spin * 2}deg)`, opacity: 1, offset: 0.85 },
    { transform: `translate(${dx}px, ${dy + 6}px) scale(.1) rotate(${spin * 2}deg)`, opacity: 0 },
  ], { duration: D(780), easing: "cubic-bezier(.45,.05,.55,.95)", fill: "forwards" }).finished;
  ghost.remove();
  Snd.pop();
  bumpFolder(entry, 1);
  setTimeout(() => closeFolderAnim(entry), D(200));
}

/** Reverse flight (undo / put back): a card pops out of its folder. */
async function flyOut(file, entry) {
  const rect = file.el.getBoundingClientRect();
  const ghost = cloneGhost(file.el, rect);
  file.el.style.visibility = "hidden";
  const from = centerOf(iconRect(entry));
  const to = centerOf(rect);
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  openFolderAnim(entry);
  bumpFolder(entry, -1);
  Snd.whoosh();
  await ghost.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(.1)`, opacity: 0 },
    { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 120}px) scale(.8) rotate(-10deg)`, opacity: 1, offset: 0.5 },
    { transform: "none" },
  ], { duration: D(700), easing: "cubic-bezier(.3,.1,.3,1)" }).finished;
  ghost.remove();
  file.el.style.visibility = "";
  setTimeout(() => closeFolderAnim(entry), D(150));
}

/** Card flips over and comes back with its new name. */
async function flipRename(file) {
  const el = file.el;
  await el.animate(
    [{ transform: "perspective(400px) rotateY(0)" }, { transform: "perspective(400px) rotateY(90deg)" }],
    { duration: D(170), easing: "ease-in" }
  ).finished;
  refreshCardText(file);
  el.animate(
    [{ transform: "perspective(400px) rotateY(-90deg)" }, { transform: "perspective(400px) rotateY(0)" }],
    { duration: D(240), easing: "cubic-bezier(.2,.9,.3,1.4)" }
  );
  sparkle(centerOf(el.getBoundingClientRect()), 10);
  Snd.tick();
}

function sparkle(point, count = 14) {
  for (let i = 0; i < count; i++) {
    const bit = document.createElement("div");
    bit.className = "spark";
    bit.style.left = `${point.x}px`;
    bit.style.top = `${point.y}px`;
    fx.append(bit);
    const angle = Math.random() * Math.PI * 2;
    const dist = 25 + Math.random() * 45;
    bit.animate(
      [
        { transform: "translate(0,0) rotate(0) scale(1)", opacity: 1 },
        { transform: `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px) rotate(${Math.random() * 360}deg) scale(.3)`, opacity: 0 },
      ],
      { duration: D(550 + Math.random() * 300), easing: "cubic-bezier(.2,.8,.3,1)" }
    ).finished.then(() => bit.remove());
  }
}

function poof(point) {
  for (let i = 0; i < 18; i++) {
    const puff = document.createElement("div");
    puff.className = "dust";
    puff.style.left = `${point.x}px`;
    puff.style.top = `${point.y}px`;
    fx.append(puff);
    const angle = Math.random() * Math.PI * 2;
    const dist = 30 + Math.random() * 60;
    puff.animate(
      [
        { transform: "scale(1)", opacity: 1 },
        { transform: `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px) scale(3)`, opacity: 0 },
      ],
      { duration: D(700), easing: "ease-out" }
    ).finished.then(() => puff.remove());
  }
}

function celebrate() {
  Snd.chime();
  toast("All files sorted.");
  const badge = $("#empty .empty-icon");
  badge?.animate(
    [{ transform: "scale(.6)", opacity: 0 }, { transform: "scale(1.08)", opacity: 1, offset: 0.6 }, { transform: "none" }],
    { duration: D(500), easing: "cubic-bezier(.2,.9,.3,1.2)" }
  );
}

/* ---------------- the vacuum cleaner ---------------- */
const NOZZLE = { x: 29, y: 127 };   // suction point in SVG units
let vacPos = { x: 0, y: 0 };
const vacScale = () => vac.getBoundingClientRect().width / 240 || 1;

function placeVac(x, y) {
  vacPos = { x, y };
  vac.style.transform = `translate(${x}px, ${y}px)`;
}

async function driveVac(x, y, duration) {
  const distance = Math.hypot(x - vacPos.x, y - vacPos.y);
  vac.classList.add("driving");
  const anim = vac.animate(
    [{ transform: `translate(${vacPos.x}px, ${vacPos.y}px)` }, { transform: `translate(${x}px, ${y}px)` }],
    { duration: D(duration ?? Math.min(1100, Math.max(260, distance * 1.1))), easing: "cubic-bezier(.4,0,.2,1)" }
  );
  await anim.finished;
  placeVac(x, y);
  vac.classList.remove("driving");
}

function nozzlePoint() {
  const s = vacScale();
  return { x: vacPos.x + NOZZLE.x * s, y: vacPos.y + NOZZLE.y * s };
}

function dustBurst(rect, target) {
  for (let i = 0; i < 16; i++) {
    const dot = document.createElement("div");
    dot.className = "dust";
    const x = rect.left - 20 + Math.random() * (rect.width + 40);
    const y = rect.top - 20 + Math.random() * (rect.height + 40);
    dot.style.left = `${x}px`;
    dot.style.top = `${y}px`;
    dot.style.opacity = 0.4 + Math.random() * 0.6;
    fx.append(dot);
    dot.animate(
      [{ transform: "none" }, { transform: `translate(${target.x - x}px, ${target.y - y}px) scale(.2)` }],
      { duration: D(380 + Math.random() * 300), delay: D(Math.random() * 380), easing: "cubic-bezier(.6,0,1,.6)", fill: "backwards" }
    ).finished.then(() => dot.remove());
  }
}

function hoseLump() {
  const path = $("#suckPath");
  const lump = $("#lump");
  const length = path.getTotalLength();
  const start = performance.now();
  const duration = D(450);
  lump.setAttribute("opacity", 1);
  const step = now => {
    const t = Math.min(1, (now - start) / duration);
    const point = path.getPointAtLength(length * t);
    lump.setAttribute("cx", point.x);
    lump.setAttribute("cy", point.y);
    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      lump.setAttribute("opacity", 0);
    }
  };
  requestAnimationFrame(step);
}

/** Card resists, stretches toward the nozzle, then gets slurped. */
async function suck(file, rect) {
  const nozzle = nozzlePoint();
  const ghost = cloneGhost(file.el, rect);
  file.el.style.visibility = "hidden";
  const c = centerOf(rect);
  const dx = nozzle.x - c.x;
  const dy = nozzle.y - c.y;
  dustBurst(rect, nozzle);
  Snd.slurp();
  const tug = `translate(${dx * 0.12}px, ${dy * 0.12}px) skewX(-12deg) scaleX(1.15)`;
  await ghost.animate([
    { transform: "none" },
    { transform: `translate(${dx * 0.08}px, ${dy * 0.08}px) skewX(-8deg) scaleX(1.08)`, offset: 0.3 },
    { transform: `translate(${dx * 0.03}px, ${dy * 0.03}px) skewX(4deg)`, offset: 0.6 },
    { transform: tug },
  ], { duration: D(420), easing: "ease-in-out", fill: "forwards" }).finished;
  await ghost.animate([
    { transform: tug },
    { transform: `translate(${dx * 0.7}px, ${dy * 0.7}px) scale(.5,.25) rotate(-25deg)`, offset: 0.6 },
    { transform: `translate(${dx}px, ${dy}px) scale(.04) rotate(-200deg)`, opacity: 0.3 },
  ], { duration: D(380), easing: "cubic-bezier(.55,0,1,.45)", fill: "forwards" }).finished;
  ghost.remove();
  hoseLump();
  Snd.tone(300, 120, 0.15, 0.08);
  bumpFolder(bagEntry, 1);
}
