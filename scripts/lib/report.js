'use strict';

// The report is one table: where NVDA said something it should not have, what it
// said, what it should have said, and why. See knowledge/report-format.md.

const fs = require('fs');
const path = require('path');
const { KitError, readJson, readTranscript, rel } = require('./common');

const SEVERITIES = ['critical', 'serious', 'moderate', 'minor'];

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const norm = (s) => String(s).toLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, '\'').replace(/\s+/g, ' ').trim();
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

/**
 * Every NVDA quote in the report must be real. A quote is accepted only if it
 * appears word for word in what NVDA said during the steps it cites. An
 * ellipsis (... or …) may be used to skip words in the middle.
 */
function verifyQuote(quote, steps, byNumber, all) {
  const pool = steps.length
    ? steps.map((n) => byNumber.get(n)).filter(Boolean).map((r) => (r.said || []).join(' / '))
    : all;
  const haystack = norm(pool.join(' / '));
  const fragments = String(quote).split(/\.{3}|…/).map(norm).filter(Boolean);
  if (!fragments.length) return false;
  // A fragment must match whole words: "home, link" is not a quote of "nav_home, link".
  const wordChar = (c) => c !== undefined && /[\p{L}\p{N}_]/u.test(c);
  let from = 0;
  for (const fragment of fragments) {
    let at = haystack.indexOf(fragment, from);
    while (at !== -1) {
      const cutsStart = wordChar(fragment[0]) && wordChar(haystack[at - 1]);
      const cutsEnd = wordChar(fragment[fragment.length - 1]) && wordChar(haystack[at + fragment.length]);
      if (!cutsStart && !cutsEnd) break;
      at = haystack.indexOf(fragment, at + 1);
    }
    if (at === -1) return false;
    from = at + fragment.length;
  }
  return true;
}

function validate(data, transcript, { allowUnverified }) {
  const problems = [];
  const unverified = new Set();
  const byNumber = new Map(transcript.map((r) => [r.n, r]));
  const all = transcript.map((r) => (r.said || []).join(' / '));

  if (!data || typeof data !== 'object') throw new KitError('findings.json must contain a JSON object.');
  if (!data.title) problems.push('"title" is missing.');
  if (!list(data.checked).length) problems.push('"checked" is missing: list the pages and the checks that were run, so a reader knows what an empty table means.');
  if (!Array.isArray(data.findings)) problems.push('"findings" must be a list (it may be empty).');
  if (!Array.isArray(data.notCovered)) problems.push('"notCovered" must be a list of what was not checked (it may be empty).');

  const checkQuotes = (item, label) => {
    const steps = list(item.steps);
    for (const n of steps) if (!byNumber.has(n)) problems.push(`${label}: step ${n} is not in the transcript.`);
    const quotes = list(item.nvdaSaid);
    if (quotes.length && !steps.length) problems.push(`${label}: "steps" is missing. List the transcript step numbers the quotes come from.`);
    for (const quote of quotes) {
      if (!verifyQuote(quote, steps.filter((n) => byNumber.has(n)), byNumber, all)) {
        if (allowUnverified) unverified.add(quote);
        else problems.push(`${label}: the quote "${quote}" does not appear in what NVDA said at step(s) ${steps.join(', ') || '(none given)'}. Copy NVDA's words exactly from the transcript.`);
      }
    }
    return quotes;
  };

  list(data.findings).forEach((f, i) => {
    const label = `Finding ${i + 1}`;
    const quotes = checkQuotes(f, label);
    if (!quotes.length && !f.silent) {
      problems.push(`${label}: "nvdaSaid" is missing. Quote NVDA word for word, or set "silent": true if the problem is that NVDA said nothing.`);
    }
    if (!SEVERITIES.includes(f.severity)) problems.push(`${label}: "severity" must be one of ${SEVERITIES.join(', ')}.`);
    for (const field of ['where', 'expected', 'why']) if (!f[field]) problems.push(`${label}: "${field}" is missing.`);
  });
  list(data.notCounted).forEach((item, i) => {
    const label = `Not counted ${i + 1}`;
    if (!checkQuotes(item, label).length) problems.push(`${label}: "nvdaSaid" is missing.`);
    if (!item.why) problems.push(`${label}: "why" is missing: say why this is not the site's fault.`);
  });

  if (problems.length) {
    throw new KitError('findings.json needs fixing before a report can be built:\n  - ' + problems.join('\n  - '));
  }
  return unverified;
}

