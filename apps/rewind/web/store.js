// Data layer for Rewind.
// LocalStore keeps everything in this browser (localStorage).
// CloudStore talks to Supabase so everyone shares one catalogue.
// Both expose the same async interface, so app.js doesn't care which is active.

const STATUS_LABELS = {
  unavailable: "Not streaming",
  partial: "Edited or partial",
  physical: "DVD / VHS only",
  streaming: "Streaming somewhere",
  unknown: "Unknown",
};

const SEED_SHOWS = [
  {
    title: "WKRP in Cincinnati",
    years: "1978–1982",
    network: "CBS",
    genre: "Sitcom",
    status: "partial",
    why: "Much of the original rock soundtrack was replaced in later releases because of music licensing.",
    synopsis: "The staff of a struggling Ohio radio station switches to a rock format.",
  },
  {
    title: "The Wonder Years",
    years: "1988–1993",
    network: "ABC",
    genre: "Coming-of-age",
    status: "partial",
    why: "Its huge licensed soundtrack kept it out of home release and streaming for many years.",
    synopsis: "Kevin Arnold grows up in the suburbs during the late 1960s and early '70s.",
  },
  {
    title: "Northern Exposure",
    years: "1990–1995",
    network: "CBS",
    genre: "Dramedy",
    status: "partial",
    why: "Several music cues were swapped out on home video because of rights costs.",
    synopsis: "A New York doctor is sent to practise in a quirky Alaskan town.",
  },
  {
    title: "Daria",
    years: "1997–2002",
    network: "MTV",
    genre: "Animation",
    status: "partial",
    why: "Most of the original licensed music was replaced in the DVD release.",
    synopsis: "A deadpan teen navigates high school in the suburb of Lawndale.",
  },
  {
    title: "Freaks and Geeks",
    years: "1999–2000",
    network: "NBC",
    genre: "Dramedy",
    status: "unknown",
    why: "Cancelled after one season; music clearances famously delayed its home release.",
    synopsis: "Two siblings fall in with very different crowds at a Michigan high school in 1980.",
  },
  {
    title: "My So-Called Life",
    years: "1994–1995",
    network: "ABC",
    genre: "Teen drama",
    status: "unknown",
    why: "A one-season cult classic that tends to drift in and out of availability.",
    synopsis: "Fifteen-year-old Angela Chase navigates friendship, family and first love.",
  },
  {
    title: "Dark Skies",
    years: "1996–1997",
    network: "NBC",
    genre: "Sci-fi",
    status: "unknown",
    why: "A short-lived conspiracy series with a small home-video footprint.",
    synopsis: "A couple uncovers an alien conspiracy hidden behind 1960s American history.",
  },
  {
    title: "Moonlighting",
    years: "1985–1989",
    network: "ABC",
    genre: "Dramedy",
    status: "unknown",
    why: "Music licensing kept it off streaming for decades.",
    synopsis: "A former model and a wisecracking detective run an LA detective agency.",
  },
];

function makeId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ---------------------------------------------------------------------------
// Local mode
// ---------------------------------------------------------------------------

class LocalStore {
  constructor() {
    this.mode = "local";
    this.storageKey = "rewind-data-v1";
    this.data = this.load();
  }

  load() {
    const raw = localStorage.getItem(this.storageKey);
    if (raw) {
      try {
        return this.normalize(JSON.parse(raw));
      } catch (error) {
        console.warn("Corrupt local data, starting fresh", error);
      }
    }
    return this.normalize({
      username: "",
      shelf: [],
      remembered: [],
      shows: SEED_SHOWS.map((show) => ({ ...show, id: makeId(), createdAt: Date.now() })),
    });
  }

  // Accepts data from older versions (e.g. quotes stored as plain strings).
  normalize(data) {
    data.shelf = data.shelf || [];
    data.remembered = data.remembered || [];
    data.username = data.username || "";
    data.shows = (data.shows || []).map((show) => ({
      ...show,
      remembers: show.remembers || 0,
      memories: show.memories || [],
      quotes: (show.quotes || []).map((quote) =>
        typeof quote === "string" ? { id: makeId(), text: quote, createdAt: Date.now() } : quote
      ),
    }));
    return data;
  }

