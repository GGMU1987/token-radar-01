// GGMU token radar model (radar-2): one sealed snapshot in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a
// ceiling) and adds the strongest pre-token protocols below the floor, ranked
// by the same model: the early rows a radar exists to find. A protocol is
// pre-token when its record carries no token (no market cap, no CoinGecko id,
// no symbol); protocols whose token already trades are never ranked here, the
// dashboard shows them apart at the market's own values.
//
// The implied value is what a token would be worth if the protocol's record
// stayed as it is. It is built only from the snapshot's own figures:
//
//   peerMultiple  the market's own price of $1 of TVL for this kind of
//                 protocol: the median mcap/TVL ratio of the snapshot's
//                 live-token protocols in the same category (at least 3
//                 samples, else the median over every live protocol),
//                 clamped to [0.05, 3]. No multiple is written down by hand;
//                 each is measured from the sealed snapshot itself.
//   momentum      1 + clamp(change_7d, -50, 100)/100 x 0.40
//   maturity      0.55 + 0.45 x min(age_days, 1460)/1460  (unknown age: 270)
//   breadth       1 + 0.03 x min(chains - 1, 5)
//   implied       max(1, round(tvl x peerMultiple x momentum x maturity x breadth))
//
// No protocol name is ever special-cased: the same function scores every row,
// and the dashboard restates the model and recomputes every row from its
// inputs, so the page and board.json are visibly the same arithmetic.

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

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by implied value. */
export const EARLY_ROWS = 220;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The model's fixed constants (the peer multiple itself is measured, never fixed). */
export const MODEL = {
  multiple_floor: 0.05,
  multiple_cap: 3,
  min_category_samples: 3,
  momentum_weight: 0.4,
  momentum_floor: -50,
  momentum_cap: 100,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 1460,
  unknown_age_days: 270,
  breadth_per_chain: 0.03,
  breadth_max_extra_chains: 5,
};

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
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    peer_samples: number;
    peer_fallback: boolean;
    momentum_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
  };
  farm_steps: string[];
}

/** The dashboard's view of one row: the board row's figures plus its farm plan. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  peer_multiple: number;
  peer_samples: number;
  peer_fallback: boolean;
  momentum_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: typeof MODEL;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
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
const bySlugOrder = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The peer multiples, measured from the snapshot: for each category, the
 * median mcap/TVL of its live-token protocols; a category with too few live
 * samples falls back to the global median. Every value is clamped.
 */
export function peerMultiples(snapshot: Snapshot): Map<string, { multiple: number; samples: number; fallback: boolean }> {
  const ratiosByCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    const key = p.category ?? 'Uncategorised';
    const list = ratiosByCategory.get(key) ?? [];
    list.push(ratio);
    ratiosByCategory.set(key, list);
    all.push(ratio);
  }
  const globalMedian = all.length > 0 ? median(all) : 0.25;
  const clamp = (v: number): number => Math.min(MODEL.multiple_cap, Math.max(MODEL.multiple_floor, v));
  const out = new Map<string, { multiple: number; samples: number; fallback: boolean }>();
  for (const [key, list] of ratiosByCategory) {
    if (list.length >= MODEL.min_category_samples) {
      out.set(key, { multiple: clamp(median(list)), samples: list.length, fallback: false });
    } else {
      out.set(key, { multiple: clamp(globalMedian), samples: all.length, fallback: true });
    }
  }
  out.set('__global__', { multiple: clamp(globalMedian), samples: all.length, fallback: true });
  return out;
}

/** The multipliers and the implied value one protocol gets under the model. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  peers: Map<string, { multiple: number; samples: number; fallback: boolean }>,
): { implied: number; peer: { multiple: number; samples: number; fallback: boolean }; momentum: number; maturity: number; breadth: number; age: number | null } {
  const peer = peers.get(p.category ?? 'Uncategorised') ?? peers.get('__global__')!;
  const pct = Math.min(MODEL.momentum_cap, Math.max(MODEL.momentum_floor, p.change_7d ?? 0));
  const momentum = 1 + (pct / 100) * MODEL.momentum_weight;
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? MODEL.unknown_age_days;
  const maturity = MODEL.maturity_floor + (Math.min(Math.max(ageForModel, 0), MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range;
  const breadth = 1 + MODEL.breadth_per_chain * Math.min(Math.max(p.chains.length - 1, 0), MODEL.breadth_max_extra_chains);
  const implied = Math.max(1, Math.round(p.tvl_usd * peer.multiple * momentum * maturity * breadth));
  return { implied, peer, momentum, maturity, breadth, age };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const peers = peerMultiples(snapshot);
  // The early radar: pre-token protocols below the floor, scored by the same
  // model and taken by implied value, never by raw TVL alone.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .map((p) => ({ p, implied: impliedValue(p, snapshot.as_of, peers).implied }))
    .sort((a, b) => b.implied - a.implied || bySlugOrder(a.p.slug, b.p.slug))
    .slice(0, EARLY_ROWS);
  for (const e of early) chosen.set(e.p.slug, e.p);

  const scored = [...chosen.values()].map((p) => ({ p, ...impliedValue(p, snapshot.as_of, peers) }));
  scored.sort((a, b) => b.implied - a.implied || bySlugOrder(a.p.slug, b.p.slug));
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
    watchlist: watch.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      peer_multiple: s.peer.multiple,
      peer_samples: s.peer.samples,
      peer_fallback: s.peer.fallback,
      momentum_multiplier: s.momentum,
      maturity_multiplier: s.maturity,
      breadth_multiplier: s.breadth,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A rough weekly gas budget by the chain a position lives on: L1 time costs more than L2 time. */
