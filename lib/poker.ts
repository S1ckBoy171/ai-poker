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

export type Winner = { seat: number; amount: number; hand: string; cards: Card[] }; // cards = best five at showdown, [] when everyone else folded

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
  winners: Winner[];
  swept: { street: Street; seat: number; amount: number }[]; // bets last collected into the pot (drives the chip animation)
};

/** What the player to act may do; amounts are totals for this street. */
export type LegalOptions = { owe: number; minTo: number; maxTo: number; canRaise: boolean };

const RANKS = "23456789TJQKA";
const SUITS = "shdc";
const BETTING_STREETS: Street[] = ["preflop", "flop", "turn", "river"];

// Hand categories, weakest first; the index is the category number inside a hand value.
const HAND_NAMES = ["High Card", "Pair", "Two Pair", "Three of a Kind", "Straight", "Flush", "Full House", "Four of a Kind", "Straight Flush"];
const CATEGORY = { highCard: 0, pair: 1, twoPair: 2, trips: 3, straight: 4, flush: 5, fullHouse: 6, quads: 7, straightFlush: 8 };
// A hand value is a base-15 number: the category, then five tie-breaking ranks.
const CATEGORY_SIZE = 15 ** 5;

function newPlayer(name: string, stack: number): Player {
  return { name, stack, bet: 0, committed: 0, cards: [], folded: true, allIn: false, acted: false, buyIn: stack, rebuys: 0 };
}

