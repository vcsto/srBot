'use strict';

// The test session. It is started by "kit.js start" and keeps running in the
// background, holding NVDA, the browser and the keyboard helper open, so that
// each later "kit.js press ..." command is one more step in the same session.
// Commands arrive over a local-only connection protected by a random token.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { SESSION_FILE, KitError, parseArgs, writeJson, readJson, ensureDir, sleep, rel } = require('./lib/common');
const nvda = require('./lib/nvda');
const { launchBrowser, attach, pageState } = require('./lib/browser');
const { formatSteps } = require('./lib/format');

const args = parseArgs(process.argv.slice(2), { booleans: ['audible', 'watch', 'keep-raw-log', 'nvda-off', 'continue'] });
const runDir = path.resolve(String(args.run));
const transcriptFile = path.join(runDir, 'transcript.jsonl');
const rawLog = path.join(runDir, 'nvda.log');
const nvdaConfig = path.join(runDir, 'nvda-config');
const IDLE_MS = 25 * 60 * 1000;

// Single-letter NVDA browse mode commands used by "sweep".
const SWEEPS = {
  headings: { key: 'h', what: 'heading' },
  landmarks: { key: 'd', what: 'landmark' },
  links: { key: 'k', what: 'link' },
  buttons: { key: 'b', what: 'button' },
  fields: { key: 'f', what: 'form field' },
  graphics: { key: 'g', what: 'graphic' },
  tables: { key: 't', what: 'table' },
  lists: { key: 'l', what: 'list' },
  tab: { key: 'tab', what: 'tab stop' },
  read: { key: 'down', what: 'line' },
};

const keys = new nvda.Keys();
const log = new nvda.SpeechLog(rawLog);
let launched = null;
let connection = null;
let context = null;
let page = null;
let browserPid = null;
let openDialog = null;
let counter = 0;
let closing = false;
let nvdaStarted = false;
let nvdaOn = false;
let mode = 'browse';
let outside = true; // the browser opens with focus in its address bar
let paused = null; // why srBot has stopped pressing keys, or null
let pageStart = 0; // first step recorded on the page currently open
let idleTimer = null;
let queue = Promise.resolve();

function record(rec) {
  fs.appendFileSync(transcriptFile, JSON.stringify(rec) + '\n');
  return rec;
}

function watch(p) {
  p.on('dialog', (dialog) => { openDialog = { type: dialog.type(), message: dialog.message() }; });
}

async function ensureFront() {
  const front = await keys.send('front');
  if (front.ok && browserPid && front.pid === browserPid) return;
  const reply = await keys.send('focus');
  if (!reply.ok) throw new KitError(reply.error || 'The test browser could not be brought to the front.');
  browserPid = reply.pid;
  await sleep(300);
}

const pausedMessage = () => `Paused: ${paused}. srBot has stopped pressing keys and will not continue by itself. When the tester is ready, run: node scripts/kit.js resume`;

/** Stop pressing keys until "resume". Used when a person takes the keyboard or switches window. */
function pauseNow(reason) {
  if (paused) return;
  paused = reason;
  record({ n: ++counter, at: new Date().toISOString(), action: 'note', text: `Paused: ${reason}` });
}

/**
 * Before any key is sent: the test browser must still be the window in front.
 * If the tester has switched to something else, srBot pauses instead of
 * pulling the browser back over what they are doing.
 */
async function checkFront() {
  for (let attempt = 0; attempt < 3; attempt++) {
    const front = await keys.send('front');
    if (front.ok && browserPid && front.pid === browserPid) return;
    await sleep(350);
  }
  pauseNow('another window was brought to the front');
  throw new KitError(pausedMessage());
}

// NVDA announces "<title>, document" whenever focus arrives in the web page,
// and the browser's own regions by name when focus goes to its toolbar.
const SAID_DOCUMENT = /(^|, )document(,|$)/i;
const SAID_BROWSER_UI = /- (Google Chrome|Microsoft\s*Edge), region|(^|, )tool bar(,|$)|^tab control$/i;

/**
 * Make sure keyboard focus is in the web page, not in the browser's own
 * toolbar. F6 moves between the browser's panes. The page cannot be asked
 * directly: after F6 returns to it, the page still reports that it has no
 * focus until an element inside it is focused, so NVDA's own announcement is
 * the reliable signal.
 */
