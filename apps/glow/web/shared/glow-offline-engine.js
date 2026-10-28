// Glow Offline engine host: runs an AI model on this device with WebLLM (WebGPU), so GlowChat can answer
// with no internet once the model is downloaded. It runs inside a module worker (glow-offline-worker.js);
// when a browser has no WebGPU in workers, glow-offline-ai.js runs the same host on the page instead.
//
// Messages in:  { id, op: "probe" | "status" | "load" | "chat" | "abort" | "unload" | "delete", spec?, request? }
//   spec = { modelId, modelUrl, contextWindow }   (modelUrl ends in ".../resolve/<branch>/")
// Messages out: { id, type: "progress", progress, text } while loading, { id, type: "delta", text } while
//   answering, then { id, type: "result", result } or { id, type: "error", name, message }.
import * as webllm from "./vendor/web-llm.js";

export function createHost(post) {
  let engine = null;
  let loadedKey = "";

  // One model per app config. The model files come from the host the user downloaded them from, and
  // WebLLM keeps them in Cache Storage under those URLs, so later loads work offline.
  function appConfigFor(spec) {
    const base = webllm.prebuiltAppConfig.model_list.find((record) => record.model_id === spec.modelId);
    if (!base) throw new Error(`Glow Offline doesn't know the model ${spec.modelId}.`);
    const record = {
      ...base,
      model: spec.modelUrl,
      overrides: { ...(base.overrides || {}), context_window_size: spec.contextWindow },
    };
    return { model_list: [record], useIndexedDBCache: false };
  }

  async function probe() {
    const gpu = typeof navigator !== "undefined" ? navigator.gpu : null;
    if (!gpu) return { webgpu: false };
    const adapter = await gpu.requestAdapter();
    if (!adapter) return { webgpu: false };
    return {
      webgpu: true,
      f16: adapter.features.has("shader-f16"),
      maxBufferMB: Math.round(adapter.limits.maxBufferSize / 1048576),
    };
  }

  async function load(id, spec) {
    const appConfig = appConfigFor(spec);
    const key = JSON.stringify(appConfig);
    if (engine && loadedKey === key) return { reused: true };
    const initProgressCallback = (report) => {
      post({ id, type: "progress", progress: report.progress, text: report.text });
    };
    if (!engine) {
      engine = new webllm.MLCEngine({ appConfig, initProgressCallback });
    } else {
      engine.setAppConfig(appConfig);
      engine.setInitProgressCallback(initProgressCallback);
    }
    loadedKey = "";
    await engine.reload(spec.modelId);
    loadedKey = key;
    return { reused: false };
  }

  async function chat(id, request) {
    if (!engine || !loadedKey) throw new Error("Glow Offline isn't started yet.");
    const chunks = await engine.chat.completions.create({
      ...request,
      stream: true,
      stream_options: { include_usage: true },
    });
    let usage = null;
    for await (const chunk of chunks) {
      const choice = chunk.choices && chunk.choices[0];
      const text = choice && choice.delta && choice.delta.content;
      if (text) post({ id, type: "delta", text });
      if (chunk.usage) usage = chunk.usage;
    }
    return { usage };
  }

  async function unload() {
    if (engine) await engine.unload();
    engine = null;
    loadedKey = "";
  }

  async function run(message) {
    switch (message.op) {
      case "probe":
        return probe();
      case "status":
        return { cached: await webllm.hasModelInCache(message.spec.modelId, appConfigFor(message.spec)) };
      case "load":
        return load(message.id, message.spec);
      case "chat":
        return chat(message.id, message.request);
      case "abort":
        if (engine) engine.interruptGenerate();
        return {};
      case "unload":
        await unload();
        return {};
      case "delete":
        if (loadedKey.includes(JSON.stringify(message.spec.modelId))) await unload();
        await webllm.deleteModelAllInfoInCache(message.spec.modelId, appConfigFor(message.spec));
        return {};
      default:
        throw new Error(`Unknown Glow Offline request: ${message.op}`);
    }
  }

  async function handle(message) {
    try {
      post({ id: message.id, type: "result", result: await run(message) });
    } catch (error) {
      post({
        id: message.id,
        type: "error",
        name: (error && error.name) || "Error",
        message: String((error && error.message) || error),
      });
    }
  }

  return { handle };
}
