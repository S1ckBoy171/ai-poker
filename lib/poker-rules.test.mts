// Run: npm test. Checks the engine against the standard rules of no-limit Texas Hold'em: dealing, hand rankings,
// betting and pots.
// Rules the engine does not follow yet are marked `todo`: they run and report their failure without failing the suite.
import assert from "node:assert/strict";
import { describe, test, type TestContext } from "node:test";
import { act, bestFive, handName, handValue, legal, legalize, newGame, startHand, type Action, type Card, type Game, type Street } from "./poker.ts";

const FULL_DECK = [..."23456789TJQKA"].flatMap((rank) => [..."shdc"].map((suit) => rank + suit));

/** Every card the hand has touched or still holds: hole cards, board, and what is left of the deck. */
const allCards = (game: Game): Card[] => [...game.players.flatMap((p) => p.cards), ...game.board, ...game.deck];

/** Check or call until the hand reaches `street`. */
function playTo(game: Game, street: Street): Game {
  let current = game;
  while (current.street !== street && current.street !== "done") {
    current = act(current, legalize(current, { type: "call" }));
  }
  return current;
}

/**
 * Make the shuffle a no-op (Fisher-Yates swaps every card with itself), so the deck stays in factory order and the
 * top card, the one the engine draws first, is the last of FULL_DECK.
 */
function unshuffled(t: TestContext): Card[] {
  t.mock.method(Math, "random", () => 0.9999999);
  return [...FULL_DECK].reverse();
}

/** Seats in dealing order: the first seat holding cards left of the button, then on round the table. */
function dealingOrder(game: Game): number[] {
  const count = game.players.length;
  return Array.from({ length: count }, (_, step) => (game.dealer + 1 + step) % count).filter((seat) => game.players[seat].cards.length);
}

describe("the deck", () => {
  test("every hand uses one standard 52-card deck with no duplicates, at every street", () => {
    for (let hand = 0; hand < 200; hand++) {
      let game = startHand(newGame(["A", "B", "C", "D", "E", "F", "G", "H", "I"], 1000, 20));
      for (const street of ["preflop", "flop", "turn", "river"] as Street[]) {
        game = playTo(game, street);
        const cards = allCards(game);
        assert.equal(new Set(cards).size, cards.length, `${street}: no card twice`);
        assert(cards.every((card) => FULL_DECK.includes(card)), `${street}: only standard cards`);
        assert(cards.length >= 52 - 3, `${street}: nothing lost but up to three burn cards`);
      }
    }
  });

  test("each hand gets a fresh shuffle", () => {
    const decks = new Set(Array.from({ length: 50 }, () => allCards(startHand(newGame(["A", "B"], 1000, 20))).join()));
    assert.equal(decks.size, 50);
  });

  test("the shuffle is uniform: every card is equally likely in every slot", () => {
    // 52,000 deals: each card should be the button's first hole card about 1,000 times (sd ~31).
    const counts = new Map(FULL_DECK.map((card) => [card, 0]));
    const deals = 52_000;
    for (let i = 0; i < deals; i++) {
      const game = startHand(newGame(["A", "B", "C"], 1000, 20));
      const card = game.players[game.dealer].cards[0];
      counts.set(card, counts.get(card)! + 1);
    }
    const expected = deals / 52;
    let chiSquare = 0;
    for (const [card, seen] of counts) {
      assert(Math.abs(seen - expected) < 200, `${card} seen ${seen} times, expected about ${expected}`);
      chiSquare += (seen - expected) ** 2 / expected;
    }
    // 51 degrees of freedom: p < 0.0001 above ~100.
    assert(chiSquare < 100, `chi-square ${chiSquare.toFixed(1)}`);
  });
});

