/*
 * Sheetmint data layer. Two interchangeable stores with the same async interface:
 *   ApiStore   — talks to server/server.py (real accounts, shared marketplace)
 *   LocalStore — browser-only demo (GitHub Pages / offline). Mirrors the server's
 *                rules: fees, affiliate commission, no self-referral, buyer-only reviews.
 * SheetmintStore.connect() picks the server when /api/health answers, else the demo.
 */
(function (root) {
  "use strict";

  var Core = root.SheetmintCore;
  var FEE_PCT = 10;
  var KEY = "sheetmint.demo.v1";

  function fail(status, message) {
    var err = new Error(message);
    err.status = status;
    return Promise.reject(err);
  }

  // ------------------------------------------------------------------ API store
  function ApiStore(health) {
    this.mode = "server";
    this.feePct = health.platformFeePct;
  }

  ApiStore.prototype.call = function (method, path, body) {
    var opts = { method: method, credentials: "same-origin", headers: {} };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch("api/" + path, opts).then(function (res) {
      return res.json().catch(function () {
        return {};
      }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || "Request failed (" + res.status + ")");
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  };

  ApiStore.prototype.me = function () { return this.call("GET", "me").then(function (d) { return d.user; }); };
  ApiStore.prototype.register = function (email, name, password) { return this.call("POST", "auth/register", { email: email, name: name, password: password }).then(function (d) { return d.user; }); };
  ApiStore.prototype.login = function (email, password) { return this.call("POST", "auth/login", { email: email, password: password }).then(function (d) { return d.user; }); };
  ApiStore.prototype.logout = function () { return this.call("POST", "auth/logout", {}); };
  ApiStore.prototype.myTemplates = function () { return this.call("GET", "templates").then(function (d) { return d.templates; }); };
  ApiStore.prototype.saveTemplate = function (id, spec) { return this.call("POST", "templates", { id: id || undefined, title: spec.title, spec: spec }).then(function (d) { return d.template; }); };
  ApiStore.prototype.deleteTemplate = function (id) { return this.call("DELETE", "templates/" + encodeURIComponent(id)); };
  ApiStore.prototype.browse = function (q) {
    var params = [];
    Object.keys(q || {}).forEach(function (k) {
      if (q[k] !== undefined && q[k] !== "") {
        params.push(encodeURIComponent(k) + "=" + encodeURIComponent(q[k]));
      }
    });
    return this.call("GET", "listings" + (params.length ? "?" + params.join("&") : "")).then(function (d) { return d.listings; });
  };
  ApiStore.prototype.listing = function (id) { return this.call("GET", "listings/" + encodeURIComponent(id)).then(function (d) { return d.listing; }); };
  ApiStore.prototype.publish = function (data) { return this.call("POST", "listings", data).then(function (d) { return d.listing; }); };
  ApiStore.prototype.setStatus = function (id, live) { return this.call("POST", "listings/" + encodeURIComponent(id) + "/" + (live ? "republish" : "unpublish"), {}); };
  ApiStore.prototype.buy = function (id, ref) { return this.call("POST", "listings/" + encodeURIComponent(id) + "/buy", { ref: ref || "" }); };
  ApiStore.prototype.review = function (id, rating, body) { return this.call("POST", "listings/" + encodeURIComponent(id) + "/reviews", { rating: rating, body: body }); };
  ApiStore.prototype.library = function () { return this.call("GET", "library").then(function (d) { return d.items; }); };
  ApiStore.prototype.createLink = function (listingId) { return this.call("POST", "affiliate/links", { listingId: listingId }).then(function (d) { return d.link; }); };
  ApiStore.prototype.affiliate = function () { return this.call("GET", "affiliate").then(function (d) { return d.links; }); };
  ApiStore.prototype.click = function (code) { return this.call("POST", "affiliate/click", { code: code }).catch(function () {}); };
  ApiStore.prototype.seller = function () { return this.call("GET", "seller"); };

  // ------------------------------------------------------------------ local demo store
  function LocalStore() {
    this.mode = "demo";
    this.feePct = FEE_PCT;
    this.db = null;
  }

  LocalStore.prototype.load = function () {
    var self = this;
    try {
      self.db = JSON.parse(localStorage.getItem(KEY));
    } catch (err) {
      self.db = null;
    }
    if (self.db && self.db.version === 1) {
      return Promise.resolve();
    }
    self.db = { version: 1, nextId: 1, users: [], session: null, templates: [], listings: [], purchases: [], links: [], reviews: [] };
    return fetch("data/seed.json").then(function (res) {
      return res.ok ? res.json() : null;
    }).catch(function () {
      return null;
    }).then(function (seed) {
      var items = seed && seed.listings ? seed.listings : Core.BLUEPRINTS.map(function (bp) {
        return { id: "seed-" + bp.id, title: bp.title, description: bp.description, category: bp.category, tags: [], price: 0, currency: "USD", commissionPct: 0, spec: Core.specFromBlueprint(bp) };
      });
      var studio = { id: 0, email: "studio@sheetmint.local", name: "Sheetmint Studio", system: true };
      self.db.users.push(studio);
      var now = Date.now() / 1000;
      items.forEach(function (item, i) {
        self.db.listings.push({
          id: item.id, sellerId: 0, templateId: null, title: item.title, description: item.description, category: item.category,
          tags: item.tags || [], priceCents: Math.round(item.price * 100), currency: item.currency, commissionPct: item.commissionPct || 0,
          paymentUrl: "", spec: item.spec, status: "live", created: now - i, updated: now - i
        });
      });
      self.save();
    });
  };

  LocalStore.prototype.save = function () {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.db));
    } catch (err) {
      /* storage full — demo keeps working in memory */
    }
  };

  LocalStore.prototype.id = function (prefix) {
    this.db.nextId += 1;
    return prefix + this.db.nextId.toString(36) + Math.random().toString(36).slice(2, 7);
  };

  LocalStore.prototype.currentUser = function () {
    var sid = this.db.session;
    return this.db.users.filter(function (u) {
      return u.id === sid && !u.system;
    })[0] || null;
  };

  LocalStore.prototype.need = function () {
    var user = this.currentUser();
    if (!user) {
      var err = new Error("Please log in");
      err.status = 401;
      throw err;
    }
    return user;
  };

  function hashPassword(password, salt) {
    var enc = new TextEncoder();
    if (root.crypto && root.crypto.subtle) {
      return root.crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]).then(function (key) {
        return root.crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc.encode(salt), iterations: 100000, hash: "SHA-256" }, key, 256);
      }).then(function (bits) {
        return Array.prototype.map.call(new Uint8Array(bits), function (b) {
          return ("0" + b.toString(16)).slice(-2);
        }).join("");
      });
    }
    // file:// fallback (no SubtleCrypto): weak but this is a local-only demo.
    var h = 2166136261;
    var s = salt + ":" + password;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return Promise.resolve("fnv" + h.toString(16));
  }

  function publicUser(u) {
    return { id: u.id, email: u.email, name: u.name };
  }

  function guard(fn) {
    try {
      return Promise.resolve(fn());
    } catch (err) {
      return Promise.reject(err);
    }
  }

  LocalStore.prototype.me = function () {
    var u = this.currentUser();
    return Promise.resolve(u ? publicUser(u) : null);
  };

  LocalStore.prototype.register = function (email, name, password) {
    var self = this;
    email = String(email || "").trim().toLowerCase();
    name = String(name || "").trim().slice(0, 60);
    if (!/^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,24}$/.test(email)) {
      return fail(400, "Enter a valid email");
    }
    if (!name) {
      return fail(400, "Name is required");
    }
    if (String(password || "").length < 8) {
      return fail(400, "Password must be at least 8 characters");
    }
    if (self.db.users.some(function (u) { return u.email === email; })) {
      return fail(409, "An account with this email already exists");
    }
    var salt = Math.random().toString(36).slice(2);
    return hashPassword(password, salt).then(function (hash) {
      var user = { id: self.db.users.length + 1, email: email, name: name, hash: hash, salt: salt };
      self.db.users.push(user);
      self.db.session = user.id;
      self.save();
      return publicUser(user);
    });
  };

  LocalStore.prototype.login = function (email, password) {
    var self = this;
    var user = self.db.users.filter(function (u) {
      return u.email === String(email || "").trim().toLowerCase() && !u.system;
    })[0];
    if (!user) {
      return fail(401, "Wrong email or password");
    }
    return hashPassword(password, user.salt).then(function (hash) {
      if (hash !== user.hash) {
        throw Object.assign(new Error("Wrong email or password"), { status: 401 });
      }
      self.db.session = user.id;
      self.save();
      return publicUser(user);
    });
  };

  LocalStore.prototype.logout = function () {
    this.db.session = null;
    this.save();
    return Promise.resolve({ ok: true });
  };

  LocalStore.prototype.myTemplates = function () {
    var self = this;
    return guard(function () {
      var u = self.need();
      return self.db.templates.filter(function (t) {
        return t.ownerId === u.id;
      }).sort(function (a, b) {
        return b.updated - a.updated;
      }).map(function (t) {
        return { id: t.id, title: t.title, updated: t.updated, spec: t.spec };
      });
    });
  };

  LocalStore.prototype.saveTemplate = function (id, spec) {
    var self = this;
    return guard(function () {
      var u = self.need();
      var clean = Core.normalize(spec);
      var existing = self.db.templates.filter(function (t) {
        return t.id === id;
      })[0];
      if (existing && existing.ownerId !== u.id) {
        throw Object.assign(new Error("Not your template"), { status: 403 });
      }
      if (!existing) {
        existing = { id: self.id("t_"), ownerId: u.id };
        self.db.templates.push(existing);
      }
      existing.title = clean.title;
      existing.spec = clean;
      existing.updated = Date.now() / 1000;
      self.save();
      return { id: existing.id, title: existing.title, spec: clean };
    });
  };

  LocalStore.prototype.deleteTemplate = function (id) {
    var self = this;
    return guard(function () {
      var u = self.need();
      self.db.templates = self.db.templates.filter(function (t) {
        return !(t.id === id && t.ownerId === u.id);
      });
      self.save();
      return { ok: true };
    });
  };

  LocalStore.prototype.summary = function (l) {
    var self = this;
    var purchases = self.db.purchases.filter(function (p) {
      return p.listingId === l.id;
    });
    var reviews = self.db.reviews.filter(function (r) {
      return r.listingId === l.id;
    });
    var seller = self.db.users.filter(function (u) {
      return u.id === l.sellerId;
    })[0];
    var avg = reviews.length ? reviews.reduce(function (a, r) { return a + r.rating; }, 0) / reviews.length : null;
    return {
      id: l.id, title: l.title, description: l.description, category: l.category, tags: l.tags, price: l.priceCents / 100,
      currency: l.currency, commissionPct: l.commissionPct, paymentUrl: l.paymentUrl, status: l.status, sellerId: l.sellerId,
      sellerName: seller ? seller.name : "Unknown", sales: purchases.length, ratingCount: reviews.length,
      rating: avg === null ? null : Math.round(avg * 100) / 100, theme: l.spec.theme,
      columns: l.spec.sheet.columns.slice(0, 8).map(function (c) { return c.name; }), created: l.created
    };
  };

  LocalStore.prototype.browse = function (q) {
    var self = this;
    q = q || {};
    var term = String(q.q || "").trim().toLowerCase();
    var items = self.db.listings.filter(function (l) {
      if (l.status !== "live") {
        return false;
      }
      if (q.category && l.category !== q.category) {
        return false;
      }
      if (q.free === "1" && l.priceCents !== 0) {
        return false;
      }
      if (q.seller && String(l.sellerId) !== String(q.seller)) {
        return false;
      }
      if (term) {
        var hay = (l.title + " " + l.description + " " + l.tags.join(" ")).toLowerCase();
        return hay.indexOf(term) !== -1;
      }
      return true;
    }).map(function (l) {
      return self.summary(l);
    });
    var sort = q.sort || "new";
    items.sort(function (a, b) {
      if (sort === "popular") return b.sales - a.sales || b.created - a.created;
      if (sort === "price_asc") return a.price - b.price;
      if (sort === "price_desc") return b.price - a.price;
      if (sort === "rating") return (b.rating || 0) - (a.rating || 0) || b.ratingCount - a.ratingCount;
      return b.created - a.created;
    });
    return Promise.resolve(items);
  };

  LocalStore.prototype.find = function (id) {
    var l = this.db.listings.filter(function (x) {
      return x.id === id;
    })[0];
    if (!l) {
      throw Object.assign(new Error("Listing not found"), { status: 404 });
    }
    return l;
  };

  LocalStore.prototype.listing = function (id) {
    var self = this;
    return guard(function () {
      var l = self.find(id);
      var u = self.currentUser();
      if (l.status !== "live" && (!u || u.id !== l.sellerId)) {
        throw Object.assign(new Error("Listing not found"), { status: 404 });
      }
      var s = self.summary(l);
      s.spec = l.spec;
      s.owned = !!(u && self.db.purchases.some(function (p) { return p.listingId === id && p.buyerId === u.id; }));
      s.isSeller = !!(u && u.id === l.sellerId);
      s.reviews = self.db.reviews.filter(function (r) {
        return r.listingId === id;
      }).sort(function (a, b) {
        return b.created - a.created;
      }).map(function (r) {
        var who = self.db.users.filter(function (x) { return x.id === r.userId; })[0];
        return { rating: r.rating, body: r.body, name: who ? who.name : "Buyer", created: r.created };
      });
      return s;
    });
  };

  LocalStore.prototype.publish = function (data) {
    var self = this;
    return guard(function () {
      var u = self.need();
      var title = String(data.title || "").trim().slice(0, 70);
      var description = String(data.description || "").trim().slice(0, 1200);
      if (!title) throw Object.assign(new Error("Title is required"), { status: 400 });
      if (!description) throw Object.assign(new Error("Description is required"), { status: 400 });
      var price = parseFloat(data.price || 0);
      if (isNaN(price) || price < 0) throw Object.assign(new Error("Price must be 0 or more"), { status: 400 });
      var commission = parseInt(data.commissionPct, 10);
      if (isNaN(commission) || commission < 0 || commission > 50) throw Object.assign(new Error("Affiliate commission must be 0–50%"), { status: 400 });
      var paymentUrl = String(data.paymentUrl || "").trim();
      if (paymentUrl && paymentUrl.indexOf("https://") !== 0) throw Object.assign(new Error("Payment link must start with https://"), { status: 400 });
      var now = Date.now() / 1000;
      var l = {
        id: self.id("l_"), sellerId: u.id, templateId: data.templateId || null, title: title, description: description,
        category: Core.CATEGORIES.indexOf(data.category) !== -1 ? data.category : "Other",
        tags: (data.tags || []).slice(0, 8), priceCents: Math.round(price * 100),
        currency: Core.CURRENCIES[data.currency] ? data.currency : "USD", commissionPct: commission, paymentUrl: paymentUrl,
        spec: Core.normalize(data.spec), status: "live", created: now, updated: now
      };
      self.db.listings.push(l);
      self.save();
      return self.summary(l);
    });
  };

  LocalStore.prototype.setStatus = function (id, live) {
    var self = this;
    return guard(function () {
      var u = self.need();
      var l = self.find(id);
      if (l.sellerId !== u.id) throw Object.assign(new Error("Not your listing"), { status: 403 });
      l.status = live ? "live" : "hidden";
      self.save();
      return { ok: true, status: l.status };
    });
  };

  LocalStore.prototype.buy = function (id, ref) {
    var self = this;
    return guard(function () {
      var u = self.need();
      var l = self.find(id);
      if (l.status !== "live") throw Object.assign(new Error("Listing not found"), { status: 404 });
      if (l.sellerId === u.id) throw Object.assign(new Error("You can’t buy your own template"), { status: 400 });
      var existing = self.db.purchases.filter(function (p) {
        return p.listingId === id && p.buyerId === u.id;
      })[0];
      if (existing) return { purchase: existing, alreadyOwned: true };
      var price = l.priceCents;
      var fee = Math.round(price * self.feePct / 100);
      var link = ref ? self.db.links.filter(function (x) { return x.code === ref && x.listingId === id; })[0] : null;
      if (link && (link.userId === u.id || link.userId === l.sellerId)) link = null;
      var commission = link && price > 0 ? Math.round(price * l.commissionPct / 100) : 0;
      var purchase = {
        listingId: id, buyerId: u.id, priceCents: price, currency: l.currency, feeCents: fee,
        affiliateCode: link ? link.code : null, affiliateUserId: link ? link.userId : null,
        commissionCents: commission, sellerNetCents: price - fee - commission, created: Date.now() / 1000
      };
      self.db.purchases.push(purchase);
      self.save();
      return { purchase: purchase, alreadyOwned: false, mode: "demo" };
    });
  };

  LocalStore.prototype.review = function (id, rating, body) {
    var self = this;
    return guard(function () {
      var u = self.need();
      if (!self.db.purchases.some(function (p) { return p.listingId === id && p.buyerId === u.id; })) {
        throw Object.assign(new Error("Only buyers can review"), { status: 403 });
      }
      rating = parseInt(rating, 10);
      if (!(rating >= 1 && rating <= 5)) throw Object.assign(new Error("Rating must be 1–5"), { status: 400 });
      self.db.reviews = self.db.reviews.filter(function (r) {
        return !(r.listingId === id && r.userId === u.id);
      });
      self.db.reviews.push({ listingId: id, userId: u.id, rating: rating, body: String(body || "").slice(0, 800), created: Date.now() / 1000 });
      self.save();
      return { ok: true };
    });
  };

  LocalStore.prototype.library = function () {
    var self = this;
    return guard(function () {
      var u = self.need();
      return self.db.purchases.filter(function (p) {
        return p.buyerId === u.id;
      }).sort(function (a, b) {
        return b.created - a.created;
      }).map(function (p) {
        var l = self.find(p.listingId);
        return { listingId: l.id, title: l.title, price: p.priceCents / 100, currency: p.currency, purchased: p.created, spec: l.spec };
      });
    });
  };

  LocalStore.prototype.createLink = function (listingId) {
    var self = this;
    return guard(function () {
      var u = self.need();
      var l = self.find(listingId);
      if (l.status !== "live") throw Object.assign(new Error("Listing not found"), { status: 404 });
      if (l.commissionPct <= 0) throw Object.assign(new Error("This seller doesn’t offer affiliate commission"), { status: 400 });
      var existing = self.db.links.filter(function (x) {
        return x.userId === u.id && x.listingId === listingId;
      })[0];
      if (existing) return { code: existing.code, listingId: listingId };
      var code = (u.name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10) || "partner") + "-" + Math.random().toString(16).slice(2, 8);
      self.db.links.push({ code: code, userId: u.id, listingId: listingId, clicks: 0, created: Date.now() / 1000 });
      self.save();
      return { code: code, listingId: listingId };
    });
  };

  LocalStore.prototype.affiliate = function () {
    var self = this;
    return guard(function () {
      var u = self.need();
      return self.db.links.filter(function (x) {
        return x.userId === u.id;
      }).map(function (x) {
        var l = self.find(x.listingId);
        var sales = self.db.purchases.filter(function (p) {
          return p.affiliateCode === x.code;
        });
        return {
          code: x.code, listingId: x.listingId, title: l.title, clicks: x.clicks, sales: sales.length,
          earnings: sales.reduce(function (a, p) { return a + p.commissionCents; }, 0) / 100,
          currency: l.currency, commissionPct: l.commissionPct, price: l.priceCents / 100
        };
      });
    });
  };

  LocalStore.prototype.click = function (code) {
    var link = this.db.links.filter(function (x) {
      return x.code === code;
    })[0];
    if (link) {
      link.clicks += 1;
      this.save();
    }
    return Promise.resolve({ ok: true });
  };

  LocalStore.prototype.seller = function () {
    var self = this;
    return guard(function () {
      var u = self.need();
      var mine = self.db.listings.filter(function (l) {
        return l.sellerId === u.id;
      }).sort(function (a, b) {
        return b.created - a.created;
      });
      var listings = mine.map(function (l) {
        var ps = self.db.purchases.filter(function (p) {
          return p.listingId === l.id;
        });
        var s = self.summary(l);
        function total(key) {
          return ps.reduce(function (a, p) { return a + p[key]; }, 0) / 100;
        }
        s.gross = total("priceCents");
        s.fees = total("feeCents");
        s.commissions = total("commissionCents");
        s.net = total("sellerNetCents");
        return s;
      });
      var ids = mine.map(function (l) { return l.id; });
      var recent = self.db.purchases.filter(function (p) {
        return ids.indexOf(p.listingId) !== -1;
      }).sort(function (a, b) {
        return b.created - a.created;
      }).slice(0, 20).map(function (p) {
        var l = self.find(p.listingId);
        return { title: l.title, price: p.priceCents / 100, currency: p.currency, created: p.created, viaAffiliate: !!p.affiliateCode, commission: p.commissionCents / 100 };
      });
      return { platformFeePct: self.feePct, listings: listings, recent: recent };
    });
  };

  LocalStore.prototype.reset = function () {
    localStorage.removeItem(KEY);
    return this.load();
  };

  // ------------------------------------------------------------------ connect
  function connect() {
    var probe = typeof fetch === "function" && /^https?:/.test(root.location ? root.location.protocol : "")
      ? fetch("api/health", { credentials: "same-origin" }).then(function (res) {
        return res.ok ? res.json() : null;
      }).catch(function () {
        return null;
      })
      : Promise.resolve(null);
    return probe.then(function (health) {
      if (health && health.mode === "server") {
        return new ApiStore(health);
      }
      var local = new LocalStore();
      return local.load().then(function () {
        return local;
      });
    });
  }

  root.SheetmintStore = { connect: connect, LocalStore: LocalStore, ApiStore: ApiStore, FEE_PCT: FEE_PCT };
})(typeof globalThis !== "undefined" ? globalThis : this);