async function ensurePageFocus() {
  await page.bringToFront().catch(() => {});
  const first = await pageState(page);
  if (!first) return true; // a browser dialog is open; nothing to check
  if (first.hasFocus) { outside = false; return true; }
  if (!outside) return true;
  for (let i = 0; i < 5; i++) {
    log.mark();
    await keys.press('f6');
    const said = (await log.settle()).filter((e) => e.kind === 'speech').map((e) => e.text);
    const state = await pageState(page);
    if ((state && state.hasFocus) || said.some((s) => SAID_DOCUMENT.test(s))) {
      outside = false;
      await sleep(700); // NVDA is still loading the page into its buffer; keys sent now can be lost
      return true;
    }
  }
  return false;
}

/**
 * One recorded step: do something, wait for NVDA to finish speaking, and note
 * what it said together with where the page's focus ended up.
 */
async function step(base, act, { afterLoad = false } = {}) {
  if (closing) throw new KitError('The session is stopping.');
  if (paused) throw new KitError(pausedMessage());
  await checkFront();
  // NVDA logs every key it receives. srBot sends nothing between steps, so a
  // key logged since the last step was pressed by a person.
  if (log.read().some((e) => e.kind === 'input')) {
    pauseNow('a key was pressed on the keyboard');
    throw new KitError(pausedMessage());
  }
  const before = await pageState(page);
  const pagesBefore = context.pages().length;
  log.mark();
  await act();
  await sleep(150);

  let navigated = afterLoad;
  let state = openDialog ? null : await pageState(page, 1500);
  if (!openDialog && (!state || (before && state.url !== before.url))) {
    navigated = true;
    await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
  }
  const flags = [];
  if (context.pages().length > pagesBefore) {
    page = context.pages()[context.pages().length - 1];
    await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
    navigated = true;
    flags.push('this opened a new browser tab; the session is now on that tab');
  }

  const entries = await log.settle(navigated ? { minMs: 1500, maxMs: 7000, quietMs: 700 } : undefined);
  state = await pageState(page);
  if (state) openDialog = null;

  const said = entries.filter((e) => e.kind === 'speech').map((e) => e.text);
  // One key press by srBot is one key seen by NVDA. Any more came from a person.
  const keysSeen = entries.filter((e) => e.kind === 'input').length;
  const humanKey = (base.action === 'press' && keysSeen > 1) || (base.action === 'goto' && keysSeen > 0);
  // NVDA announces every switch between reading the page (browse mode) and
  // operating a control (focus mode). A newly loaded page starts in browse mode.
  if (navigated) mode = 'browse';
  for (const phrase of said) {
    if (/^focus mode$/i.test(phrase)) mode = 'focus';
    else if (/^browse mode$/i.test(phrase)) mode = 'browse';
  }
  const front = await keys.send('front');
  if (front.ok && front.pid !== browserPid) {
    // Whatever NVDA said may belong to the other application. It is not about
    // the page being tested and may be private, so it is not kept.
    said.length = 0;
    flags.push('another window was in front during this step, so what NVDA said was not kept');
  }
  if (state) {
    if (state.hasFocus || said.some((s) => SAID_DOCUMENT.test(s))) outside = false;
    else if ((before && before.hasFocus) || said.some((s) => SAID_BROWSER_UI.test(s))) outside = true;
  }
  if (outside && !openDialog) flags.push('keyboard focus is outside the web page (browser toolbar or another tab)');

  const rec = {
    n: ++counter,
    at: new Date().toISOString(),
    ...base,
    said,
    page: state ? { url: state.url, title: state.title } : null,
    focus: state ? state.focus : null,
  };
  if (navigated && before && state && state.url !== before.url) rec.navigated = true;
  if (rec.navigated || base.action === 'goto') pageStart = rec.n;
  if (openDialog) rec.dialog = openDialog;

  // When NVDA could not name something, look up the markup behind the words
  // it did say, so the cause is on record next to the symptom.
  const odd = said.find((s) => /unlabeled/i.test(s) || /^clickable(,|$)/i.test(s));
  if (odd) {
    const name = pickName(odd);
    const found = name ? await findMarkup(name, 2).catch(() => null) : null;
    if (found && found.total) rec.markup = found.hits;
  }
  if (humanKey) flags.push('a key was pressed that srBot did not send, so this step may not be reliable');
  if (flags.length) rec.flags = flags;
  record(rec);
  if (humanKey) pauseNow('a key was pressed on the keyboard');
  return rec;
}

const ROLE_WORDS = /^(clickable|unlabeled graphic|graphic|link|button|same page|visited|menu button|collapsed|expanded|submenu|heading|level \d|edit|list|with \d+ items?|.* landmark|open the context menu\.?)$/i;

/** The part of an NVDA announcement that is the thing's name, not its role or state. */
function pickName(announcement) {
  for (const piece of announcement.split(', ')) {
    const text = piece.replace(/\. To get missing image descriptions.*$/i, '').trim();
    if (text.length >= 3 && !ROLE_WORDS.test(text)) return text;
  }
  return null;
}