describe("hole cards", () => {
  test("every player with chips gets exactly two; players without chips get none", () => {
    for (let players = 2; players <= 9; players++) {
      const fresh = newGame(Array.from({ length: players }, (_, i) => `P${i}`), 1000, 20);
      fresh.players[0].stack = players > 2 ? 0 : 1000;
      const game = startHand(fresh);
      for (const player of game.players) {
        assert.equal(player.cards.length, player.stack + player.bet > 0 ? 2 : 0, `${players} players, ${player.name}`);
      }
    }
  });

  test("dealt one at a time, starting left of the button and going round twice", { todo: "poker.ts:252 deals both cards to each seat in turn, starting at seat 0" }, (t) => {
    const top = unshuffled(t);
    const game = startHand(newGame(["A", "B", "C", "D"], 1000, 20));
    const order = dealingOrder(game);
    order.forEach((seat, k) => {
      assert.deepEqual(game.players[seat].cards, [top[k], top[order.length + k]], `seat ${seat}`);
    });
  });

  test("heads-up: the big blind (left of the button) gets the first card", { todo: "poker.ts:252 starts dealing at seat 0, not left of the button" }, (t) => {
    const top = unshuffled(t);
    let game = startHand(newGame(["A", "B"], 1000, 20));
    game = startHand(playTo(game, "done")); // button now on seat 1, so seat 0 is the big blind
    assert.equal(game.dealer, 1);
    assert.deepEqual(game.players[0].cards, [top[0], top[2]]);
    assert.deepEqual(game.players[1].cards, [top[1], top[3]]);
  });
});

describe("the board", () => {
  test("no board preflop, then 3, 4 and 5 cards on the flop, turn and river", () => {
    let game = startHand(newGame(["A", "B", "C"], 1000, 20));
    assert.equal(game.board.length, 0);
    for (const [street, size] of [["flop", 3], ["turn", 4], ["river", 5]] as const) {
      game = playTo(game, street);
      assert.equal(game.street, street);
      assert.equal(game.board.length, size, street);
    }
    game = playTo(game, "done");
    assert.equal(game.board.length, 5, "a showdown sees all five");
  });

  test("an all-in preflop runs out all five board cards", () => {
    let game = startHand(newGame(["A", "B"], 1000, 20));
    game = act(game, legalize(game, { type: "raise", amount: 1000 }));
    game = act(game, legalize(game, { type: "call" }));
    assert.equal(game.street, "done");
    assert.equal(game.board.length, 5);
  });

  test("a card is burned before the flop, the turn and the river", { todo: "poker.ts:420 deals the board with no burn cards" }, (t) => {
    const top = unshuffled(t);
    let game = startHand(newGame(["A", "B", "C"], 1000, 20));
    const holes = 2 * 3;
    game = playTo(game, "river");
    assert.deepEqual(game.board, [top[holes + 1], top[holes + 2], top[holes + 3], top[holes + 5], top[holes + 7]]);
    assert.equal(game.deck.length, 52 - holes - 8, "three burns and five board cards leave the deck");
  });

  test("the board comes off the top of the same deck as the hole cards", { todo: "poker.ts:420 takes the board from the bottom of the deck; hole cards come off the top (poker.ts:223)" }, (t) => {
    const top = unshuffled(t);
    let game = startHand(newGame(["A", "B"], 1000, 20));
    game = playTo(game, "flop");
    const holes = 4;
    for (const card of game.board) {
      assert(top.indexOf(card) < holes + 8, `${card} is near the top of the deck, not the bottom`);
    }
  });
});

describe("button and blinds", () => {
  test("the button moves one seat clockwise each hand; the blinds follow it", () => {
    let game = newGame(["A", "B", "C", "D"], 1000, 20);
    for (let hand = 0; hand < 8; hand++) {
      game = startHand(game);
      assert.equal(game.dealer, hand % 4, `hand ${hand + 1}`);
      const sb = (game.dealer + 1) % 4;
      const bb = (game.dealer + 2) % 4;
      assert.equal(game.players[sb].bet, 10, "small blind left of the button");
      assert.equal(game.players[bb].bet, 20, "big blind left of the small blind");
      assert.equal(game.turn, (game.dealer + 3) % 4, "under the gun acts first preflop");
      game = playTo(game, "flop");
      assert.equal(game.turn, sb, "first seat left of the button acts first after the flop");
      game = playTo(game, "done");
    }
  });

  test("heads-up: the button posts the small blind and acts first preflop, last after the flop", () => {
    let game = newGame(["A", "B"], 1000, 20);
    for (let hand = 0; hand < 4; hand++) {
      game = startHand(game);
      const other = 1 - game.dealer;
      assert.equal(game.dealer, hand % 2);
      assert.equal(game.players[game.dealer].bet, 10);
      assert.equal(game.players[other].bet, 20);
      assert.equal(game.turn, game.dealer);
      game = playTo(game, "flop");
      assert.equal(game.turn, other);
      game = playTo(game, "done");
    }
  });

  test("players without chips are skipped by the button and the blinds", () => {
    const fresh = newGame(["A", "B", "C", "D"], 1000, 20);
    fresh.players[2].stack = 0;
    let game = startHand(fresh);
    assert.equal(game.dealer, 0);
    assert.deepEqual(game.players.map((p) => p.bet), [0, 10, 0, 20]);
    game = startHand(playTo(game, "done"));
    assert.equal(game.dealer, 1);
    assert.deepEqual(game.players.map((p) => p.bet), [20, 0, 0, 10]);
  });

  test("down to two players, the heads-up blind rules take over", () => {
    const fresh = newGame(["A", "B", "C"], 1000, 20);
    fresh.players[1].stack = 0;
    const game = startHand(fresh);
    assert.equal(game.dealer, 0);
    assert.deepEqual(game.players.map((p) => p.bet), [10, 0, 20]);
    assert.equal(game.turn, 0);
  });
});

