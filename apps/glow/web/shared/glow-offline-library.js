// Glow Library: reference packs kept on this device, so offline answers can quote real sources.
// A pack (web/library/<id>.json, built by tools/build_library.py from Wikipedia) is downloaded once from
// Glow's own site and stored in IndexedDB. With no internet GlowChat searches the packs (BM25 over short
// passages), gives the best passages to the on-device AI and lists them as sources under the answer.
// With no AI model on the device at all, GlowChat shows the passages themselves, so it works on any phone.
//
// window.GlowLibrary = { catalog(), installed(), hasPacks(), install(id, onProgress), remove(id), search(query, opts),
//   contextFor(query, opts), answerFromLibrary(query), warm(), sizeLabel(bytes), tokenize(text) }
(function () {
  "use strict";

  const SCRIPT_URL = document.currentScript ? document.currentScript.src : location.href;
  const LIBRARY_URL = window.GLOW_LIBRARY_URL || new URL("../library/", SCRIPT_URL).href;
  const DB_NAME = "glow-library";
  const DB_VERSION = 1;
  const STORE = "packs";
  const META_KEY = "glow.library.v1";
  const PACK_FORMAT = 1;

  // BM25 settings and how much the article title and section name count compared with the passage text.
  const K1 = 1.2;
  const B = 0.75;
  const TITLE_WEIGHT = 3;
  const SECTION_WEIGHT = 1.5;
  // A question word that names the article itself ("bleeding" → Bleeding) counts extra, outside BM25's
  // saturation, so a passage that merely repeats the word in another article doesn't outrank it.
  const TITLE_BONUS = 1.2;
  // A word in the question also matches longer forms that start the same way ("purify" → "purification").
  // The shared start grows with the word, so "translate" matches "translation" but not "transmission".
  const PREFIX_CHARS = 5;
  const PREFIX_SHARE = 0.6;
  const PREFIX_WEIGHT = 0.6;
  const SYNONYM_WEIGHT = 0.8;
  // Passages must share enough of the question's words to count as an answer (keeps "rewrite my email" out).
  const MIN_COVERAGE = 0.5;
  // Real answers score 11 or more on these packs; unrelated chats that share a word or two score 5 to 8.
  const MIN_SCORE = 9;
  // Passages far below the best one are usually off-topic filler, so they are left out.
  const RELATIVE_CUTOFF = 0.5;
  const MAX_PER_ARTICLE = 2;

  const STOPWORDS = new Set((
    "a about above after again against all am an and any are as at be because been before being below between both but by " +
    "can could did do does doing down during each few for from further had has have having he her here hers herself him " +
    "himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other " +
    "our ours ourselves out over own same she should so some such than that the their theirs them themselves then there " +
    "these they this those through to too under until up very was we were what when where which while who whom why will " +
    "with would you your yours yourself yourselves also get got let lets please tell know want need thing things way ways " +
    "someone somebody something anyone anything happen happens happened best good really much many make makes use using used " +
    "like should shall may might must one two help explain give show quick quickly"
  ).split(" "));

  // Everyday words → the terms the articles use, so "fainted and not breathing" finds Syncope and CPR.
  // Keys are the question's plain words; values are stemmed like the library text.
  const QUERY_SYNONYMS = {
    treat: ["management", "treatment"],
    treating: ["management", "treatment"],
    treatment: ["management"],
    help: ["management", "treatment"],
    faint: ["syncope", "unconscious"],
    fainted: ["syncope", "unconscious"],
    passed: ["syncope", "unconscious"],
    unconscious: ["unresponsive", "syncope"],
    breathing: ["respiratory", "resuscitation"],
    breath: ["respiratory", "resuscitation"],
    cpr: ["cardiopulmonary", "resuscitation"],
    bleeding: ["hemorrhage"],
    cut: ["laceration", "wound"],
    broken: ["fracture"],
    snake: ["snakebite"],
    choking: ["airway", "abdominal"],
    fit: ["seizure"],
    convulsion: ["seizure"],
    allergic: ["anaphylaxis", "allergy"],
    sugar: ["hypoglycemia", "glucose"],
    diabetic: ["hypoglycemia"],
    overheating: ["hyperthermia", "heat"],
    freezing: ["hypothermia", "frostbite"],
    purify: ["purification", "disinfection"],
    lost: ["navigation", "orienteering"],
    north: ["compass", "navigation"],
    hurricane: ["tropical", "cyclone"],
    typhoon: ["tropical", "cyclone"],
    blackout: ["power", "outage"],
    radiation: ["fallout"],
  };
  // Common Indonesian words for emergencies (Glow has an Indonesian interface; the packs are in English).
  const INDONESIAN_WORDS = {
    pingsan: "faint", bernapas: "breathing", bernafas: "breathing", napas: "breathing", nafas: "breathing",
    luka: "wound", bakar: "burn", berdarah: "bleeding", pendarahan: "bleeding", perdarahan: "bleeding",
    darah: "bleeding", patah: "fracture", tulang: "bone", gigitan: "bite", digigit: "bite", ular: "snake",
    tersedak: "choking", banjir: "flood", gempa: "earthquake", air: "water", minum: "drinking",
    menjernihkan: "purify", jernih: "purify", demam: "fever", diare: "diarrhea", dehidrasi: "dehydration",
    kebakaran: "fire", hutan: "forest", api: "fire", listrik: "power", padam: "outage", kejang: "seizure",
    keracunan: "poisoning", racun: "poisoning", sengatan: "sting", lebah: "bee", tenggelam: "drowning",
    serangan: "attack", jantung: "heart", mengobati: "treatment", obati: "treatment", mengatasi: "treatment",
    menangani: "treatment", penanganan: "treatment", pengobatan: "treatment", gejala: "symptoms", tanda: "signs",
    hipotermia: "hypothermia", badai: "storm", topan: "cyclone", evakuasi: "evacuation", mengungsi: "evacuation",
    berlindung: "shelter", perlindungan: "shelter", menyalakan: "start", kompas: "compass", utara: "north",
    tersesat: "lost", makanan: "food", darurat: "emergency", perlengkapan: "kit", pertolongan: "aid",
    alergi: "allergy", longsor: "landslide", kekeringan: "drought",
  };
  const INDONESIAN_STOPWORDS = new Set((
    "bagaimana cara yang dan di ke dari saya aku kamu apa untuk jika kalau orang teman ini itu ada harus bisa " +
    "tidak dengan atau saat ketika sedang sudah akan lagi apakah mengapa kenapa tolong gimana dong ya juga pada " +
    "oleh sebuah seorang seseorang adalah agar supaya perlu setelah sebelum terkena kena dilakukan melakukan " +
    "pertama sangat banyak sedikit"
  ).split(" "));

  // ---------------------------------------------------------------- words
  function stem(word) {
    if (word.length <= 3 || /^\d+$/.test(word)) return word;
    if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
    if (word.endsWith("sses")) return word.slice(0, -2);
    if (/(ches|shes|xes|zes)$/.test(word)) return word.slice(0, -2);
    if (word.endsWith("ing") && word.length > 6) return word.slice(0, -3);
    if (word.endsWith("ed") && word.length > 5) return word.slice(0, -2);
    if (word.endsWith("s") && !/(ss|us|is|ys)$/.test(word)) return word.slice(0, -1);
    return word;
  }

  function tokenize(text) {
    const words = String(text || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/);
    const out = [];
    for (const word of words) {
      if (word.length < 2 || STOPWORDS.has(word)) continue;
      out.push(stem(word));
    }
    return out;
  }

  // The question's words for searching: Indonesian emergency words become English, filler words are dropped.
  function queryWords(query) {
    const raw = String(query || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/);
    const english = [];
    for (const word of raw) {
      if (!word || INDONESIAN_STOPWORDS.has(word)) continue;
      english.push(INDONESIAN_WORDS[word] || word);
    }
    return english.flatMap((word) => tokenize(word).map((stemmed) => ({ word: stemmed, plain: word })));
  }

  function sizeLabel(bytes) {
    return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
  }

  // ---------------------------------------------------------------- what is installed (small, kept in localStorage)
  let memoryMeta = null;
  function readMeta() {
    if (memoryMeta) return memoryMeta;
    try {
      const saved = JSON.parse(localStorage.getItem(META_KEY) || "null");
      if (saved && saved.packs) {
        memoryMeta = saved;
        return saved;
      }
    } catch (error) {
      // Unreadable: start empty; the packs in IndexedDB are found again by syncMeta().
    }
    memoryMeta = { packs: {} };
    return memoryMeta;
  }

  function writeMeta(meta) {
    memoryMeta = meta;
    try {
      localStorage.setItem(META_KEY, JSON.stringify(meta));
    } catch (error) {
      // Storage full or private mode: the list still holds while Glow stays open.
    }
    window.dispatchEvent(new CustomEvent("glow-library-change"));
  }

  function installed() {
    const packs = readMeta().packs;
    return Object.keys(packs).map((id) => ({ id, ...packs[id] }));
  }

  function hasPacks() {
    return installed().length > 0;
  }

  // ---------------------------------------------------------------- IndexedDB
  let dbPromise = null;
  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        if (!window.indexedDB) {
          reject(new Error("This browser can't store the offline library (no IndexedDB)."));
          return;
        }
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "id" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("The offline library storage didn't open."));
      });
      dbPromise.catch(() => {
        dbPromise = null;
      });
    }
    return dbPromise;
  }

  async function withStore(mode, action) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request ? request.result : undefined);
      transaction.onerror = () => reject(transaction.error || new Error("The offline library storage failed."));
      transaction.onabort = () => reject(transaction.error || new Error("The device ran out of storage for the offline library."));
    });
  }

  const allPacks = () => withStore("readonly", (store) => store.getAll());

  // The list in localStorage can be lost (cleared, full); rebuild it from what IndexedDB really holds.
  async function syncMeta() {
    try {
      const packs = await allPacks();
      const meta = { packs: {} };
      for (const pack of packs) meta.packs[pack.id] = metaFor(pack, pack.bytes || 0);
      const before = JSON.stringify(readMeta());
      if (JSON.stringify(meta) !== before) writeMeta(meta);
      return installed();
    } catch (error) {
      return installed();
    }
  }

  function metaFor(pack, bytes) {
    return {
      name: pack.name,
      about: pack.about || "",
      note: pack.note || "",
      version: pack.built || pack.version || "",
      articles: pack.articles.length,
      passages: pack.chunks.length,
      bytes,
    };
  }

  // ---------------------------------------------------------------- catalog, download, delete
  async function catalog() {
    try {
      const response = await fetch(`${LIBRARY_URL}index.json`, { cache: "no-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return (data.packs || []).map((pack) => ({ ...pack, installed: Boolean(readMeta().packs[pack.id]) }));
    } catch (error) {
      // Offline: show what is on the device.
      return installed().map((pack) => ({ ...pack, installed: true, offline: true }));
    }
  }

  async function readWithProgress(response, expected, onProgress) {
    if (!response.body || !response.body.getReader) return response.text();
    const reader = response.body.getReader();
    const parts = [];
    let received = 0;
    while (true) {
      const step = await reader.read();
      if (step.done) break;
      parts.push(step.value);
      received += step.value.length;
      if (onProgress) onProgress(Math.min(0.99, received / Math.max(expected, 1)));
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    return new TextDecoder("utf-8").decode(bytes);
  }

  async function install(id, onProgress) {
    const packs = await catalog();
    const entry = packs.find((pack) => pack.id === id);
    if (!entry || entry.offline) throw new Error("Connect to the internet to download this library pack.");
    let response;
    try {
      response = await fetch(`${LIBRARY_URL}${entry.file}`, { cache: "no-cache" });
    } catch (error) {
      throw new Error("The library pack couldn't be downloaded. Check the connection and try again.");
    }
    if (!response.ok) throw new Error(`The library pack couldn't be downloaded (HTTP ${response.status}).`);
    const raw = await readWithProgress(response, entry.bytes, onProgress);
    let pack;
    try {
      pack = JSON.parse(raw);
    } catch (error) {
      throw new Error("The library pack arrived damaged. Try again.");
    }
    if (pack.format !== PACK_FORMAT || pack.id !== id || !Array.isArray(pack.chunks) || !Array.isArray(pack.articles)) {
      throw new Error("This library pack needs a newer Glow. Reload the page and try again.");
    }
    pack.bytes = raw.length;
    await withStore("readwrite", (store) => store.put(pack));
    const meta = readMeta();
    meta.packs[id] = metaFor(pack, raw.length);
    writeMeta({ packs: { ...meta.packs } });
    index = null;
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if (onProgress) onProgress(1);
    return installed().find((p) => p.id === id);
  }

  async function remove(id) {
    await withStore("readwrite", (store) => store.delete(id));
    const meta = readMeta();
    const packs = { ...meta.packs };
    delete packs[id];
    writeMeta({ packs });
    index = null;
  }

  // ---------------------------------------------------------------- the search index (built in memory on first use)
  let index = null;
  let building = null;

  function buildIndex(packs) {
    const docs = [];
    const postings = new Map();
    let totalLength = 0;
    for (const pack of packs) {
      for (const chunk of pack.chunks) {
        const article = pack.articles[chunk.a];
        if (!article) continue;
        const weights = new Map();
        const add = (words, weight) => {
          for (const word of words) weights.set(word, (weights.get(word) || 0) + weight);
        };
        const body = tokenize(chunk.t);
        const titleWords = tokenize(article.title);
        add(body, 1);
        add(titleWords, TITLE_WEIGHT);
        add(tokenize(chunk.s), SECTION_WEIGHT);
        const docId = docs.length;
        docs.push({
          pack: pack.id,
          packName: pack.name,
          note: pack.note || "",
          title: article.title,
          url: article.url,
          section: chunk.s || "",
          text: chunk.t,
          length: body.length,
          titleWords: new Set(titleWords),
        });
        totalLength += body.length;
        for (const [word, weight] of weights) {
          let list = postings.get(word);
          if (!list) {
            list = [];
            postings.set(word, list);
          }
          list.push(docId, weight);
        }
      }
    }
    return { docs, postings, vocabulary: [...postings.keys()], averageLength: totalLength / Math.max(docs.length, 1) };
  }

  async function ensureIndex() {
    if (index) return index;
    if (!building) {
      building = allPacks()
        .then((packs) => {
          index = buildIndex(packs);
          return index;
        })
        .finally(() => {
          building = null;
        });
    }
    return building;
  }

  // Start building the index early (for example when someone starts typing while offline).
  function warm() {
    if (hasPacks()) ensureIndex().catch(() => {});
  }

  // Each question word, with its synonyms and the longer words in the library that start the same way.
  function expandQuery(words, vocabulary) {
    const seen = new Set();
    const unique = words.filter((w) => !seen.has(w.word) && seen.add(w.word));
    return unique.map(({ word, plain }) => {
      const forms = [{ word, weight: 1 }];
      for (const synonym of QUERY_SYNONYMS[plain] || []) {
        for (const stemmed of tokenize(synonym)) forms.push({ word: stemmed, weight: SYNONYM_WEIGHT });
      }
      if (word.length >= PREFIX_CHARS) {
        const prefix = word.slice(0, Math.max(PREFIX_CHARS, Math.ceil(word.length * PREFIX_SHARE)));
        for (const candidate of vocabulary) {
          if (candidate !== word && candidate.startsWith(prefix) && candidate.length <= word.length + 6) {
            forms.push({ word: candidate, weight: PREFIX_WEIGHT });
          }
        }
      }
      return { word, forms };
    });
  }

  async function search(query, options = {}) {
    const limit = options.limit || 4;
    const words = queryWords(query);
    if (!words.length || !hasPacks()) return [];
    const { docs, postings, vocabulary, averageLength } = await ensureIndex();
    if (!docs.length) return [];
    const total = docs.length;
    const scores = new Map();
    const matched = new Map();
    const terms = expandQuery(words, vocabulary);
    terms.forEach((term, termNo) => {
      const best = new Map();
      for (const form of term.forms) {
        const list = postings.get(form.word);
        if (!list) continue;
        const frequency = list.length / 2;
        const idf = Math.log(1 + (total - frequency + 0.5) / (frequency + 0.5));
        for (let i = 0; i < list.length; i += 2) {
          const docId = list[i];
          const tf = list[i + 1];
          const norm = tf + K1 * (1 - B + (B * docs[docId].length) / averageLength);
          const titleBonus = docs[docId].titleWords.has(form.word) ? TITLE_BONUS * idf : 0;
          const value = form.weight * (idf * ((tf * (K1 + 1)) / norm) + titleBonus);
          if (value > (best.get(docId) || 0)) best.set(docId, value);
        }
      }
      for (const [docId, value] of best) {
        scores.set(docId, (scores.get(docId) || 0) + value);
        let seen = matched.get(docId);
        if (!seen) {
          seen = new Set();
          matched.set(docId, seen);
        }
        seen.add(termNo);
      }
    });
    // One-word questions need that word; longer ones need at least two of their words (and half of them),
    // so a single common word ("article", "name") never pulls passages into an unrelated chat.
    const needed = terms.length <= 1 ? 1 : Math.max(2, Math.ceil(terms.length * MIN_COVERAGE));
    const ranked = [...scores.entries()]
      .filter(([docId, score]) => matched.get(docId).size >= needed && score >= (options.minScore ?? MIN_SCORE))
      .sort((a, b) => b[1] - a[1]);
    const floor = ranked.length ? ranked[0][1] * RELATIVE_CUTOFF : 0;
    const perArticle = new Map();
    const results = [];
    for (const [docId, score] of ranked) {
      if (score < floor) break;
      const doc = docs[docId];
      const key = `${doc.pack}:${doc.title}`;
      const count = perArticle.get(key) || 0;
      if (count >= MAX_PER_ARTICLE) continue;
      perArticle.set(key, count + 1);
      const { titleWords, ...shown } = doc;
      results.push({ ...shown, score: Math.round(score * 100) / 100, coverage: matched.get(docId).size / terms.length });
      if (results.length >= limit) break;
    }
    return results;
  }

  // ---------------------------------------------------------------- answers with sources
  function clip(text, max) {
    if (text.length <= max) return text;
    const cut = text.slice(0, max);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("\n"));
    return `${end > max * 0.5 ? cut.slice(0, end + 1) : cut}…`;
  }

  function numberSources(results) {
    const sources = [];
    const byArticle = new Map();
    const passages = results.map((result) => {
      let n = byArticle.get(result.url);
      if (!n) {
        n = sources.length + 1;
        byArticle.set(result.url, n);
        sources.push({ n, title: result.title, url: result.url, pack: result.packName });
      }
      return { ...result, n };
    });
    return { sources, passages };
  }

  function footer(sources, notes) {
    const list = sources.map((s) => `[${s.n}] [${s.title}](${s.url})`).join(" · ");
    const note = [...new Set(notes.filter(Boolean))].join(" ");
    return `\n\n---\n📚 **Offline library sources:** ${list}\n<sub>Wikipedia text (CC BY-SA 4.0), saved on this device.${note ? ` ${note}` : ""}</sub>`;
  }

  // Passages for the on-device AI to read before it answers, sized to fit its small working memory.
  async function contextFor(query, options = {}) {
    const maxChars = options.maxChars || 3000;
    const results = await search(query, { limit: options.limit || 4 });
    if (!results.length) return null;
    const { sources, passages } = numberSources(results);
    const head = "Reference passages from the offline library on this device (Wikipedia). Base your answer on them and cite them like [1]. If they don't cover the question, say so, then answer carefully. For an emergency, also say to contact emergency services if possible.";
    const share = Math.max(300, Math.floor((maxChars - head.length) / passages.length) - 40);
    const body = passages
      .map((p) => `[${p.n}] ${p.title}${p.section ? ` › ${p.section}` : ""}: ${clip(p.text, share)}`)
      .join("\n\n");
    return {
      prompt: `${head}\n\n${body}`,
      sources,
      passages,
      footer: footer(sources, passages.map((p) => p.note)),
    };
  }

  // No AI on this device: show the best passages themselves, with their sources.
  async function answerFromLibrary(query) {
    const results = await search(query, { limit: 3 });
    if (!results.length) {
      return "📚 I couldn't find this in the offline library on this device. Try other words (the library is in English), or download Glow Offline in Settings the next time you're online so an AI can answer with no internet.";
    }
    const { sources, passages } = numberSources(results);
    const body = passages
      .map((p) => `**[${p.n}] ${p.title}${p.section ? ` › ${p.section}` : ""}**\n\n${clip(p.text, 900)}`)
      .join("\n\n");
    return `📚 **From the offline library on this device** (no AI model downloaded, so these are the closest passages, not a written answer):\n\n${body}${footer(sources, passages.map((p) => p.note))}`;
  }

  if (navigator.storage && window.indexedDB) syncMeta();

  window.GlowLibrary = {
    catalog,
    installed,
    hasPacks,
    install,
    remove,
    search,
    contextFor,
    answerFromLibrary,
    warm,
    sizeLabel,
    tokenize,
    syncMeta,
  };
})();
