// Run: npm test
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { act, legalize, newGame, startHand, type Action, type Game } from "./poker.ts";
import {
  answerSchema,
  briefing,
  checkAnswer,
  onlyMove,
  optionsText,
  rejectionMessage,
  sampleSpot,
  timeoutMove,
  turnOptions,
  type TurnOptions,
} from "./turn-rules.ts";

/** Apply each action, coerced to a legal one, for whoever is to act. */
function play(game: Game, ...actions: Action[]): Game {
  return actions.reduce((current, action) => act(current, legalize(current, action)), game);
}

/** Heads-up, blinds 10/20: A is the dealer and small blind, B the big blind, A to act and owing 10. */
const headsUp = () => startHand(newGame(["A", "B"], 1000, 20));

/** Three players where C has only 100 chips: A raises to 500, B folds, and C can only fold or call all-in. */
function shortStackFacingRaise(): Game {
  const game = newGame(["A", "B", "C"], 1000, 20);
  game.players[2].stack = 100;
  return play(startHand(game), { type: "raise", amount: 500 }, { type: "fold" });
}

const answer = (fields: Record<string, unknown>) => JSON.stringify(fields);

/** The options when facing a bet: fold, call 10, raise to 40-1000, all-in (1000). */
const facingBet = (): TurnOptions => turnOptions(headsUp());

function expectRejected(options: TurnOptions, text: string, reasonPart: string) {
  const verdict = checkAnswer(options, text);
  assert.equal(verdict.ok, false, `expected a rejection for ${text}`);
  if (!verdict.ok) {
    assert.ok(verdict.reason.includes(reasonPart), `"${verdict.reason}" should mention "${reasonPart}"`);
  }
}

describe("legal options", () => {
  test("facing a bet: fold, call, raise and all-in", () => {
    assert.deepEqual(turnOptions(headsUp()), {
      moves: ["fold", "call", "raise", "all-in"],
      callAmount: 10,
      callIsAllIn: false,
      minTo: 40,
      maxTo: 1000,
    });
  });

  test("the big blind's option preflop: check, raise and all-in", () => {
    const game = play(headsUp(), { type: "call" });
    assert.deepEqual(turnOptions(game).moves, ["check", "raise", "all-in"]);
  });

  test("nobody has bet yet: check, bet and all-in, with the big blind as the smallest bet", () => {
    const flop = play(headsUp(), { type: "call" }, { type: "check" });
    assert.equal(flop.street, "flop");
    assert.deepEqual(turnOptions(flop), {
      moves: ["check", "bet", "all-in"],
      callAmount: 0,
      callIsAllIn: false,
      minTo: 20,
      maxTo: 980,
    });
  });

  test("calling takes the whole stack: only fold or call", () => {
    const options = turnOptions(shortStackFacingRaise());
    assert.deepEqual(options.moves, ["fold", "call"]);
    assert.equal(options.callAmount, 80);
    assert.equal(options.callIsAllIn, true);
  });

  test("nobody else can act and nothing is owed: check is the only move", () => {
    const flop = play(headsUp(), { type: "call" }, { type: "check" });
    const opponent = flop.players.findIndex((_, seat) => seat !== flop.turn);
    flop.players[opponent].allIn = true;
    const options = turnOptions(flop);
    assert.deepEqual(options.moves, ["check"]);
    assert.deepEqual(onlyMove(options), { type: "check" });
  });

  test("options read as a list a model can follow", () => {
    assert.equal(optionsText(facingBet()), "fold, call 10, raise to 40-1000, all-in (1000)");
    assert.equal(optionsText(turnOptions(shortStackFacingRaise())), "fold, call 80 (all-in)");
    const flop = play(headsUp(), { type: "call" }, { type: "check" });
    assert.equal(optionsText(turnOptions(flop)), "check, bet 20-980, all-in (980)");
  });

  test("a choice of moves has no single move; out of time means check if free, else fold", () => {
    assert.equal(onlyMove(facingBet()), null);
    assert.deepEqual(timeoutMove(facingBet()), { type: "fold" });
    const flop = play(headsUp(), { type: "call" }, { type: "check" });
    assert.deepEqual(timeoutMove(turnOptions(flop)), { type: "check" });
  });
});

describe("answer format", () => {
  test("lists only this turn's legal moves and needs all three fields, nothing else", () => {
    const schema = answerSchema(facingBet()) as {
      properties: { action: { enum: string[] } };
      required: string[];
      additionalProperties: boolean;
    };
    assert.deepEqual(schema.properties.action.enum, ["fold", "call", "raise", "all-in"]);
    assert.deepEqual(schema.required, ["action", "amount", "say"]);
    assert.equal(schema.additionalProperties, false);
  });
});