/** Search the page's own markup for some text. Read-only. */
async function findMarkup(needle, limit = 10) {
  const work = page.evaluate(({ text, max }) => {
    const clean = (s, n) => {
      s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
      return s.length > n ? s.slice(0, n - 1) + '…' : s;
    };
    const tagOf = (el) => {
      let s = '<' + el.localName;
      for (const attr of Array.from(el.attributes).slice(0, 14)) {
        if (attr.name === 'value' && el.localName === 'input' && el.type === 'password') continue; // never show a secret
        s += ' ' + attr.name + '="' + clean(attr.value, 80) + '"';
      }
      return s + '>';
    };
    const names = ['alt', 'title', 'aria-label', 'aria-labelledby', 'aria-describedby', 'name', 'id', 'src', 'href', 'value', 'placeholder', 'role'];
    const hits = [];
    let total = 0;
    for (const el of document.querySelectorAll('body *')) {
      if (el.localName === 'script' || el.localName === 'style') continue;
      let hit = names.some((n) => (el.getAttribute(n) || '').toLowerCase().includes(text));
      if (!hit) {
        for (const node of el.childNodes) {
          if (node.nodeType === 3 && node.nodeValue.toLowerCase().includes(text)) { hit = true; break; }
        }
      }
      if (!hit) continue;
      total++;
      if (hits.length < max) {
        const own = clean(el.innerText || '', 70);
        hits.push(tagOf(el) + (own ? ' "' + own + '"' : '') + (el.parentElement ? '\n      inside ' + tagOf(el.parentElement) : ''));
      }
    }
    return { total, hits };
  }, { text: String(needle).toLowerCase(), max: limit });
  return Promise.race([work, sleep(4000).then(() => null)]);
}

const press = (key) => step({ action: 'press', key }, () => keys.press(key));

const note = (text) => record({ n: ++counter, at: new Date().toISOString(), action: 'note', text });

function requireNvda() {
  if (!nvdaOn) throw new KitError('NVDA is off. Start it with: node scripts/kit.js nvda on');
}

/**
 * Start NVDA in the browser window that is already open. NVDA is kept off
 * until the tester has finished signing in, because NVDA's log records every
 * key pressed while it runs.
 */
async function turnNvdaOn() {
  if (nvdaOn) throw new KitError('NVDA is already on.');
  await ensureFront(); // so NVDA wakes up looking at the test browser, not another application
  const started = await nvda.start({
    configDir: nvdaConfig, logFile: rawLog, silent: !args.audible, watch: !!args.watch,
    onLaunch: () => { nvdaStarted = true; },
  });
  nvdaOn = true;
  mode = 'browse';
  await ensureFront();
  await sleep(600);
  log.reset();
  log.mark(); // drop NVDA's start-up chatter: it can mention other windows on the desktop

  const runFile = path.join(runDir, 'run.json');
  const run = readJson(runFile);
  run.screenReader = { name: 'NVDA', version: started.version, speech: args.audible ? 'audible' : 'silent (speech captured from NVDA\'s log)' };
  writeJson(runFile, run);

  const state = await pageState(page);
  outside = !(state && state.hasFocus);
  pageStart = counter + 1;
  const steps = [note(`NVDA ${started.version} started`)];
  if (!(await ensurePageFocus())) steps.push(note('Keyboard focus could not be moved into the page'));
  await sleep(500);
  await ensureFront();
  try {
    steps.push(await press('nvda+t'));
  } catch (e) {
    if (!paused) throw e;
    steps.push(note('NVDA is running, but srBot paused before its first key press'));
  }
  return steps;
}

async function turnNvdaOff() {
  if (!nvdaOn) throw new KitError('NVDA is already off.');
  await nvda.stop();
  nvdaOn = false;
  nvdaStarted = false;
  if (!args['keep-raw-log']) {
    try { fs.rmSync(rawLog, { force: true }); } catch (e) { /* ignore */ }
  }
  return [note('NVDA stopped. Nothing typed from here on is recorded until it is started again')];
}

/** Open a page while NVDA is off. Nothing is spoken, so only the page's state is noted. */
async function plainGoto(url) {
  await ensureFront();
  await page.goto(url, { waitUntil: 'load', timeout: 45000 }).catch((e) => {
    throw new KitError(`Could not open ${url} (${String(e.message).split('\n')[0]}).`);
  });
  await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
  const state = await pageState(page);
  pageStart = counter + 1;
  return record({
    n: ++counter, at: new Date().toISOString(), action: 'goto', url, nvdaOff: true,
    page: state ? { url: state.url, title: state.title } : null, focus: state ? state.focus : null,
  });
}

