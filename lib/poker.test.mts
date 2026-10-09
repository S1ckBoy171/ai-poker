// Run: npm test (Node's built-in test runner, no framework)
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  act,
  addPlayer,
  bestFive,
  describe as describeSpot,
  handName,
  handRecord,
  handValue,
  houseBot,
  legal,
  legalize,
  newGame,
  parseReply,
  startHand,
  system,
  viewFor,
  type Action,
  type Game,
} from "./poker.ts";

const value = (cards: string) => handValue(cards.split(" "));

/** Apply each action, coerced to a legal one, for whoever is to act. */
function play(game: Game, ...actions: Action[]): Game {
  return actions.reduce((current, action) => act(current, legalize(current, action)), game);
}

/** Check or call until the hand is over. */
function checkDown(game: Game): Game {
  let current = game;
  while (current.street !== "done") {
    current = play(current, { type: "call" });
  }
  return current;
}

/** Deal a hand, then swap in known hole cards and the next board cards. */
function rigHand(game: Game, holeCards: string[], board: string): Game {
  const dealt = startHand(game);
  holeCards.forEach((cards, seat) => {
    dealt.players[seat].cards = cards.split(" ");
  });
  dealt.deck = board.split(" ");
  return dealt;
}

const totalChips = (game: Game) => game.players.reduce((sum, player) => sum + player.stack, 0);

describe("hand values", () => {
  test("categories, kickers, the wheel and board-plays rank in order", () => {
    const ladder = [
      "Ah 2h 3h 4h 5h Kd Kc", // steel wheel
      "9h 9d 9s 9c Kd 2c 3d",
      "Th Td Ts 4c 4d",
      "2h 7h 9h Jh Kh 2c 2d",
      "5c 6d 7h 8s 9c",
      "Ac 2d 3h 4s 5c",
      "Ah Ad As 4c 9d",
      "Kh Kd 4s 4c Ad",
      "Ah Ad Kc 7s 3d",
      "Ah Ad Qc Js Td",
      "Ah Kd 9c 7s 3d",
    ];
    ladder.slice(1).forEach((hand, i) => assert(value(ladder[i]) > value(hand), `${ladder[i]} should beat ${hand}`));
  });

  test("only the best five cards count", () => {
    assert.equal(value("9h 9d 9s 9c Kd 2c 3d"), value("9h 9d 9s 9c Kd 4c 5d"), "quads use one kicker");
    assert.equal(value("Ah Ad Kh Kd Qh Qd 2c"), value("Ah Ad Kh Kd Qs 2c 3c"), "three pairs: best two + kicker");
    assert.equal(value("Ah Ad Ac Ks Kd 2c 2h"), value("Ah Ad Ac Ks Kd 3c 3h"), "full house ignores extra pair");
  });

  test("best five picks the cards that make the hand", () => {
    assert.deepEqual(bestFive("Ah 2h 3h 4h 5h Kd Kc".split(" ")).sort(), ["2h", "3h", "4h", "5h", "Ah"]);
  });

  test("hand names", () => {
    assert.equal(handName(value("Ah 2h 3h 4h 5h Kd Kc")), "Straight Flush");
    assert.equal(handName(value("Th Td Ts 4c 4d")), "Full House");
    assert.equal(handName(value("Kh Kd 4s 4c Ad")), "Two Pair");
    assert.equal(handName(value("Ah Kd 9c 7s 3d")), "High Card");
  });
});

