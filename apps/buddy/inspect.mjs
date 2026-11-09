const targetsRes = await fetch('http://127.0.0.1:9222/json');
const targets = await targetsRes.json();
const page = targets.find(t => t.type === 'page');
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

// Subscribe to console messages
const consoleMessages = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === 'Runtime.consoleAPICalled' || msg.method === 'Runtime.exceptionThrown' || msg.method === 'Log.entryAdded') {
    consoleMessages.push(msg);
  }
});

await send('Runtime.enable');
await send('Log.enable');

// Trigger a reload to capture initial console output
await send('Runtime.evaluate', { expression: 'location.reload()' });
await new Promise(r => setTimeout(r, 4000));

console.log('messages:', JSON.stringify(consoleMessages, null, 2).substring(0, 8000));

const r1 = await send('Runtime.evaluate', { expression: 'document.getElementById("root").innerHTML.length', returnByValue: true });
console.log('root length:', JSON.stringify(r1.result));

// Try to manually invoke React render to see if it works
const r2 = await send('Runtime.evaluate', {
  expression: `(async () => {
    const out = [];
    try {
      const reactMod = await import('react');
      out.push('react OK keys=' + Object.keys(reactMod).slice(0, 5).join(','));
    } catch (e) { out.push('react ERR: ' + e.message); }
    try {
      const domMod = await import('react-dom/client');
      out.push('dom OK keys=' + Object.keys(domMod).slice(0, 5).join(','));
    } catch (e) { out.push('dom ERR: ' + e.message); }
    try {
      const appMod = await import('./src/App.tsx');
      out.push('app OK keys=' + Object.keys(appMod).slice(0, 5).join(','));
    } catch (e) { out.push('app ERR: ' + e.message); }
    return out.join(' || ');
  })()`,
  awaitPromise: true,
  returnByValue: true,
});
console.log('imports:', JSON.stringify(r2.result));

// Check window for any uncaught error info
const r3 = await send('Runtime.evaluate', {
  expression: `(() => {
    const w = window;
    return 'href=' + location.href + ' | ready=' + document.readyState;
  })()`,
  returnByValue: true,
});
console.log('window:', JSON.stringify(r3.result));

const png = await send('Page.captureScreenshot', { format: 'png' });
const fs = await import('fs');
fs.writeFileSync('C:/Users/juwen_lie/Documents/Default Project/apps/buddy/shot.png', Buffer.from(png.result.data, 'base64'));
console.log('screenshot saved');

ws.close();
