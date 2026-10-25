// Run: npm test (Node's built-in test runner, no framework)
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { legal, newGame, startHand } from "./poker.ts";
import { HOST_AWAY_MS, NEXT_HAND_MS, TURN_MS, hostSeat, markSeen, playForAbsentPlayers, runTimers, seatOf, type TableData } from "./table-rules.ts";

const START = 1_000_000; // a made-up clock (epoch ms) the tests move forward by hand

/** A friend table with these players seated in order, one account each ("user-<name>"), dealt if `dealt`. */
function tableOf(names: string[], dealt = true): TableData {
  const seats = names.map((name) => ({ name, userId: `user-${name}`, seenAt: START }));
  const game = dealt ? startHand(newGame(names, 1000, 20)) : null;
  return { stack: 1000, bb: 20, seats, game, turnAt: START };
}

/** Let the turn clock run out once for whoever is to act. */
function timeOut(table: TableData, now: number) {
  assert(runTimers(table, now + TURN_MS + 1), "the clock acted");
}

describe("seats and the host", () => {
  test("a seat belongs to an account", () => {
    const table = tableOf(["Ana", "Ben"], false);
    assert.equal(seatOf(table, "user-Ben"), 1);
    assert.equal(seatOf(table, "someone-else"), -1);
  });

  test("seat 0 hosts until they go quiet; then the first player still looking does", () => {
    const table = tableOf(["Ana", "Ben", "Cy"], false);
    assert.equal(hostSeat(table, START), 0);

    const later = START + HOST_AWAY_MS;
    assert(markSeen(table, "user-Cy", later));
    assert.equal(hostSeat(table, later), 2, "Ana and Ben haven't looked for a while; Cy has");
    assert(markSeen(table, "user-Ana", later + 1));
    assert.equal(hostSeat(table, later + 1), 0, "Ana is back, and hosts again");
  });

  test("visits are written down every few seconds at most, and not once the game has started", () => {
    const table = tableOf(["Ana", "Ben"], false);
    assert.equal(markSeen(table, "user-Ana", START + 1), false, "just seen");
    assert.equal(markSeen(table, "nobody", START + 60_000), false, "not seated");

    const dealt = tableOf(["Ana", "Ben"]);
    assert.equal(markSeen(dealt, "user-Ana", START + 60_000), false);
  });
});

describe("the clock and players who are away", () => {
  test("before the turn time runs out nothing happens", () => {
    const table = tableOf(["Ana", "Ben"]);
    assert.equal(runTimers(table, START + TURN_MS - 1), false);
  });

  test("the clock plays a missed turn; a second miss in a row sits the player out", () => {
    const table = tableOf(["Ana", "Ben", "Cy"]);
    const slow = table.game!.turn;
    timeOut(table, START);
    assert.equal(table.seats[slow].missedTurns, 1);
    assert(!table.game!.players[slow].sittingOut, "one miss is not away yet");

    const again = tableOf(["Ana", "Ben", "Cy"]);
    again.seats[slow].missedTurns = 1; // missed their last turn too
    timeOut(again, START);
    assert(again.game!.players[slow].sittingOut, "two misses: away");
  });

  test("a player sitting out is played for at once, without waiting for the clock", () => {
    const table = tableOf(["Ana", "Ben", "Cy"]);
    const game = table.game!;
    const away = game.turn;
    game.players[away].sittingOut = true;
    const owes = legal(game).owe > 0;

    assert(playForAbsentPlayers(table, START + 1));
    const after = table.game!;
    assert.notEqual(after.turn, away);
    assert.equal(after.players[away].folded, owes, "folds when owing chips, checks when free");
  });

  test("players sitting out are dealt out of the next hand; with fewer than two left, nothing is dealt", () => {
    const table = tableOf(["Ana", "Ben", "Cy"]);
    table.game = { ...table.game!, street: "done", turn: -1 };
    table.game.players[2].sittingOut = true;
    assert(runTimers(table, START + NEXT_HAND_MS + 1));
    assert.equal(table.game.hand, 2);
    assert.deepEqual(table.game.players[2].cards, [], "Cy sits this hand out");

    const quiet = tableOf(["Ana", "Ben"]);
    quiet.game = { ...quiet.game!, street: "done", turn: -1 };
    quiet.game.players[1].sittingOut = true;
    assert.equal(runTimers(quiet, START + NEXT_HAND_MS + 1), false);
    assert.equal(quiet.game.hand, 1);
  });

  test("a player who stood up folds on their turn and leaves when the hand ends", () => {
    const table = tableOf(["Ana", "Ben"]);
    const leaver = table.game!.turn;
    table.seats[leaver].leaving = true;
    assert(playForAbsentPlayers(table, START + 1));
    assert.equal(table.game!.street, "done");
    assert.equal(table.seats.length, 1);
    assert.equal(table.game!.players.length, 1);
  });
});
