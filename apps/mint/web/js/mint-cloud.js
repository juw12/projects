/* Mint account + end-to-end encrypted sync key, shared by Budget and the Marketplace.
 *
 * Both pages live on the same origin, so they share one login ("mint.token", the bearer token the
 * Mint API issues) and one sync key. The sync key is a random AES-256 key that never leaves the
 * device in the clear: the server only stores it wrapped (AES-GCM) with a key derived from the
 * password (PBKDF2-SHA256), and optionally a second copy wrapped with the recovery code, so a
 * password reset keeps synced data readable. Budgets are sealed with that key before upload.
 *
 * Wire formats (base64url parts, "." separated):
 *   w1.<iv>.<ciphertext>   a wrapped sync key
 *   s1.<iv>.<ciphertext>   an item: JSON, deflate-raw compressed, AES-GCM with the item key as AAD
 *   s0.<iv>.<ciphertext>   the same without compression (browsers without CompressionStream)
 */
(function (root) {
  'use strict';

  var TOKEN_KEY = 'mint.token';
  var USER_KEY = 'mint.user';
  var DEK_KEY = 'mint.sync.dek';
  var DEFAULT_API = 'https://mint-api.juw12.workers.dev';
  var ROUNDS = 210000;
  var te = new TextEncoder();
  var td = new TextDecoder();
  var listeners = [];
  var dekCache = null;

  function storageGet(key) {
    try {
      return root.localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }
  function storageSet(key, value) {
    try {
      if (value == null) {
        root.localStorage.removeItem(key);
      } else {
        root.localStorage.setItem(key, value);
      }
    } catch (err) {
      /* storage blocked: the session lasts for this page only */
    }
  }

  function apiBase() {
    var fromQuery = null;
    try {
      fromQuery = new URLSearchParams(root.location.search).get('api');
      if (fromQuery) {
        root.localStorage.setItem('mint.api', fromQuery);
      }
    } catch (err) {
      /* ignore */
    }
    var meta = root.document && root.document.querySelector('meta[name="mint-api"]');
    return (fromQuery || storageGet('mint.api') || (meta && meta.content) || DEFAULT_API).replace(/\/+$/, '');
  }

  // ------------------------------------------------------------------ encoding
  function b64u(bytes) {
    var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var s = '';
    for (var i = 0; i < b.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    }
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64u(text) {
    var s = String(text).replace(/-/g, '+').replace(/_/g, '/');
    var bin = atob(s + '==='.slice((s.length + 3) % 4));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  }
  function randomId(n) {
    return b64u(root.crypto.getRandomValues(new Uint8Array(n || 12)));
  }

  // ------------------------------------------------------------------ API
  function call(method, path, body) {
    var token = storageGet(TOKEN_KEY);
    var opts = { method: method, mode: 'cors', credentials: 'omit', headers: {} };
    if (token) {
      opts.headers.Authorization = 'Bearer ' + token;
    }
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(apiBase() + '/api/' + path, opts).then(
      function (res) {
        return res
          .json()
          .catch(function () {
            return {};
          })
          .then(function (data) {
            if (res.status === 401 && token && path.indexOf('auth/') !== 0) {
              forget();
            }
            if (!res.ok) {
              var err = new Error(data.error || 'Request failed (' + res.status + ')');
              err.status = res.status;
              err.data = data;
              throw err;
            }
            return data;
          });
      },
      function () {
        var err = new Error('Can\u2019t reach Mint right now \u2014 check your connection');
        err.status = 0;
        throw err;
      }
    );
  }

  // ------------------------------------------------------------------ keys
  function deriveKek(secret, salt) {
    var subtle = root.crypto.subtle;
    return subtle.importKey('raw', te.encode(secret), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return subtle.deriveKey({ name: 'PBKDF2', salt: te.encode(salt), iterations: ROUNDS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }
  function normEmail(email) {
    return String(email || '').trim().toLowerCase();
  }
  function normCode(code) {
    return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
  function passwordKek(email, password) {
    return deriveKek(String(password || ''), 'mint-sync-pw-v1:' + normEmail(email));
  }
  function recoveryKek(email, code) {
    return deriveKek(normCode(code), 'mint-sync-rc-v1:' + normEmail(email));
  }
  function wrap(kek, raw) {
    var iv = root.crypto.getRandomValues(new Uint8Array(12));
    return root.crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, kek, raw).then(function (ct) {
      return 'w1.' + b64u(iv) + '.' + b64u(ct);
    });
  }
  function unwrap(kek, wrapped) {
    var parts = String(wrapped || '').split('.');
    if (parts.length !== 3 || parts[0] !== 'w1') {
      return Promise.reject(new Error('Unknown key format'));
    }
    return root.crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(parts[1]) }, kek, unb64u(parts[2])).then(function (raw) {
      return new Uint8Array(raw);
    });
  }

  function saveDek(id, raw, email) {
    storageSet(DEK_KEY, JSON.stringify({ id: id, k: b64u(raw), email: normEmail(email) }));
    dekCache = null;
    emit();
  }
  function dekRecord() {
    try {
      return JSON.parse(storageGet(DEK_KEY) || 'null');
    } catch (err) {
      return null;
    }
  }
  /** The unlocked sync key on this device: {id, key: CryptoKey} or null. */
  function dek() {
    var rec = dekRecord();
    if (!rec || !rec.k) {
      return Promise.resolve(null);
    }
    if (dekCache && dekCache.id === rec.id) {
      return Promise.resolve(dekCache);
    }
    return root.crypto.subtle.importKey('raw', unb64u(rec.k), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']).then(function (key) {
      dekCache = { id: rec.id, key: key };
      return dekCache;
    });
  }

  /** After the password is known: fetch the wrapped key and unlock it, or create the account's first key. */
  function unlock(email, password, recoveryCode) {
    if (!(root.crypto && root.crypto.subtle)) {
      return Promise.reject(new Error('Sync needs a secure (https) page'));
    }
    return call('GET', 'sync/key').then(function (d) {
      var key = d.key;
      if (key) {
        return passwordKek(email, password)
          .then(function (kek) {
            return unwrap(kek, key.wrapPw);
          })
          .then(
            function (raw) {
              saveDek(key.keyId, raw, email);
              if (recoveryCode && !key.wrapRc) {
                return recoveryKek(email, recoveryCode)
                  .then(function (rk) {
                    return wrap(rk, raw);
                  })
                  .then(function (wrapRc) {
                    return call('POST', 'sync/key', { keyId: key.keyId, wrapPw: key.wrapPw, wrapRc: wrapRc });
                  })
                  .then(function () {
                    return key.keyId;
                  });
              }
              return key.keyId;
            },
            function () {
              var err = new Error('Your synced data is locked with an older password');
              err.code = 'locked';
              throw err;
            }
          );
      }
      var raw = root.crypto.getRandomValues(new Uint8Array(32));
      var id = randomId(12);
      return passwordKek(email, password)
        .then(function (kek) {
          return wrap(kek, raw);
        })
        .then(function (wrapPw) {
          if (!recoveryCode) {
            return { keyId: id, wrapPw: wrapPw };
          }
          return recoveryKek(email, recoveryCode)
            .then(function (rk) {
              return wrap(rk, raw);
            })
            .then(function (wrapRc) {
              return { keyId: id, wrapPw: wrapPw, wrapRc: wrapRc };
            });
        })
        .then(function (body) {
          return call('POST', 'sync/key', body);
        })
        .then(
          function () {
            saveDek(id, raw, email);
            return id;
          },
          function (err) {
            // Another device created the key a moment ago: unlock that one instead.
            if (err.status === 409) {
              return unlock(email, password, recoveryCode);
            }
            throw err;
          }
        );
    });
  }

  /** Re-wrap the unlocked key (after a password change or a new recovery code). */
  function rewrap(opts) {
    var rec = dekRecord();
    var email = opts.email || (rec && rec.email) || (user() && user().email) || '';
    if (!rec || !email) {
      return Promise.resolve(false);
    }
    var raw = unb64u(rec.k);
    var jobs = [];
    var body = { keyId: rec.id };
    jobs.push(
      opts.password
        ? passwordKek(email, opts.password).then(function (k) {
            return wrap(k, raw);
          })
        : call('GET', 'sync/key').then(function (d) {
            if (!d.key || d.key.keyId !== rec.id) {
              throw new Error('stale');
            }
            return d.key.wrapPw;
          })
    );
    if (opts.recoveryCode) {
      jobs.push(
        recoveryKek(email, opts.recoveryCode).then(function (k) {
          return wrap(k, raw);
        })
      );
    }
    return Promise.all(jobs)
      .then(function (wraps) {
        body.wrapPw = wraps[0];
        if (wraps[1]) {
          body.wrapRc = wraps[1];
        }
        return call('POST', 'sync/key', body);
      })
      .then(
        function () {
          return true;
        },
        function () {
          return false;
        }
      );
  }

  // ------------------------------------------------------------------ sealed items
  function pipe(bytes, stream) {
    var blob = new Blob([bytes]).stream().pipeThrough(stream);
    return new Response(blob).arrayBuffer().then(function (buf) {
      return new Uint8Array(buf);
    });
  }
  var canZip = typeof root.CompressionStream === 'function' && typeof root.DecompressionStream === 'function';

  function seal(itemKey, value) {
    return dek().then(function (k) {
      if (!k) {
        throw new Error('Sync is locked on this device');
      }
      var plain = te.encode(JSON.stringify(value));
      var packed = canZip ? pipe(plain, new root.CompressionStream('deflate-raw')) : Promise.resolve(plain);
      return packed.then(function (bytes) {
        var iv = root.crypto.getRandomValues(new Uint8Array(12));
        return root.crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: te.encode(itemKey) }, k.key, bytes).then(function (ct) {
          return (canZip ? 's1.' : 's0.') + b64u(iv) + '.' + b64u(ct);
        });
      });
    });
  }

  function open(itemKey, blob) {
    var parts = String(blob || '').split('.');
    if (parts.length !== 3 || (parts[0] !== 's1' && parts[0] !== 's0')) {
      return Promise.reject(new Error('Unknown item format'));
    }
    return dek().then(function (k) {
      if (!k) {
        throw new Error('Sync is locked on this device');
      }
      return root.crypto.subtle
        .decrypt({ name: 'AES-GCM', iv: unb64u(parts[1]), additionalData: te.encode(itemKey) }, k.key, unb64u(parts[2]))
        .then(function (buf) {
          var bytes = new Uint8Array(buf);
          return parts[0] === 's1' ? pipe(bytes, new root.DecompressionStream('deflate-raw')) : bytes;
        })
        .then(function (bytes) {
          return JSON.parse(td.decode(bytes));
        });
    });
  }

  // ------------------------------------------------------------------ session
  function token() {
    return storageGet(TOKEN_KEY) || '';
  }
  function user() {
    try {
      return JSON.parse(storageGet(USER_KEY) || 'null');
    } catch (err) {
      return null;
    }
  }
  function keepSession(data) {
    if (data.token) {
      storageSet(TOKEN_KEY, data.token);
    }
    if (data.user) {
      storageSet(USER_KEY, JSON.stringify({ id: data.user.id, email: data.user.email, name: data.user.name }));
    }
    emit();
    return data.user;
  }
  /** Drop the session and the unlocked key from this device (the account itself stays). */
  function forget() {
    storageSet(TOKEN_KEY, null);
    storageSet(USER_KEY, null);
    storageSet(DEK_KEY, null);
    dekCache = null;
    emit();
  }

  function register(email, name, password) {
    return call('POST', 'auth/register', { email: email, name: name, password: password }).then(function (d) {
      keepSession(d);
      return unlock(email, password, d.recoveryCode)
        .catch(function () {
          return null;
        })
        .then(function () {
          return { user: d.user, recoveryCode: d.recoveryCode };
        });
    });
  }

  function login(email, password) {
    return call('POST', 'auth/login', { email: email, password: password }).then(function (d) {
      keepSession(d);
      return unlock(email, password)
        .then(
          function () {
            return { user: d.user, locked: false };
          },
          function (err) {
            return { user: d.user, locked: err.code === 'locked', error: err };
          }
        );
    });
  }

  /** Password reset with the recovery code; the recovery copy of the key keeps synced data readable. */
  function recover(email, code, newPassword) {
    var before = dekRecord();
    return call('POST', 'auth/recover', { email: email, recoveryCode: code, newPassword: newPassword }).then(function (d) {
      keepSession(d);
      return call('GET', 'sync/key')
        .then(function (k) {
          if (!k.key) {
            return unlock(email, newPassword, d.recoveryCode);
          }
          var fromRc = k.key.wrapRc
            ? recoveryKek(email, code).then(function (rk) {
                return unwrap(rk, k.key.wrapRc);
              })
            : Promise.reject(new Error('no recovery copy'));
          return fromRc
            .catch(function () {
              if (before && before.id === k.key.keyId) {
                return unb64u(before.k);
              }
              throw new Error('locked');
            })
            .then(function (raw) {
              saveDek(k.key.keyId, raw, email);
              return rewrap({ email: email, password: newPassword, recoveryCode: d.recoveryCode });
            });
        })
        .catch(function () {
          return null;
        })
        .then(function () {
          return { user: d.user, recoveryCode: d.recoveryCode };
        });
    });
  }

  function changePassword(currentPassword, newPassword) {
    return call('POST', 'me/password', { currentPassword: currentPassword, newPassword: newPassword }).then(function (d) {
      var u = user();
      var after = dekRecord() ? Promise.resolve() : u ? unlock(u.email, currentPassword).catch(function () {}) : Promise.resolve();
      return after
        .then(function () {
          return rewrap({ password: newPassword });
        })
        .then(function () {
          return d;
        });
    });
  }

  function newRecoveryCode(password) {
    return call('POST', 'me/recovery-code', { password: password }).then(function (d) {
      var u = user();
      var ready = dekRecord() ? Promise.resolve() : u ? unlock(u.email, password).catch(function () {}) : Promise.resolve();
      return ready
        .then(function () {
          return rewrap({ password: password, recoveryCode: d.recoveryCode });
        })
        .then(function () {
          return d.recoveryCode;
        });
    });
  }

  function logout() {
    var done = token() ? call('POST', 'auth/logout', {}).catch(function () {}) : Promise.resolve();
    return done.then(forget);
  }

  /** Start over: delete this account's synced items and key on the server (local data stays). */
  function resetSync(password) {
    var u = user();
    return call('DELETE', 'sync').then(function () {
      storageSet(DEK_KEY, null);
      dekCache = null;
      return u && password ? unlock(u.email, password) : null;
    });
  }

  function emit() {
    listeners.slice().forEach(function (fn) {
      try {
        fn();
      } catch (err) {
        /* a listener failing must not break the others */
      }
    });
  }
  function onChange(fn) {
    listeners.push(fn);
  }
  // Another tab or the Marketplace frame logged in or out.
  root.addEventListener('storage', function (e) {
    if (e.key === TOKEN_KEY || e.key === DEK_KEY || e.key === USER_KEY) {
      dekCache = null;
      emit();
    }
  });

  root.MintCloud = {
    apiBase: apiBase,
    call: call,
    token: token,
    user: user,
    signedIn: function () {
      return !!token();
    },
    unlocked: function () {
      var rec = dekRecord();
      var u = user();
      return !!(rec && token() && (!u || !rec.email || rec.email === normEmail(u.email)));
    },
    keyId: function () {
      var rec = dekRecord();
      return rec ? rec.id : '';
    },
    keepSession: keepSession,
    register: register,
    login: login,
    unlock: unlock,
    recover: recover,
    changePassword: changePassword,
    newRecoveryCode: newRecoveryCode,
    rewrap: rewrap,
    logout: logout,
    forget: forget,
    /** Drop only the unlocked key (the session stays); the next sync asks for the password. */
    lock: function () {
      storageSet(DEK_KEY, null);
      dekCache = null;
      emit();
    },
    resetSync: resetSync,
    seal: seal,
    open: open,
    onChange: onChange,
  };
})(window);
