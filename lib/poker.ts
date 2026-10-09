// No-limit Texas Hold'em engine. Pure functions: every call returns a new Game.

export type Card = string; // rank + suit, e.g. "As", "Td", "7h"
export type Action = { type: "fold" | "check" | "call" | "raise"; amount?: number }; // raise amount = total bet this street
export type Street = "preflop" | "flop" | "turn" | "river" | "done";

export type Player = {
  name: string;
  stack: number;
  bet: number; // chips in front of the player this street
  committed: number; // chips put in this hand
  cards: Card[]; // empty = sitting out this hand
  folded: boolean;
  allIn: boolean;
  acted: boolean;
  last?: string; // last action, shown on the seat
  buyIn: number; // total chips brought to the table (start + rebuys + top-offs)
  rebuys: number;
};

export type Game = {
  id: string;
  players: Player[];
  deck: Card[];
  board: Card[];
  dealer: number;
  turn: number; // seat to act, -1 when nobody is
  street: Street;
  currentBet: number;
  minRaise: number;
  sb: number;
  bb: number;
  hand: number;
  history: string[];
  winners: { seat: number; amount: number; hand: string; cards: Card[] }[]; // cards = best five at showdown, [] when everyone else folded
  swept: { street: Street; seat: number; amount: number }[]; // bets last collected into the pot (drives the chip animation)
};

const RANKS = "23456789TJQKA";
const HANDS = ["High Card", "Pair", "Two Pair", "Three of a Kind", "Straight", "Flush", "Full House", "Four of a Kind", "Straight Flush"];
const CAT = 15 ** 5;

export function newGame(names: string[], stack: number, bb: number): Game {
  return {
    id: crypto.randomUUID(),
    players: names.map((name) => ({ name, stack, bet: 0, committed: 0, cards: [], folded: true, allIn: false, acted: false, buyIn: stack, rebuys: 0 })),
    deck: [],
    board: [],
    dealer: names.length - 1,
    turn: -1,
    street: "done",
    currentBet: 0,
    minRaise: bb,
    sb: Math.max(1, Math.floor(bb / 2)),
    bb,
    hand: 0,
    history: [],
    winners: [],
    swept: [],
  };
}

function shuffledDeck(): Card[] {
  const d = [...RANKS].flatMap((r) => [..."shdc"].map((s) => r + s));
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

/** Best 5-card hand out of 2-7 cards as a comparable number (higher wins). */
export function handValue(cards: Card[]): number {
  const vals = cards.map((c) => RANKS.indexOf(c[0]) + 2);
  const counts = new Map<number, number>();
  for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]); // [value, count], biggest group first
  const uniq = [...counts.keys()].sort((a, b) => b - a);
  const kick = (n: number, ...not: number[]) => uniq.filter((v) => !not.includes(v)).slice(0, n);
  const score = (cat: number, ks: number[]) => [...ks, 0, 0, 0, 0, 0].slice(0, 5).reduce((a, k) => a * 15 + k, cat);
  const straight = (vs: number[]) => {
    const has = new Set(vs);
    if (has.has(14)) has.add(1); // wheel
    for (let hi = 14; hi >= 5; hi--) if ([0, 1, 2, 3, 4].every((k) => has.has(hi - k))) return hi;
    return 0;
  };
  const suited = [..."shdc"].map((s) => cards.filter((c) => c[1] === s)).find((f) => f.length >= 5);
  const flush = suited?.map((c) => RANKS.indexOf(c[0]) + 2).sort((a, b) => b - a);
  const [[top, topN], [second, secondN] = [0, 0]] = groups;

  if (flush && straight(flush)) return score(8, [straight(flush)]);
  if (topN === 4) return score(7, [top, ...kick(1, top)]);
  if (topN === 3 && secondN >= 2) return score(6, [top, second]);
  if (flush) return score(5, flush);
  if (straight(uniq)) return score(4, [straight(uniq)]);
  if (topN === 3) return score(3, [top, ...kick(2, top)]);
  if (topN === 2 && secondN === 2) return score(2, [top, second, ...kick(1, top, second)]);
  if (topN === 2) return score(1, [top, ...kick(3, top)]);
  return score(0, uniq);
}

export const handName = (value: number) => HANDS[Math.floor(value / CAT)];