/** Does the page in front of us look like a sign-in page? A hint for Claude, who also sees the screenshot. */
async function detectSignIn() {
  const work = page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const inputs = Array.from(document.querySelectorAll('input')).filter(visible);
    return {
      password: inputs.some((i) => i.type === 'password'),
      account: inputs.some((i) => i.type === 'email' || /user|e-?mail|login/i.test(`${i.autocomplete || ''} ${i.name || ''} ${i.id || ''}`)),
      url: location.href,
    };
  });
  const info = await Promise.race([work, sleep(3000).then(() => null)]).catch(() => null);
  if (!info) return { signIn: false };
  let where = info.url;
  try { const u = new URL(info.url); where = u.hostname + u.pathname; } catch (e) { /* keep */ }
  const loginAddress = /log-?in|sign-?in|sso|oauth|saml|auth/i.test(where);
  if (info.password) return { signIn: true, why: 'the page has a password field' };
  if (info.account && loginAddress) return { signIn: true, why: 'the address looks like a sign-in page and it asks for a user name or email' };
  return { signIn: false };
}

/**
 * Single-letter navigation only works in browse mode. If NVDA was left in
 * focus mode (for example after tabbing into a combo box), switch it back.
 */
async function ensureBrowseMode(steps) {
  for (let i = 0; i < 2 && mode === 'focus'; i++) steps.push(await press('nvda+space'));
  return mode === 'browse';
}

async function goto(url) {
  await ensureFront();
  await ensurePageFocus();
  await sleep(800); // let NVDA finish announcing the focus move, so it is not mixed into the page load
  const rec = await step({ action: 'goto', url }, async () => {
    await page.goto(url, { waitUntil: 'load', timeout: 45000 }).catch((e) => {
      throw new KitError(`Could not open ${url} (${String(e.message).split('\n')[0]}).`);
    });
  }, { afterLoad: true });
  if (!(await ensurePageFocus())) {
    rec.flags = (rec.flags || []).concat('keyboard focus could not be moved into the page');
  }
  return rec;
}

function expandKeys(list) {
  const out = [];
  for (const item of list) {
    const m = /^(.+)\*(\d{1,3})$/.exec(item);
    if (m) for (let i = 0; i < Number(m[2]); i++) out.push(m[1]);
    else out.push(item);
  }
  return out;
}

async function sweep(kind, max) {
  const spec = SWEEPS[kind];
  if (!spec) throw new KitError(`Unknown sweep "${kind}". Choose one of: ${Object.keys(SWEEPS).join(', ')}.`);
  const limit = Math.min(Math.max(Number(max) || (kind === 'read' ? 120 : 80), 1), 400);
  const steps = [];
  steps.push(record({ n: ++counter, at: new Date().toISOString(), action: 'note', text: `Sweep: every ${spec.what} from the top of the page (key: ${spec.key})` }));
  await ensurePageFocus();
  await ensureBrowseMode(steps);
  let top = await press('ctrl+home');
  steps.push(top);
  // If NVDA was still announcing its arrival in the page, the jump to the top
  // may not have registered. Press it again so the sweep really starts at the top.
  if (top.said.some((s) => SAID_DOCUMENT.test(s))) {
    top = await press('ctrl+home');
    steps.push(top);
  }

  let reason = `stopped after ${limit} steps (there may be more; rerun with a higher --max)`;
  let firstFocus = null;
  let repeats = 0;
  let previous = null;
  let found = 0;
  let silent = 0;
  let silentRun = 0;
  for (let i = 0; i < limit; i++) {
    const rec = await press(spec.key);
    steps.push(rec);
    const text = rec.said.join(' / ');
    if (kind === 'tab') {
      if (rec.flags && rec.flags.some((f) => f.startsWith('keyboard focus is outside'))) {
        reason = 'Tab left the page and moved into the browser toolbar: end of the tab order';
        break;
      }
      if (rec.focus && rec.focus === firstFocus && i > 0) { reason = 'focus came back to the first tab stop'; break; }
      if (i === 0) firstFocus = rec.focus;
      if (rec.said.length) { found++; silentRun = 0; } else { silent++; silentRun++; }
      if (silentRun >= 6) {
        reason = 'NVDA said nothing for 6 Tab presses in a row, so the sweep was stopped (focus is being lost or moving through things NVDA cannot announce)';
        break;
      }
    } else {
      if (!rec.said.length) {
        silent++;
        silentRun++;
        if (silentRun >= 3) {
          reason = 'NVDA said nothing three times in a row, so the sweep was stopped (check with "look" where focus is; NVDA may not be reading the page)';
          break;
        }
        continue;
      }
      silentRun = 0;
      if (kind === 'read') {
        repeats = text === previous ? repeats + 1 : 0;
        previous = text;
        // At the bottom NVDA repeats the last line. Runs of empty lines are common mid-page, so they need a longer run to count.
        if (repeats >= (text === 'blank' ? 6 : 2)) { found -= 1; reason = 'NVDA repeated the same line three times: bottom of the page'; break; }
      } else if (rec.said.some((s) => /^no (next|previous) /i.test(s))) {
        reason = `NVDA said "${text}"`;
        break;
      }
      found++;
    }
    if (rec.navigated) { reason = 'the page address changed during the sweep, so it was stopped'; break; }
  }
  if (kind === 'tab') {
    await ensurePageFocus();
    await ensureBrowseMode(steps);
  }
  const quiet = silent ? `, ${silent} press${silent === 1 ? '' : 'es'} with no speech` : '';
  return { steps, summary: `Sweep "${kind}": ${found} ${spec.what}${found === 1 ? '' : 's'} announced${quiet}; ${reason}.` };
}

