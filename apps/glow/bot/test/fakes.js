// Stand-ins for Cloudflare, the network, the AI models and the web, so the Worker's real code runs
// under plain Node.

import { StoppedError } from "../src/util.js";

// A clock the test moves by hand. Nothing in the Worker reads the real time.
export function makeClock(start = 1750000000000) {
  let time = start;
  const now = () => time;
  now.advance = (ms) => {
    time += ms;
    return time;
  };
  return now;
}

// Durable Object storage: keys and values, plus one alarm. Values are copied on the way in and out,
// as the real storage does, so a test cannot pass by sharing an object with the code under test.
export class FakeStorage {
  constructor() {
    this.map = new Map();
    this.alarmAt = null;
  }

  async get(keyOrKeys) {
    if (Array.isArray(keyOrKeys)) {
      const found = new Map();
      for (const key of keyOrKeys) {
        if (this.map.has(key)) found.set(key, structuredClone(this.map.get(key)));
      }
      return found;
    }
    return this.map.has(keyOrKeys) ? structuredClone(this.map.get(keyOrKeys)) : undefined;
  }

  async put(keyOrEntries, value) {
    if (typeof keyOrEntries === "string") {
      this.map.set(keyOrEntries, structuredClone(value));
      return;
    }
    for (const [key, entry] of Object.entries(keyOrEntries)) this.map.set(key, structuredClone(entry));
  }

  async delete(keyOrKeys) {
    if (Array.isArray(keyOrKeys)) {
      let removed = 0;
      for (const key of keyOrKeys) removed += this.map.delete(key) ? 1 : 0;
      return removed;
    }
    return this.map.delete(keyOrKeys);
  }

  async deleteAll() {
    this.map.clear();
  }

  async list(options = {}) {
    const found = new Map();
    for (const key of [...this.map.keys()].sort()) {
      if (!options.prefix || key.startsWith(options.prefix)) found.set(key, structuredClone(this.map.get(key)));
    }
    return found;
  }

  async setAlarm(time) {
    this.alarmAt = Number(time);
  }

  async getAlarm() {
    return this.alarmAt;
  }

  async deleteAlarm() {
    this.alarmAt = null;
  }
}

// A Durable Object namespace: one object per name, built the first time it is asked for.
export class FakeNamespace {
  constructor(Class, env, now) {
    this.Class = Class;
    this.env = env;
    this.now = now || (() => Date.now());
    this.objects = new Map();
  }

  idFromName(name) {
    return { name, toString: () => "id:" + name };
  }

  object(name) {
    if (!this.objects.has(name)) {
      const storage = new FakeStorage();
      const instance = new this.Class({ storage, id: this.idFromName(name) }, this.env);
      this.objects.set(name, { storage, instance });
    }
    return this.objects.get(name);
  }

  get(id) {
    return {
      fetch: (input, init) => this.object(id.name).instance.fetch(new Request(input, init)),
    };
  }

  // Run every alarm that is due, including ones the alarms themselves set, until none is left.
  async runAlarms(limit = 50) {
    let ran = 0;
    for (;;) {
      const due = [...this.objects.values()].filter((entry) => entry.storage.alarmAt !== null && entry.storage.alarmAt <= this.now());
      if (!due.length) return ran;
      for (const entry of due) {
        entry.storage.alarmAt = null; // the platform clears an alarm before it runs it
        await entry.instance.alarm();
        ran += 1;
        if (ran >= limit) throw new Error(`alarms were still being set after ${limit} runs`);
      }
    }
  }
}

export function reply(body, init = {}) {
  if (typeof body === "string" || body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return new Response(body, init);
  }
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
}

// A pretend network. routes = [[urlPrefix, handler(url, init, callNumber)], ...]; the first match answers.
// An address with no route gets status 599, so a test never reaches the real internet by accident.
export function fakeFetch(routes) {
  const calls = [];
  async function send(input, init = {}) {
    const url = String(typeof input === "string" ? input : input.url);
    if (init.signal && init.signal.aborted) throw new DOMException("This operation was aborted", "AbortError");
    calls.push({ url, method: init.method || "GET", headers: init.headers || {}, body: init.body });
    for (const [prefix, handler] of routes) {
      if (url.startsWith(prefix)) return handler(url, init, calls.length);
    }
    return new Response("no fake route for " + url, { status: 599 });
  }
  send.calls = calls;
  send.count = (prefix) => calls.filter((call) => call.url.startsWith(prefix)).length;
  return send;
}

// What an OpenAI-style endpoint sends back for one answer.
export function completion(text, extra = {}) {
  return { model: "fake-model", choices: [{ message: { role: "assistant", content: text } }], ...extra };
}

// A pretend Workers AI binding. answers = { "<model id>": output | (inputs) => output }.
export function fakeAi(answers, models) {
  const calls = [];
  const ai = {
    calls,
    async run(model, inputs) {
      calls.push({ model, inputs });
      if (!(model in answers)) throw new Error(`5007: No such model ${model}`);
      const answer = answers[model];
      return typeof answer === "function" ? answer(inputs) : answer;
    },
  };
  if (models) ai.models = async () => models;
  return ai;
}

// ------------------------------------------------------------------ AI models and the web
// A model that answers from a script. The first rule whose pattern matches the system prompt wins.
// An answer is a string, an Error to throw, or a function of the call that returns either.
export function scripted(rules) {
  const calls = [];
  async function complete({ messages, temperature, maxTokens, signal }) {
    const system = messages[0].content;
    const user = messages[messages.length - 1].content;
    const call = { system, user, messages, temperature, maxTokens, n: calls.length + 1 };
    calls.push(call);
    if (signal && signal.aborted) throw new StoppedError();
    for (const [pattern, answer] of rules) {
      if (!pattern.test(system)) continue;
      const value = typeof answer === "function" ? answer(call) : answer;
      if (value instanceof Error) throw value;
      return { text: value, name: "Test Model", label: "Test" };
    }
    throw new Error("no scripted answer for: " + system.slice(0, 60));
  }
  return { complete, calls, to: (pattern) => calls.filter((call) => pattern.test(call.system)) };
}

// An answer for scripted() that gives the next entry of a list on each call.
export function inTurn(answers) {
  let index = 0;
  return (call) => {
    if (index >= answers.length) return new Error("the script ran out of answers");
    const answer = answers[index++];
    return typeof answer === "function" ? answer(call) : answer;
  };
}

export function busyError() {
  const error = new Error("All the free AI models are busy.");
  error.name = "ModelsBusyError";
  error.retryInMs = 30000;
  return error;
}

export function fakeWeb({ results = [], pages = {}, news = null } = {}) {
  const calls = { search: [], read: [], news: 0 };
  return {
    calls,
    async search(query, signal) {
      calls.search.push(query);
      if (signal && signal.aborted) throw new StoppedError();
      const found = typeof results === "function" ? results(calls.search.length) : results;
      if (found instanceof Error) throw found;
      return { results: found, via: "test", tried: [] };
    },
    async read(url, signal) {
      calls.read.push(url);
      if (signal && signal.aborted) throw new StoppedError();
      const page = pages[url];
      if (page === undefined || page instanceof Error) throw page || new Error("no such page");
      return { text: page, via: "test" };
    },
    async news() {
      calls.news += 1;
      const edition = typeof news === "function" ? news(calls.news) : news;
      if (!edition || edition instanceof Error) throw edition || new Error("no news");
      return edition;
    },
  };
}
