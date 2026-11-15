// Token Radar's model, radar-2: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol
// is pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol);
// the snapshot's live-token protocols are kept apart and shown as the market's own values, never
// mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures, and the multiple is calibrated from
// the snapshot itself: for each category, the median market-cap-to-TVL ratio of the live-token
// protocols in that category. A DEX token trades at a different multiple of its TVL than a liquid
// staking token does, and the snapshot's own live set says what that multiple is. Categories with
// too few live protocols fall back to the overall median. No protocol name is ever special-cased:
// the same function scores every row.
//
//   catMult    = median(mcap_usd / tvl_usd) over live-token protocols of the category (n >= 3),
//                else the overall median; clamped to [0.05, 1.00]
//   base       = tvl_usd x catMult
//   growth     = clamp(change_7d, -60, 60) per cent
//   growthMult = 1 + (growth / 100) x 0.5
//   maturity   = 0.7 + min(age_days, 1095) / 1095 x 0.3   (age_days unknown: 365)
//   chainMult  = 1 + 0.05 x min(log2(chains), 6)          (1 chain: 1.00, 64 chains: 1.30)
//   implied    = max(1, round(base x growthMult x maturity x chainMult))
//
// The dashboard states the formula and the calibrated multiples, and recomputes each row from the
// same figures, so the page's code and the board's data are visibly the same arithmetic.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_weight: number;
  chain_log_cap: number;
  cat_mult_floor: number;
  cat_mult_cap: number;
  min_live_for_category: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 60,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_weight: 0.05,
  chain_log_cap: 6,
  cat_mult_floor: 0.05,
  cat_mult_cap: 1.0,
  min_live_for_category: 3,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One calibrated category multiple, as the dashboard shows it. */
