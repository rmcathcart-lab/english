// Local dev server: serves the site and runs Code.gs (via the mock) at /api.
// Usage: node dev/server.js [port]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { makeContext } = require('./gas-mock');

const port = Number(process.argv[2]) || 8080;
const root = path.join(__dirname, '..');
const g = makeContext();
console.log(g.setup());

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api') {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      let out;
      try { out = g.doPost({ postData: { contents: body } }).getContent(); } catch (e) { out = JSON.stringify({ ok: false, error: String(e) }); }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      setTimeout(() => res.end(out), 120); // a touch of latency, like Apps Script
    });
    return;
  }
  if (url.pathname === '/js/config.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    res.end(`window.INKWELL_CONFIG = { apiUrl: 'http://localhost:${port}/api' };`);
    return;
  }
  let p = path.join(root, decodeURIComponent(url.pathname));
  if (url.pathname.endsWith('/')) p = path.join(p, 'index.html');
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(port, () => console.log('Inkwell dev server on http://localhost:' + port));
