// Strict turns for player-built agents: exactly which moves are legal, the briefing the agent gets, the answer
// format it must use, and the check every answer goes through. Nothing is repaired: an answer is legal or rejected.
import { act, houseBot, legal, legalize, newGame, startHand, tableLines, type Action, type Game, type Street } from "./poker.ts";

export type MoveName = "fold" | "check" | "call" | "bet" | "raise" | "all-in";

/** What the player to act may do. Amounts are totals for this betting round, as in the engine. */
export type TurnOptions = {
  moves: MoveName[];
  callAmount: number; // chips owed to stay in the hand; 0 when nothing is owed
  callIsAllIn: boolean; // calling takes the whole stack
  minTo: number; // the smallest total for a bet or raise
  maxTo: number; // the largest total: all-in
};

export type Answer = { action: Action; say: string };
export type Verdict = { ok: true; answer: Answer } | { ok: false; reason: string };

const ANSWER_FIELDS = ["action", "amount", "say"];
const MAX_SAY_LENGTH = 120;
const ONLY_THE_OBJECT = "Your answer must be only the JSON object, with nothing before or after it.";

const SAMPLE_OPPONENTS = ["Ana", "Ben", "Cleo", "Dev", "Eli"];
const SAMPLE_PLAYERS = 5;
const SAMPLE_STACK = 1000;
const SAMPLE_BIG_BLIND = 20;
const SAMPLE_STREETS: Street[] = ["preflop", "flop", "turn", "river"];
const SAMPLE_DEALS = 20;
const FIRST_TO_ACT_PREFLOP = 3; // with the dealer button on seat 0: small blind 1, big blind 2, then seat 3

const takesAmount = (move: MoveName) => move === "bet" || move === "raise";

const isLegalMove = (options: TurnOptions, value: unknown): value is MoveName => options.moves.some((move) => move === value);

export function turnOptions(game: Game): TurnOptions {
  const player = game.players[game.turn];
  const { owe, minTo, maxTo, canRaise } = legal(game);

  const moves: MoveName[] = [];
  if (owe > 0) {
    moves.push("fold", "call");
  } else {
    moves.push("check");
  }
  if (canRaise) {
    const nobodyHasBet = game.currentBet === 0;
    moves.push(nobodyHasBet ? "bet" : "raise", "all-in");
  }

  return { moves, callAmount: owe, callIsAllIn: owe > 0 && owe >= player.stack, minTo, maxTo };
}

/** The options as a list a model can follow, e.g. "fold, call 10, raise to 40-1000, all-in (1000)". */
export function optionsText(options: TurnOptions): string {
  return options.moves.map((move) => moveText(move, options)).join(", ");
}

function moveText(move: MoveName, options: TurnOptions): string {
  const range = options.minTo === options.maxTo ? `${options.maxTo}` : `${options.minTo}-${options.maxTo}`;
  switch (move) {
    case "call":
      return options.callIsAllIn ? `call ${options.callAmount} (all-in)` : `call ${options.callAmount}`;
    case "bet":
      return `bet ${range}`;
    case "raise":
      return `raise to ${range}`;
    case "all-in":
      return `all-in (${options.maxTo})`;
    default:
      return move;
  }
}

/**
 * The JSON schema the provider enforces while the model writes, where it supports one. Number ranges and the
 * table-talk length are only described: providers don't reliably enforce them, so `checkAnswer` does.
 */
export function answerSchema(options: TurnOptions): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      action: { type: "string", enum: options.moves },
      amount: {
        anyOf: [{ type: "integer" }, { type: "null" }],
        description: `For bet or raise: the total to put in this round, ${options.minTo} to ${options.maxTo}. Otherwise null.`,
      },
      say: { type: "string", description: `Short table talk, at most ${MAX_SAY_LENGTH} characters, or "" to stay quiet.` },
    },
    required: ANSWER_FIELDS,
    additionalProperties: false,
  };
}

/** Accept an answer only if it is exactly one legal move in the required format; otherwise say what is wrong. */
export function checkAnswer(options: TurnOptions, text: string): Verdict {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    return reject(ONLY_THE_OBJECT);
  }
  const isObject = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  if (!isObject) {
    return reject(ONLY_THE_OBJECT);
  }

  const fields = parsed as Record<string, unknown>;
  const extraField = Object.keys(fields).find((field) => !ANSWER_FIELDS.includes(field));
  if (extraField) {
    return reject(`Your answer has a field "${extraField}"; use only "action", "amount" and "say".`);
  }
  const missingField = ANSWER_FIELDS.find((field) => !(field in fields));
  if (missingField) {
    return reject(`Your answer is missing "${missingField}".`);
  }

  const { action, amount, say } = fields;
  if (typeof say !== "string") {
    return reject('"say" must be a string; use "" to stay quiet.');
  }
  if (say.length > MAX_SAY_LENGTH) {
    return reject(`"say" must be at most ${MAX_SAY_LENGTH} characters; yours has ${say.length}.`);
  }
  if (!isLegalMove(options, action)) {
    return reject(illegalMoveReason(action, options));
  }

  if (takesAmount(action)) {
    return checkAmount(action, amount, options, say);
  }
  if (amount !== null) {
    return reject(`"amount" must be null when you ${action}.`);
  }
  return accept(moveAction(action, options), say);
}

