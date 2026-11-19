'use strict';

// The one command for the kit. Run "node scripts/kit.js help" for the list.

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const {
  ROOT, RUNS_DIR, SESSION_FILE, KitError, main, parseArgs, normalizeUrl, slugify, stamp,
  ensureDir, readJson, rel, sleep, readTranscript, resolveRun,
} = require('./lib/common');
const { formatSteps } = require('./lib/format');

const HELP = `
srBot: test a website with the NVDA screen reader

  node scripts/kit.js doctor                 Check this computer is ready
  node scripts/kit.js start <address>        Open the page in the test browser. If it is not a sign-in page, NVDA starts too
        --nvda-off                           Never start NVDA yet, even if no sign-in page is detected
        --continue [run]                     Carry on an earlier run after a stop: same recording, same report
        --audible                            Let NVDA speak out loud (default: silent, speech is still captured)
        --watch                              Show NVDA's words on screen and highlight where it is, for someone watching
        --browser edge                       Use Microsoft Edge instead of Google Chrome
        --keep-raw-log                       Keep NVDA's own log file (it can contain unrelated desktop content)

  While a session is running:
  node scripts/kit.js nvda on                Start NVDA in the open browser window (after the tester has signed in)
  node scripts/kit.js nvda off               Stop NVDA so the tester can type without anything being recorded
  node scripts/kit.js pass "<page name>"     The standard checks for one page in one go: screenshot, headings, landmarks,
        --tab-max 60 --read-max 120          graphics, form fields, tab order, line-by-line reading, then the coverage check
  node scripts/kit.js press <keys...>        Press keys as an NVDA user would: h  tab  shift+tab  enter  nvda+t  down*5
  node scripts/kit.js sweep <kind>           Walk the whole page: headings landmarks links buttons fields graphics
        --max 80                             tables lists tab read
  node scripts/kit.js goto <address>         Open another page in the same session
  node scripts/kit.js type "<text>"          Type into the focused field (never passwords)
  node scripts/kit.js look [--full]          Where focus is, plus a screenshot
  node scripts/kit.js find "<text>"          Show the page's markup for something NVDA said, to see why
  node scripts/kit.js outline [--text]       What the browser exposes to screen readers: every role, name and state
  node scripts/kit.js coverage               Which named things on this page NVDA has not said yet
  node scripts/kit.js note "<text>"          Add a heading to the transcript
  node scripts/kit.js pause                  Stop pressing keys at once, keep everything open
  node scripts/kit.js resume                 Carry on after a pause
  node scripts/kit.js status
  node scripts/kit.js stop                   Close NVDA and the test browser, at once, even mid-sweep,
                                             then open a page saying TESTING IS DONE in your own browser
        --quiet                              Do not open that page
  node scripts/kit.js done                   Open the TESTING IS DONE page by itself

  srBot pauses by itself if someone presses a key or brings another window to the front.

  Afterwards:
  node scripts/kit.js transcript [run]       Print everything NVDA said in a run
  node scripts/kit.js report [run]           Build report.html from the run's findings.json
`;

function post(session, cmd, args) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ token: session.token, cmd, args });
    const req = http.request({
      host: '127.0.0.1', port: session.port, method: 'POST', path: '/',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Unreadable reply from the session.')); } });
    });
    req.on('error', reject);
    req.end(body);
  });
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return false; }
}

/** The running session, or null. Clears the pointer file if the session died. */
function currentSession() {
  if (!fs.existsSync(SESSION_FILE)) return null;
  let session;
  try { session = readJson(SESSION_FILE); } catch (e) { session = null; }
  if (!session || !processAlive(session.pid)) {
    fs.rmSync(SESSION_FILE, { force: true });
    return null;
  }
  return session;
}

async function send(cmd, args = {}) {
  const session = currentSession();
  if (!session) throw new KitError('No test session is running. Start one with: node scripts/kit.js start <address>');
  let reply;
  try { reply = await post(session, cmd, args); } catch (e) {
    throw new KitError('The test session is not answering. Run "node scripts/kit.js stop" and start again.');
  }
  if (!reply.ok) throw new KitError(reply.error);
  return reply.result;
}

function show(result) {
  if (result.steps) console.log(formatSteps(result.steps));
  if (result.summary) console.log('\n' + result.summary);
  if (result.text) console.log(result.text);
}

async function start(args) {
  if (process.platform !== 'win32') throw new KitError('NVDA only runs on Windows, so srBot does too.');
  if (currentSession()) throw new KitError('A test session is already running. Stop it first with: node scripts/kit.js stop');
  const url = normalizeUrl(args._[0]);
  const runDir = args.continue
    ? resolveRun(args.continue === true ? undefined : args.continue)
    : ensureDir(path.join(RUNS_DIR, `${stamp()}-${slugify(new URL(url).host + new URL(url).pathname)}`));
  const out = fs.openSync(path.join(runDir, 'session.log'), 'a');
  const serverArgs = [path.join(__dirname, 'server.js'), '--run', runDir, '--url', url];
  if (args.audible) serverArgs.push('--audible');
  if (args.watch) serverArgs.push('--watch');
  if (args['nvda-off']) serverArgs.push('--nvda-off');
  if (args.continue) serverArgs.push('--continue');
  if (args['keep-raw-log']) serverArgs.push('--keep-raw-log');
  if (args.browser && args.browser !== true) serverArgs.push('--browser', String(args.browser));
  const child = spawn(process.execPath, serverArgs, { detached: true, stdio: ['ignore', out, out], windowsHide: true, cwd: ROOT });
  let exited = false;
  child.on('exit', () => { exited = true; });
  child.unref();

  console.log('Opening the test browser. This takes up to 30 seconds; do not use the keyboard or mouse.');
  const began = Date.now();
  while (Date.now() - began < 150000) {
    await sleep(700);
    if (fs.existsSync(SESSION_FILE)) {
      const session = readJson(SESSION_FILE);
      if (session.pid === child.pid) {
        console.log('Session ready.');
        console.log(session.message);
        return;
      }
    }
    if (exited) break;
  }
  const errorFile = path.join(runDir, 'start-error.txt');
  const reason = fs.existsSync(errorFile) ? fs.readFileSync(errorFile, 'utf8') : 'The session did not start. See ' + rel(path.join(runDir, 'session.log'));
  throw new KitError(reason);
}