  save() {
    localStorage.setItem(this.storageKey, JSON.stringify(this.data));
  }

  async init() {}

  get user() {
    return { id: "local", name: this.data.username };
  }

  async setDisplayName(name) {
    this.data.username = name;
    this.save();
  }

  // Wipes the local archive and restores the starter catalogue.
  async reset() {
    localStorage.removeItem(this.storageKey);
    this.data = this.load();
    this.save();
  }

  findShow(id) {
    const show = this.data.shows.find((item) => item.id === id);
    if (!show) {
      throw new Error("Show not found");
    }
    return show;
  }

  toCard(show) {
    return {
      id: show.id,
      title: show.title,
      years: show.years || "",
      network: show.network || "",
      genre: show.genre || "Misc",
      status: show.status || "unknown",
      synopsis: show.synopsis || "",
      why: show.why || "",
      theme: show.theme || "",
      memoryCount: show.memories.length,
      rememberCount: show.remembers,
      remembered: this.data.remembered.includes(show.id),
      onShelf: this.data.shelf.includes(show.id),
      canDelete: true,
    };
  }

  async listShows() {
    return this.data.shows.map((show) => this.toCard(show));
  }

  async getShow(id) {
    const show = this.findShow(id);
    return {
      ...this.toCard(show),
      memories: show.memories
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((memory) => ({ ...memory, canDelete: true })),
      quotes: show.quotes,
    };
  }

  async addShow(fields) {
    const duplicate = this.data.shows.find(
      (show) => show.title.toLowerCase() === fields.title.toLowerCase()
    );
    if (duplicate) {
      const error = new Error("That show is already in the vault.");
      error.existingId = duplicate.id;
      throw error;
    }
    const show = {
      ...fields,
      id: makeId(),
      remembers: 0,
      memories: [],
      quotes: [],
      createdAt: Date.now(),
    };
    this.data.shows.push(show);
    this.save();
    return show.id;
  }

  async updateStatus(id, status) {
    this.findShow(id).status = status;
    this.save();
  }

  async deleteShow(id) {
    this.data.shows = this.data.shows.filter((show) => show.id !== id);
    this.data.shelf = this.data.shelf.filter((item) => item !== id);
    this.data.remembered = this.data.remembered.filter((item) => item !== id);
    this.save();
  }

  async addMemory(showId, author, text) {
    this.data.username = author;
    this.findShow(showId).memories.push({ id: makeId(), author, text, createdAt: Date.now() });
    this.save();
  }

  async deleteMemory(showId, memoryId) {
    const show = this.findShow(showId);
    show.memories = show.memories.filter((memory) => memory.id !== memoryId);
    this.save();
  }

  async addQuote(showId, text) {
    this.findShow(showId).quotes.push({ id: makeId(), text, createdAt: Date.now() });
    this.save();
  }

  async toggleRemember(showId) {
    const show = this.findShow(showId);
    if (this.data.remembered.includes(showId)) {
      this.data.remembered = this.data.remembered.filter((item) => item !== showId);
      show.remembers = Math.max(0, show.remembers - 1);
    } else {
      this.data.remembered.push(showId);
      show.remembers += 1;
    }
    this.save();
  }

  async toggleShelf(showId) {
    if (this.data.shelf.includes(showId)) {
      this.data.shelf = this.data.shelf.filter((item) => item !== showId);
    } else {
      this.data.shelf.push(showId);
    }
    this.save();
  }

  async listFeed() {
    return this.data.shows
      .flatMap((show) =>
        show.memories.map((memory) => ({ ...memory, showId: show.id, showTitle: show.title }))
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 100);
  }

  subscribe() {}

  exportJson() {
    return JSON.stringify(this.data, null, 2);
  }

  importJson(content) {
    const imported = JSON.parse(content);
    if (!Array.isArray(imported.shows)) {
      throw new Error("That file has no shows list.");
    }
    this.data = this.normalize(imported);
    this.save();
  }
}