function weeklyGas(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 'about $6-10 of gas a week at ordinary fees';
  if (c === 'bitcoin' || c === 'solana') return 'about $2-4 of fees a week';
  return 'about $1-2 of gas a week on this chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  if (p.tvl_usd >= 10_000_000) return 75;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  if (age < 730) return 35;
  return 30;
}

/** The category's core action, in words a farmer can follow. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${n} on ${chain}; supplying is the activity its future distribution is most likely to count.`;
  if (c.includes('dex')) return `Provide $${capital} of liquidity to ${n}'s busiest pool on ${chain}, split evenly across the pair, and keep the LP position open.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into one of ${n}'s curated vaults on ${chain} and keep the vault shares in the same wallet.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${n}'s yield-bearing asset on ${chain} through its own app and hold the asset, not a wrapped copy.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${n}, then use the bridged funds once inside its app so both legs count.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${n} on ${chain} and keep the staking receipt unspent.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${n} and open one small hedged position so volume and open interest both register.`;
  if (c.includes('chain')) return `Bridge $${capital} to ${n}, hold it there, and make one native swap so the wallet reads as a real chain user.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${n} on ${chain} and hold it in the farming wallet.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${n} on ${chain} and keep the policy active for the full term.`;
  if (c.includes('yield') || c.includes('leveraged farm')) return `Open a $${capital} position in ${n}'s main strategy on ${chain} at the lowest leverage it offers and keep it open.`;
  if (c.includes('payment')) return `Route one real payment of about $${capital} through ${n} and keep the account active afterwards.`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} through its own app and keep the position open.`;
}

/** The category's second action: the step that separates a farmer from a one-click visitor. */
function secondAction(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow a small amount against the supply once, repay it within a week, and leave the supply in place: a borrow-and-repay is the second signal most lending distributions count.`;
  if (c.includes('dex')) return `Make two ordinary swaps a week in the same pool alongside the liquidity, so the wallet shows trading activity and not only a deposit.`;
  if (c.includes('curator') || c.includes('allocator')) return `After two weeks, move a quarter of the position into a second ${n} vault, so the wallet holds more than one of its products.`;
  if (c.includes('rwa')) return `Hold the minted asset across a full distribution or coupon date instead of selling at once: holding through a payout is the behaviour these protocols reward.`;
  if (c.includes('staking') || c.includes('restak')) return `Claim and re-stake the rewards once a month rather than selling them, and keep the streak unbroken for the whole hold.`;
  if (c.includes('chain')) return `Use one native application on ${n} each week (a swap, a name or a bridge-out and back) so the wallet keeps a weekly heartbeat on the chain.`;
  return `Repeat the core action once a month with a small top-up, so the wallet's history shows a returning user and not a single visit.`;
}

const usd = (n: number): string => `$${n.toLocaleString('en-US')}`;

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time,
 * derived from the protocol's own record (category, chains, TVL, age, 7-day
 * change), never from a hand-written list of names. Each step is written as
 * one string of 20..600 characters, the gate's shape.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const ageText = age === null ? 'an unrecorded listing date' : `${age} days on DefiLlama's record`;
  const trend = p.change_7d === null ? 'unreported' : `${p.change_7d >= 0 ? '+' : ''}${p.change_7d.toFixed(2)}% over the last 7 days`;
  const steps = [
    `Start from the record: ${p.name} holds ${usd(p.tvl_usd)} of TVL on ${chain}, has run ${ageText} with no token recorded, and its TVL trend is ${trend}; farm it only if that record still reads the same on its own page. Cost: nothing to check. Time: 10 minutes.`,
    `Use a fresh wallet that holds only the funds you plan to farm, keep its seed phrase offline, and fund it from an exchange withdrawal rather than from your main wallet. Cost: under $3 of gas for the first transaction. Time: 5 minutes.`,
    `${coreAction(p, capital, chain)} Cost: $${capital} of capital plus about $${capital >= 150 ? 8 : 4} of gas. Time: 15 minutes to set up.`,
    `${secondAction(p, chain)} Cost: ${weeklyGas(chain)}. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days so the activity is counted in more than one weekly snapshot, and keep the wallet's balance above zero the whole time. Cost: the $${capital} stays in the position. Time: ${hold} days.`,
    `Check the protocol's own points or rewards page once a week from the link its app publishes, and claim only there; never pay a third party to claim for you. Cost: no fee to check. Time: 5 minutes a week.`,
    `Keep a farm log with the wallet, the dates and every transaction hash, and review it monthly: if the protocol announces a token, the log is your proof of when you were active. Cost: nothing but the log. Time: 5 minutes a month.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || bySlugOrder(a.slug, b.slug))
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

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: MODEL,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      watchlist: r.watchlist,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      peer_multiple: r.model.peer_multiple,
      peer_samples: r.model.peer_samples,
      peer_fallback: r.model.peer_fallback,
      momentum_multiplier: r.model.momentum_multiplier,
      maturity_multiplier: r.model.maturity_multiplier,
      breadth_multiplier: r.model.breadth_multiplier,
      farm_steps: r.farm_steps,
    })),
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
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
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
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const ordered = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < ordered.length; i++) if (ordered[i]!.implied_value_usd > ordered[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