// ---------------------------------------------------------------------------
// The page's own structure, as the browser exposes it to screen readers
// ---------------------------------------------------------------------------

const AX_LEAF = new Set(['heading', 'link', 'button', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'switch', 'slider', 'spinbutton', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'option', 'image', 'img']);
const AX_REGION = new Set(['banner', 'navigation', 'main', 'contentinfo', 'complementary', 'search', 'dialog', 'alertdialog', 'table', 'menu', 'tablist', 'toolbar']);
const AX_NAMED_REGION = new Set(['region', 'form', 'group', 'radiogroup', 'tabpanel', 'article', 'figure', 'list', 'grid', 'menubar']);
const AX_CHECKED = new Set(['heading', 'link', 'button', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'switch', 'slider', 'spinbutton', 'menuitem', 'tab', 'image', 'img']);

/**
 * Chrome's accessibility tree: the role and name it has computed for each
 * element, which is what NVDA is given to work with. Returned as indented
 * lines plus a flat list of the named things on the page.
 */
async function readOutline({ text = false } = {}) {
  const client = await context.newCDPSession(page);
  let nodes;
  try {
    await client.send('Accessibility.enable');
    ({ nodes } = await client.send('Accessibility.getFullAXTree'));
  } finally {
    await client.detach().catch(() => {});
  }
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const prop = (n, name) => {
    const p = (n.properties || []).find((x) => x.name === name);
    return p && p.value ? p.value.value : undefined;
  };
  const lines = [];
  const items = [];
  const walk = (n, depth) => {
    if (!n) return;
    const role = n.role && n.role.value ? String(n.role.value) : '';
    const name = n.name && n.name.value ? String(n.name.value).replace(/\s+/g, ' ').trim() : '';
    let next = depth;
    if (!n.ignored) {
      if (AX_LEAF.has(role)) {
        const states = [];
        if (role === 'heading') states.push('level ' + prop(n, 'level'));
        const expanded = prop(n, 'expanded');
        if (expanded !== undefined) states.push(expanded === true || expanded === 'true' ? 'expanded' : 'collapsed');
        for (const s of ['checked', 'pressed', 'selected', 'required', 'disabled']) {
          const v = prop(n, s);
          if (v === true || v === 'true' || v === 'mixed') states.push(s);
        }
        lines.push('  '.repeat(depth) + role + ' ' + (name ? JSON.stringify(cut(name, 90)) : '(NO NAME)') + (states.length ? ' [' + states.join(', ') + ']' : ''));
        items.push({ role, name });
        return; // what is inside a link or button is already part of its name
      }
      if (AX_REGION.has(role) || (AX_NAMED_REGION.has(role) && name)) {
        lines.push('  '.repeat(depth) + '[' + role + (name ? ' ' + JSON.stringify(cut(name, 60)) : '') + ']');
        next = depth + 1;
      } else if (text && role === 'StaticText' && name) {
        lines.push('  '.repeat(depth) + 'text ' + JSON.stringify(cut(name, 90)));
      }
    }
    for (const id of n.childIds || []) walk(byId.get(id), next);
  };
  walk(nodes[0], 0);
  return { lines, items };
}

/**
 * Which named things on the page did NVDA never say? Compares the browser's
 * list with everything NVDA has spoken since this page was opened. What it
 * lists depends on which sweeps have been run, so it is a prompt to look, not
 * a finding.
 */
