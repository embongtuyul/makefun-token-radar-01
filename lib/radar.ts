// Token Radar's scoring core: snapshot in, ranked board out.
//
// The radar answers one question per protocol: if this protocol issued a token
// tomorrow and its record stayed exactly as it is, what would that token be
// worth in total? The answer is built only from the snapshot's own numbers —
// the protocol's locked value, how fast that value moved in the last week,
// how long the protocol has run without a token, and how many chains it
// touches. No name is ever special-cased: two protocols with the same numbers
// get the same score, whatever they are called.
//
// The board ranks pre-token protocols only. A protocol whose token already
// trades is set aside and counted, never ranked: the radar is a launch radar,
// and a launch that already happened is not a launch to come.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ValueParts {
  base_usd: number;
  growth: number;
  maturity: number;
  reach: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  token_status: string;
  on_watchlist: boolean;
  model: ValueParts;
}

export interface BoardMeta {
  as_of: string;
  floor_usd: number;
  rows: number;
  watchlist_rows: number;
  pre_token_total: number;
  live_set_aside: number;
  snapshot_protocols: number;
}

export interface BuiltBoard {
  rows: BoardRow[];
  meta: BoardMeta;
}

/** How many rows the board carries: every watchlist slug plus this many more. */
export const EXTRA_ROWS = 200;

/** The share of locked value a launch is worth before the levers apply. */
const VALUE_SHARE = 0.3;

/** A protocol records no token when DefiLlama carries neither id nor symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** Whole days between the day DefiLlama began tracking a protocol and the snapshot day. */
export function ageInDays(listedAt: string | null, asOf: string): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.floor((end - start) / 86_400_000);
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * The growth lever: a protocol whose locked value grew in the last seven days
 * is worth more than one the same size that shrank. The weekly move is
 * clamped to [-50, +100] per cent first, so one wild week cannot decide the
 * board, and a missing reading is neutral. The lever runs 0.75 to 1.50.
 */
export function growthLever(change7d: number | null): number {
  if (change7d === null || !Number.isFinite(change7d)) return 1;
  const pct = clamp(change7d, -50, 100);
  return 1 + 0.5 * (pct / 100);
}

/**
 * The maturity lever: a protocol that has run longer with no token has had
 * more time to build the user base a launch rewards, so it earns more. The
 * lever adds 12% per year of tokenless age, up to four years, and a protocol
 * with no tracking date is neutral.
 */
export function maturityLever(ageDays: number | null): number {
  if (ageDays === null) return 1;
  return 1 + 0.12 * Math.min(ageDays / 365, 4);
}

/**
 * The reach lever: a protocol live on more chains reaches more users, so it
 * earns more. Three per cent per extra chain, up to ten extra chains.
 */
export function reachLever(chainCount: number): number {
  return 1 + 0.03 * Math.min(Math.max(chainCount - 1, 0), 10);
}

/** The implied value of one protocol, with the levers that produced it. */
export function scoreProtocol(p: SnapshotProtocol, asOf: string): { value: number; parts: ValueParts } {
  const age = ageInDays(p.listed_at, asOf);
  const parts: ValueParts = {
    base_usd: Math.round(p.tvl_usd * VALUE_SHARE),
    growth: growthLever(p.change_7d),
    maturity: maturityLever(age),
    reach: reachLever(p.chains.length),
  };
  const raw = parts.base_usd * parts.growth * parts.maturity * parts.reach;
  const value = Math.max(1, Math.min(Math.round(raw), 100_000_000_000_000));
  return { value, parts };
}

