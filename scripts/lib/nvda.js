'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn, spawnSync } = require('child_process');
const { KitError, ensureDir, sleep } = require('./common');

function findNvda() {
  const candidates = [
    process.env.NVDA_PATH,
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'NVDA', 'nvda.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'NVDA', 'nvda.exe'),
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new KitError('NVDA is not installed on this computer. Install it from https://www.nvaccess.org/download/ and try again.');
}

function isRunning() {
  const out = spawnSync('tasklist', ['/FI', 'IMAGENAME eq nvda*', '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
  return /"nvda[^"]*\.exe"/i.test(out.stdout || '');
}

/**
 * Settings for the kit's own NVDA session. NVDA is started against this
 * folder, so the tester's personal NVDA settings and add-ons are never used
 * or changed.
 */
function writeProfile(configDir, { silent = true, watch = false } = {}) {
  ensureDir(configDir);
  const lines = [
    'schemaVersion = 2',
    '[general]',
    '\tlanguage = en',
    '\tshowWelcomeDialogAtStartup = False',
    '\tplayStartAndExitSounds = False',
    '\taskToExit = False',
    '[update]',
    '\taskedAllowUsageStats = True',
    '\tallowUsageStats = False',
    '\tautoCheck = False',
    '\tstartupNotification = False',
    '[keyboard]',
    '\thandleInjectedKeys = True',
    '\tuseExtendedInsertAsNVDAModifierKey = True',
    '[virtualBuffers]',
    // Reading the whole page on load would bury the first announcement.
    '\tautoSayAllOnPageLoad = False',
    // Say "focus mode" / "browse mode" in words instead of a sound, so the
    // switch shows up in the transcript.
    '\tpassThroughAudioIndication = False',
  ];
  if (silent) lines.push('[speech]', '\tsynth = silence');
  if (watch) {
    // For a person watching the test: NVDA's Speech Viewer shows each phrase
    // as text, and Visual Highlight draws a box around where NVDA is.
    lines.push(
      '[speechViewer]',
      '\tshowSpeechViewerAtStartup = True',
      '[vision]',
      '\t[[NVDAHighlighter]]',
      '\t\tenabled = True',
      '\t\thighlightFocus = True',
      '\t\thighlightNavigator = True',
      '\t\thighlightBrowseMode = True',
    );
  }
  fs.writeFileSync(path.join(configDir, 'nvda.ini'), lines.join('\r\n') + '\r\n');
}

/** Start NVDA with speech logging on. Resolves once NVDA has finished starting. */
async function start({ configDir, logFile, silent = true, watch = false, timeoutMs = 45000, onLaunch = null }) {
  const exe = findNvda();
  if (isRunning()) {
    throw new KitError('NVDA is already running. Close it first (NVDA+Q), then try again; the kit starts its own NVDA session so your settings are left alone.');
  }
  writeProfile(configDir, { silent, watch });
  ensureDir(path.dirname(logFile));
  if (fs.existsSync(logFile)) fs.unlinkSync(logFile);

  // NVDA has to be launched through the Windows shell (as a double-click
  // would), not as a direct child process. Paths travel in environment
  // variables so that spaces and quotes in them cannot break the command.
  const args = `-c "${configDir}" -f "${logFile}" -l 12 --lang=en`;
  const launched = spawnSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $env:SRBOT_NVDA_EXE -ArgumentList $env:SRBOT_NVDA_ARGS'],
    { env: { ...process.env, SRBOT_NVDA_EXE: exe, SRBOT_NVDA_ARGS: args }, encoding: 'utf8', windowsHide: true });
  if (launched.status !== 0) {
    throw new KitError('NVDA could not be started. ' + String(launched.stderr || '').trim().split('\n')[0]);
  }
  if (onLaunch) onLaunch();

  const began = Date.now();
  while (Date.now() - began < timeoutMs) {
    await sleep(500);
    const text = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
    if (/NVDA initialized/.test(text)) {
      await sleep(1000);
      const version = /Starting NVDA version (\S+)/.exec(text);
      return { exe, version: version ? version[1] : 'unknown' };
    }
  }
  throw new KitError('NVDA did not finish starting within ' + Math.round(timeoutMs / 1000) + ' seconds.');
}

async function stop() {
  let exe;
  try { exe = findNvda(); } catch (e) { return; }
  spawnSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $env:SRBOT_NVDA_EXE -ArgumentList "-q" -Wait'],
    { env: { ...process.env, SRBOT_NVDA_EXE: exe }, timeout: 20000, windowsHide: true });
  for (let i = 0; i < 30; i++) {
    if (!isRunning()) return;
    await sleep(300);
  }
  spawnSync('taskkill', ['/IM', 'nvda.exe', '/F']);
}

// ---------------------------------------------------------------------------
// Reading what NVDA said
// ---------------------------------------------------------------------------

const HEADER = /^(IO|INFO|DEBUG|DEBUGWARNING|WARNING|ERROR|CRITICAL) - (\S+) \((\d\d:\d\d:\d\d\.\d+)\) - .*:\s*$/;

/**
 * Split NVDA's speech list, e.g.
 *   [LangChangeCommand ('en'), 'Example Domain', 'heading', 'level 1']
 * into the spoken strings, ignoring the non-speech commands mixed in with them.
 */