describe("dealing", () => {
  test("heads-up: the dealer posts the small blind and acts first, then last after the flop", () => {
    let game = startHand(newGame(["A", "B"], 1000, 20));
    assert.equal(game.hand, 1);
    assert.equal(game.street, "preflop");
    assert.equal(game.dealer, 0);
    assert.deepEqual(
      game.players.map((p) => p.bet),
      [10, 20],
    );
    assert.deepEqual(game.history, ["preflop: A posts small blind 10", "preflop: B posts big blind 20"]);
    assert.equal(game.turn, 0);
    assert.equal(game.deck.length, 48);
    assert(game.players.every((p) => p.cards.length === 2));

    game = play(game, { type: "call" }, { type: "check" });
    assert.equal(game.street, "flop");
    assert.equal(game.board.length, 3);
    assert.equal(game.turn, 1);
    assert.equal(game.history.at(-1), `flop: ${game.board.join(" ")}`);
  });

  test("three players: blinds sit left of the button and the button moves each hand", () => {
    let game = startHand(newGame(["A", "B", "C"], 1000, 20));
    assert.equal(game.dealer, 0);
    assert.deepEqual(
      game.players.map((p) => p.bet),
      [0, 10, 20],
    );
    assert.equal(game.turn, 0);

    game = play(game, { type: "fold" }, { type: "fold" });
    assert.equal(game.street, "done");
    assert.equal(game.turn, -1);
    assert.deepEqual(game.winners, [{ seat: 2, amount: 30, hand: "", cards: [] }]);
    assert.deepEqual(
      game.players.map((p) => p.stack),
      [1000, 990, 1010],
    );
    assert.equal(game.history.at(-1), "C wins 30");
    assert(!game.history.some((line) => line.startsWith("showdown")), "no showdown when everyone else folds");

    const next = startHand(game);
    assert.equal(next.hand, 2);
    assert.equal(next.dealer, 1);
    assert.deepEqual(
      next.players.map((p) => p.bet),
      [20, 0, 10],
    );
    assert.equal(next.turn, 1);
  });

  test("players without chips sit out and the button skips them", () => {
    const game = newGame(["A", "B", "C"], 1000, 20);
    game.players[1].stack = 0;
    const dealt = startHand(game);
    assert.equal(dealt.dealer, 0);
    assert.deepEqual(dealt.players[1].cards, []);
    assert.deepEqual(
      dealt.players.map((p) => p.bet),
      [10, 0, 20],
    );
    assert.equal(dealt.turn, 0);
  });

  test("no hand is dealt with fewer than two players holding chips", () => {
    const game = newGame(["A", "B"], 1000, 20);
    game.players[1].stack = 0;
    const same = startHand(game);
    assert.equal(same.street, "done");
    assert.equal(same.hand, 0);
    assert(same.players.every((p) => p.cards.length === 0));
  });

  test("a late joiner sits out until the next deal", () => {
    let game = startHand(newGame(["a", "b", "c"], 500, 20));
    game = addPlayer(game, "late", 500);
    assert.equal(game.players[3].name, "late");
    assert.equal(game.players[3].stack, 500);
    assert.equal(game.players[3].buyIn, 500);
    assert.equal(game.players[3].cards.length, 0);
    while (game.street !== "done") {
      game = play(game, { type: "fold" });
    }
    assert.equal(startHand(game).players[3].cards.length, 2, "late joiner dealt in next hand");
  });
});

describe("legal actions", () => {
  test("facing the big blind: a check becomes a fold and raises are clamped", () => {
    const game = startHand(newGame(["A", "B"], 1000, 20));
    assert.deepEqual(legal(game), { owe: 10, minTo: 40, maxTo: 1000, canRaise: true });
    assert.deepEqual(legalize(game, { type: "check" }), { type: "fold" });
    assert.deepEqual(legalize(game, { type: "fold" }), { type: "fold" });
    assert.deepEqual(legalize(game, { type: "call" }), { type: "call" });
    assert.deepEqual(legalize(game, { type: "raise", amount: 25 }), { type: "raise", amount: 40 });
    assert.deepEqual(legalize(game, { type: "raise", amount: 5000 }), { type: "raise", amount: 1000 });
    assert.deepEqual(legalize(game, { type: "raise" }), { type: "raise", amount: 40 });
    assert.deepEqual(legalize(game, { type: "raise", amount: 55.4 }), { type: "raise", amount: 55 });
  });

  test("nothing to call: a fold or call becomes a check", () => {
    const game = play(startHand(newGame(["A", "B"], 1000, 20)), { type: "call" });
    assert.deepEqual(legal(game), { owe: 0, minTo: 40, maxTo: 1000, canRaise: true });
    assert.deepEqual(legalize(game, { type: "fold" }), { type: "check" });
    assert.deepEqual(legalize(game, { type: "call" }), { type: "check" });
    assert.deepEqual(legalize(game, { type: "check" }), { type: "check" });
  });

  test("no raising when every opponent is all-in", () => {
    const game = play(startHand(newGame(["A", "B"], 1000, 20)), { type: "raise", amount: 1000 });
    assert.deepEqual(legal(game), { owe: 980, minTo: 1000, maxTo: 1000, canRaise: false });
    assert.deepEqual(legalize(game, { type: "raise", amount: 1000 }), { type: "call" });
  });
});

