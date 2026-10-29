// Local stand-ins for Midtrans, Xendit, Stripe, Web Push services and Resend, used by api_test.mjs.
// They mimic the request/response shapes Mint relies on; they are not the real providers.
import http from "node:http";

export const VALID_KEYS = {
  midtrans: "SB-Mid-server-mint-test-key-123456",
  xendit: "xnd_development_mint_test_key_123456",
  stripe: "sk_test_mint_test_key_123456",
};

export function startMockServices(port = 8799) {
  const state = { midtrans: {}, xendit: {}, stripe: {}, pushes: [], emails: [], notifyUrls: {} };
  let counter = 0;

  function keyFrom(req) {
    const auth = req.headers.authorization || "";
    if (auth.startsWith("Basic ")) {
      return Buffer.from(auth.slice(6), "base64").toString().replace(/:$/, "");
    }
    if (auth.startsWith("Bearer ")) {
      return auth.slice(7);
    }
    return "";
  }

  function send(res, status, payload) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const raw = Buffer.concat(chunks);
      const url = new URL(req.url, "http://127.0.0.1:" + port);
      const path = url.pathname;
      const key = keyFrom(req);
      let body = {};
      const type = req.headers["content-type"] || "";
      if (type.includes("json") && raw.length) {
        body = JSON.parse(raw.toString());
      } else if (type.includes("x-www-form-urlencoded")) {
        body = Object.fromEntries(new URLSearchParams(raw.toString()));
      }

      // ---- exchange rates (open.er-api.com shape) and Google News RSS
      if (req.method === "GET" && path === "/fx") {
        return send(res, 200, { result: "success", time_last_update_unix: 1761696000, rates: { USD: 1, IDR: 16300, EUR: 0.92, SGD: 1.3, JPY: 151.5, bogus: "x" } });
      }
      if (req.method === "GET" && path === "/news") {
        state.newsHits = (state.newsHits || 0) + 1;
        const gl = url.searchParams.get("gl");
        const item = (n) => `<item><title><![CDATA[Market note ${n} for ${gl} &amp; friends - Kompas]]></title><link>https://news.example/${gl}/${n}</link>` +
          `<pubDate>Wed, 29 Oct 2026 0${n}:00:00 GMT</pubDate><source url="https://kompas.example">Kompas</source></item>`;
        const bad = "<item><title>No link</title><link>javascript:alert(1)</link></item>";
        res.writeHead(200, { "Content-Type": "application/rss+xml" });
        return res.end(`<?xml version="1.0"?><rss><channel><title>t</title>${item(1)}${bad}${item(2)}${item(3)}</channel></rss>`);
      }

      // ---- Midtrans
      if (path.startsWith("/midtrans")) {
        if (key !== VALID_KEYS.midtrans) {
          return send(res, 401, { status_code: "401", status_message: "Unauthorized" });
        }
        if (req.method === "POST" && path === "/midtrans/snap/v1/transactions") {
          const id = body.transaction_details.order_id;
          state.midtrans[id] = { status: "pending", gross: body.transaction_details.gross_amount, body };
          state.notifyUrls[id] = req.headers["x-override-notification"] || "";
          return send(res, 201, { token: "tok-" + id, redirect_url: "http://127.0.0.1:" + port + "/checkout/midtrans/" + id });
        }
        const m = path.match(/^\/midtrans\/v2\/([^/]+)\/status$/);
        if (req.method === "GET" && m) {
          const tx = state.midtrans[decodeURIComponent(m[1])];
          if (!tx) {
            return send(res, 200, { status_code: "404", status_message: "Transaction doesn't exist." });
          }
          return send(res, 200, {
            status_code: tx.status === "settlement" ? "200" : "201",
            transaction_status: tx.status,
            fraud_status: "accept",
            gross_amount: Number(tx.gross).toFixed(2),
            order_id: decodeURIComponent(m[1]),
          });
        }
      }

      // ---- Xendit
      if (path.startsWith("/xendit")) {
        if (key !== VALID_KEYS.xendit) {
          return send(res, 401, { error_code: "INVALID_API_KEY" });
        }
        if (req.method === "GET" && path === "/xendit/v2/invoices") {
          return send(res, 200, []);
        }
        if (req.method === "POST" && path === "/xendit/v2/invoices") {
          counter += 1;
          const id = "inv_" + counter;
          state.xendit[id] = { status: "PENDING", amount: body.amount, external_id: body.external_id, body };
          return send(res, 200, { id, status: "PENDING", invoice_url: "http://127.0.0.1:" + port + "/checkout/xendit/" + id, amount: body.amount });
        }
        const m = path.match(/^\/xendit\/v2\/invoices\/([^/]+)$/);
        if (req.method === "GET" && m) {
          const inv = state.xendit[m[1]];
          return inv ? send(res, 200, { id: m[1], status: inv.status, amount: inv.amount, external_id: inv.external_id }) : send(res, 404, {});
        }
      }

      // ---- Stripe
      if (path.startsWith("/stripe")) {
        if (key !== VALID_KEYS.stripe) {
          return send(res, 401, { error: { message: "Invalid API Key provided" } });
        }
        if (req.method === "GET" && path === "/stripe/v1/checkout/sessions") {
          return send(res, 200, { object: "list", data: [] });
        }
        if (req.method === "POST" && path === "/stripe/v1/checkout/sessions") {
          counter += 1;
          const id = "cs_test_" + counter;
          state.stripe[id] = {
            payment_status: "unpaid",
            status: "open",
            amount_total: Number(body["line_items[0][price_data][unit_amount]"]),
            currency: body["line_items[0][price_data][currency]"],
            client_reference_id: body.client_reference_id,
            body,
          };
          return send(res, 200, { id, url: "http://127.0.0.1:" + port + "/checkout/stripe/" + id });
        }
        const m = path.match(/^\/stripe\/v1\/checkout\/sessions\/([^/]+)$/);
        if (req.method === "GET" && m) {
          const s = state.stripe[m[1]];
          return s ? send(res, 200, { id: m[1], ...s }) : send(res, 404, { error: { message: "No such session" } });
        }
      }

      // ---- test control: simulate the buyer paying (used by the browser e2e)
      if (req.method === "POST" && path === "/control/pay") {
        const provider = body.provider;
        let ref = body.ref;
        if (provider === "xendit" || provider === "stripe") {
          const table = state[provider];
          ref = Object.keys(table).find((k) => (table[k].external_id || table[k].client_reference_id) === body.orderId) || ref;
        }
        if (!state[provider] || !state[provider][ref]) {
          return send(res, 404, { error: "unknown payment" });
        }
        if (provider === "midtrans") {
          state.midtrans[ref].status = "settlement";
        } else if (provider === "xendit") {
          state.xendit[ref].status = "PAID";
        } else {
          state.stripe[ref].payment_status = "paid";
        }
        return send(res, 200, { ok: true, ref });
      }
      if (req.method === "GET" && path.startsWith("/checkout/")) {
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end("<!doctype html><title>Mock checkout</title><h1>Mock provider checkout</h1>");
      }

      // ---- Web Push service + Resend
      if (req.method === "POST" && path.startsWith("/push/")) {
        state.pushes.push({ endpoint: "http://127.0.0.1:" + port + path, headers: req.headers, body: raw });
        res.writeHead(path.includes("gone") ? 410 : 201);
        return res.end();
      }
      if (req.method === "POST" && path === "/resend/emails") {
        if (key !== "re_test_key") {
          return send(res, 401, { message: "bad key" });
        }
        state.emails.push(body);
        return send(res, 200, { id: "email_" + state.emails.length });
      }
      send(res, 404, { error: "mock: no route " + req.method + " " + path });
    });
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      resolve({
        state,
        close: () => new Promise((r) => server.close(r)),
        // Simulates the buyer paying on the provider's checkout page.
        pay(provider, ref) {
          if (provider === "midtrans") {
            state.midtrans[ref].status = "settlement";
          } else if (provider === "xendit") {
            state.xendit[ref].status = "PAID";
          } else {
            state.stripe[ref].payment_status = "paid";
            state.stripe[ref].status = "complete";
          }
        },
      });
    });
  });
}