function illegalMoveReason(action: unknown, options: TurnOptions): string {
  if (action === "check" && options.callAmount > 0) {
    return `You chose check, but you owe ${options.callAmount}.`;
  }
  if (action === "fold" && options.callAmount === 0) {
    return "You chose fold, but checking is free, so folding is not an option.";
  }
  if (action === "raise" && options.moves.includes("bet")) {
    return '"raise" is not an option: nobody has bet this round, so bet instead.';
  }
  if (action === "bet" && options.moves.includes("raise")) {
    return '"bet" is not an option: there is already a bet this round, so raise instead.';
  }
  return `"${String(action)}" is not one of your options.`;
}

function checkAmount(move: MoveName, amount: unknown, options: TurnOptions, say: string): Verdict {
  if (typeof amount !== "number") {
    return reject(`A ${move} needs "amount": the total to put in this round, as a number.`);
  }
  if (!Number.isInteger(amount)) {
    return reject(`"amount" must be a whole number; you sent ${amount}.`);
  }
  const inRange = amount >= options.minTo && amount <= options.maxTo;
  if (!inRange) {
    return reject(`You chose to ${move} ${amount}, but the amount must be between ${options.minTo} and ${options.maxTo}.`);
  }
  return accept({ type: "raise", amount }, say);
}

/** The engine action for a move that needs no amount. All-in is a raise to the most this player can bet. */
function moveAction(move: MoveName, options: TurnOptions): Action {
  if (move === "all-in") {
    return { type: "raise", amount: options.maxTo };
  }
  if (move === "fold" || move === "check" || move === "call") {
    return { type: move };
  }
  throw new Error(`${move} needs an amount`);
}

const accept = (action: Action, say: string): Verdict => ({ ok: true, answer: { action, say } });

const reject = (reason: string): Verdict => ({ ok: false, reason });

/** What the agent is told after a rejected answer. */
export function rejectionMessage(reason: string, options: TurnOptions): string {
  return `Rejected: ${reason} Your options: ${optionsText(options)}. Answer again with only the JSON object in the required format.`;
}

/** Everything the agent is told on its turn: the table, that it is its turn, its options and the answer format. */
export function briefing(game: Game): string {
  const options = turnOptions(game);
  return [...tableLines(game), "It is your turn to act now.", `Your options: ${optionsText(options)}.`, answerFormatText(options)].join("\n");
}

function answerFormatText(options: TurnOptions): string {
  const moves = options.moves.map((move) => `"${move}"`).join(", ");
  const canBetOrRaise = options.moves.some(takesAmount);
  const amount = canBetOrRaise
    ? `the total to put in this round (${options.minTo} to ${options.maxTo}) as a whole number for bet or raise, otherwise null`
    : "null";
  return `Answer with only this JSON object: {"action": one of ${moves}, "amount": ${amount}, "say": short table talk (at most ${MAX_SAY_LENGTH} characters, or "")}`;
}

/** The move to make without asking the model, when only one is legal (a check nobody can bet against). */
export function onlyMove(options: TurnOptions): Action | null {
  if (options.moves.length !== 1) {
    return null;
  }
  return moveAction(options.moves[0], options);
}

/** When the agent runs out of time or attempts: check if checking is free, otherwise fold. */
export function timeoutMove(options: TurnOptions): Action {
  return options.callAmount === 0 ? { type: "check" } : { type: "fold" };
}

/**
 * A random spot for testing an agent: five players, the agent in a random seat, house bots playing every seat
 * until a randomly chosen street is reached with the agent to act. If no deal gets there, the agent opens a
 * fresh hand preflop (the first seat to act), which always works.
 */
export function sampleSpot(agentName: string): Game {
  const opponents = SAMPLE_OPPONENTS.filter((name) => name !== agentName).slice(0, SAMPLE_PLAYERS - 1);
  const randomSeat = Math.floor(Math.random() * SAMPLE_PLAYERS);

  for (let deal = 0; deal < SAMPLE_DEALS; deal++) {
    const targetStreet = SAMPLE_STREETS[Math.floor(Math.random() * SAMPLE_STREETS.length)];
    let game = dealSample(opponents, agentName, randomSeat);
    while (game.street !== "done") {
      const agentToAct = game.turn === randomSeat;
      if (agentToAct && game.street === targetStreet) {
        return game;
      }
      game = act(game, legalize(game, houseBot(game)));
    }
  }
  return dealSample(opponents, agentName, FIRST_TO_ACT_PREFLOP);
}

function dealSample(opponents: string[], agentName: string, agentSeat: number): Game {
  const names = [...opponents];
  names.splice(agentSeat, 0, agentName);
  return startHand(newGame(names, SAMPLE_STACK, SAMPLE_BIG_BLIND));
}
