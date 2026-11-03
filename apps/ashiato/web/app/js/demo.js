// Sample diary for "Look around with sample days" (same content as ios/Ashiato/DemoData.swift).
// Seeded into its own database (see store.js), so it never mixes with a real diary.

import * as store from "./store.js";
import { season, sceneName, timeOfDay } from "./scene.js";

const L = (ja, ko, en) => ({ ja, ko, en });

const SAMPLE_DAYS = [
  { daysAgo: 0, weather: "clear", tempC: 14, mood: 5, walked: 4200, newRoads: 800, photo: "demo/demo_cat.jpg",
    note: L("近所の猫が、やっと撫でさせてくれた。", "동네 고양이가 드디어 만지게 해 줬다.", "The neighbourhood cat finally let me pet her.") },
  { daysAgo: 1, weather: "partly_cloudy", tempC: 12, mood: 4, walked: 2600, newRoads: 0, photo: "demo/demo_coffee.jpg",
    note: L("角の喫茶店で、窓ぎわの席。", "모퉁이 카페, 창가 자리.", "Window seat at the corner café.") },
  { daysAgo: 2, weather: "rain", tempC: 9, mood: 3, walked: 600, newRoads: 0, photo: null,
    note: L("雨の音を聞きながら、本を一冊。", "빗소리 들으며 책 한 권.", "Read a whole book to the sound of rain.") },
  { daysAgo: 3, weather: "cloudy", tempC: 11, mood: 4, walked: 3100, newRoads: 450, photo: "demo/demo_flowers.jpg",
    note: L("花屋さんで小さなブーケを買った。", "꽃집에서 작은 꽃다발을 샀다.", "Bought a tiny bouquet at the flower shop.") },
  { daysAgo: 4, weather: "clear", tempC: 15, mood: 5, walked: 5400, newRoads: 1200, photo: "demo/demo_cat_watercolor.jpg",
    note: L("知らない坂道をのぼってみた。", "모르는 언덕길을 올라 봤다.", "Took an unknown slope just to see.") },
  { daysAgo: 6, weather: "fog", tempC: 8, mood: 4, walked: 1900, newRoads: 300, photo: "demo/demo_coffee_pencil.jpg",
    note: L("朝の霧で、町がやさしく見えた。", "아침 안개에 동네가 부드러워 보였다.", "Morning fog made the town look soft.") },
  { daysAgo: 365, weather: "clear", tempC: 16, mood: 5, walked: 6800, newRoads: 6800, photo: "demo/demo_cat.jpg",
    note: L("はじめてこの町を歩いた日。", "처음 이 동네를 걸은 날.", "My first walk around this town.") },
];

const FRAGMENTS = [
  L("パン屋は火曜休み", "빵집은 화요일 휴무", "Bakery closed on Tuesdays"),
  L("ゆっくりでいい", "천천히 해도 돼", "Slow is fine"),
  L("あの歌の名前、あとで調べる", "그 노래 제목 나중에 찾아보기", "Look up the name of that song"),
];

// Bundled mock screenshots (shots/shots.json) become the tidy inbox; three are already filed.
const KEPT_SHOTS = new Set(["shot_place.png", "shot_recipe.png", "shot_ticket.png"]);

const YANAKA = [
  [35.7268, 139.767], [35.7262, 139.7683], [35.7255, 139.7695], [35.7246, 139.7702], [35.7238, 139.7712],
  [35.7229, 139.7705], [35.7225, 139.769], [35.7231, 139.7676], [35.7243, 139.7668], [35.7256, 139.7663], [35.7268, 139.767],
];

function shiftDays(daysAgo, hour = 18) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d;
}

export async function seed() {
  if ((await store.count("days")) > 0) return;
  const lang = localStorage.getItem("ui.languageMode") || "english";
  const pick = (label) => (lang === "japanese" ? label.ja : lang === "korean" ? label.ko : lang === "english" ? label.en : label.ja);

  for (const sample of SAMPLE_DAYS) {
    const at = shiftDays(sample.daysAgo, sample.daysAgo === 0 ? new Date().getHours() : 17);
    const time = sample.daysAgo === 0 ? timeOfDay(new Date()) : ["morning", "noon", "dusk"][sample.daysAgo % 3];
    await store.put("days", {
      date: store.dateKey(at),
      weather: sample.weather,
      tempC: sample.tempC,
      scene: sceneName(sample.weather, time, season(at, 35.7)),
      walkedMeters: sample.walked,
      newMeters: sample.newRoads,
      moments: [{ id: store.uid(), at: at.getTime(), text: pick(sample.note), label: sample.note, mood: sample.mood, photo: sample.photo }],
    });
  }

  for (const [index, fragment] of FRAGMENTS.entries()) {
    await store.put("fragments", { id: store.uid(), text: pick(fragment), label: fragment, at: shiftDays(20 + index * 9).getTime() });
  }

  try {
    const shots = await (await fetch("shots/shots.json")).json();
    for (const [index, shot] of shots.entries()) {
      const kept = KEPT_SHOTS.has(shot.file);
      await store.put("clips", {
        id: store.uid(),
        at: shiftDays(index % 4, 9 + index).getTime(),
        image: `shots/${shot.file}`,
        text: shot.text,
        suggested: shot.drawer,
        drawer: shot.drawer,
        status: kept ? "kept" : "inbox",
        expiry: shot.expiry,
        duplicateOf: shot.duplicateOf,
      });
    }
  } catch {
    // offline first run without the shots file: tidy just starts empty
  }

  for (const daysAgo of [0, 4]) {
    const start = shiftDays(daysAgo, 16).getTime();
    const points = YANAKA.map(([lat, lon], i) => [lat + daysAgo * 0.0004, lon - daysAgo * 0.0006, start + i * 90000]);
    await store.put("walks", { id: store.uid(), start, end: start + points.length * 90000, points, meters: daysAgo ? 2100 : 1500 });
  }
}
