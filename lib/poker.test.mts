// Run: npm test  (plain node, no test framework)
import assert from "node:assert/strict";
import { act, addPlayer, bestFive, handValue, legalize, newGame, startHand, viewFor, type Action, type Game } from "./poker.ts";

const v = (s: string) => handValue(s.split(" "));

// Category order, kickers, wheel, board-plays edge cases.
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
ladder.slice(1).forEach((h, i) => assert(v(ladder[i]) > v(h), `${ladder[i]} should beat ${h}`));
assert.equal(v("9h 9d 9s 9c Kd 2c 3d"), v("9h 9d 9s 9c Kd 4c 5d"), "quads use one kicker");
assert.equal(v("Ah Ad Kh Kd Qh Qd 2c"), v("Ah Ad Kh Kd Qs 2c 3c"), "three pairs: best two + kicker");
assert.equal(v("Ah Ad Ac Ks Kd 2c 2h"), v("Ah Ad Ac Ks Kd 3c 3h"), "full house ignores extra pair");
assert.deepEqual(bestFive("Ah 2h 3h 4h 5h Kd Kc".split(" ")).sort(), ["2h", "3h", "4h", "5h", "Ah"], "best five picks the straight flush");

// Side pot: short stack wins the main pot, middle stack the side pot.
let g: Game = newGame(["A", "B", "C"], 0, 20);
[100, 300, 300].forEach((s, i) => (g.players[i].stack = s));
g = startHand(g); // dealer A, B posts 10, C posts 20, A to act
g.players[0].cards = ["Ah", "Ad"];
g.players[1].cards = ["Kh", "Kd"];
g.players[2].cards = ["Qh", "Qd"];
g.deck = ["2c", "7d", "9s", "Jh", "3c"];
for (const a of [{ type: "raise", amount: 100 }, { type: "raise", amount: 300 }, { type: "call" }] as Action[]) g = act(g, legalize(g, a));
assert.equal(g.street, "done");
assert.deepEqual(g.players.map((p) => p.stack), [300, 400, 0]);
assert.deepEqual(g.winners.map((w) => w.hand), ["Pair", "Pair"]);
assert.deepEqual(g.swept.map((s) => s.amount), [100, 300, 300], "preflop bets swept into the pot");

// Random play never creates or loses chips and always terminates.
const types = ["fold", "check", "call", "raise"] as const;
for (let n = 0; n < 3000; n++) {
  g = newGame(["a", "b", "c", "d", "e", "f"].slice(0, 2 + (n % 5)), 0, 20);
  for (const p of g.players) p.stack = 1 + Math.floor(Math.random() * 600);
  const total = g.players.reduce((s, p) => s + p.stack, 0);
  g = startHand(g);
  for (let steps = 0; g.street !== "done"; steps++) {
    assert(steps < 500, "hand did not terminate");
    g = act(g, legalize(g, { type: types[Math.floor(Math.random() * 4)], amount: Math.floor(Math.random() * 700) }));
  }
  assert.equal(g.players.reduce((s, p) => s + p.stack, 0), total, "chips not conserved");
  for (const w of g.winners)
    if (w.cards.length) assert.equal(handValue(w.cards), handValue([...g.players[w.seat].cards, ...g.board]), "winning five = best hand");
}
// A friend's view hides the deck and other hole cards; a late joiner sits out until the next deal.
g = startHand(newGame(["a", "b", "c"], 500, 20));
const seen = viewFor(g, 1);
assert.equal(seen.deck.length, 0);
assert.deepEqual(seen.players[1].cards, g.players[1].cards);
assert.deepEqual(seen.players[0].cards, ["", ""]);
g = addPlayer(g, "late", 500);
assert.equal(g.players[3].cards.length, 0);
while (g.street !== "done") g = act(g, legalize(g, { type: "fold" }));
assert.equal(startHand(g).players[3].cards.length, 2, "late joiner dealt in next hand");
console.log("poker engine ok");