async function coverage() {
  const { readTranscript } = require('./lib/common');
  const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
  const heard = norm(readTranscript(runDir).filter((r) => r.n >= pageStart && r.said).map((r) => r.said.join(' / ')).join(' / '));
  const { items } = await readOutline();
  const seen = new Set();
  const missed = [];
  const nameless = {};
  let total = 0;
  for (const item of items) {
    if (!AX_CHECKED.has(item.role)) continue;
    if (!item.name) { nameless[item.role] = (nameless[item.role] || 0) + 1; continue; }
    const key = item.role + '|' + item.name;
    if (seen.has(key)) continue;
    seen.add(key);
    total++;
    if (!heard.includes(norm(item.name).slice(0, 60))) missed.push(`${item.role} "${item.name.length > 90 ? item.name.slice(0, 89) + '…' : item.name}"`);
  }
  const lines = [`Coverage on this page: NVDA has said ${total - missed.length} of the ${total} named headings, links, controls and images the browser exposes.`];
  const blank = Object.keys(nameless).map((r) => `${nameless[r]} ${r}${nameless[r] === 1 ? '' : 's'}`);
  if (blank.length) lines.push(`Exposed with NO NAME: ${blank.join(', ')}. Find them with "outline".`);
  if (missed.length) {
    lines.push(`Never said by NVDA so far (${missed.length}${missed.length > 40 ? ', first 40 shown' : ''}):`);
    for (const m of missed.slice(0, 40)) lines.push('  ' + m);
    lines.push('Check each against the sweeps you ran: it may be off-screen content, a sweep that stopped early, or something NVDA cannot reach.');
  }
  return lines.join('\n');
}

async function look(full) {
  const state = await pageState(page);
  const rec = { n: ++counter, at: new Date().toISOString(), action: 'look', page: state ? { url: state.url, title: state.title } : null, focus: state ? state.focus : null };
  const file = path.join(runDir, 'shots', String(rec.n).padStart(3, '0') + '.png');
  ensureDir(path.dirname(file));
  try {
    await page.screenshot({ path: file, fullPage: !!full, timeout: 10000 });
    rec.shot = rel(file, runDir);
    rec.shotPath = file;
  } catch (e) { rec.flags = ['a screenshot could not be taken']; }
  return record(rec);
}

