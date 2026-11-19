'use strict';

// Shows "TESTING IS DONE" in the tester's own browser when a test session has closed.
// The page is served from this computer only (localhost) and the server closes itself
// after half an hour. Run by "kit.js stop" and "kit.js done"; it can also be run directly.

const http = require('http');
const { spawn } = require('child_process');

const PORT = 4747;
const KEEP_MS = 30 * 60 * 1000;
const MARK = 'srbot-done-page';

// Where the tester goes back to. The address says which, so one running server can
// answer for any of them: /?to=vscode
const RETURN_TO = {
  vscode: 'You can return to VS Code.',
  claude: 'You can return to Claude.',
};

function page(to) {
  const line = RETURN_TO[to] || RETURN_TO.claude;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${MARK}">
<title>Testing is done</title>
<style>
  html, body { height: 100%; margin: 0; background: #fff; color: #000; }
  body { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; text-align: center; font-family: Arial, Helvetica, sans-serif; }
  h1 { margin: 0; font-weight: 900; font-size: clamp(3rem, 13vw, 14rem); line-height: 1; }
  p { margin: 1.5rem 0 0; font-size: clamp(1.25rem, 3vw, 2.5rem); }
</style>
</head>
<body>
<h1>TESTING IS DONE</h1>
<p>${line}</p>
</body>
</html>
`;
}

/** "vscode" when Claude is running inside VS Code, otherwise "claude". */
function returnTo() {
  const asked = (process.argv[2] || '').toLowerCase();
  if (RETURN_TO[asked]) return asked;
  const inVsCode = /vscode/i.test(process.env.CLAUDE_CODE_ENTRYPOINT || '') || process.env.TERM_PROGRAM === 'vscode' || !!process.env.VSCODE_PID;
  return inVsCode ? 'vscode' : 'claude';
}

function openInBrowser(url) {
  // "start" hands the address to the tester's default browser.
  spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

/** True when our own page is already being served on this port by an earlier run. */
function alreadyServing(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1500 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data.includes(MARK)));
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

function serve(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const to = new URL(req.url, 'http://localhost').searchParams.get('to');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(page(to));
    });
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  const to = returnTo();
  let server;
  try {
    server = await serve(PORT);
  } catch (e) {
    if (await alreadyServing(PORT)) { openInBrowser(`http://localhost:${PORT}/?to=${to}`); return; }
    server = await serve(0); // the usual port is taken by something else: use any free one
  }
  const port = server.address().port;
  // Also answer on the IPv6 loopback, because some browsers try it first for "localhost".
  const v6 = http.createServer((req, res) => server.emit('request', req, res));
  v6.on('error', () => { /* no IPv6 loopback: the browser falls back to 127.0.0.1 */ });
  v6.listen(port, '::1');
  openInBrowser(`http://localhost:${port}/?to=${to}`);
  setTimeout(() => process.exit(0), KEEP_MS);
})().catch(() => process.exit(1));