/** Opens a page saying TESTING IS DONE in the tester's own browser, so they can see the computer is theirs again. */
function showDonePage() {
  spawn(process.execPath, [path.join(__dirname, 'done-page.js')], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  console.log('A page saying TESTING IS DONE has been opened in your browser.');
}

async function stop(args) {
  const session = currentSession();
  if (!session) { console.log('No test session is running.'); return; }
  try {
    show(await send('stop'));
  } catch (e) {
    try { process.kill(session.pid); } catch (err) { /* gone */ }
  }
  for (let i = 0; i < 60 && processAlive(session.pid); i++) await sleep(500);
  if (processAlive(session.pid)) {
    console.log('The session is taking a long time to close. If NVDA is still running, quit it with NVDA+Q.');
    return;
  }
  if (!args.quiet) showDonePage();
}

async function doctor() {
  const lines = [];
  let ok = true;
  const check = (good, text, fix) => { lines.push((good ? '  OK    ' : '  FIX   ') + text + (good || !fix ? '' : '\n        ' + fix)); if (!good) ok = false; };
  check(process.platform === 'win32', 'Windows', 'NVDA only runs on Windows.');
  check(Number(process.versions.node.split('.')[0]) >= 18, `Node.js ${process.versions.node}`, 'Install the current LTS version from https://nodejs.org');
  let playwright = false;
  try { require.resolve('playwright-core'); playwright = true; } catch (e) { /* missing */ }
  check(playwright, 'Kit dependencies installed', 'Run: npm install');
  if (process.platform === 'win32') {
    const nvda = require('./lib/nvda');
    let exe = null;
    try { exe = nvda.findNvda(); } catch (e) { /* missing */ }
    check(!!exe, exe ? `NVDA found at ${exe}` : 'NVDA installed', 'Install NVDA from https://www.nvaccess.org/download/');
    check(!nvda.isRunning(), 'NVDA is not already running', 'Quit NVDA (NVDA+Q). The kit starts its own NVDA session so your settings stay untouched.');
    const { findBrowser } = require('./lib/browser');
    let browser = null;
    try { browser = findBrowser(); } catch (e) { /* missing */ }
    check(!!browser, browser ? `Browser found: ${browser.exe}` : 'Google Chrome or Microsoft Edge installed', 'Install Google Chrome.');
    const keys = new nvda.Keys();
    let helper = false;
    try { await keys.start(); helper = (await keys.front()).ok; } catch (e) { /* failed */ }
    await keys.stop();
    check(helper, 'Keyboard helper can start (PowerShell)', 'PowerShell scripts may be blocked by your organisation. Ask IT whether powershell.exe can run local scripts.');
  }
  check(!currentSession(), 'No leftover test session', 'Run: node scripts/kit.js stop');
  console.log(lines.join('\n'));
  console.log(ok ? '\nReady to test.' : '\nFix the items marked FIX, then run this again.');
  if (!ok) process.exitCode = 1;
}

main(async () => {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest, { booleans: ['audible', 'watch', 'keep-raw-log', 'nvda-off', 'full', 'text', 'allow-unverified', 'quiet'] });
  switch (command) {
    case 'start': return start(args);
    case 'stop': return stop(args);
    case 'done': return showDonePage();
    case 'doctor': return doctor();
    case 'status': {
      if (!currentSession()) { console.log('No test session is running.'); return undefined; }
      return show(await send('status'));
    }
    case 'nvda': return show(await send('nvda', { state: String(args._[0] || '').toLowerCase() }));
    case 'press': return show(await send('press', { keys: args._ }));
    case 'sweep': return show(await send('sweep', { kind: args._[0], max: args.max }));
    case 'goto': return show(await send('goto', { url: normalizeUrl(args._[0]) }));
    case 'type': return show(await send('type', { text: args._.join(' ') }));
    case 'look': return show(await send('look', { full: !!args.full }));
    case 'note': return show(await send('note', { text: args._.join(' ') }));
    case 'find': return show(await send('find', { text: args._.join(' ') }));
    case 'outline': return show(await send('outline', { text: !!args.text, max: args.max }));
    case 'coverage': return show(await send('coverage'));
    case 'pass': return show(await send('pass', { name: args._.join(' '), tabMax: args['tab-max'], readMax: args['read-max'] }));
    case 'pause': return show(await send('pause'));
    case 'resume': return show(await send('resume'));
    case 'transcript': {
      const runDir = resolveRun(args._[0]);
      console.log(formatSteps(readTranscript(runDir)));
      return undefined;
    }
    case 'report': {
      const { buildReport } = require('./lib/report');
      return buildReport(resolveRun(args._[0]), { allowUnverified: !!args['allow-unverified'] });
    }
    case undefined:
    case 'help':
    case '--help':
      console.log(HELP);
      return undefined;
    default:
      throw new KitError(`Unknown command "${command}". Run: node scripts/kit.js help`);
  }
});