// ---------------------------------------------------------------------------
// Online mode (Supabase)
// ---------------------------------------------------------------------------

class CloudStore {
  constructor(config) {
    this.mode = "cloud";
    this.client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    this.session = null;
  }

  async init(onAuthChange) {
    const { data } = await this.client.auth.getSession();
    this.session = data.session;
    this.client.auth.onAuthStateChange((_event, session) => {
      const changed = (session?.user?.id || null) !== (this.session?.user?.id || null);
      this.session = session;
      if (changed && onAuthChange) {
        onAuthChange();
      }
    });
  }

  get user() {
    if (!this.session) {
      return null;
    }
    const user = this.session.user;
    const fallbackName = (user.email || "viewer").split("@")[0];
    return {
      id: user.id,
      email: user.email,
      name: user.user_metadata?.display_name || fallbackName,
    };
  }

  requireUser() {
    if (!this.user) {
      throw new Error("Please sign in first.");
    }
    return this.user;
  }

  async signIn(email) {
    const redirectTo = window.location.href.split("#")[0];
    const { error } = await this.client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    check(error);
  }

  async signOut() {
    const { error } = await this.client.auth.signOut();
    check(error);
  }

  async setDisplayName(name) {
    const { data, error } = await this.client.auth.updateUser({ data: { display_name: name } });
    check(error);
    if (this.session && data.user) {
      this.session.user = data.user;
    }
  }

  async userSets() {
    const remembered = new Set();
    const shelf = new Set();
    if (!this.user) {
      return { remembered, shelf };
    }
    const [rememberResult, shelfResult] = await Promise.all([
      this.client.from("remembers").select("show_id").eq("user_id", this.user.id),
      this.client.from("shelves").select("show_id"),
    ]);
    check(rememberResult.error);
    check(shelfResult.error);
    rememberResult.data.forEach((row) => remembered.add(row.show_id));
    shelfResult.data.forEach((row) => shelf.add(row.show_id));
    return { remembered, shelf };
  }

  toCard(row, sets) {
    return {
      id: row.id,
      title: row.title,
      years: row.years || "",
      network: row.network || "",
      genre: row.genre || "Misc",
      status: row.status || "unknown",
      synopsis: row.synopsis || "",
      why: row.why_hard_to_find || "",
      theme: row.theme_song || "",
      memoryCount: row.memory_count,
      rememberCount: row.remember_count,
      remembered: sets.remembered.has(row.id),
      onShelf: sets.shelf.has(row.id),
      canDelete: Boolean(this.user) && row.created_by === this.user.id,
    };
  }

  async listShows() {
    const [cardsResult, sets] = await Promise.all([
      this.client.from("show_cards").select("*").order("title"),
      this.userSets(),
    ]);
    check(cardsResult.error);
    return cardsResult.data.map((row) => this.toCard(row, sets));
  }

  async getShow(id) {
    const [cardResult, memoryResult, quoteResult, sets] = await Promise.all([
      this.client.from("show_cards").select("*").eq("id", id).single(),
      this.client
        .from("memories")
        .select("*")
        .eq("show_id", id)
        .order("created_at", { ascending: false }),
      this.client.from("quotes").select("*").eq("show_id", id).order("created_at"),
      this.userSets(),
    ]);
    check(cardResult.error);
    check(memoryResult.error);
    check(quoteResult.error);
    const userId = this.user?.id;
    return {
      ...this.toCard(cardResult.data, sets),
      memories: memoryResult.data.map((row) => ({
        id: row.id,
        author: row.author_name,
        text: row.text,
        createdAt: Date.parse(row.created_at),
        canDelete: row.user_id === userId,
      })),
      quotes: quoteResult.data.map((row) => ({ id: row.id, text: row.text })),
    };
  }