describe("betting", () => {
  test("history lines and seat labels for each kind of action", () => {
    let game = startHand(newGame(["A", "B"], 1000, 20));

    game = play(game, { type: "call" });
    assert.equal(game.history.at(-1), "preflop: A calls 10");
    assert.equal(game.players[0].last, "Call");

    game = play(game, { type: "raise", amount: 60 });
    assert.equal(game.history.at(-1), "preflop: B raises to 60");
    assert.equal(game.players[1].last, "Raise");
    assert.equal(game.currentBet, 60);
    assert.equal(game.minRaise, 40);

    game = play(game, { type: "call" });
    assert(game.history.includes("preflop: A calls 40"));
    assert.equal(game.street, "flop");
    assert.equal(game.currentBet, 0);
    assert.equal(game.minRaise, 20);
    assert.deepEqual(
      game.players.map((p) => p.last),
      [undefined, undefined],
      "labels clear when a street ends",
    );
    assert.deepEqual(game.swept, [
      { street: "preflop", seat: 0, amount: 60 },
      { street: "preflop", seat: 1, amount: 60 },
    ]);

    game = play(game, { type: "raise", amount: 100 });
    assert.equal(game.history.at(-1), "flop: B bets 100");
    assert.equal(game.players[1].last, "Bet");
    assert.equal(game.minRaise, 100);

    game = play(game, { type: "raise", amount: 5000 });
    assert.equal(game.history.at(-1), "flop: A raises to 940 (all-in)");
    assert.equal(game.players[0].last, "All-in");
    assert.equal(game.players[0].allIn, true);
  });

  test("when nobody can bet any more, the board runs out to a showdown", () => {
    let game = startHand(newGame(["A", "B"], 1000, 20));
    game = play(game, { type: "raise", amount: 1000 }, { type: "call" });
    assert.equal(game.street, "done");
    assert.equal(game.board.length, 5);
    for (const street of ["flop", "turn", "river"]) {
      assert(game.history.some((line) => line.startsWith(`${street}: `)), `${street} dealt`);
    }
    assert(game.history.includes(`preflop: B calls 980 (all-in)`));
    assert.equal(game.history.filter((line) => line.startsWith("showdown: ")).length, 2);
    assert.equal(totalChips(game), 2000);
  });
});

describe("pots", () => {
  test("side pot: the short stack wins the main pot, the middle stack the side pot", () => {
    let game: Game = newGame(["A", "B", "C"], 0, 20);
    [100, 300, 300].forEach((stack, i) => (game.players[i].stack = stack));
    game = rigHand(game, ["Ah Ad", "Kh Kd", "Qh Qd"], "2c 7d 9s Jh 3c"); // dealer A, B posts 10, C posts 20, A to act
    game = play(game, { type: "raise", amount: 100 }, { type: "raise", amount: 300 }, { type: "call" });
    assert.equal(game.street, "done");
    assert.deepEqual(
      game.players.map((p) => p.stack),
      [300, 400, 0],
    );
    assert.deepEqual(
      game.winners.map((w) => w.hand),
      ["Pair", "Pair"],
    );
    assert.deepEqual(
      game.swept.map((s) => s.amount),
      [100, 300, 300],
      "preflop bets swept into the pot",
    );
  });

  test("a split pot shares the odd chip out by seat order", () => {
    let game = rigHand(newGame(["A", "B", "C"], 1000, 22), ["2c 3d", "4c 5d", "2d 3c"], "Ah Kh Qh Jh Th");
    game = play(game, { type: "call" }, { type: "fold" });
    game = checkDown(game);

    assert.deepEqual(
      game.winners.map((w) => [w.seat, w.amount, w.hand]),
      [
        [0, 28, "Straight Flush"],
        [2, 27, "Straight Flush"],
      ],
    );
    for (const winner of game.winners) {
      assert.deepEqual(winner.cards.toSorted(), ["Ah", "Jh", "Kh", "Qh", "Th"]);
    }
    assert.deepEqual(
      game.players.map((p) => p.stack),
      [1006, 989, 1005],
    );
    assert.deepEqual(game.history.slice(-4), [
      "showdown: A shows 2c 3d (Straight Flush)",
      "showdown: C shows 2d 3c (Straight Flush)",
      "A wins 28 with Straight Flush",
      "C wins 27 with Straight Flush",
    ]);
  });

  test("random play never creates or loses chips and always terminates", () => {
    const types = ["fold", "check", "call", "raise"] as const;
    for (let n = 0; n < 3000; n++) {
      let game = newGame(["a", "b", "c", "d", "e", "f"].slice(0, 2 + (n % 5)), 0, 20);
      for (const player of game.players) {
        player.stack = 1 + Math.floor(Math.random() * 600);
      }
      const total = totalChips(game);
      game = startHand(game);
      for (let steps = 0; game.street !== "done"; steps++) {
        assert(steps < 500, "hand did not terminate");
        const type = types[Math.floor(Math.random() * 4)];
        game = play(game, { type, amount: Math.floor(Math.random() * 700) });
      }
      assert.equal(totalChips(game), total, "chips not conserved");
      for (const winner of game.winners) {
        if (winner.cards.length) {
          const best = handValue([...game.players[winner.seat].cards, ...game.board]);
          assert.equal(handValue(winner.cards), best, "winning five = best hand");
        }
      }
    }
  });
});