export interface CategoryMultiple {
  category: string;
  multiple: number;
  live_count: number;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with the farm plan generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the calibrated multiples, and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  category_multiples: CategoryMultiple[];
  overall_multiple: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * The category multiples, calibrated from the snapshot's own live-token protocols: for each
 * category, the median market-cap-to-TVL ratio of its live-token protocols (only categories with
 * at least `min_live_for_category` of them). The overall median is the fallback for every other
 * category. Every multiple is clamped to [cat_mult_floor, cat_mult_cap].
 */
export function categoryMultiples(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { byCategory: Map<string, number>; overall: number; table: CategoryMultiple[] } {
  const live = snapshot.protocols.filter(
    (p) => p.gecko_id !== null && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const overall =
    live.length > 0
      ? median(live.map((p) => p.mcap_usd! / p.tvl_usd))
      : 0.25;
  const clamp = (n: number): number =>
    Math.min(model.cat_mult_cap, Math.max(model.cat_mult_floor, n));
  const byCategory = new Map<string, number>();
  const grouped = new Map<string, number[]>();
  for (const p of live) {
    const cat = p.category ?? 'Other';
    const list = grouped.get(cat) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    grouped.set(cat, list);
  }
  const table: CategoryMultiple[] = [];
  for (const [cat, ratios] of grouped) {
    if (ratios.length >= model.min_live_for_category) {
      const m = clamp(median(ratios));
      byCategory.set(cat, m);
      table.push({ category: cat, multiple: m, live_count: ratios.length });
    }
  }
  table.sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : 1));
  return { byCategory, overall: clamp(overall), table };
}

/** The category multiple one protocol gets: its category's calibrated multiple, or the overall one. */
export function categoryMultipleFor(
  p: SnapshotProtocol,
  calibrated: { byCategory: Map<string, number>; overall: number },
): number {
  return calibrated.byCategory.get(p.category ?? 'Other') ?? calibrated.overall;
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  calibrated: { byCategory: Map<string, number>; overall: number },
  model: ModelConstants = MODEL,
): {
  implied: number;
  catMult: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chainMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const catMult = categoryMultipleFor(protocol, calibrated);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) *
      model.maturity_range;
  const chainCount = Math.max(protocol.chains.length, 1);
  const chainMult =
    1 + model.chain_weight * Math.min(Math.log2(chainCount), model.chain_log_cap);
  const base = protocol.tvl_usd * catMult;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * chainMult));
  return { implied, catMult, growthPct, growthMult, maturityMult, chainMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(
  snapshot: Snapshot,
  calibrated: { byCategory: Map<string, number>; overall: number },
  model: ModelConstants = MODEL,
): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a
  // replacement for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, calibrated, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: round4(s.catMult),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('liquid staking') || c.includes('staking pool') || c.includes('restak'))
    return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`;
  if (c.includes('risk curator') || c.includes('capital allocator') || c.includes('allocator') || c.includes('liquidity manager'))
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares.`;
  if (c.includes('bridge') || c.includes('cross chain'))
    return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('dex') || c.includes('amm'))
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('rwa'))
    return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('leveraged'))
    return `Deposit $${capital} into ${name}'s main yield pool on ${chain} and keep the position open.`;
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('interest rate'))
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('basis'))
    return `Deposit $${capital} into ${name}'s basis vault on ${chain} and keep the position open.`;
  if (c.includes('prediction'))
    return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('stablecoin') || c.includes('stable'))
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('anchor btc') || c.includes('decentralized btc') || c.includes('btc'))
    return `Mint $${capital} of the BTC-backed asset through ${name} on ${chain} and hold it.`;
  if (c.includes('cedefi'))
    return `Deposit $${capital} into ${name}'s CeDeFi vault on ${chain} and keep the shares.`;
  if (c.includes('insurance'))
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('payment'))
    return `Send $${capital} through ${name}'s payment rail on ${chain} and keep the receipt.`;
  if (c.includes('governance'))
    return `Deposit $${capital} to vote on ${name} on ${chain} and keep the voting position.`;
  if (c.includes('chain'))
    return `Bridge $${capital} of USDC to ${name}'s chain and use one of its apps.`;
  if (c.includes('index'))
    return `Buy $${capital} of ${name}'s index token on ${chain} and hold it.`;
  if (c.includes('privacy'))
    return `Deposit $${capital} into ${name}'s private pool on ${chain} and keep the note.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's weekly qualifying action: what to repeat so the activity is counted. */
function weeklyFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('liquid staking') || c.includes('staking pool') || c.includes('restak'))
    return 'Restake the staking rewards once a week so the position keeps growing.';
  if (c.includes('risk curator') || c.includes('capital allocator') || c.includes('allocator') || c.includes('liquidity manager'))
    return 'Check the vault allocation and its points page once a week and top up a small amount.';
  if (c.includes('bridge') || c.includes('cross chain'))
    return 'Bridge a small amount back once a week so the route stays active.';
  if (c.includes('dex') || c.includes('amm'))
    return 'Swap a small amount through the pool once a week to keep the position active.';
  if (c.includes('rwa'))
    return 'Check the yield accrual once a week and add a small amount to the position.';
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return 'Adjust the position once a week, such as a small borrow or a top-up.';
  if (c.includes('yield') || c.includes('farm') || c.includes('leveraged'))
    return 'Claim and restake the yield once a week so the position compounds.';
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('interest rate'))
    return 'Close and reopen one small position once a week to keep the account active.';
  if (c.includes('basis'))
    return 'Check the funding-rate capture once a week and add a small amount.';
  if (c.includes('prediction'))
    return 'Settle or place one new market once a week.';
  if (c.includes('stablecoin') || c.includes('stable'))
    return 'Mint or redeem a small amount once a week to keep the position active.';
  if (c.includes('anchor btc') || c.includes('decentralized btc') || c.includes('btc'))
    return 'Check the BTC backing once a week and add a small amount.';
  if (c.includes('cedefi'))
    return 'Check the vault yield once a week and top up a small amount.';
  if (c.includes('insurance'))
    return 'Check the cover status once a week and renew it before it lapses.';
  if (c.includes('payment'))
    return 'Send one small payment a week through the rail.';
  if (c.includes('governance'))
    return 'Vote on one proposal a week while the position is open.';
  if (c.includes('chain'))
    return 'Use one app on the chain each week so the address stays active.';
  if (c.includes('index'))
    return 'Check the index rebalance once a week and hold through it.';
  if (c.includes('privacy'))
    return 'Make one private transfer a week through the pool.';
  return 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.';
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names. The main action and the weekly action follow the category; the capital follows the TVL;
 * the hold follows the age.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const weekly = weeklyFor(p);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weekly,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Farm only with funds you can afford to lose, verify the contract on the protocol's own docs, and never pay anyone to claim an airdrop.`,
      cost: 'nothing',
      time: '5 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    watchlist: watchlist.has(row.slug),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; radar: RadarData } {
  const calibrated = categoryMultiples(snapshot, model);
  const board = buildBoard(snapshot, calibrated, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const watchlistSet = new Set(snapshot.watchlist);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    category_multiples: calibrated.table,
    overall_multiple: calibrated.overall,
    rows: board.map((r) => radarRow(r, watchlistSet)),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of))
    throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0)
    throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string'))
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v))
      throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (
      typeof p.slug !== 'string' ||
      typeof p.name !== 'string' ||
      typeof p.tvl_usd !== 'number' ||
      !Number.isFinite(p.tvl_usd)
    ) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains)
        ? p.chains.filter((c): c is string => typeof c === 'string')
        : [],
      tvl_usd: p.tvl_usd,
      change_7d:
        typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd:
        typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0)
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++)
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd)
      return `row ${i + 1} outranks row ${i} on implied value`;
  if (
    board.length >= 2 &&
    board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd
  ) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps)
      if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0)
      return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