export function newGame(names: string[], stack: number, bb: number): Game {
  return {
    id: crypto.randomUUID(),
    players: names.map((name) => newPlayer(name, stack)),
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
  const deck = [...RANKS].flatMap((rank) => [...SUITS].map((suit) => rank + suit));
  // Fisher-Yates
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/** 2 for a deuce up to 14 for an ace. */
const rankValue = (card: Card) => RANKS.indexOf(card[0]) + 2;

/** The top rank of the highest five-in-a-row among these ranks (the ace also plays low), or 0 if there is none. */
function straightHigh(ranks: number[]): number {
  const present = new Set(ranks);
  if (present.has(14)) {
    present.add(1); // the wheel: A-2-3-4-5
  }
  for (let high = 14; high >= 5; high--) {
    const isRun = [0, 1, 2, 3, 4].every((offset) => present.has(high - offset));
    if (isRun) {
      return high;
    }
  }
  return 0;
}

/** Pack a category and up to five tie-breaking ranks (most important first) into one comparable number. */
function score(category: number, tieBreakers: number[]): number {
  const fiveRanks = [...tieBreakers, 0, 0, 0, 0, 0].slice(0, 5);
  return fiveRanks.reduce((value, rank) => value * 15 + rank, category);
}

/** Best 5-card hand out of 2-7 cards as a comparable number (higher wins). */
export function handValue(cards: Card[]): number {
  const countByRank = new Map<number, number>();
  for (const rank of cards.map(rankValue)) {
    countByRank.set(rank, (countByRank.get(rank) ?? 0) + 1);
  }
  // [rank, count] pairs: biggest group first, higher rank first within a size
  const groups = [...countByRank].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const distinctRanks = [...countByRank.keys()].sort((a, b) => b - a);
  const kickers = (count: number, ...used: number[]) => distinctRanks.filter((rank) => !used.includes(rank)).slice(0, count);

  const flushCards = [...SUITS].map((suit) => cards.filter((card) => card[1] === suit)).find((suited) => suited.length >= 5);
  const flushRanks = flushCards?.map(rankValue).sort((a, b) => b - a);
  const straightFlush = flushRanks ? straightHigh(flushRanks) : 0;
  const straight = straightHigh(distinctRanks);
  const [[top, topCount], [second, secondCount] = [0, 0]] = groups;

  if (straightFlush) {
    return score(CATEGORY.straightFlush, [straightFlush]);
  }
  if (topCount === 4) {
    return score(CATEGORY.quads, [top, ...kickers(1, top)]);
  }
  if (topCount === 3 && secondCount >= 2) {
    return score(CATEGORY.fullHouse, [top, second]);
  }
  if (flushRanks) {
    return score(CATEGORY.flush, flushRanks);
  }
  if (straight) {
    return score(CATEGORY.straight, [straight]);
  }
  if (topCount === 3) {
    return score(CATEGORY.trips, [top, ...kickers(2, top)]);
  }
  if (topCount === 2 && secondCount === 2) {
    return score(CATEGORY.twoPair, [top, second, ...kickers(1, top, second)]);
  }
  if (topCount === 2) {
    return score(CATEGORY.pair, [top, ...kickers(3, top)]);
  }
  return score(CATEGORY.highCard, distinctRanks);
}

const handCategory = (value: number) => Math.floor(value / CATEGORY_SIZE);

export const handName = (value: number) => HAND_NAMES[handCategory(value)];

/** The 5 cards that make the best hand out of 5-7 (tries every 5-card subset: at most 21). */
export function bestFive(cards: Card[]): Card[] {
  let best: Card[] = [];
  let bestValue = -1;
  const choose = (from: number, chosen: Card[]) => {
    if (chosen.length === 5) {
      const value = handValue(chosen);
      if (value > bestValue) {
        best = chosen;
        bestValue = value;
      }
      return;
    }
    for (let i = from; i < cards.length; i++) {
      choose(i + 1, [...chosen, cards[i]]);
    }
  };
  choose(0, []);
  return best;
}

const isInHand = (player: Player) => !player.folded;
const canAct = (player: Player) => !player.folded && !player.allIn;

const countInHand = (game: Game) => game.players.filter(isInHand).length;

/** How many players have chips to play a hand with. */
export const playersWithChips = (game: Game) => game.players.filter((player) => player.stack > 0).length;

/** All chips put in this hand, including bets not yet swept into the pot. */
export const potTotal = (game: Game) => game.players.reduce((sum, player) => sum + player.committed, 0);

/** The hand ended with more than one player still in, so their cards are shown. */
export const isShowdown = (game: Game) => game.street === "done" && countInHand(game) > 1;

/** The next seat after `from`, going round the table, whose player matches; -1 if none does. */
function nextSeat(game: Game, from: number, matches: (player: Player) => boolean): number {
  const count = game.players.length;
  for (let step = 1; step <= count; step++) {
    const seat = (from + step) % count;
    if (matches(game.players[seat])) {
      return seat;
    }
  }
  return -1;
}

/** Move chips from the player's stack into their bet, up to what they have; returns how many moved. */
function putChipsIn(player: Player, amount: number): number {
  const paid = Math.min(amount, player.stack);
  player.stack -= paid;
  player.bet += paid;
  player.committed += paid;
  if (player.stack === 0) {
    player.allIn = true;
  }
  return paid;
}

/** Take the top card. A 52-card deck always covers nine players' hole cards and the board. */
const drawCard = (game: Game): Card => game.deck.pop()!;

export function startHand(previous: Game): Game {
  const game = structuredClone(previous);
  const seated = playersWithChips(game);
  if (seated < 2) {
    return game;
  }

  for (const player of game.players) {
    player.bet = 0;
    player.committed = 0;
    player.cards = [];
    player.folded = player.stack === 0; // no chips: sits this hand out
    player.allIn = false;
    player.acted = false;
    player.last = undefined;
  }
  game.deck = shuffledDeck();
  game.board = [];
  game.history = [];
  game.winners = [];
  game.swept = [];
  game.hand += 1;
  game.street = "preflop";
  game.currentBet = game.bb;
  game.minRaise = game.bb;

  game.dealer = nextSeat(game, game.dealer, isInHand);
  for (const player of game.players) {
    if (isInHand(player)) {
      player.cards = [drawCard(game), drawCard(game)];
    }
  }

  const postBlind = (seat: number, amount: number, blind: "small" | "big") => {
    const posted = putChipsIn(game.players[seat], amount);
    game.history.push(`preflop: ${game.players[seat].name} posts ${blind} blind ${posted}`);
  };
  const smallBlindSeat = seated === 2 ? game.dealer : nextSeat(game, game.dealer, isInHand); // heads-up: the dealer posts the small blind
  const bigBlindSeat = nextSeat(game, smallBlindSeat, isInHand);
  postBlind(smallBlindSeat, game.sb, "small");
  postBlind(bigBlindSeat, game.bb, "big");
  game.turn = bigBlindSeat;
  return advance(game);
}

/** Seat someone new at the end of the table; they sit out until the next hand is dealt. */
export function addPlayer(previous: Game, name: string, stack: number): Game {
  const game = structuredClone(previous);
  game.players.push(newPlayer(name, stack));
  return game;
}

/** The table as one seat may see it: no deck, and nobody else's hole cards until they show them at showdown ("" = face down). */
export function viewFor(game: Game, seat: number): Game {
  const showdown = isShowdown(game);
  const players = game.players.map((player, i) => {
    const visible = i === seat || (showdown && isInHand(player));
    return visible ? player : { ...player, cards: player.cards.map(() => "") };
  });
  return { ...game, deck: [], players };
}

/** What the player to act may do. */
export function legal(game: Game): LegalOptions {
  const player = game.players[game.turn];
  const owe = Math.min(game.currentBet - player.bet, player.stack);
  const maxTo = player.bet + player.stack;
  const minTo = Math.min(game.currentBet + game.minRaise, maxTo);
  const opponentCanAct = game.players.some((other, seat) => seat !== game.turn && canAct(other));
  return { owe, minTo, maxTo, canRaise: opponentCanAct && maxTo > game.currentBet };
}

/** Coerce any requested action into the closest legal one. */
export function legalize(game: Game, action: Action): Action {
  const { owe, minTo, maxTo, canRaise } = legal(game);
  if (action.type === "raise" && canRaise) {
    const requested = action.amount ?? minTo;
    return { type: "raise", amount: Math.round(Math.min(maxTo, Math.max(minTo, requested))) };
  }
  if (action.type === "fold" && owe > 0) {
    return action;
  }
  if (action.type === "check" && owe > 0) {
    return { type: "fold" };
  }
  return { type: owe > 0 ? "call" : "check" };
}

/** Apply a legal action (see legalize) for the player to act. */
export function act(previous: Game, action: Action): Game {
  const game = structuredClone(previous);
  const player = game.players[game.turn];
  const tableBetBefore = game.currentBet;
  const playerBetBefore = player.bet;
  const isOpeningBet = !tableBetBefore;

  switch (action.type) {
    case "fold":
      player.folded = true;
      break;
    case "call":
      putChipsIn(player, tableBetBefore - player.bet);
      break;
    case "raise":
      putChipsIn(player, action.amount! - player.bet); // legalize always sets a raise amount
      break;
  }

  if (player.bet > game.currentBet) {
    // ponytail: a short all-in raise reopens betting for everyone; strict rules only let them call or fold
    game.minRaise = Math.max(game.minRaise, player.bet - game.currentBet);
    game.currentBet = player.bet;
    for (const other of game.players) {
      other.acted = false;
    }
  }
  player.acted = true;

  const seatLabel = { fold: "Fold", check: "Check", call: "Call", raise: isOpeningBet ? "Bet" : "Raise" }[action.type];
  player.last = player.allIn ? "All-in" : seatLabel;

  const description = {
    fold: "folds",
    check: "checks",
    call: `calls ${player.bet - playerBetBefore}`,
    raise: `${isOpeningBet ? "bets" : "raises to"} ${player.bet}`,
  }[action.type];
  const allInNote = player.allIn ? " (all-in)" : "";
  game.history.push(`${game.street}: ${player.name} ${description}${allInNote}`);
  return advance(game);
}

/** After an action: pass the turn on, or close the betting round and deal the next street (or settle the hand). */
function advance(game: Game): Game {
  if (countInHand(game) === 1) {
    return finish(game);
  }

  const actors = game.players.filter(canAct);
  const stillToAct = (player: Player) => canAct(player) && (!player.acted || player.bet < game.currentBet);
  // With one player (or none) able to bet, the round is over once nobody owes chips.
  const roundOver = actors.length <= 1 ? actors.every((player) => player.bet >= game.currentBet) : !actors.some(stillToAct);
  if (!roundOver) {
    game.turn = nextSeat(game, game.turn, stillToAct);
    return game;
  }

  sweep(game);
  for (const player of game.players) {
    player.acted = false;
    if (canAct(player)) {
      player.last = undefined;
    }
  }
  game.currentBet = 0;
  game.minRaise = game.bb;
  if (game.street === "river") {
    return finish(game);
  }

  const cardsToDeal = game.street === "preflop" ? 3 : 1;
  game.board.push(...game.deck.splice(0, cardsToDeal));
  game.street = BETTING_STREETS[BETTING_STREETS.indexOf(game.street) + 1];
  game.history.push(`${game.street}: ${game.board.join(" ")}`);
  if (actors.length <= 1) {
    return advance(game); // nobody left to bet: run out the board
  }
  game.turn = nextSeat(game, game.dealer, canAct);
  return game;
}

/** Move this street's bets into the pot, remembering who put in what for the chip animation. */
function sweep(game: Game) {
  const bets = game.players.flatMap((player, seat) => (player.bet > 0 ? [{ street: game.street, seat, amount: player.bet }] : []));
  if (bets.length) {
    game.swept = bets;
  }
  for (const player of game.players) {
    player.bet = 0;
  }
}

/**
 * Split the pot into side pots and decide who wins each. Every distinct all-in level among the players
 * still in caps a pot that only those who reached it can win; tied winners share it, odd chips going
 * to the earliest seats. Returns the chips won per seat.
 */
function splitPots(game: Game, contenders: number[], scores: number[]): Map<number, number> {
  const winnings = new Map<number, number>();
  const levels = [...new Set(contenders.map((seat) => game.players[seat].committed))].sort((a, b) => a - b);
  let floor = 0;
  levels.forEach((level, index) => {
    const isLastPot = index === levels.length - 1;
    const cap = isLastPot ? Infinity : level; // the last pot also sweeps up any folded overage
    const pot = game.players.reduce((sum, player) => sum + Math.min(player.committed, cap) - Math.min(player.committed, floor), 0);
    const eligible = contenders.filter((seat) => game.players[seat].committed >= level);
    const bestScore = Math.max(...eligible.map((seat) => scores[seat]));
    const potWinners = eligible.filter((seat) => scores[seat] === bestScore);
    const share = Math.floor(pot / potWinners.length);
    const oddChips = pot % potWinners.length;
    potWinners.forEach((seat, order) => {
      const oddChip = order < oddChips ? 1 : 0;
      winnings.set(seat, (winnings.get(seat) ?? 0) + share + oddChip);
    });
    floor = level;
  });
  return winnings;
}

/** End the hand: show down if more than one player is left, then pay every pot out. */
function finish(game: Game): Game {
  sweep(game);
  game.street = "done";
  game.turn = -1;

  const contenders = game.players.map((_, seat) => seat).filter((seat) => isInHand(game.players[seat]));
  const showdown = contenders.length > 1;
  const scores = game.players.map((player) => (isInHand(player) ? handValue([...player.cards, ...game.board]) : -1));
  if (showdown) {
    for (const seat of contenders) {
      const player = game.players[seat];
      game.history.push(`showdown: ${player.name} shows ${player.cards.join(" ")} (${handName(scores[seat])})`);
    }
  }

  const winnings = splitPots(game, contenders, scores);
  game.winners = [...winnings]
    .filter(([, amount]) => amount > 0)
    .map(([seat, amount]) => ({
      seat,
      amount,
      hand: showdown ? handName(scores[seat]) : "",
      cards: showdown ? bestFive([...game.players[seat].cards, ...game.board]) : [],
    }));
  for (const winner of game.winners) {
    const player = game.players[winner.seat];
    player.stack += winner.amount;
    const withHand = winner.hand ? ` with ${winner.hand}` : "";
    game.history.push(`${player.name} wins ${winner.amount}${withHand}`);
  }
  return game;
}

// ---- AI agents ----

export type AgentReply = { action: Action; say?: string };

export const system = (name: string) =>
  `You are ${name}, an expert no-limit Texas Hold'em player at a table of AI agents. Your goal is to win as many chips as possible. Study the spot, then answer with only a JSON object.`;

/** The spot as the player to act sees it (no opponent hole cards). */
export function describe(game: Game): string {
  const seat = game.turn;
  const me = game.players[seat];
  const { owe, minTo, maxTo, canRaise } = legal(game);

  const status = (player: Player) => {
    if (!player.cards.length) {
      return ", sitting out";
    }
    if (player.folded) {
      return ", folded";
    }
    if (player.allIn) {
      return ", all-in";
    }
    return "";
  };
  const seatLine = (player: Player, i: number) => {
    const you = i === seat ? " (you)" : "";
    const dealer = i === game.dealer ? " [dealer]" : "";
    return `- ${player.name}${you}${dealer}: stack ${player.stack}, bet this round ${player.bet}${status(player)}`;
  };
  const callOrCheck = owe > 0 ? `fold, call ${owe}` : "check";
  const raiseRange = canRaise ? `, raise to any total between ${minTo} and ${maxTo} (${maxTo} = all-in)` : "";

  return [
    `No-limit Texas Hold'em, blinds ${game.sb}/${game.bb}. Hand #${game.hand}, ${game.street}.`,
    `Your hole cards: ${me.cards.join(" ")}`,
    `Board: ${game.board.join(" ") || "(none yet)"}`,
    `Pot: ${potTotal(game)}. To call: ${owe}. Your stack: ${me.stack}.`,
    `Players in seating order (action moves down the list and wraps around):`,
    ...game.players.map(seatLine),
    `Action so far this hand:`,
    ...game.history,
    `Legal actions: ${callOrCheck}${raiseRange}.`,
    `Reply with only this JSON: {"action":"fold|check|call|raise","amount":<total to raise to, raise only>,"say":"<short table talk, under 12 words>"}`,
  ].join("\n");
}

/** Read a model's answer: the last {...} in its text, holding an action and optional table talk. Null if unusable. */
export function parseReply(text: string): AgentReply | null {
  const lastObject = [...text.matchAll(/\{[^{}]*\}/g)].at(-1)?.[0] ?? "";
  let reply: Record<string, unknown>;
  try {
    reply = JSON.parse(lastObject);
  } catch {
    return null;
  }

  const say = typeof reply.say === "string" ? reply.say.slice(0, 120) : undefined;
  const word = String(reply.action ?? "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (word === "allin") {
    return { action: { type: "raise", amount: Infinity }, say };
  }
  const type = word === "bet" ? "raise" : word;
  if (type !== "fold" && type !== "check" && type !== "call" && type !== "raise") {
    return null;
  }
  return { action: { type, amount: Number(reply.amount) || undefined }, say };
}

/** Fallback player for seats without a working API key. */
export function houseBot(game: Game): Action {
  // ponytail: made-hand strength + a dice roll, no draws or position; swap in an equity calc if bots need to be tougher
  const player = game.players[game.turn];
  const category = handCategory(handValue([...player.cards, ...game.board]));
  const roll = Math.random();

  const strongHand = category >= CATEGORY.twoPair;
  const pushesPair = category === CATEGORY.pair && roll < 0.25;
  const bluffs = roll < 0.04;
  if (strongHand || pushesPair || bluffs) {
    const minRaises = 1 + Math.floor(roll * 3);
    return { type: "raise", amount: game.currentBet + game.minRaise * minRaises };
  }

  const toCall = game.currentBet - player.bet;
  const callLimit = player.stack * (category > CATEGORY.highCard ? 0.3 : 0.08);
  if (toCall <= callLimit) {
    return { type: "call" };
  }
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
export function handRecord(game: Game, ownSeat: number): HandRecord {
  const wonBySeat = new Map(game.winners.map((winner) => [winner.seat, winner.amount]));
  const showdown = countInHand(game) > 1;
  const players = game.players.flatMap((player, seat) => {
    if (!player.cards.length) {
      return []; // sat this hand out
    }
    const shown = (showdown && isInHand(player)) || seat === ownSeat;
    const delta = (wonBySeat.get(seat) ?? 0) - player.committed;
    return [{ name: player.name, cards: shown ? player.cards : [], delta, stack: player.stack }];
  });
  return {
    number: game.hand,
    board: game.board,
    history: game.history,
    players,
    winners: game.winners.map((winner) => ({
      name: game.players[winner.seat].name,
      amount: winner.amount,
      hand: winner.hand,
      cards: winner.cards,
    })),
  };
}