describe("what each seat sees", () => {
  test("mid-hand: no deck, and other players' hole cards face down", () => {
    const game = startHand(newGame(["a", "b", "c"], 500, 20));
    const seen = viewFor(game, 1);
    assert.equal(seen.deck.length, 0);
    assert.deepEqual(seen.players[1].cards, game.players[1].cards);
    assert.deepEqual(seen.players[0].cards, ["", ""]);
    assert.deepEqual(seen.players[2].cards, ["", ""]);
  });

  test("at showdown the hands still in are shown; folded hands stay hidden", () => {
    let game = rigHand(newGame(["A", "B", "C"], 1000, 22), ["2c 3d", "4c 5d", "2d 3c"], "Ah Kh Qh Jh Th");
    game = checkDown(play(game, { type: "call" }, { type: "fold" }));
    const seen = viewFor(game, 0);
    assert.deepEqual(seen.players[0].cards, ["2c", "3d"]);
    assert.deepEqual(seen.players[1].cards, ["", ""]);
    assert.deepEqual(seen.players[2].cards, ["2d", "3c"]);
  });

  test("hand record after a showdown: shown cards, your own cards, and each player's net", () => {
    let game = rigHand(newGame(["A", "B", "C"], 1000, 22), ["2c 3d", "4c 5d", "2d 3c"], "Ah Kh Qh Jh Th");
    game = checkDown(play(game, { type: "call" }, { type: "fold" }));
    const record = handRecord(game, 1);
    assert.equal(record.number, 1);
    assert.deepEqual(record.board, ["Ah", "Kh", "Qh", "Jh", "Th"]);
    assert.deepEqual(record.history, game.history);
    assert.deepEqual(record.players, [
      { name: "A", cards: ["2c", "3d"], delta: 6, stack: 1006 },
      { name: "B", cards: ["4c", "5d"], delta: -11, stack: 989 },
      { name: "C", cards: ["2d", "3c"], delta: 5, stack: 1005 },
    ]);
    assert.deepEqual(
      record.winners.map((w) => [w.name, w.amount, w.hand]),
      [
        ["A", 28, "Straight Flush"],
        ["C", 27, "Straight Flush"],
      ],
    );
  });

  test("hand record without a showdown hides everything but your own cards and skips seats sitting out", () => {
    let game = newGame(["A", "B", "C"], 1000, 20);
    game.players[1].stack = 0;
    game = play(startHand(game), { type: "fold" });
    const record = handRecord(game, 0);
    assert.deepEqual(
      record.players.map((p) => p.name),
      ["A", "C"],
    );
    assert.deepEqual(record.players[0].cards, game.players[0].cards);
    assert.deepEqual(record.players[1].cards, []);
    assert.deepEqual(
      record.players.map((p) => p.delta),
      [-10, 10],
    );
    assert.deepEqual(handRecord(game, -1).players[0].cards, []);
  });
});