/** The 5 cards that make the best hand out of 5-7 (tries every 5-card subset: at most 21). */
export function bestFive(cards: Card[]): Card[] {
  let best: Card[] = [];
  let bestValue = -1;
  const pick = (from: number, chosen: Card[]) => {
    if (chosen.length === 5) {
      const v = handValue(chosen);
      if (v > bestValue) {
        best = chosen;
        bestValue = v;
      }
      return;
    }
    for (let i = from; i < cards.length; i++) pick(i + 1, [...chosen, cards[i]]);
  };
  pick(0, []);
  return best;
}

const live = (p: Player) => !p.folded;
const canAct = (p: Player) => !p.folded && !p.allIn;

function next(g: Game, from: number, ok: (p: Player) => boolean) {
  const n = g.players.length;
  for (let k = 1; k <= n; k++) if (ok(g.players[(from + k) % n])) return (from + k) % n;
  return -1;
}

function put(p: Player, amount: number) {
  const a = Math.min(amount, p.stack);
  p.stack -= a;
  p.bet += a;
  p.committed += a;
  if (p.stack === 0) p.allIn = true;
  return a;
}

export function startHand(prev: Game): Game {
  const g = structuredClone(prev);
  const seated = g.players.filter((p) => p.stack > 0).length;
  if (seated < 2) return g;
  for (const p of g.players) Object.assign(p, { bet: 0, committed: 0, cards: [], folded: p.stack === 0, allIn: false, acted: false, last: undefined });
  Object.assign(g, { deck: shuffledDeck(), board: [], history: [], winners: [], swept: [], hand: g.hand + 1, street: "preflop", currentBet: g.bb, minRaise: g.bb });
  g.dealer = next(g, g.dealer, live);
  for (const p of g.players) if (live(p)) p.cards = [g.deck.pop()!, g.deck.pop()!];
  const sbSeat = seated === 2 ? g.dealer : next(g, g.dealer, live); // heads-up: dealer posts the small blind
  const bbSeat = next(g, sbSeat, live);
  for (const [seat, amount, blind] of [[sbSeat, g.sb, "small"], [bbSeat, g.bb, "big"]] as const)
    g.history.push(`preflop: ${g.players[seat].name} posts ${blind} blind ${put(g.players[seat], amount)}`);
  g.turn = bbSeat;
  return advance(g);
}

/** Seat someone new at the end of the table; they sit out until the next hand is dealt. */
export function addPlayer(prev: Game, name: string, stack: number): Game {
  const g = structuredClone(prev);
  g.players.push({ name, stack, bet: 0, committed: 0, cards: [], folded: true, allIn: false, acted: false, buyIn: stack, rebuys: 0 });
  return g;
}

/** The table as one seat may see it: no deck, and nobody else's hole cards until they show them at showdown ("" = face down). */
export function viewFor(g: Game, seat: number): Game {
  const showdown = g.street === "done" && g.players.filter(live).length > 1;
  return { ...g, deck: [], players: g.players.map((p, i) => (i === seat || (showdown && live(p)) ? p : { ...p, cards: p.cards.map(() => "") })) };
}

/** What the player to act may do. */
export function legal(g: Game) {
  const p = g.players[g.turn];
  const owe = Math.min(g.currentBet - p.bet, p.stack);
  const maxTo = p.bet + p.stack;
  const others = g.players.some((o, i) => i !== g.turn && canAct(o));
  return { owe, minTo: Math.min(g.currentBet + g.minRaise, maxTo), maxTo, canRaise: others && maxTo > g.currentBet };
}

/** Coerce any requested action into the closest legal one. */
export function legalize(g: Game, a: Action): Action {
  const { owe, minTo, maxTo, canRaise } = legal(g);
  if (a.type === "raise" && canRaise) return { type: "raise", amount: Math.round(Math.min(maxTo, Math.max(minTo, a.amount ?? minTo))) };
  if (a.type === "fold" && owe > 0) return a;
  if (a.type === "check" && owe > 0) return { type: "fold" };
  return { type: owe > 0 ? "call" : "check" };
}