  async addShow(fields) {
    const user = this.requireUser();
    const { data, error } = await this.client
      .from("shows")
      .insert({
        title: fields.title,
        years: fields.years,
        network: fields.network,
        genre: fields.genre,
        status: fields.status,
        synopsis: fields.synopsis,
        why_hard_to_find: fields.why,
        theme_song: fields.theme,
        created_by: user.id,
      })
      .select("id")
      .single();
    if (error && error.code === "23505") {
      const existing = await this.client
        .from("shows")
        .select("id")
        .ilike("title", fields.title)
        .maybeSingle();
      const duplicateError = new Error("That show is already in the vault.");
      duplicateError.existingId = existing.data?.id;
      throw duplicateError;
    }
    check(error);
    return data.id;
  }

  async updateStatus(id, status) {
    this.requireUser();
    const { error } = await this.client.from("shows").update({ status }).eq("id", id);
    check(error);
  }

  async deleteShow(id) {
    this.requireUser();
    const { error } = await this.client.from("shows").delete().eq("id", id);
    check(error);
  }

  async addMemory(showId, author, text) {
    const user = this.requireUser();
    if (author !== user.name) {
      await this.setDisplayName(author);
    }
    const { error } = await this.client.from("memories").insert({
      show_id: showId,
      user_id: user.id,
      author_name: author,
      text,
    });
    check(error);
  }

  async deleteMemory(_showId, memoryId) {
    this.requireUser();
    const { error } = await this.client.from("memories").delete().eq("id", memoryId);
    check(error);
  }

  async addQuote(showId, text) {
    const user = this.requireUser();
    const { error } = await this.client
      .from("quotes")
      .insert({ show_id: showId, user_id: user.id, text });
    check(error);
  }

  async toggleRow(table, showId) {
    const user = this.requireUser();
    const existing = await this.client
      .from(table)
      .select("show_id")
      .eq("show_id", showId)
      .eq("user_id", user.id)
      .maybeSingle();
    check(existing.error);
    const result = existing.data
      ? await this.client.from(table).delete().eq("show_id", showId).eq("user_id", user.id)
      : await this.client.from(table).insert({ show_id: showId, user_id: user.id });
    check(result.error);
  }

  async toggleRemember(showId) {
    await this.toggleRow("remembers", showId);
  }

  async toggleShelf(showId) {
    await this.toggleRow("shelves", showId);
  }

  async listFeed() {
    const { data, error } = await this.client
      .from("memories")
      .select("id, author_name, text, created_at, show_id, shows(title)")
      .order("created_at", { ascending: false })
      .limit(100);
    check(error);
    return data.map((row) => ({
      id: row.id,
      author: row.author_name,
      text: row.text,
      createdAt: Date.parse(row.created_at),
      showId: row.show_id,
      showTitle: row.shows?.title || "",
    }));
  }

  // Calls onNewMemory whenever anyone posts a memory (Supabase Realtime).
  subscribe(onNewMemory) {
    this.client
      .channel("public-memories")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "memories" },
        () => onNewMemory()
      )
      .subscribe();
  }
}

function check(error) {
  if (error) {
    throw new Error(error.message || "Something went wrong talking to the server.");
  }
}

function createStore(config) {
  const wantsCloud = Boolean(config && config.supabaseUrl && config.supabaseAnonKey);
  if (wantsCloud && window.supabase) {
    return new CloudStore(config);
  }
  if (wantsCloud) {
    console.warn("Supabase library failed to load; falling back to local mode.");
  }
  return new LocalStore();
}

const SUPABASE_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";

function isCloudConfigured(config) {
  return Boolean(config && config.supabaseUrl && config.supabaseAnonKey);
}

// Loads a script without blocking the page, giving up after timeoutMs.
function loadScript(src, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timer = setTimeout(() => reject(new Error(`Timed out loading ${src}`)), timeoutMs);
    script.src = src;
    script.async = true;
    script.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`Could not load ${src}`));
    };
    document.head.appendChild(script);
  });
}

// Local mode never touches the network. Online mode loads the Supabase library on demand
// and falls back to local mode if it can't be reached.
async function prepareStore(config) {
  if (isCloudConfigured(config) && !window.supabase) {
    try {
      await loadScript(SUPABASE_SCRIPT_URL);
    } catch (error) {
      console.warn(error.message);
    }
  }
  const store = createStore(config);
  store.fellBackToLocal = isCloudConfigured(config) && store.mode === "local";
  return store;
}
