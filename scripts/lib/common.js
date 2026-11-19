'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const RUNS_DIR = path.join(ROOT, 'runs');
const SESSION_FILE = path.join(ROOT, '.session.json');
const BROWSER_PROFILE = path.join(ROOT, '.browser-profile');

/** An error whose message is meant to be read by the tester, not a stack trace. */
class KitError extends Error {}

function main(fn) {
  fn().catch((err) => {
    if (err instanceof KitError) console.error('Problem: ' + err.message);
    else console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
}

function parseArgs(argv, { booleans = [] } = {}) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq !== -1) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (booleans.includes(key) || next === undefined || next.startsWith('--')) { out[key] = true; continue; }
    out[key] = next;
    i++;
  }
  return out;
}

function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) throw new KitError('No page address was given.');
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch (e) { throw new KitError(`"${input}" is not a valid page address.`); }
  if (!['http:', 'https:', 'file:'].includes(u.protocol)) {
    throw new KitError(`"${input}" must start with http:// or https://.`);
  }
  return u.href;
}

function slugify(text, max = 40) {
  const s = String(text).replace(/^[a-z]+:\/\//i, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (s || 'site').slice(0, max).replace(/-+$/, '');
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Path shown to the tester: relative to the kit folder, forward slashes. */
function rel(file, from = ROOT) {
  return path.relative(from, file).split(path.sep).join('/');
}

function truncate(s, n) {
  s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Read every step recorded in a run's transcript. */
function readTranscript(runDir) {
  const file = path.join(runDir, 'transcript.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/** Resolve a run folder given by name, path, or nothing (the most recent run). */
function resolveRun(arg) {
  if (arg && arg !== true) {
    for (const c of [path.resolve(process.cwd(), String(arg)), path.join(RUNS_DIR, String(arg))]) {
      if (fs.existsSync(path.join(c, 'run.json'))) return c;
    }
    throw new KitError(`"${arg}" is not a test run folder.`);
  }
  const all = fs.existsSync(RUNS_DIR)
    ? fs.readdirSync(RUNS_DIR).filter((d) => fs.existsSync(path.join(RUNS_DIR, d, 'run.json'))).sort()
    : [];
  if (!all.length) throw new KitError('There are no test runs yet.');
  return path.join(RUNS_DIR, all[all.length - 1]);
}

module.exports = {
  ROOT, RUNS_DIR, SESSION_FILE, BROWSER_PROFILE, KitError, main, parseArgs, normalizeUrl,
  slugify, stamp, ensureDir, writeJson, readJson, rel, truncate, sleep, readTranscript, resolveRun,
};