/** Worst first; findings of the same severity keep the order they were written in. */
function sorted(findings) {
  return list(findings)
    .map((f, i) => ({ f, i }))
    .sort((a, b) => SEVERITIES.indexOf(a.f.severity) - SEVERITIES.indexOf(b.f.severity) || a.i - b.i)
    .map((x) => x.f);
}

function csvCell(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@]/.test(s)) s = '\'' + s; // stop spreadsheets treating text as a formula
  return '"' + s.replace(/"/g, '""') + '"';
}

const saidText = (f) => [...list(f.nvdaSaid), ...(f.silent ? ['(nothing)'] : [])].join(' | ');

function buildCsv(data) {
  const head = ['#', 'Severity', 'Page', 'Where', 'NVDA said', 'It should have said', 'Why'];
  const rows = sorted(data.findings).map((f, i) => [i + 1, cap(f.severity), f.page, f.where, saidText(f), f.expected, f.why]);
  return '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const CSS = `
:root { --bg:#fff; --fg:#1b1f24; --muted:#57606a; --line:#d0d7de; --head:#f6f8fa; --link:#0b5cad; --quote:#fff8e1;
  --critical:#a40e26; --serious:#9a4a00; --moderate:#6e5600; --minor:#3d5a80; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#0f1317; --fg:#e6edf3; --muted:#9da7b3; --line:#30363d; --head:#161b22; --link:#79b8ff; --quote:#2a2410;
    --critical:#ff8f9c; --serious:#ffb37a; --moderate:#e6c75c; --minor:#9cc3f0; }
}
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; overflow-wrap:anywhere; }
main { max-width: 84rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
h1 { font-size: 1.6rem; line-height:1.25; margin: 0 0 .35rem; }
h2 { font-size: 1.15rem; margin: 2rem 0 .5rem; }
a { color: var(--link); }
.meta, .muted { color: var(--muted); }
.meta { margin:.15rem 0; }
ul { margin:.35rem 0; padding-left:1.25rem; }
.scroll { overflow-x:auto; margin-top:1rem; }
.scroll:focus-visible { outline:3px solid var(--link); outline-offset:2px; }
table { border-collapse:collapse; width:100%; min-width:58rem; }
th, td { text-align:left; vertical-align:top; padding:.5rem .6rem; border:1px solid var(--line); }
thead th { background:var(--head); position:sticky; top:0; }
th.n, td.sev { white-space:nowrap; }
td.sev { font-weight:700; }
.sev-critical { color: var(--critical); } .sev-serious { color: var(--serious); }
.sev-moderate { color: var(--moderate); } .sev-minor { color: var(--minor); }
.said { display:block; margin:0 0 .35rem; padding:.2rem .4rem; background:var(--quote); font-family: ui-monospace, Consolas, monospace; font-size:.9rem; }
.said:last-child { margin-bottom:0; }
.warn { font-family: system-ui, sans-serif; font-weight:600; }
@media print { .scroll { overflow:visible; } table { min-width:0; } thead th { position:static; } tr { break-inside: avoid; } }
`;

function saidHtml(item, unverified) {
  const quotes = list(item.nvdaSaid).map((q) =>
    `<span class="said">“${esc(q)}”${unverified.has(q) ? ' <span class="warn">(not checked against the recording)</span>' : ''}</span>`);
  if (item.silent) quotes.push('<span class="said">(nothing)</span>');
  return quotes.join('');
}

function buildHtml(data, run, transcript, unverified) {
  const findings = sorted(data.findings);
  const showPage = findings.some((f) => f.page);
  const date = new Date(run.startedAt || Date.now()).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
  const bullets = (items) => '<ul>' + list(items).map((i) => `<li>${esc(i)}</li>`).join('') + '</ul>';
  const tools = [
    run.screenReader ? `${run.screenReader.name} ${run.screenReader.version}` : 'NVDA',
    run.browser ? `${run.browser.name} ${run.browser.version}` : 'a desktop browser',
  ].join(' with ');
  const checked = list(data.checked);

  const table = findings.length ? `
<div class="scroll" role="region" aria-label="Findings" tabindex="0">
<table>
<thead><tr>
<th scope="col" class="n">#</th><th scope="col">Severity</th>${showPage ? '<th scope="col">Page</th>' : ''}<th scope="col">Where</th>
<th scope="col">NVDA said</th><th scope="col">It should have said</th><th scope="col">Why</th>
</tr></thead>
<tbody>
${findings.map((f, i) => `<tr>
<th scope="row" class="n">${i + 1}</th><td class="sev sev-${esc(f.severity)}">${esc(cap(f.severity))}</td>${showPage ? `<td>${esc(f.page || '')}</td>` : ''}<td>${esc(f.where)}</td>
<td>${saidHtml(f, unverified)}</td><td>${esc(f.expected)}</td><td>${esc(f.why)}</td>
</tr>`).join('\n')}
</tbody>
</table>
</div>` : '<p>In what was checked, NVDA said what it should have.</p>';

  const notCounted = list(data.notCounted).length ? `
<h2>Not counted</h2>
<p class="muted">Things NVDA said that sound wrong but are not the site's fault.</p>
<ul>${list(data.notCounted).map((x) => `<li>${saidHtml(x, unverified)}${esc(x.why)}</li>`).join('')}</ul>` : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(data.title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<h1>${esc(data.title)}</h1>
<p class="meta">${[run.site, date, tools].filter(Boolean).map(esc).join(' · ')}</p>
${checked.length === 1 ? `<p class="meta">Checked: ${esc(checked[0])}</p>` : `<h2>Checked</h2>${bullets(checked)}`}

<h2>Where NVDA should have said something else</h2>
${table}

<h2>Not covered</h2>
${list(data.notCovered).length ? bullets(data.notCovered) : ''}
<p class="muted">This is a test with one screen reader and one browser, not a full accessibility audit. Colour contrast, zoom, captions and other assistive technology were not assessed.</p>
${notCounted}

<p class="muted">Every quote is NVDA's own words, checked against the recording when this report was built. The full recording (${transcript.length} steps) and the screenshots are in the same folder as this report.</p>
</main>
</body>
</html>
`;
}

function buildReport(runDir, { allowUnverified = false } = {}) {
  const findingsFile = path.join(runDir, 'findings.json');
  if (!fs.existsSync(findingsFile)) {
    throw new KitError(`There is no findings.json in ${rel(runDir)} yet. Write the findings there first (see knowledge/report-format.md).`);
  }
  let data;
  try { data = readJson(findingsFile); } catch (e) { throw new KitError('findings.json is not valid JSON: ' + e.message); }
  const transcript = readTranscript(runDir);
  const run = readJson(path.join(runDir, 'run.json'));
  const unverified = validate(data, transcript, { allowUnverified });

  const html = path.join(runDir, 'report.html');
  const csv = path.join(runDir, 'report.csv');
  fs.writeFileSync(html, buildHtml(data, run, transcript, unverified));
  fs.writeFileSync(csv, buildCsv(data));
  console.log(`Report written: ${html}`);
  console.log(`Spreadsheet of findings (for a bug tracker): ${csv}`);
  if (unverified.size) console.log(`Warning: ${unverified.size} quote(s) could not be matched to the transcript and are marked as such in the report.`);
}

module.exports = { buildReport, verifyQuote };
