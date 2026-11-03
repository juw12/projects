// Weather → one of the 192 bundled diorama scenes (port of ios/Shared/SceneKey.swift).
// Weather comes from Open-Meteo (free, no key). Position: device location if allowed,
// otherwise the town picked in Settings, otherwise just time of day + season.

export const WEATHERS = ["clear", "partly_cloudy", "cloudy", "rain", "storm", "snow", "fog", "heat"];

export function timeOfDay(date, sunrise, sunset) {
  const hour = 3600 * 1000;
  if (sunrise && sunset) {
    const t = date.getTime();
    if (t < sunrise - hour) {
      const midnight = new Date(date);
      midnight.setHours(0, 0, 0, 0);
      return t - midnight.getTime() < 4 * hour ? "late_night" : "night";
    }
    if (t < sunrise + hour) return "dawn";
    if (t < sunrise + 5 * hour) return "morning";
    if (t < sunset - hour) return "noon";
    if (t < sunset + hour) return "dusk";
  }
  const h = date.getHours();
  if (h < 4) return "late_night";
  if (h < 7) return "dawn";
  if (h < 11) return "morning";
  if (h < 17) return "noon";
  if (h < 20) return "dusk";
  return "night";
}

export function season(date, latitude = 35) {
  const m = date.getMonth() + 1;
  const northern = m >= 3 && m <= 5 ? "spring" : m >= 6 && m <= 8 ? "summer" : m >= 9 && m <= 11 ? "autumn" : "winter";
  if (latitude >= 0) return northern;
  return { spring: "autumn", summer: "winter", autumn: "spring", winter: "summer" }[northern];
}

export function sceneName(weather, time, seasonName) {
  return `${weather}__${time}__${seasonName}`;
}

export function sceneURL(name) {
  return `scenes/${name}.jpg`;
}

/** WMO weather code (Open-Meteo) → scene weather. */
export function weatherFromCode(code, temperatureC) {
  let weather = "cloudy";
  if (code === 0) weather = "clear";
  else if (code === 1 || code === 2) weather = "partly_cloudy";
  else if (code === 3) weather = "cloudy";
  else if (code === 45 || code === 48) weather = "fog";
  else if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) weather = "rain";
  else if ((code >= 71 && code <= 77) || code === 85 || code === 86) weather = "snow";
  else if (code >= 95) weather = "storm";
  if ((weather === "clear" || weather === "partly_cloudy") && temperatureC >= 31) weather = "heat";
  return weather;
}

const CACHE_KEY = "weather.cache";

/** Returns { weather, tempC, time, season, scene, place } — cached for 30 minutes. */
export async function currentScene(position) {
  const now = new Date();
  const fallback = () => {
    const lat = position?.lat ?? 35;
    const s = season(now, lat);
    const time = timeOfDay(now);
    return { weather: "clear", tempC: null, time, season: s, scene: sceneName("clear", time, s), place: position?.name ?? null, live: false };
  };
  if (!position) return fallback();

  const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
  const fresh = cached && Math.abs(cached.lat - position.lat) < 0.05 && Math.abs(cached.lon - position.lon) < 0.05 && now - cached.at < 30 * 60 * 1000;
  let data = fresh ? cached.data : null;
  if (!data) {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${position.lat.toFixed(3)}&longitude=${position.lon.toFixed(3)}` +
        "&current=temperature_2m,weather_code&daily=sunrise,sunset&timezone=auto&forecast_days=1&timeformat=unixtime";
      const response = await fetch(url);
      if (!response.ok) throw new Error(response.statusText);
      data = await response.json();
      localStorage.setItem(CACHE_KEY, JSON.stringify({ lat: position.lat, lon: position.lon, at: now.getTime(), data }));
    } catch {
      if (cached) data = cached.data;
      else return fallback();
    }
  }
  const tempC = data.current?.temperature_2m ?? null;
  const weather = weatherFromCode(data.current?.weather_code ?? 3, tempC ?? 20);
  const sunrise = data.daily?.sunrise?.[0] ? data.daily.sunrise[0] * 1000 : null;
  const sunset = data.daily?.sunset?.[0] ? data.daily.sunset[0] * 1000 : null;
  const time = timeOfDay(now, sunrise, sunset);
  const s = season(now, position.lat);
  return { weather, tempC, time, season: s, scene: sceneName(weather, time, s), place: position.name ?? null, live: true };
}

export async function searchPlaces(query, language = "en") {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=${language}&format=json`;
  const response = await fetch(url);
  const data = await response.json();
  return (data.results || []).map((r) => ({
    name: [r.name, r.admin1, r.country].filter(Boolean).join(", "),
    lat: r.latitude,
    lon: r.longitude,
  }));
}
