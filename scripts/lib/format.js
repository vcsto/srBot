'use strict';

/** One transcript step as plain text, the way it is shown to Claude and saved in transcript.txt. */
function formatStep(rec) {
  if (rec.action === 'note') return `\n=== ${rec.text} ===`;
  if (rec.action === 'look') {
    const lines = [`#${rec.n} [look] ${rec.page ? rec.page.url : ''}`];
    if (rec.page && rec.page.title) lines.push(`      title: "${rec.page.title}"`);
    lines.push(`      focus: ${rec.focus || '(nothing focused in the page)'}`);
    if (rec.shot) lines.push(`      screenshot: ${rec.shot}`);
    return lines.join('\n');
  }
  const what = rec.action === 'press' ? rec.key : rec.action === 'type' ? `type "${rec.text}"` : `${rec.action} ${rec.url || ''}`.trim();
  const said = rec.nvdaOff ? '(NVDA is off)'
    : rec.said && rec.said.length ? rec.said.map((s) => `"${s}"`).join(' / ') : '(NVDA said nothing)';
  const lines = [`#${rec.n} [${what}] ${said}`];
  if (rec.focus) lines.push(`      focus: ${rec.focus}`);
  else if (/^(shift\+)?tab$/.test(rec.key || '')) lines.push('      focus: (no element in the page has focus)');
  if ((rec.navigated || rec.nvdaOff) && rec.page) lines.push(`      now on: ${rec.page.url} "${rec.page.title}"`);
  if (rec.markup) for (const m of rec.markup) lines.push(`      markup: ${m.replace(/\n\s+/g, ' ')}`);
  if (rec.dialog) lines.push(`      browser dialog open (${rec.dialog.type}): "${rec.dialog.message}"`);
  if (rec.flags && rec.flags.length) lines.push(`      note: ${rec.flags.join('; ')}`);
  return lines.join('\n');
}

function formatSteps(records) {
  return records.map(formatStep).join('\n');
}

module.exports = { formatStep, formatSteps };