const COMMANDS = {
  async status() {
    const sr = nvdaOn ? `NVDA is on, in ${mode} mode.` : 'NVDA is off.';
    return { text: `Session is running. Run folder: ${rel(runDir)}. Steps so far: ${counter}. ${sr}` };
  },
  async nvda(a) {
    if (a.state === 'on') return { steps: await turnNvdaOn(), text: 'NVDA is on. Every key press is recorded from now on.' };
    if (a.state === 'off') return { steps: await turnNvdaOff(), text: 'NVDA is off. The tester can type in the test browser without anything being recorded.' };
    throw new KitError('Use: nvda on  or  nvda off');
  },
  async press(a) {
    requireNvda();
    const list = expandKeys(a.keys || []);
    if (!list.length) throw new KitError('Give at least one key, for example: press h  or  press tab*5  or  press nvda+f7');
    if (list.length > 60) throw new KitError('At most 60 key presses per command. Use "sweep" to walk a whole page.');
    const steps = [];
    for (const key of list) steps.push(await press(key));
    return { steps };
  },
  async sweep(a) { requireNvda(); return sweep(a.kind, a.max); },
  async goto(a) { return { steps: [nvdaOn ? await goto(a.url) : await plainGoto(a.url)] }; },
  async type(a) {
    requireNvda();
    if (!a.text) throw new KitError('Nothing to type.');
    const secret = await Promise.race([
      page.evaluate(() => {
        let el = document.activeElement;
        while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
        return !!el && el.localName === 'input' && (el.type === 'password' || /password|one-time-code/i.test(el.getAttribute('autocomplete') || ''));
      }),
      sleep(2500).then(() => false),
    ]).catch(() => false);
    if (secret) {
      throw new KitError('The focused field is a password or one-time-code field. srBot never types secrets. Turn NVDA off ("nvda off"), ask the tester to sign in themselves in the test browser, then turn NVDA back on.');
    }
    return { steps: [await step({ action: 'type', text: a.text }, () => keys.type(a.text))] };
  },
  async look(a) { return { steps: [await look(a.full)] }; },
  /**
   * Look up the page's own markup for something NVDA said, to explain why it
   * said it. Read-only, and not part of the NVDA recording.
   */
  async find(a) {
    const needle = String(a.text || '').trim().toLowerCase();
    if (needle.length < 2) throw new KitError('Give some text to look for, for example: find "nav_home"');
    const quick = await findMarkup(needle, 10);
    if (!quick) throw new KitError('The page did not answer. A browser dialog may be open.');
    if (!quick.total) return { text: `Nothing in the page's markup contains "${a.text}".` };
    const extra = quick.total > quick.hits.length ? ` (showing the first ${quick.hits.length})` : '';
    return { text: `${quick.total} element${quick.total === 1 ? ' in the page\'s markup contains' : 's in the page\'s markup contain'} "${a.text}"${extra}:\n  ` + quick.hits.join('\n  ') };
  },
  async outline(a) {
    const { lines } = await readOutline({ text: !!a.text });
    const file = path.join(runDir, `outline-${String(counter).padStart(3, '0')}.txt`);
    fs.writeFileSync(file, lines.join('\n') + '\n');
    const max = Math.min(Math.max(Number(a.max) || 150, 10), 2000);
    const shown = lines.slice(0, max);
    const more = lines.length > max ? `\n(${lines.length - max} more lines; the whole outline is in ${rel(file, runDir)}, or rerun with --max ${lines.length})` : '';
    return { text: 'What the browser exposes to screen readers on this page (role, name, state):\n' + shown.join('\n') + more };
  },
  async coverage() { return { text: await coverage() }; },
  /** The standard set of checks for one page, in one go. */
  async pass(a) {
    requireNvda();
    const steps = [note(a.name ? String(a.name) : 'Page pass'), await look(true)];
    const summaries = [];
    for (const kind of ['headings', 'landmarks', 'graphics', 'fields', 'tab', 'read']) {
      const max = kind === 'tab' ? (Number(a.tabMax) || 60) : kind === 'read' ? (Number(a.readMax) || 120) : 40;
      const result = await sweep(kind, max);
      steps.push(...result.steps);
      summaries.push(result.summary);
    }
    return { steps, summary: summaries.join('\n') + '\n\n' + await coverage() };
  },
  async pause() {
    pauseNow('paused by request');
    return { text: 'Paused. srBot will not press any keys until: node scripts/kit.js resume' };
  },
  async resume() {
    if (!paused) return { text: 'srBot is not paused.' };
    paused = null;
    await ensureFront();
    const steps = [note('Resumed')];
    if (nvdaOn) {
      log.mark(); // keys typed while paused are not part of the test
      const state = await pageState(page);
      outside = !(state && state.hasFocus);
      if (!(await ensurePageFocus())) steps.push(note('Keyboard focus could not be moved into the page'));
      await sleep(400);
      steps.push(await press('nvda+t'));
    }
    return { steps, text: 'Resumed. The page may have changed while paused: run "look" before carrying on.' };
  },
  async note(a) { return { steps: [note(String(a.text || ''))] }; },
  async stop() {
    setTimeout(() => shutdown(0), 50);
    return { text: `Session stopped. NVDA and the test browser are being closed. Transcript: ${rel(path.join(runDir, 'transcript.txt'))}` };
  },
};

async function shutdown(code) {
  if (closing) return;
  closing = true;
  clearTimeout(idleTimer);
  try {
    if (connection) {
      const session = await connection.newBrowserCDPSession();
      await Promise.race([session.send('Browser.close'), sleep(3000)]);
    }
  } catch (e) { /* browser already gone */ }
  await sleep(500);
  try { if (launched) launched.child.kill(); } catch (e) { /* gone */ }
  // Only ever close the NVDA this session started, never the tester's own.
  if (nvdaStarted) await nvda.stop().catch(() => {});
  await keys.stop().catch(() => {});

  try {
    const { readTranscript } = require('./lib/common');
    const steps = readTranscript(runDir);
    fs.writeFileSync(path.join(runDir, 'transcript.txt'), formatSteps(steps) + '\n');
    const runFile = path.join(runDir, 'run.json');
    if (fs.existsSync(runFile)) {
      const run = readJson(runFile);
      run.finishedAt = new Date().toISOString();
      run.steps = steps.length;
      writeJson(runFile, run);
    }
  } catch (e) { /* transcript stays as jsonl */ }

  // NVDA's raw log records every key pressed and everything spoken on the whole
  // desktop, including other applications. Only the kit's own transcript is kept.
  if (!args['keep-raw-log']) {
    try { fs.rmSync(rawLog, { force: true }); } catch (e) { /* ignore */ }
    try { fs.rmSync(nvdaConfig, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
  try {
    if (fs.existsSync(SESSION_FILE) && readJson(SESSION_FILE).pid === process.pid) fs.rmSync(SESSION_FILE, { force: true });
  } catch (e) { /* ignore */ }
  process.exit(code);
}

function touchIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    console.log('No commands for 25 minutes: closing the session.');
    shutdown(0);
  }, IDLE_MS);
}