const value = (cards: string) => handValue(cards.split(" "));

/** Apply each action, coerced to a legal one, for whoever is to act. */
const play = (game: Game, ...actions: Action[]) => actions.reduce((current, action) => act(current, legalize(current, action)), game);

/** Check it down to the river, swap in known hole cards and board, then finish the hand. */
function showdownWith(game: Game, holeCards: (string | null)[], board: string): Game {
  let current = playTo(game, "river");
  holeCards.forEach((cards, seat) => {
    if (cards) {
      current.players[seat].cards = cards.split(" ");
    }
  });
  current.board = board.split(" ");
  current = playTo(current, "done");
  return current;
}

/**
 * Rig hole cards for a hand that will be all-in before the board is out. The deck left holds only 3s, 4s and 8s in
 * mixed suits, so whichever of them the board gets, pocket aces beat kings beat queens beat 7-2.
 */
function rigAllIn(game: Game, holeCards: string[]): Game {
  holeCards.forEach((cards, seat) => (game.players[seat].cards = cards.split(" ")));
  game.deck = "3c 3d 3s 8h 8c 8d 4s 4h".split(" ");
  return game;
}

const stacks = (game: Game) => game.players.map((p) => p.stack);

describe("hand rankings", () => {
  test("each category beats the one below it", () => {
    const ladder = [
      ["High Card", "Ah Kd 9s 7c 3h 2d 4s"],
      ["Pair", "2h 2d 9s 7c 3h Kd 4s"],
      ["Two Pair", "2h 2d 3s 3c 9h Kd 4s"],
      ["Three of a Kind", "2h 2d 2s 7c 9h Kd 4s"],
      ["Straight", "Ah 2d 3s 4c 5h Kd Ks"],
      ["Flush", "2h 4h 6h 8h Th Kd Ks"],
      ["Full House", "2h 2d 2s 3c 3h Kd 4s"],
      ["Four of a Kind", "2h 2d 2s 2c 3h Kd 4s"],
      ["Straight Flush", "2h 3h 4h 5h 6h Kd Ks"],
      ["Royal Flush", "Th Jh Qh Kh Ah 2d 2s"],
    ];
    ladder.forEach(([name, cards], i) => {
      assert.equal(handName(value(cards)), name, cards);
      if (i > 0) {
        assert(value(cards) > value(ladder[i - 1][1]), `${name} beats ${ladder[i - 1][0]}`);
      }
    });
  });

  // [better, worse] pairs of seven-card hands
  const beats: [string, string, string][] = [
    ["high card: compares all five cards", "Ah Kd 9s 7c 4h 2d 3s", "Ah Kd 9s 6c 5h 2d 3s"],
    ["pair: higher pair", "3h 3d Ks Qc 9h 2d 4s", "2h 2d As Kc Qh 9d 7s"],
    ["pair: then kickers in order", "Ah Ad Ks Qc 9h 2d 4s", "Ah Ad Ks Qc 8h 2d 4s"],
    ["two pair: top pair first", "Ah Ad 2s 2c 3h 5d 7s", "Kh Kd Qs Qc Jh 5d 7s"],
    ["two pair: then bottom pair", "Ah Ad Qs Qc 3h 5d 7s", "Ah Ad Js Jc Kh 5d 7s"],
    ["two pair: a third pair can be the kicker", "Ah Ad Ks Kc Qh Qd 2s", "Ah Ad Ks Kc Jh Td 2s"],
    ["trips: higher set, then kickers", "9h 9d 9s Ac Kh 2d 3s", "9h 9d 9s Ac Qh 2d 3s"],
    ["straight: higher top card", "6h 2d 3s 4c 5h Kd Ks", "Ah 2d 3s 4c 5h Kd Ks"],
    ["straight: the ace plays high", "Th Jd Qs Kc Ah 2d 2s", "9h Td Js Qc Kh 2d 2s"],
    ["flush: compares all five suited cards", "Ah Kh 9h 7h 4h 2d 3s", "Ah Kh 9h 7h 3h 2d 5s"],
    ["flush: the best five of six suited cards", "Ah Kh 9h 7h 5h 2h 3s", "Ah Kh 9h 7h 4h 3h 2s"],
    ["full house: trips first", "3h 3d 3s 2c 2h 5d 7s", "2h 2d 2s Ac Ah 5d 7s"],
    ["full house: then the pair", "3h 3d 3s Ac Ah 5d 7s", "3h 3d 3s Kc Kh 5d 7s"],
    ["full house: two sets make the higher set over the lower", "Kh Kd Ks Qc Qh Qd 2s", "Kh Kd Ks Jc Jh Ad 2s"],
    ["quads: then the kicker", "9h 9d 9s 9c Ah 2d 3s", "9h 9d 9s 9c Kh Qd Js"],
    ["straight flush: higher top card", "3h 4h 5h 6h 7h Ad Ks", "Ah 2h 3h 4h 5h Kd Ks"],
  ];
  for (const [rule, better, worse] of beats) {
    test(rule, () => assert(value(better) > value(worse), `${better} beats ${worse}`));
  }

  const ties: [string, string, string][] = [
    ["suits never break a tie", "Ah Kd 9s 7c 4h 2d 3s", "As Kh 9d 7h 4c 2c 3d"],
    ["cards beyond the best five don't count", "Ah Ad Ks Qc Jh 3d 2s", "Ah Ad Ks Qc Jh 5d 4s"],
    ["the board plays: both hands are the board", "Th Jd Qs Kc Ah 2d 3s", "Th Jd Qs Kc Ah 4d 5s"],
    ["quads on board: the best kicker plays for both", "9h 9d 9s 9c Ah 2d 3s", "9h 9d 9s 9c Ah Kd Qs"],
  ];
  for (const [rule, a, b] of ties) {
    test(rule, () => assert.equal(value(a), value(b), `${a} ties ${b}`));
  }

  test("no wrap-around straight: Q K A 2 3 is ace high", () => {
    assert.equal(handName(value("Qh Kd As 2c 3h 7d 8s")), "High Card");
  });

  test("best five picks the cards that make the hand", () => {
    assert.deepEqual(bestFive("Ah 2d 3s 4c 5h Kd Ks".split(" ")).toSorted(), ["2d", "3s", "4c", "5h", "Ah"]);
    assert.deepEqual(bestFive("2h 4h 6h 8h Th Qh Ks".split(" ")).toSorted(), ["4h", "6h", "8h", "Qh", "Th"]);
  });
});