/** Apply a legal action (see legalize) for the player to act. */
export function act(prev: Game, a: Action): Game {
  const g = structuredClone(prev);
  const p = g.players[g.turn];
  const before = g.currentBet;
  const paid = p.bet;
  if (a.type === "fold") p.folded = true;
  if (a.type === "call") put(p, before - p.bet);
  if (a.type === "raise") put(p, a.amount! - p.bet);
  const text = { fold: "folds", check: "checks", call: `calls ${p.bet - paid}`, raise: `${before ? "raises to" : "bets"} ${p.bet}` }[a.type];
  if (p.bet > g.currentBet) {
    // ponytail: a short all-in raise reopens betting for everyone; strict rules only let them call or fold
    g.minRaise = Math.max(g.minRaise, p.bet - g.currentBet);
    g.currentBet = p.bet;
    for (const o of g.players) o.acted = false;
  }
  p.acted = true;
  p.last = p.allIn ? "All-in" : { fold: "Fold", check: "Check", call: "Call", raise: before ? "Raise" : "Bet" }[a.type];
  g.history.push(`${g.street}: ${p.name} ${text}${p.allIn ? " (all-in)" : ""}`);
  return advance(g);
}

function advance(g: Game): Game {
  if (g.players.filter(live).length === 1) return finish(g);
  const actors = g.players.filter(canAct);
  const pending = (p: Player) => canAct(p) && (!p.acted || p.bet < g.currentBet);
  const roundOver = actors.length <= 1 ? actors.every((p) => p.bet >= g.currentBet) : !actors.some(pending);
  if (!roundOver) {
    g.turn = next(g, g.turn, pending);
    return g;
  }
  sweep(g);
  for (const p of g.players) {
    p.acted = false;
    if (canAct(p)) p.last = undefined;
  }
  g.currentBet = 0;
  g.minRaise = g.bb;
  if (g.street === "river") return finish(g);
  g.board.push(...g.deck.splice(0, g.street === "preflop" ? 3 : 1));
  g.street = g.street === "preflop" ? "flop" : g.street === "flop" ? "turn" : "river";
  g.history.push(`${g.street}: ${g.board.join(" ")}`);
  if (actors.length <= 1) return advance(g); // nobody left to bet: run out the board
  g.turn = next(g, g.dealer, canAct);
  return g;
}

/** Move this street's bets into the pot, remembering who put in what for the chip animation. */
function sweep(g: Game) {
  const bets = g.players.flatMap((p, seat) => (p.bet > 0 ? [{ street: g.street, seat, amount: p.bet }] : []));
  if (bets.length) g.swept = bets;
  for (const p of g.players) p.bet = 0;
}

function finish(g: Game): Game {
  sweep(g);
  g.street = "done";
  g.turn = -1;
  const seats = g.players.map((_, i) => i).filter((i) => live(g.players[i]));
  const won = new Map<number, number>();
  const scores = g.players.map((p) => (live(p) ? handValue([...p.cards, ...g.board]) : -1));
  if (seats.length > 1) for (const i of seats) g.history.push(`showdown: ${g.players[i].name} shows ${g.players[i].cards.join(" ")} (${handName(scores[i])})`);

  // Side pots: each distinct all-in level among live players caps a pot only those who reached it can win.
  const levels = [...new Set(seats.map((i) => g.players[i].committed))].sort((a, b) => a - b);
  let floor = 0;
  levels.forEach((level, k) => {
    const cap = k === levels.length - 1 ? Infinity : level; // last pot also sweeps up any folded overage
    const pot = g.players.reduce((s, p) => s + Math.min(p.committed, cap) - Math.min(p.committed, floor), 0);
    const eligible = seats.filter((i) => g.players[i].committed >= level);
    const best = Math.max(...eligible.map((i) => scores[i]));
    const winners = eligible.filter((i) => scores[i] === best);
    winners.forEach((i, w) => won.set(i, (won.get(i) ?? 0) + Math.floor(pot / winners.length) + (w < pot % winners.length ? 1 : 0)));
    floor = level;
  });

  const showdown = seats.length > 1;
  g.winners = [...won]
    .filter(([, amount]) => amount > 0)
    .map(([seat, amount]) => ({ seat, amount, hand: showdown ? handName(scores[seat]) : "", cards: showdown ? bestFive([...g.players[seat].cards, ...g.board]) : [] }));
  for (const w of g.winners) {
    g.players[w.seat].stack += w.amount;
    g.history.push(`${g.players[w.seat].name} wins ${w.amount}${w.hand && ` with ${w.hand}`}`);
  }
  return g;
}