async function boot() {
  ensureDir(runDir);
  if (nvda.isRunning()) {
    throw new KitError('NVDA is already running. Close it first (NVDA+Q), then try again; srBot starts its own NVDA session so your settings are left alone.');
  }
  nvda.findNvda();
  await keys.start();

  launched = launchBrowser({ browser: args.browser, debug: true });
  connection = await attach(launched);
  context = connection.contexts()[0];
  page = context.pages()[0] || await context.newPage();
  context.pages().forEach(watch);
  context.on('page', watch);

  const focus = await keys.command('focus');
  browserPid = focus.pid;

  const runFile = path.join(runDir, 'run.json');
  const continuing = !!args.continue && fs.existsSync(runFile);
  if (continuing) {
    const { readTranscript } = require('./lib/common');
    counter = readTranscript(runDir).reduce((max, r) => Math.max(max, r.n || 0), 0);
    const run = readJson(runFile);
    run.continuedAt = (run.continuedAt || []).concat(new Date().toISOString());
    delete run.finishedAt;
    delete run.note;
    writeJson(runFile, run);
    note('Session continued after a stop');
  } else {
    writeJson(runFile, {
      kit: require('../package.json').version,
      startedAt: new Date().toISOString(),
      site: args.url && args.url !== true ? String(args.url) : null,
      screenReader: { name: 'NVDA', version: '(not started)', speech: args.audible ? 'audible' : 'silent (speech captured from NVDA\'s log)' },
      browser: { name: launched.name === 'edge' ? 'Microsoft Edge' : 'Google Chrome', version: connection.version() },
      system: `${os.version()} (${os.release()})`,
    });
  }

  // Open the page with NVDA off first, so that a sign-in can happen without
  // anything being recorded. NVDA starts only once we know where we stand.
  const url = String(args.url);
  const opened = [await plainGoto(url), await look(false)];
  const signIn = await detectSignIn();
  const lines = [`Run folder: ${rel(runDir)}`, `Browser: ${launched.name === 'edge' ? 'Microsoft Edge' : 'Google Chrome'} ${connection.version()}`, '', formatSteps(opened), ''];
  if (signIn.signIn || args['nvda-off']) {
    if (signIn.signIn) lines.push(`This looks like a sign-in page (${signIn.why}).`);
    lines.push(
      'NVDA has NOT been started, so nothing typed in the test browser is recorded.',
      'Next:',
      '  - If the tester should sign in: ask them to sign in in the test browser window and tell you when they are done. Then run: node scripts/kit.js nvda on',
      '  - To test this page itself with NVDA first: run "nvda on" now, test without real credentials, then "nvda off" before the tester signs in.',
    );
  } else {
    const steps = await turnNvdaOn();
    if (!paused) steps.push(await goto(page.url())); // load it again with NVDA listening, to hear what a user hears on arrival
    if (paused) lines.push(pausedMessage());
    const run = readJson(path.join(runDir, 'run.json'));
    lines.push(`No sign-in page was detected, so NVDA ${run.screenReader.version} was started (${run.screenReader.speech}).`, 'What NVDA said:', formatSteps(steps));
  }

  const token = crypto.randomBytes(24).toString('hex');
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      let msg;
      try { msg = JSON.parse(body); } catch (e) { msg = null; }
      const reply = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
      if (!msg || msg.token !== token) return reply(403, { ok: false, error: 'Not allowed.' });
      const handler = COMMANDS[msg.cmd];
      if (!handler) return reply(400, { ok: false, error: `Unknown command "${msg.cmd}".` });
      touchIdle();
      if (msg.cmd === 'stop' || msg.cmd === 'pause' || msg.cmd === 'status') {
        handler(msg.args || {}).then((result) => reply(200, { ok: true, result }), (e) => reply(200, { ok: false, error: String(e && e.message ? e.message : e) }));
        return undefined;
      }
      queue = queue.then(async () => {
        try {
          reply(200, { ok: true, result: await handler(msg.args || {}) });
        } catch (e) {
          reply(200, { ok: false, error: e instanceof KitError ? e.message : String(e && e.stack ? e.stack : e) });
        }
      });
    });
  });
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  writeJson(SESSION_FILE, { pid: process.pid, port: server.address().port, token, runDir, message: lines.join('\n') });
  touchIdle();
  console.log('Session ready.');
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('uncaughtException', (e) => { console.error(e && e.stack ? e.stack : e); shutdown(1); });
process.on('unhandledRejection', (e) => { console.error(e && e.stack ? e.stack : e); shutdown(1); });

boot().catch((e) => {
  const message = e instanceof KitError ? e.message : String(e && e.stack ? e.stack : e);
  console.error('Problem: ' + message);
  try { fs.writeFileSync(path.join(runDir, 'start-error.txt'), message); } catch (err) { /* ignore */ }
  shutdown(1);
});