describe("betting", () => {
  test("preflop: the big blind gets the option when everyone just calls", () => {
    let game = startHand(newGame(["A", "B", "C"], 1000, 20)); // A button, B small blind, C big blind
    game = play(game, { type: "call" }, { type: "call" });
    assert.equal(game.street, "preflop");
    assert.equal(game.turn, 2);
    assert.deepEqual(legal(game), { owe: 0, minTo: 40, maxTo: 1000, canRaise: true });
    game = play(game, { type: "check" });
    assert.equal(game.street, "flop");
  });

  test("minimums: a bet is at least the big blind, a raise at least the last bet or raise", () => {
    let game = startHand(newGame(["A", "B", "C"], 1000, 20));
    assert.equal(legal(game).minTo, 40, "preflop: raise to at least two big blinds");
    game = play(game, { type: "raise", amount: 70 }); // a raise of 50
    assert.equal(legal(game).minTo, 120, "re-raise by at least 50");
    game = play(game, { type: "call" }, { type: "call" });
    assert.equal(game.street, "flop");
    assert.equal(legal(game).minTo, 20, "postflop: bet at least the big blind");
    game = play(game, { type: "raise", amount: 30 });
    assert.equal(legal(game).minTo, 60, "raise by at least the 30 bet");
  });

  test("a bet or raise is capped at the player's stack", () => {
    const game = startHand(newGame(["A", "B", "C"], 300, 20));
    assert.deepEqual(legalize(game, { type: "raise", amount: 5000 }), { type: "raise", amount: 300 });
    assert.deepEqual(legalize(game, { type: "raise", amount: 25 }), { type: "raise", amount: 40 }, "raised up to the minimum");
  });

  test("a check is not allowed facing a bet, and a fold is not needed when there is nothing to call", () => {
    let game = startHand(newGame(["A", "B", "C"], 1000, 20));
    assert.deepEqual(legalize(game, { type: "check" }), { type: "fold" });
    game = playTo(game, "flop");
    assert.deepEqual(legalize(game, { type: "fold" }), { type: "check" });
  });

  test("the round ends only when everyone still in has matched the bet", () => {
    let game = startHand(newGame(["A", "B", "C"], 1000, 20));
    game = playTo(game, "flop");
    game = play(game, { type: "check" }, { type: "raise", amount: 50 });
    assert.equal(game.turn, 0, "the button still has to act");
    game = play(game, { type: "call" });
    assert.equal(game.street, "flop");
    assert.equal(game.turn, 1, "the first checker has to act again");
    game = play(game, { type: "call" });
    assert.equal(game.street, "turn");
  });
});

