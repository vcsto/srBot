'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { KitError, ensureDir, sleep, BROWSER_PROFILE } = require('./common');

function findBrowser(preferred) {
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  const known = {
    chrome: [
      path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ],
    edge: [
      path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ],
  };
  const order = preferred && preferred !== true ? [String(preferred).toLowerCase()] : ['chrome', 'edge'];
  for (const name of order) {
    if (!known[name]) throw new KitError(`Unknown browser "${name}". Use chrome or edge.`);
    for (const exe of known[name]) if (exe && fs.existsSync(exe)) return { name, exe };
  }
  throw new KitError('Could not find Google Chrome or Microsoft Edge on this computer.');
}

/**
 * Start the tester's ordinary Chrome (or Edge) with the kit's own profile
 * folder. Sign-ins made in this profile are remembered between test runs.
 * With `debug`, the browser also accepts a local connection so the kit can
 * navigate and see which element has focus.
 */
function launchBrowser({ browser, url = 'about:blank', debug = true }) {
  const found = findBrowser(browser);
  ensureDir(BROWSER_PROFILE);
  const portFile = path.join(BROWSER_PROFILE, 'DevToolsActivePort');
  if (fs.existsSync(portFile)) fs.unlinkSync(portFile);
  const args = [
    `--user-data-dir=${BROWSER_PROFILE}`,
    '--no-first-run', '--no-default-browser-check', '--start-maximized',
    '--force-renderer-accessibility',
    '--disable-features=Translate',
    '--hide-crash-restore-bubble', // no "Restore pages?" pop-up after a forced stop
  ];
  if (debug) args.push('--remote-debugging-port=0');
  args.push(url);
  const child = spawn(found.exe, args, { stdio: 'ignore', detached: !debug });
  child.on('error', () => {});
  if (!debug) child.unref();
  return { ...found, child, portFile };
}

/** Attach to a browser started with launchBrowser({ debug: true }). */
async function attach(launched, timeoutMs = 30000) {
  let chromium;
  try { ({ chromium } = require('playwright-core')); } catch (e) {
    throw new KitError('The kit is not installed yet. Run "npm install" in the kit folder first.');
  }
  const began = Date.now();
  let exited = false;
  launched.child.once('exit', () => { exited = true; });
  while (Date.now() - began < timeoutMs) {
    await sleep(400);
    if (fs.existsSync(launched.portFile)) {
      const port = Number(fs.readFileSync(launched.portFile, 'utf8').split('\n')[0]);
      if (port) {
        const connection = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
        if (connection) return connection;
      }
    }
    if (exited) break;
  }
  throw new KitError('Could not connect to the test browser. If a test browser window from an earlier run is still open, close it and try again.');
}

/** What the page looks like right now: address, title, and the element with keyboard focus. */
async function pageState(page, timeoutMs = 2500) {
  const work = page.evaluate(() => {
    const clean = (s, n) => {
      s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
      return s.length > n ? s.slice(0, n - 1) + '…' : s;
    };
    let el = document.activeElement;
    for (let i = 0; el && i < 10; i++) {
      if (el.shadowRoot && el.shadowRoot.activeElement) { el = el.shadowRoot.activeElement; continue; }
      if (el.localName === 'iframe') {
        let doc = null;
        try { doc = el.contentDocument; } catch (e) { doc = null; }
        if (doc && doc.activeElement && doc.activeElement !== doc.body) { el = doc.activeElement; continue; }
      }
      break;
    }
    let focus = null;
    if (el && el !== document.body && el !== document.documentElement) {
      let tag = '<' + el.localName;
      for (const name of ['id', 'type', 'name', 'role', 'href', 'aria-label', 'aria-labelledby', 'aria-expanded', 'aria-haspopup', 'tabindex', 'title', 'alt']) {
        if (el.hasAttribute(name)) tag += ' ' + name + '="' + clean(el.getAttribute(name), 50) + '"';
      }
      focus = clean(tag + '>', 220);
      // Never read back what is in a password or one-time-code field.
      const secret = el.localName === 'input' && (el.type === 'password' || /password|one-time-code/i.test(el.getAttribute('autocomplete') || ''));
      const text = secret ? '' : clean(el.innerText || el.value || '', 50);
      if (text) focus += ' "' + text + '"';
    }
    return { url: location.href, title: document.title, hasFocus: document.hasFocus(), focus };
  });
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs));
  try { return await Promise.race([work, timeout]); } catch (e) { return null; }
}

module.exports = { findBrowser, launchBrowser, attach, pageState };
