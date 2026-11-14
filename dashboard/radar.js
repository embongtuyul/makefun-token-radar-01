// Token Radar's page: renders the ranked board from window.RADAR (written
// beside this page by main.ts), filters and sorts it, and opens one protocol
// at a time in the detail panel. Deep links: #slug=<slug> opens a protocol,
// #q=<text> searches, #cat=<category> filters by category.

const board = window.RADAR;
const rows = board.rows;
const meta = board.meta;

const $ = (id) => document.getElementById(id);
const rowsEl = $('rows');
const detailEl = $('detail');

/** $1.23B, $45.6M or $812K for a whole-dollar amount. */
function money(n) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

/** +12.3% or -4.5%, with a class for the colour; a missing reading is a dash. */
function growthCell(change) {
  if (change === null || change === undefined) return '<span>—</span>';
  const cls = change >= 0 ? 'up' : 'down';
  const sign = change >= 0 ? '+' : '';
  return `<span class="${cls}">${sign}${change.toFixed(1)}%</span>`;
}

/** 812d as 2.2y, 45d as 45d; a missing date is a dash. */
function ageCell(days) {
  if (days === null || days === undefined) return '<span>—</span>';
  if (days >= 365) return `${(days / 365).toFixed(1)}y`;
  return `${days}d`;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Chains shown in a table cell: the first three, then how many more. */
function chainsCell(chains) {
  if (chains.length <= 3) return chains.map(esc).join(', ');
  return `${chains.slice(0, 3).map(esc).join(', ')} <span class="slug">+${chains.length - 3} more</span>`;
}

/* ---- header numbers ------------------------------------------------ */

$('asof').textContent = `Snapshot ${meta.as_of} · DefiLlama`;
$('stats').innerHTML = [
  [meta.rows, 'protocols ranked'],
  [meta.watchlist_rows, 'of them on the watchlist'],
  [meta.pre_token_total, 'pre-token in the snapshot'],
  [meta.live_set_aside, 'live tokens set aside'],
]
  .map(([n, label]) => `<div class="stat"><b>${n}</b><span>${label}</span></div>`)
  .join('');

/* ---- filter controls ------------------------------------------------- */

const catSel = $('cat');
const chainSel = $('chain');
[...new Set(rows.map((r) => r.category))].sort().forEach((c) => {
  const o = document.createElement('option');
  o.value = c;
  o.textContent = c;
  catSel.appendChild(o);
});
[...new Set(rows.flatMap((r) => r.chains))].sort().forEach((c) => {
  const o = document.createElement('option');
  o.value = c;
  o.textContent = c;
  chainSel.appendChild(o);
});

const state = { q: '', cat: '', chain: '', watchOnly: false, sort: 'value' };

function visibleRows() {
  const q = state.q.trim().toLowerCase();
  let out = rows.filter((r) => {
    if (state.watchOnly && !r.on_watchlist) return false;
    if (state.cat && r.category !== state.cat) return false;
    if (state.chain && !r.chains.includes(state.chain)) return false;
    if (q && !(r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q))) return false;
    return true;
  });
  const by = {
    value: (a, b) => a.rank - b.rank,
    tvl: (a, b) => b.tvl_usd - a.tvl_usd || a.rank - b.rank,
    growth: (a, b) => (b.change_7d ?? -1e9) - (a.change_7d ?? -1e9) || a.rank - b.rank,
    age: (a, b) => (b.age_days ?? -1) - (a.age_days ?? -1) || a.rank - b.rank,
    name: (a, b) => a.name.localeCompare(b.name),
  }[state.sort];
  return out.sort(by);
}

/* ---- the table -------------------------------------------------------- */

function render() {
  const list = visibleRows();
  $('count').textContent =
    list.length === rows.length
      ? `Showing all ${rows.length} ranked protocols.`
      : `Showing ${list.length} of ${rows.length} ranked protocols.`;
  rowsEl.innerHTML = list
    .map(
      (r) => `<tr data-slug="${esc(r.slug)}">
        <td class="num">${r.rank}</td>
        <td><strong>${esc(r.name)}</strong><span class="slug">${esc(r.slug)}</span>${
        r.on_watchlist ? '<span class="badge">WATCHLIST</span>' : ''
      }</td>
        <td>${esc(r.category)}</td>
        <td>${chainsCell(r.chains)}</td>
        <td class="num">${money(r.tvl_usd)}</td>
        <td class="num">${growthCell(r.change_7d)}</td>
        <td class="num">${ageCell(r.age_days)}</td>
        <td class="num val">${money(r.implied_value_usd)}</td>
      </tr>`,
    )
    .join('');
}

rowsEl.addEventListener('click', (ev) => {
  const tr = ev.target.closest('tr[data-slug]');
  if (tr) openDetail(tr.dataset.slug);
});

/* ---- the detail panel ------------------------------------------------- */

function openDetail(slug) {
  const r = rows.find((x) => x.slug === slug);
  if (!r) return;
  document.querySelectorAll('tr.open').forEach((tr) => tr.classList.remove('open'));
  const tr = rowsEl.querySelector(`tr[data-slug="${CSS.escape(slug)}"]`);
  if (tr) tr.classList.add('open');
  $('d-name').textContent = `${r.name} — rank ${r.rank}`;
  $('d-sub').textContent =
    `${r.slug} · ${r.category} · ${r.chains.join(', ')}` +
    (r.on_watchlist ? ' · on the watchlist' : '');
  const m = r.model;
  $('d-facts').innerHTML = [
    ['Implied value', money(r.implied_value_usd)],
    ['Locked value (TVL)', money(r.tvl_usd)],
    ['7-day change', r.change_7d === null ? '—' : `${r.change_7d >= 0 ? '+' : ''}${r.change_7d.toFixed(1)}%`],
    ['Age without a token', r.age_days === null ? '—' : `${r.age_days} days`],
  ]
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
    .join('');
  $('d-model').textContent =
    `${money(m.base_usd)} base (30% of TVL) × ${m.growth.toFixed(2)} growth × ` +
    `${m.maturity.toFixed(2)} maturity × ${m.reach.toFixed(2)} reach = ` +
    `${money(r.implied_value_usd)}. The protocol records no token yet.`;
  $('d-steps').innerHTML = r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('');
  detailEl.hidden = false;
}

$('d-close').addEventListener('click', () => {
  detailEl.hidden = true;
  document.querySelectorAll('tr.open').forEach((tr) => tr.classList.remove('open'));
  if (location.hash.startsWith('#slug=')) history.replaceState(null, '', location.pathname);
});

/* ---- wiring ------------------------------------------------------------ */

$('q').addEventListener('input', (ev) => {
  state.q = ev.target.value;
  render();
});
catSel.addEventListener('change', (ev) => {
  state.cat = ev.target.value;
  render();
});
chainSel.addEventListener('change', (ev) => {
  state.chain = ev.target.value;
  render();
});
$('watchonly').addEventListener('change', (ev) => {
  state.watchOnly = ev.target.checked;
  render();
});
$('sort').addEventListener('change', (ev) => {
  state.sort = ev.target.value;
  render();
});

function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.has('q')) {
    state.q = h.get('q');
    $('q').value = state.q;
  }
  if (h.has('cat')) {
    state.cat = h.get('cat');
    catSel.value = state.cat;
  }
  if (h.has('chain')) {
    state.chain = h.get('chain');
    chainSel.value = state.chain;
  }
  render();
  if (h.has('slug')) openDetail(h.get('slug'));
}

window.addEventListener('hashchange', readHash);
readHash();