// ---- AI agents ----

export const system = (name: string) =>
  `You are ${name}, an expert no-limit Texas Hold'em player at a table of AI agents. Your goal is to win as many chips as possible. Study the spot, then answer with only a JSON object.`;

/** The spot as the player to act sees it (no opponent hole cards). */
export function describe(g: Game): string {
  const seat = g.turn;
  const me = g.players[seat];
  const { owe, minTo, maxTo, canRaise } = legal(g);
  const pot = g.players.reduce((s, p) => s + p.committed, 0);
  const status = (p: Player) => (!p.cards.length ? ", sitting out" : p.folded ? ", folded" : p.allIn ? ", all-in" : "");
  return [
    `No-limit Texas Hold'em, blinds ${g.sb}/${g.bb}. Hand #${g.hand}, ${g.street}.`,
    `Your hole cards: ${me.cards.join(" ")}`,
    `Board: ${g.board.join(" ") || "(none yet)"}`,
    `Pot: ${pot}. To call: ${owe}. Your stack: ${me.stack}.`,
    `Players in seating order (action moves down the list and wraps around):`,
    ...g.players.map((p, i) => `- ${p.name}${i === seat ? " (you)" : ""}${i === g.dealer ? " [dealer]" : ""}: stack ${p.stack}, bet this round ${p.bet}${status(p)}`),
    `Action so far this hand:`,
    ...g.history,
    `Legal actions: ${owe > 0 ? `fold, call ${owe}` : "check"}${canRaise ? `, raise to any total between ${minTo} and ${maxTo} (${maxTo} = all-in)` : ""}.`,
    `Reply with only this JSON: {"action":"fold|check|call|raise","amount":<total to raise to, raise only>,"say":"<short table talk, under 12 words>"}`,
  ].join("\n");
}

export function parseReply(text: string): { action: Action; say?: string } | null {
  try {
    const j = JSON.parse([...text.matchAll(/\{[^{}]*\}/g)].at(-1)?.[0] ?? "");
    const say = typeof j.say === "string" ? j.say.slice(0, 120) : undefined;
    const type = String(j.action ?? "").toLowerCase().replace(/[^a-z]/g, "");
    if (type === "allin") return { action: { type: "raise", amount: Infinity }, say };
    const t = type === "bet" ? "raise" : type;
    if (t !== "fold" && t !== "check" && t !== "call" && t !== "raise") return null;
    return { action: { type: t, amount: Number(j.amount) || undefined }, say };
  } catch {
    return null;
  }
}

/** Fallback player for seats without a working API key. */
export function houseBot(g: Game): Action {
  // ponytail: made-hand strength + a dice roll, no draws or position; swap in an equity calc if bots need to be tougher
  const p = g.players[g.turn];
  const cat = Math.floor(handValue([...p.cards, ...g.board]) / CAT);
  const r = Math.random();
  if (cat >= 2 || (cat === 1 && r < 0.25) || r < 0.04) return { type: "raise", amount: g.currentBet + g.minRaise * (1 + Math.floor(r * 3)) };
  if (g.currentBet - p.bet <= p.stack * (cat ? 0.3 : 0.08)) return { type: "call" };
  return { type: "fold" };
}

// ---- hand history ----

export type HandRecord = {
  number: number;
  board: Card[];
  history: string[];
  players: { name: string; cards: Card[]; delta: number; stack: number }[]; // cards only when shown at showdown, or your own
  winners: { name: string; amount: number; hand: string; cards: Card[] }[];
};

/** What a finished hand looked like at the table; never the rest of the deck or cards nobody showed. */
export function handRecord(g: Game, ownSeat: number): HandRecord {
  const won = new Map(g.winners.map((w) => [w.seat, w.amount]));
  const showdown = g.players.filter(live).length > 1;
  return {
    number: g.hand,
    board: g.board,
    history: g.history,
    players: g.players.flatMap((p, i) =>
      p.cards.length ? [{ name: p.name, cards: (showdown && live(p)) || i === ownSeat ? p.cards : [], delta: (won.get(i) ?? 0) - p.committed, stack: p.stack }] : [],
    ),
    winners: g.winners.map((w) => ({ name: g.players[w.seat].name, amount: w.amount, hand: w.hand, cards: w.cards })),
  };
}
