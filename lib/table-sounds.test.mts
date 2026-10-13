// Run: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { act, legalize, newGame, startHand, type Action, type Game } from "./poker.ts";
import { DEAL_STEP_MS, soundsForUpdate, type TimedSound } from "./table-sounds.ts";

const WATCHING = -1;

const firstHand = (names: string[]) => {
  const seated = newGame(names, 1000, 20);
  return { seated, dealt: startHand(seated) };
};

/** The game after whoever is to act does `action`. */
const after = (game: Game, action: Action) => act(game, legalize(game, action));

const cardSounds = (count: number): TimedSound[] => Array.from({ length: count }, (_, card) => ({ sound: "card", delayMs: card * DEAL_STEP_MS }));

test("a new hand plays the card sound once per hole card, in step with the deal", () => {
  const { seated, dealt } = firstHand(["You", "Ann", "Bob"]);

  assert.deepEqual(soundsForUpdate(seated, dealt, WATCHING), cardSounds(6));
});

test("a player with no chips is dealt no cards, so gets no card sound", () => {
  const seated = newGame(["You", "Ann", "Bob"], 1000, 20);
  seated.players[2].stack = 0;

  assert.deepEqual(soundsForUpdate(seated, startHand(seated), WATCHING), cardSounds(4));
});

test("when a new hand starts on your turn, the turn sound waits for the last card", () => {
  const { seated, dealt } = firstHand(["You", "Ann", "Bob"]);

  const sounds = soundsForUpdate(seated, dealt, dealt.turn);

  assert.deepEqual(sounds, [...cardSounds(6), { sound: "turn", delayMs: 6 * DEAL_STEP_MS }]);
});

test("during a hand, a bet plays the chips sound right away", () => {
  const { dealt } = firstHand(["You", "Ann", "Bob"]);

  assert.deepEqual(soundsForUpdate(dealt, after(dealt, { type: "call" }), WATCHING), [{ sound: "chips", delayMs: 0 }]);
});

test("every bet in an update is heard, one after another", () => {
  const { dealt } = firstHand(["You", "Ann", "Bob"]);
  const twoBetsLater = after(after(dealt, { type: "raise", amount: 60 }), { type: "call" });

  assert.deepEqual(soundsForUpdate(dealt, twoBetsLater, WATCHING), [
    { sound: "chips", delayMs: 0 },
    { sound: "chips", delayMs: 140 },
  ]);
});

test("any other sound plays once per update, however many lines ask for it", () => {
  const { dealt } = firstHand(["You", "Ann", "Bob"]);
  const everyoneFolded = after(after(dealt, { type: "fold" }), { type: "fold" });

  assert.equal(everyoneFolded.street, "done");
  assert.deepEqual(soundsForUpdate(dealt, everyoneFolded, WATCHING), [
    { sound: "fold", delayMs: 0 },
    { sound: "win", delayMs: 140 },
  ]);
});

test("the check that closes the betting, the flop and your turn sound one after another", () => {
  const { dealt } = firstHand(["You", "Ann", "Bob"]);
  const bigBlindToAct = after(after(dealt, { type: "call" }), { type: "call" });

  const flop = after(bigBlindToAct, { type: "check" });

  assert.equal(flop.street, "flop");
  assert.deepEqual(soundsForUpdate(bigBlindToAct, flop, flop.turn), [
    { sound: "check", delayMs: 0 },
    { sound: "card", delayMs: 140 },
    { sound: "turn", delayMs: 280 },
  ]);
});

test("nothing new, nothing to play", () => {
  const { dealt } = firstHand(["You", "Ann", "Bob"]);

  assert.deepEqual(soundsForUpdate(dealt, structuredClone(dealt), WATCHING), []);
});