/** Parse the snapshot text into the shape the radar expects, refusing junk. */
export function parseSnapshot(text: string): Snapshot {
  const data = JSON.parse(text) as Snapshot;
  if (!Array.isArray(data.protocols) || !Array.isArray(data.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  if (typeof data.as_of !== 'string' || typeof data.floor_usd !== 'number') {
    throw new Error('snapshot: as_of and floor_usd are required');
  }
  return data;
}

// ---------------------------------------------------------------- farm plans

/** Rough gas cost of one simple transaction on a chain, in whole dollars. */
const GAS_BY_CHAIN: Record<string, number> = {
  Ethereum: 5,
  Arbitrum: 1,
  Base: 1,
  Optimism: 1,
  'BNB Chain': 1,
  Solana: 1,
  Polygon: 1,
  Avalanche: 1,
  Gnosis: 1,
  Linea: 1,
  zkSync: 1,
  Scroll: 1,
  Blast: 1,
  Mode: 1,
  Sei: 1,
  Sui: 1,
  Aptos: 1,
};

function gasOn(chain: string): number {
  return GAS_BY_CHAIN[chain] ?? 1;
}

/** A starter deposit sized to the protocol's implied-value tier. */
function depositFor(value: number): number {
  if (value >= 100_000_000) return 500;
  if (value >= 25_000_000) return 250;
  return 100;
}

/** The core interaction for a protocol, by what kind of protocol it is. */
function coreAction(p: SnapshotProtocol, amount: number, chain: string, gas: number): string {
  const cat = (p.category ?? '').toLowerCase();
  if (cat.includes('cex') || cat.includes('centralized')) {
    return (
      `Trade $${amount} of spot volume on ${p.name} (${chain}) across two or three ` +
      `pairs and withdraw the proceeds to your own wallet: about $${gas} in gas plus ` +
      `trading fees, 20 minutes. Regular spot trading with self-custody withdrawals ` +
      `is the activity a centralised venue would reward.`
    );
  }
  if (cat.includes('dex') || cat.includes('exchange')) {
    return (
      `Swap $${amount} into the deepest pool on ${p.name} (${chain}) and add it as liquidity ` +
      `in a tight range: about $${gas} in gas, 15 minutes. Your share earns trading fees ` +
      `while the position stays in range, and every swap counts as activity.`
    );
  }
  if (cat.includes('lending') || cat.includes('borrow')) {
    return (
      `Supply $${amount} of a stablecoin to ${p.name} on ${chain} as collateral, then borrow ` +
      `up to half of it back: about $${gas} in gas, 10 minutes. The supply earns yield ` +
      `while the borrow keeps the position active on both sides.`
    );
  }
  if (cat.includes('liquid staking') || cat.includes('restaking')) {
    return (
      `Stake $${amount} with ${p.name} on ${chain} and hold the receipt token in the same ` +
      `wallet: about $${gas} in gas, 5 minutes. Staking rewards accrue while you hold, ` +
      `and the receipt token itself can be used elsewhere later.`
    );
  }
  if (cat.includes('yield') || cat.includes('vault')) {
    return (
      `Deposit $${amount} into the highest-TVL vault on ${p.name} (${chain}): about $${gas} ` +
      `in gas, 10 minutes. The vault compounds its yield on its own, so the position ` +
      `works without further transactions from you.`
    );
  }
  if (cat.includes('bridge')) {
    const other = p.chains.length > 1 ? p.chains[1] : chain;
    return (
      `Bridge $${amount} from ${chain} to ${other} through ${p.name}: about $${gas + 1} in ` +
      `fees, 5 to 15 minutes for the transfer to land. Keep the receipt until the funds ` +
      `arrive, then bridge a smaller amount back the same week.`
    );
  }
  if (cat.includes('derivative') || cat.includes('perpetual') || cat.includes('options')) {
    return (
      `Open a $${amount} position on ${p.name} (${chain}) with low leverage and close it ` +
      `the same day: about $${gas} in gas plus trading fees, 20 minutes. One completed ` +
      `round trip records a full trading cycle on the protocol.`
    );
  }
  if (cat.includes('rwa') || cat.includes('real world')) {
    return (
      `Buy $${amount} of the tokenised asset on ${p.name} (${chain}) and hold it for at ` +
      `least a week: about $${gas} in gas, 10 minutes. Holding through a full week ` +
      `records a longer commitment than a same-day flip.`
    );
  }
  return (
    `Use ${p.name} on ${chain} with $${amount}: connect a fresh wallet, run one full ` +
    `transaction cycle end to end, and confirm it landed on the explorer: about $${gas} ` +
    `in gas, 10 minutes. A completed cycle is the activity a launch would reward.`
  );
}

/**
 * A concrete farm plan for one protocol: five steps, each naming what it
 * costs and how long it takes. Amounts follow the protocol's implied-value
 * tier, gas follows its home chain, and every step names the protocol itself.
 */
export function farmPlan(p: SnapshotProtocol, value: number): string[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const gas = gasOn(chain);
  const amount = depositFor(value);
  const repeat = Math.max(50, Math.floor(amount / 2));
  return [
    `Move $${amount} of stablecoins onto ${chain} through the chain's official bridge ` +
      `and hold them in a fresh wallet: about $${gas} in gas, 10 to 20 minutes for the ` +
      `transfer to confirm. Never farm from an exchange withdrawal address.`,
    coreAction(p, amount, chain, gas),
    `Repeat the core action once a week for four weeks with $${repeat} each time: about ` +
      `$${gas} in gas per week, 10 minutes a week. Four steady weeks count for more than ` +
      `one large deposit, because the pattern shows a real user.`,
    `Open ${p.name}'s points or rewards page and confirm your wallet's activity shows up: ` +
      `free, 5 minutes. If nothing shows after a day, check the transaction landed on ` +
      `the ${chain} explorer before doing anything else.`,
    `Leave at least $${repeat} in the position and revoke unlimited token approvals ` +
      `after each session: about $${gas} in gas, 5 minutes. Withdrawing takes one ` +
      `transaction when the token launches, so keep the wallet's keys safe until then.`,
  ];
}

// ---------------------------------------------------------------- the board

/**
 * Build the ranked board: every watchlist slug, plus the strongest other
 * pre-token protocols by implied value, ranked best first. Protocols whose
 * token already trades are counted and set aside.
 */
export function buildBoard(snapshot: Snapshot): BuiltBoard {
  const watchlist = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter(isPreToken)
    .map((p) => {
      const { value, parts } = scoreProtocol(p, snapshot.as_of);
      return { p, value, parts };
    });
  const liveSetAside = snapshot.protocols.length - scored.length;

  const byValue = (a: { p: SnapshotProtocol; value: number }, b: { p: SnapshotProtocol; value: number }): number =>
    b.value - a.value || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0);

  const picked = new Map<string, { p: SnapshotProtocol; value: number; parts: ValueParts }>();
  for (const entry of scored) {
    if (watchlist.has(entry.p.slug)) picked.set(entry.p.slug, entry);
  }
  const ranked = [...scored].sort(byValue);
  for (const entry of ranked) {
    if (picked.size >= watchlist.size + EXTRA_ROWS) break;
    if (!picked.has(entry.p.slug)) picked.set(entry.p.slug, entry);
  }

  const ordered = [...picked.values()].sort(byValue);
  const rows: BoardRow[] = ordered.map((entry, i) => {
    const { p, value, parts } = entry;
    return {
      slug: p.slug,
      name: p.name,
      rank: i + 1,
      implied_value_usd: value,
      farm_steps: farmPlan(p, value),
      category: p.category ?? 'Uncategorised',
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: ageInDays(p.listed_at, snapshot.as_of),
      token_status: 'pre-token',
      on_watchlist: watchlist.has(p.slug),
      model: parts,
    };
  });

  return {
    rows,
    meta: {
      as_of: snapshot.as_of,
      floor_usd: snapshot.floor_usd,
      rows: rows.length,
      watchlist_rows: rows.filter((r) => r.on_watchlist).length,
      pre_token_total: scored.length,
      live_set_aside: liveSetAside,
      snapshot_protocols: snapshot.protocols.length,
    },
  };
}

/** The dashboard's data file: the board and its context, as one script. */
export function dataScript(board: BuiltBoard): string {
  return `window.RADAR = ${JSON.stringify(board)};\n`;
}

/** Find the first problem a gate would refuse in a board, or null when clean. */
export function boardIssue(board: BuiltBoard, snapshot: Snapshot): string | null {
  const { rows } = board;
  if (rows.length < 100) return `board holds ${rows.length} rows, fewer than 100`;
  const seen = new Set<string>();
  let prev = Number.POSITIVE_INFINITY;
  let allEqual = rows.length > 1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.rank !== i + 1) return `row ${r.slug} has rank ${r.rank}, expected ${i + 1}`;
    if (seen.has(r.slug)) return `slug ${r.slug} appears twice`;
    seen.add(r.slug);
    if (r.implied_value_usd > prev) return `implied value rises at rank ${r.rank}`;
    if (r.implied_value_usd !== prev && prev !== Number.POSITIVE_INFINITY) allEqual = false;
    if (i > 0 && r.implied_value_usd !== rows[i - 1]!.implied_value_usd) allEqual = false;
    prev = r.implied_value_usd;
    if (!r.farm_steps || r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return `row ${r.slug} has ${r.farm_steps?.length ?? 0} farm steps`;
    }
    for (const step of r.farm_steps) {
      const t = step.trim();
      if (t.length < 20 || t.length > 600) return `row ${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  if (allEqual) return 'every implied value is the same';
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} is missing`;
  }
  return null;
}
