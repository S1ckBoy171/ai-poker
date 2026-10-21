// Friend-table rules that need no database: who sits where, who hosts, and the steps the clock takes for players
// who don't act (a turn running out, sitting out the away, the next deal). lib/tables.ts stores the result.
import { act, legalize, playersReady, removePlayer, startHand, type Game } from "./poker.ts";

export const TURN_MS = 30_000; // time to act before an automatic check (or fold)
export const NEXT_HAND_MS = 5_000; // everyone sees the result before the next deal
export const MISSED_TURNS_TO_SIT_OUT = 2; // turns in a row the clock plays for you before you're dealt out as away
export const HOST_AWAY_MS = 20_000; // before the first deal: a host not seen this long hands the deal to the next player here
export const SEEN_EVERY_MS = 5_000; // before the first deal, how often a player's visits are written down (each one is a write)

export type Seat = {
  name: string;
  userId: string; // the account sitting here: one seat per account, found again from any device
  leaving?: boolean; // stood up mid-hand, goes when the hand ends
  missedTurns?: number; // turns in a row the clock played for them
  seenAt?: number; // their last look at the table before the first deal (epoch ms)
};
export type TableData = {
  stack: number;
  bb: number;
  seats: Seat[]; // index = seat, clockwise round the table; seat 0 is the host (see hostSeat)
  game: Game | null; // null until the host deals
  turnAt: number; // when the current turn started, or the last hand ended (epoch ms)
};

export const seatOf = (table: TableData, userId: string) => table.seats.findIndex((seat) => seat.userId === userId);

/**
 * Who deals the first hand: seat 0, unless they haven't looked at the table for a while, and then the first player
 * who has. Once cards are dealt the game runs itself and nobody hosts.
 */
export function hostSeat(table: TableData, now: number): number {
  const isHere = (seat: Seat) => now - (seat.seenAt ?? 0) < HOST_AWAY_MS;
  return Math.max(0, table.seats.findIndex(isHere));
}

/** Before the first deal, note that this account looked at the table (at most every few seconds, as it's a write). */
export function markSeen(table: TableData, userId: string, now: number): boolean {
  const seat = table.seats[seatOf(table, userId)];
  if (table.game || !seat || now - (seat.seenAt ?? 0) < SEEN_EVERY_MS) {
    return false;
  }
  seat.seenAt = now;
  return true;
}

/**
 * Players who aren't playing on. One who stood up folds at once when it's their turn, and between hands (or before
 * the first deal) leaves the table; one sitting out checks, or folds when they owe chips, without the turn clock.
 * Returns whether anything changed.
 */
export function playForAbsentPlayers(table: TableData, now: number): boolean {
  let changed = false;
  for (;;) {
    const game = table.game;
    const handRunning = !!game && game.street !== "done";
    if (game && handRunning && table.seats[game.turn]?.leaving) {
      table.game = act(game, { type: "fold" });
      table.turnAt = now;
      changed = true;
      continue;
    }
    if (game && handRunning && game.players[game.turn].sittingOut) {
      table.game = act(game, legalize(game, { type: "check" }));
      table.turnAt = now;
      changed = true;
      continue;
    }
    if (handRunning) {
      return changed;
    }
    const leaver = table.seats.findIndex((seat) => seat.leaving);
    if (leaver < 0) {
      return changed;
    }
    table.seats.splice(leaver, 1);
    if (table.game) {
      table.game = removePlayer(table.game, leaver);
    }
    changed = true;
  }
}

/**
 * Steps nobody clicks for: a turn running out, and the next deal. Runs whenever anyone looks at the table. A player
 * whose clock runs out twice in a row is taken to be away and sits out until they come back.
 */
export function runTimers(table: TableData, now: number): boolean {
  const absentPlayed = playForAbsentPlayers(table, now);
  const game = table.game;
  if (!game) {
    return absentPlayed;
  }
  const handRunning = game.street !== "done";
  if (handRunning && now - table.turnAt > TURN_MS) {
    const slowSeat = game.turn;
    const next = act(game, legalize(game, { type: "check" })); // a fold when they owe chips
    const seat = table.seats[slowSeat];
    seat.missedTurns = (seat.missedTurns ?? 0) + 1;
    if (seat.missedTurns >= MISSED_TURNS_TO_SIT_OUT) {
      next.players[slowSeat].sittingOut = true;
    }
    table.game = next;
    table.turnAt = now;
    playForAbsentPlayers(table, now);
    return true;
  }
  const nextHandDue = !handRunning && now - table.turnAt > NEXT_HAND_MS;
  if (nextHandDue && playersReady(game) >= 2) {
    table.game = startHand(game);
    table.turnAt = now;
    playForAbsentPlayers(table, now);
    return true;
  }
  return absentPlayed;
}
