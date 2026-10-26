// Runs the Glow cloud service locally over HTTP for end-to-end tests of GlowLead's "instant cloud browser".
// Usage: GLOW_PLAYWRIGHT_CORE=<playwright-core> ALLOWED_ORIGINS=<origins> node local-server.mjs
// Prints "READY <port>" when listening.
import http from "node:http";
import { createApp } from "../src/app.js";
import { createTestProvider } from "./playwright-provider.mjs";

const provider = await createTestProvider(process.env.GLOW_PLAYWRIGHT_CORE);
const handle = createApp(provider);
const env = { ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || "" };

const server = http.createServer(async (incoming, outgoing) => {
  const chunks = [];
  for await (const chunk of incoming) chunks.push(chunk);
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (typeof value === "string") headers.set(name, value);
  }
  const hasBody = !["GET", "HEAD", "OPTIONS"].includes(incoming.method);
  const request = new Request("http://" + incoming.headers.host + incoming.url, {
    method: incoming.method,
    headers,
    body: hasBody ? Buffer.concat(chunks) : undefined,
  });
  const response = await handle(request, env);
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
});

server.listen(0, "127.0.0.1", () => {
  console.log("READY " + server.address().port);
});

const shutdown = async () => {
  server.close();
  await provider.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.stdin.on("end", shutdown);
process.stdin.resume();
