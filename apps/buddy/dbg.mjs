const targetsRes = await fetch('http://127.0.0.1:9222/json');
const targets = await targetsRes.json();
const page = targets.find(t => t.type === 'page');
if (!page) { console.log('NO PAGE'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
const send = (method, params = {}) => new Promise((resolve) => {
  const myId = ++id;
  pending.set(myId, resolve);
  ws.send(JSON.stringify({ id: myId, method, params }));
});
const png = await send('Page.captureScreenshot', { format: 'png' });
const fs = await import('fs');
fs.writeFileSync('C:/Users/juwen_lie/Documents/Default Project/apps/buddy/cdp.png', Buffer.from(png.result.data, 'base64'));
console.log('saved', png.result.data.length, 'chars');
ws.close();