describe("pots and showdown", () => {
  test("everyone folds: the last player wins without showing", () => {
    let game = startHand(newGame(["A", "B", "C"], 1000, 20));
    game = play(game, { type: "raise", amount: 60 }, { type: "fold" }, { type: "fold" });
    assert.equal(game.street, "done");
    assert.deepEqual(game.winners, [{ seat: 0, amount: 90, hand: "", cards: [] }]);
    assert(!game.history.some((line) => line.startsWith("showdown")));
  });

  test("an uncalled bet goes back to the player who made it", () => {
    const seated = newGame(["A", "B"], 1000, 20);
    seated.players[1].stack = 200;
    let game = rigAllIn(startHand(seated), ["7c 2d", "Ah Ad"]); // A button and small blind
    game = play(game, { type: "raise", amount: 1000 }, { type: "call" });
    assert.equal(game.street, "done");
    assert.deepEqual(stacks(game), [800, 400], "B wins only the 400 it could match");
  });

  test("three all-ins of different sizes make a main pot and two side pots", () => {
    const seated = newGame(["A", "B", "C", "D"], 1000, 20);
    [100, 200, 300, 1000].forEach((stack, i) => (seated.players[i].stack = stack));
    let game = rigAllIn(startHand(seated), ["Ah Ad", "Kh Kd", "Qh Qd", "7c 2d"]); // A button, B and C blinds, D first
    game = play(game, { type: "raise", amount: 1000 }, { type: "call" }, { type: "call" }, { type: "call" });
    assert.equal(game.street, "done");
    // Main pot 400 to A; side pot 300 (B, C, D) to B; side pot 200 (C, D) to C; D's uncalled 700 comes back.
    assert.deepEqual(stacks(game), [400, 300, 200, 700]);
  });

  test("folded players' chips stay in the pot but they cannot win it", () => {
    let game = startHand(newGame(["A", "B", "C"], 1000, 20));
    game = play(game, { type: "call" }, { type: "call" }, { type: "check" }); // 60 in the pot
    game = play(game, { type: "raise", amount: 100 }, { type: "call" }, { type: "fold" }); // B bets, C calls, A folds
    game = showdownWith(game, [null, "Ah Ad", "Kh Kd"], "2c 7d 9s Jh 3c");
    assert.deepEqual(stacks(game), [980, 1140, 880]);
    assert.deepEqual(game.winners.map((w) => w.seat), [1]);
  });

  test("a tie splits the pot evenly", () => {
    let game = startHand(newGame(["A", "B"], 1000, 20));
    game = showdownWith(game, ["2c 3d", "2d 3c"], "Ah Kh Qh Jh 9s");
    assert.deepEqual(stacks(game), [1000, 1000]);
  });
});