describe("checking an answer", () => {
  test("accepts legal moves exactly as asked", () => {
    const options = facingBet();
    assert.deepEqual(checkAnswer(options, answer({ action: "call", amount: null, say: "I'm in" })), {
      ok: true,
      answer: { action: { type: "call" }, say: "I'm in" },
    });
    assert.deepEqual(checkAnswer(options, answer({ action: "raise", amount: 40, say: "" })), {
      ok: true,
      answer: { action: { type: "raise", amount: 40 }, say: "" },
    });
    assert.deepEqual(checkAnswer(options, answer({ action: "raise", amount: 1000, say: "" })), {
      ok: true,
      answer: { action: { type: "raise", amount: 1000 }, say: "" },
    });
    assert.deepEqual(checkAnswer(options, answer({ action: "all-in", amount: null, say: "" })), {
      ok: true,
      answer: { action: { type: "raise", amount: 1000 }, say: "" },
    });
    assert.deepEqual(checkAnswer(options, `  ${answer({ action: "fold", amount: null, say: "" })}\n`), {
      ok: true,
      answer: { action: { type: "fold" }, say: "" },
    });
  });

  test("rejects amounts out of range instead of clamping them", () => {
    const shortStack = turnOptions(shortStackFacingRaise());
    expectRejected(shortStack, answer({ action: "raise", amount: 20000, say: "" }), '"raise" is not one of your options');
    const options = facingBet();
    expectRejected(options, answer({ action: "raise", amount: 20000, say: "" }), "between 40 and 1000");
    expectRejected(options, answer({ action: "raise", amount: 30, say: "" }), "between 40 and 1000");
    expectRejected(options, answer({ action: "raise", amount: -5, say: "" }), "between 40 and 1000");
    expectRejected(options, answer({ action: "raise", amount: 40.5, say: "" }), "whole number");
    expectRejected(options, answer({ action: "raise", amount: null, say: "" }), 'needs "amount"');
    expectRejected(options, answer({ action: "raise", amount: "40", say: "" }), 'needs "amount"');
  });

  test("rejects moves that aren't legal right now", () => {
    const options = facingBet();
    expectRejected(options, answer({ action: "check", amount: null, say: "" }), "you owe 10");
    expectRejected(options, answer({ action: "bet", amount: 40, say: "" }), "raise instead");
    expectRejected(options, answer({ action: "shove", amount: null, say: "" }), '"shove" is not one of your options');
    const flop = turnOptions(play(headsUp(), { type: "call" }, { type: "check" }));
    expectRejected(flop, answer({ action: "fold", amount: null, say: "" }), "checking is free");
    expectRejected(flop, answer({ action: "raise", amount: 40, say: "" }), "bet instead");
  });

  test("rejects answers that break the format", () => {
    const options = facingBet();
    expectRejected(options, answer({ action: "call", amount: 10, say: "" }), '"amount" must be null when you call');
    expectRejected(options, answer({ action: "call", amount: null, say: "", reasoning: "x" }), '"reasoning"');
    expectRejected(options, answer({ action: "call", amount: null }), 'missing "say"');
    expectRejected(options, answer({ action: "call", amount: null, say: 7 }), '"say" must be a string');
    expectRejected(options, answer({ action: "call", amount: null, say: "x".repeat(121) }), "at most 120 characters");
    expectRejected(options, `Sure! ${answer({ action: "call", amount: null, say: "" })}`, "only the JSON object");
    expectRejected(options, '{"action":"call"', "only the JSON object");
    expectRejected(options, '["call"]', "only the JSON object");
  });

  test("a rejection repeats the reason and the options", () => {
    const message = rejectionMessage("You chose check, but you owe 10.", facingBet());
    assert.ok(message.includes("You chose check, but you owe 10."));
    assert.ok(message.includes("fold, call 10, raise to 40-1000, all-in (1000)"));
  });
});

describe("briefing", () => {
  test("covers the cards, every action so far, the turn and the options", () => {
    const game = play(headsUp(), { type: "raise", amount: 60 });
    const text = briefing(game);
    for (const line of game.history) {
      assert.ok(text.includes(line), `missing "${line}"`);
    }
    assert.ok(text.includes(`Your hole cards: ${game.players[game.turn].cards.join(" ")}`));
    assert.ok(text.includes("It is your turn to act now."));
    assert.ok(text.includes("Your options: fold, call 40, raise to 100-1000, all-in (1000)."));
    assert.ok(text.includes('"action": one of "fold", "call", "raise", "all-in"'));
  });
});

describe("sample hands", () => {
  test("always stop with the agent to act in a running hand", () => {
    for (let run = 0; run < 200; run++) {
      const game = sampleSpot("My Agent");
      assert.notEqual(game.street, "done");
      assert.equal(game.players[game.turn].name, "My Agent");
      assert.equal(game.players[game.turn].cards.length, 2);
    }
  });

  test("never give an opponent the agent's name", () => {
    const game = sampleSpot("Ana");
    assert.equal(game.players.filter((player) => player.name === "Ana").length, 1);
  });
});