describe("AI prompts and replies", () => {
  test("the system prompt names the agent", () => {
    assert.equal(
      system("Opus"),
      "You are Opus, an expert no-limit Texas Hold'em player at a table of AI agents. Your goal is to win as many chips as possible. Study the spot, then answer with only a JSON object.",
    );
  });

  test("the spot is described from the seat to act", () => {
    const game = rigHand(newGame(["A", "B"], 1000, 20), ["Ah Ad", "Kc Kd"], "2c 7d 9s Jh 3c");
    assert.equal(
      describeSpot(game),
      [
        "No-limit Texas Hold'em, blinds 10/20. Hand #1, preflop.",
        "Your hole cards: Ah Ad",
        "Board: (none yet)",
        "Pot: 30. To call: 10. Your stack: 990.",
        "Players in seating order (action moves down the list and wraps around):",
        "- A (you) [dealer]: stack 990, bet this round 10",
        "- B: stack 980, bet this round 20",
        "Action so far this hand:",
        "preflop: A posts small blind 10",
        "preflop: B posts big blind 20",
        "Legal actions: fold, call 10, raise to any total between 40 and 1000 (1000 = all-in).",
        'Reply with only this JSON: {"action":"fold|check|call|raise","amount":<total to raise to, raise only>,"say":"<short table talk, under 12 words>"}',
      ].join("\n"),
    );
  });

  test("the spot lists checks, the board, and who is all-in, folded or sitting out", () => {
    let game = newGame(["A", "B", "C", "D"], 1000, 20);
    game.players[3].stack = 0;
    game = rigHand(game, ["Ah Ad", "Kc Kd", "Qc Qd"], "2c 7d 9s Jh 3c");
    game = play(game, { type: "raise", amount: 1000 }, { type: "fold" });
    const prompt = describeSpot(game);
    assert(prompt.includes("- A [dealer]: stack 0, bet this round 1000, all-in"), prompt);
    assert(prompt.includes("- B: stack 990, bet this round 10, folded"), prompt);
    assert(prompt.includes("- C (you): stack 980, bet this round 20"), prompt);
    assert(prompt.includes("- D: stack 0, bet this round 0, sitting out"), prompt);
    assert(prompt.includes("Legal actions: fold, call 980."), prompt);

    const flop = play(startHand(newGame(["A", "B"], 1000, 20)), { type: "call" }, { type: "check" });
    const flopPrompt = describeSpot(flop);
    assert(flopPrompt.includes(`Board: ${flop.board.join(" ")}`), flopPrompt);
    assert(flopPrompt.includes("Legal actions: check, raise to any total between 20 and 980 (980 = all-in)."), flopPrompt);
  });

  test("replies are read from the last JSON object in the text", () => {
    const read = (text: string) => {
      const reply = parseReply(text);
      return reply && { type: reply.action.type, amount: reply.action.amount, say: reply.say };
    };
    assert.deepEqual(read('{"action":"call"}'), { type: "call", amount: undefined, say: undefined });
    assert.deepEqual(read('Thinking... {"action":"Raise","amount":120,"say":"hi"}'), { type: "raise", amount: 120, say: "hi" });
    assert.deepEqual(read('{"action":"bet","amount":"80"}'), { type: "raise", amount: 80, say: undefined });
    assert.deepEqual(read('{"action":"all-in"}'), { type: "raise", amount: Infinity, say: undefined });
    assert.deepEqual(read('{"action":"ALL IN","say":"ship it"}'), { type: "raise", amount: Infinity, say: "ship it" });
    assert.deepEqual(read('{"action":"fold"} no wait {"action":"check"}'), { type: "check", amount: undefined, say: undefined });
    assert.deepEqual(read('{"action":"raise","amount":0}'), { type: "raise", amount: undefined, say: undefined });
    assert.deepEqual(read(`{"action":"fold","say":"${"x".repeat(200)}"}`), { type: "fold", amount: undefined, say: "x".repeat(120) });
    assert.deepEqual(read('{"action":"check","say":42}'), { type: "check", amount: undefined, say: undefined });
    assert.equal(read('{"action":"dance"}'), null);
    assert.equal(read("I fold."), null);
    assert.equal(read('{"action": {"type":"call"}}'), null);
    assert.equal(read("{not json}"), null);
  });

  test("house bot: raises strong hands, calls cheap spots, folds weak hands to big bets", (t) => {
    const random = t.mock.method(Math, "random", () => 0.5);

    let game = rigHand(newGame(["A", "B"], 1000, 20), ["Ah Ad", "Kc Kd"], "As 7c 2d 9h 3s");
    game = play(game, { type: "call" }, { type: "check" }); // flop: B to act with a pair, A holds trips
    assert.deepEqual(houseBot(game), { type: "call" });
    game = play(game, { type: "check" });
    assert.deepEqual(houseBot(game), { type: "raise", amount: 40 });

    let weak = rigHand(newGame(["A", "B"], 1000, 20), ["Ah Ad", "2c 7d"], "As 7c 2d 9h 3s");
    weak = play(weak, { type: "raise", amount: 200 }); // B owes 180 with nothing
    assert.deepEqual(houseBot(weak), { type: "fold" });

    random.mock.mockImplementation(() => 0.01); // the occasional bluff
    assert.deepEqual(houseBot(weak), { type: "raise", amount: 380 });
  });
});
