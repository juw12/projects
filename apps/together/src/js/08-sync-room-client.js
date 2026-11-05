/* ------------------------------------------------------ sync: room client */
class SyncClient {
  constructor({ configKey, getState, applyRemote, endpoint = CLOUD_URL, fetchImpl = (...args) => fetch(...args), onStatus = () => {} }) {
    Object.assign(this, { configKey, getState, applyRemote, endpoint, fetchImpl, onStatus });
    this.config = this.loadConfig();
    this.keys = null;
    this.status = this.active ? "idle" : "off";
    this.error = "";
    this.queue = Promise.resolve();
    this.pushTimer = null;
  }
  loadConfig() {
    try {
      return JSON.parse(localStorage.getItem(this.configKey)) || null;
    } catch (error) {
      return null;
    }
  }
  saveConfig() {
    if (this.config) localStorage.setItem(this.configKey, JSON.stringify(this.config));
    else localStorage.removeItem(this.configKey);
  }
  get active() {
    return Boolean(this.config && this.config.room && this.config.secret);
  }
  get protected() {
    return Boolean(this.config?.pk);
  }
  /** The ".p" suffix only tells the partner's app to ask for the passphrase; it reveals nothing about it. */
  inviteLink() {
    return this.active ? `${PUBLIC_APP_URL}#join=${this.config.room}.${this.config.secret}${this.protected ? ".p" : ""}` : "";
  }
  setStatus(status, error = "") {
    this.status = status;
    this.error = error;
    this.onStatus(status, error);
  }
  /** Serialize all network work so pushes and pulls never interleave. */
  run(task) {
    const next = this.queue.then(task);
    this.queue = next.catch(error => this.setStatus("error", error.message || String(error)));
    return next;
  }
  async keysReady() {
    if (!this.keys) this.keys = await deriveSyncKeys(this.config.secret, this.config.pk || "");
    return this.keys;
  }
  async request(method, body, query = "") {
    return this.fetchImpl(`${this.endpoint}/v1/rooms/${this.config.room}${query}`, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  /** Make a fresh room + key. Only the stretched passphrase is stored, never the passphrase itself. */
  async freshConfig(passphrase) {
    const secret = b64u.encode(crypto.getRandomValues(new Uint8Array(32)));
    return {
      room: b64u.encode(crypto.getRandomValues(new Uint8Array(16))),
      secret,
      pk: await stretchPassphrase(passphrase, secret),
      version: 0,
      lastSyncAt: null,
    };
  }
  async create(passphrase = "") {
    this.config = await this.freshConfig(passphrase);
    this.keys = null;
    this.saveConfig();
    await this.run(() => this.pushNow());
    return this.inviteLink();
  }
  async join(room, secret, passphrase = "", needsPassphrase = false) {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(room || "") || !/^[A-Za-z0-9_-]{40,}$/.test(secret || "")) throw new Error("That link is incomplete.");
    if (needsPassphrase && !String(passphrase || "").trim()) throw new Error("This plan needs the passphrase your partner chose.");
    this.config = { room, secret, pk: await stretchPassphrase(passphrase, secret), version: 0, lastSyncAt: null };
    this.keys = null;
    this.saveConfig();
    let result;
    try {
      result = await this.run(() => this.pullNow(true));
    } catch (error) {
      const wasProtected = this.protected;
      this.leave();
      throw new Error(wasProtected ? "Wrong passphrase — check it with your partner and try again." : error.message);
    }
    if (result === "missing") {
      this.leave();
      throw new Error("That sync link has expired or was replaced — ask your partner for the current one.");
    }
    return result;
  }
  /**
   * Replace the link (e.g. if it leaked): pull the latest plan, move it to a brand-new room under a new
   * key (optionally with a new passphrase), then delete the old room so the old link opens nothing.
   */
  async rotate(passphrase = "") {
    if (!this.active) throw new Error("Not syncing.");
    await this.run(() => this.pullNow(false));
    const old = { room: this.config.room, auth: (await this.keysReady()).auth };
    this.config = await this.freshConfig(passphrase);
    this.keys = null;
    this.saveConfig();
    await this.run(() => this.pushNow());
    const removed = await this.fetchImpl(`${this.endpoint}/v1/rooms/${old.room}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ auth: old.auth }),
    });
    if (!removed.ok) throw new Error(`New link is ready, but the old one could not be removed (${removed.status}).`);
    return this.inviteLink();
  }
  leave() {
    clearTimeout(this.pushTimer);
    this.config = null;
    this.keys = null;
    this.saveConfig();
    this.setStatus("off");
  }
  schedulePush(delay = 1500) {
    if (!this.active) return;
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => this.run(() => this.pushNow()), delay);
  }
  pull() {
    return this.active ? this.run(() => this.pullNow(false)) : Promise.resolve("off");
  }
  async pushNow(attempt = 0) {
    if (!this.active) return;
    this.setStatus("syncing");
    const { encKey, auth } = await this.keysReady();
    const data = await sealPlan(this.getState(), encKey);
    const response = await this.request("PUT", { auth, baseVersion: this.config.version, data });
    if (response.status === 409 && attempt < 3) {
      await this.absorb(await response.json());
      return this.pushNow(attempt + 1);
    }
    if (response.status === 403) throw new Error("This device's sync link is no longer valid.");
    if (response.status === 404 || response.status === 410) throw new Error("This sync link was replaced or has expired — ask your partner for the new one.");
    if (!response.ok) throw new Error(`Sync failed (${response.status})`);
    const result = await response.json();
    this.config.version = result.version;
    this.config.lastSyncAt = Date.now();
    this.saveConfig();
    this.setStatus("synced");
  }
  async pullNow(force) {
    if (!this.active) return "off";
    const response = await this.request("GET", null, force ? "" : `?since=${this.config.version}`);
    if (response.status === 204) {
      this.config.lastSyncAt = Date.now();
      this.saveConfig();
      this.setStatus("synced");
      return "same";
    }
    if (response.status === 404) {
      if (!force) this.setStatus("error", "This sync link was replaced or has expired — ask your partner for the new one.");
      return "missing";
    }
    if (!response.ok) throw new Error(`Sync failed (${response.status})`);
    const remotePlan = await this.absorb(await response.json());
    if (planFingerprint(this.getState()) !== planFingerprint(remotePlan)) {
      await this.pushNow();
    } else {
      this.config.lastSyncAt = Date.now();
      this.saveConfig();
      this.setStatus("synced");
    }
    return "updated";
  }
  async absorb(remote) {
    const { encKey } = await this.keysReady();
    let plan;
    try {
      plan = await openPlan(remote.data, encKey);
    } catch (error) {
      throw new Error(this.protected ? "Could not unlock the shared plan — wrong passphrase?" : "Could not unlock the shared plan — the link may be wrong.");
    }
    this.config.version = remote.version;
    this.saveConfig();
    this.applyRemote(plan);
    return plan;
  }
}