function parseSpeechList(text) {
  const start = text.indexOf('[');
  if (start === -1) return [];
  const items = [];
  let depth = 0;
  let quote = null;
  let current = '';
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === '\\') { current += text[++i] || ''; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\'' || ch === '"') { quote = ch; current += ch; continue; }
    if (ch === '[' || ch === '(' || ch === '{') { depth++; if (depth > 1) current += ch; continue; }
    if (ch === ']' || ch === ')' || ch === '}') {
      depth--;
      if (depth === 0) { items.push(current.trim()); break; }
      current += ch;
      continue;
    }
    if (ch === ',' && depth === 1) { items.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  const spoken = [];
  for (const item of items) {
    if (!item) continue;
    const q = item[0];
    if ((q === '\'' || q === '"') && item[item.length - 1] === q && item.length >= 2) {
      const value = unescapePython(item.slice(1, -1)).replace(/\s+/g, ' ').trim();
      if (value) spoken.push(value);
    }
  }
  return spoken;
}

function unescapePython(s) {
  return s.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, (m, code) => {
    if (code[0] === 'x' || code[0] === 'u' || code[0] === 'U') {
      if (code.length > 1) return String.fromCodePoint(parseInt(code.slice(1), 16));
    }
    if (code === 'n' || code === 'r' || code === 't') return ' ';
    return code;
  });
}

/** Follows NVDA's log file and hands back what was added since the last read. */
class SpeechLog {
  constructor(file) {
    this.file = file;
    this.offset = 0;
  }

  size() {
    try { return fs.statSync(this.file).size; } catch (e) { return 0; }
  }

  /** Skip everything logged so far. */
  mark() {
    this.offset = this.size();
  }

  /** NVDA was restarted and its log file started again from empty. */
  reset() {
    this.offset = 0;
  }

  /** Entries logged since the last mark/read: [{ kind: 'speech'|'input', time, text, parts }] */
  read() {
    const size = this.size();
    if (size <= this.offset) return [];
    const fd = fs.openSync(this.file, 'r');
    const buf = Buffer.alloc(size - this.offset);
    fs.readSync(fd, buf, 0, buf.length, this.offset);
    fs.closeSync(fd);
    this.offset = size;

    const entries = [];
    let head = null;
    let body = [];
    const flush = () => {
      if (!head || head[1] !== 'IO') return;
      const text = body.join('\n');
      if (text.startsWith('Speaking')) {
        const parts = parseSpeechList(text);
        if (parts.length) entries.push({ kind: 'speech', time: head[3], parts, text: parts.join(', ') });
      } else if (text.startsWith('Input:')) {
        entries.push({ kind: 'input', time: head[3], text: text.slice(6).trim() });
      }
    };
    for (const line of buf.toString('utf8').split(/\r?\n/)) {
      const m = HEADER.exec(line);
      if (m) { flush(); head = m; body = []; } else if (head) body.push(line);
    }
    flush();
    return entries;
  }

  /**
   * Wait until NVDA has stopped talking: returns everything logged since the
   * last mark once the log has been quiet for `quietMs`.
   */
  async settle({ quietMs = 450, maxMs = 4000, minMs = 250 } = {}) {
    const began = Date.now();
    const collected = [];
    let lastChange = Date.now();
    let lastSize = this.offset;
    for (;;) {
      await sleep(90);
      const size = this.size();
      if (size !== lastSize) { lastSize = size; lastChange = Date.now(); collected.push(...this.read()); }
      const elapsed = Date.now() - began;
      if (elapsed >= maxMs) break;
      if (elapsed >= minMs && Date.now() - lastChange >= quietMs && (collected.length || elapsed >= 1200)) break;
    }
    collected.push(...this.read());
    return collected;
  }
}

// ---------------------------------------------------------------------------
// Sending real key presses (see keys.ps1)
// ---------------------------------------------------------------------------

class Keys {
  constructor() {
    this.child = null;
    this.waiting = [];
  }

  async start() {
    const script = path.join(__dirname, 'keys.ps1');
    this.child = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-OwnerPid', String(process.pid)],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stderr = '';
    this.child.stderr.on('data', (d) => { stderr += d; });
    const rl = readline.createInterface({ input: this.child.stdout });
    rl.on('line', (line) => {
      const next = this.waiting.shift();
      if (!next) return;
      try { next.resolve(JSON.parse(line)); } catch (e) { next.reject(new Error('Unreadable reply from the keyboard helper: ' + line)); }
    });
    this.child.on('exit', () => {
      for (const w of this.waiting.splice(0)) w.reject(new KitError('The keyboard helper stopped unexpectedly. ' + stderr.trim().split('\n')[0]));
    });
    const hello = await new Promise((resolve, reject) => {
      this.waiting.push({ resolve, reject });
      setTimeout(() => reject(new KitError('The keyboard helper did not start. ' + stderr.trim().split('\n')[0])), 30000);
    });
    if (!hello.ready) throw new KitError('The keyboard helper did not start.');
  }

  send(line) {
    return new Promise((resolve, reject) => {
      this.waiting.push({ resolve, reject });
      this.child.stdin.write(line + '\n');
    });
  }

  async command(line) {
    const reply = await this.send(line);
    if (!reply.ok) throw new KitError(reply.error || 'The keyboard helper refused: ' + line);
    return reply;
  }

  focus() { return this.command('focus'); }
  front() { return this.command('front'); }
  press(combo) { return this.command('press ' + combo); }
  type(text) { return this.command('type ' + Buffer.from(String(text), 'utf8').toString('base64')); }

  async stop() {
    if (!this.child) return;
    try { this.child.stdin.write('exit\n'); } catch (e) { /* already gone */ }
    await sleep(200);
    try { this.child.kill(); } catch (e) { /* already gone */ }
  }
}

module.exports = { findNvda, isRunning, start, stop, SpeechLog, Keys, parseSpeechList, sleep };
