// Human-only friend tables. The server owns the game; each player only ever receives their own view of it.
import { randomBytes } from "node:crypto";
import { prisma } from "./db";
import type { Prisma } from "./generated/prisma/client";
import { act, addPlayer, legalize, newGame, startHand, viewFor, type Action, type Game } from "./poker";
import { TURN_MS, hostSeat, markSeen, playForAbsentPlayers, runTimers, seatOf, type TableData } from "./table-rules";
import { joinSeat } from "./table-shape";

const MAX_SEATS = 9;
const UPDATE_ATTEMPTS = 5;
export const CODE = /^[0-9a-f]{8}$/;

export type TableView = {
  code: string;
  you: number; // your seat, -1 if you haven't joined
  host: number; // the seat that deals the first hand
  names: string[];
  stack: number;
  bb: number;
  game: Game | null;
  turnMsLeft: number;
  turnMs: number;
};

/** What a seated player can do: a poker action, a rebuy once they're out of chips, or sit out and come back. */
export type SeatAction = Action | { type: "rebuy" } | { type: "sitOut" } | { type: "sitIn" };

/** An expected failure (bad input, not your turn...) with the HTTP status to answer with. */
type TableError = Error & { status: number };

const fail = (status: number, message: string): never => {
  throw Object.assign(new Error(message), { status });
};

const isTableError = (error: unknown): error is TableError => error instanceof Error && typeof (error as Partial<TableError>).status === "number";

/** Turn an expected failure into a JSON error; anything else is a real 500. */
export function errorResponse(error: unknown): Response {
  if (!isTableError(error)) {
    throw error;
  }
  return Response.json({ error: error.message }, { status: error.status });
}

const cleanName = (name: unknown) =>
  String(name ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 16);

/** The table as this account may see it. */
function tableViewFor(code: string, table: TableData, userId: string): TableView {
  const you = seatOf(table, userId);
  const game = table.game;
  const turnRunning = !!game && game.street !== "done";
  return {
    code,
    you,
    host: hostSeat(table, Date.now()),
    names: table.seats.map((seat) => seat.name),
    stack: table.stack,
    bb: table.bb,
    game: game && viewFor(game, you),
    turnMsLeft: turnRunning ? Math.max(0, table.turnAt + TURN_MS - Date.now()) : 0,
    turnMs: TURN_MS,
  };
}

/**
 * Read-modify-write a table. `change` edits the table in place and returns false when it changed nothing (no write).
 * Retries if another request wrote first (optimistic locking on the row version).
 */
async function updateTable(code: string, change: (table: TableData) => boolean): Promise<TableData> {
  if (!CODE.test(code)) {
    fail(404, "No table with that code.");
  }
  for (let attempt = 0; attempt < UPDATE_ATTEMPTS; attempt++) {
    const row = await prisma.table.findUnique({ where: { code } });
    if (!row) {
      return fail(404, "No table with that code.");
    }
    const table = structuredClone(row.data as unknown as TableData);
    if (!change(table)) {
      return table;
    }
    const { count } = await prisma.table.updateMany({
      where: { code, version: row.version },
      data: { data: table as unknown as Prisma.InputJsonObject, version: { increment: 1 } },
    });
    if (count) {
      return table;
    }
  }
  return fail(409, "The table is busy, try again.");
}

export async function createTable(userId: string, name: unknown, stack: unknown, bb: unknown) {
  const host = cleanName(name) || fail(400, "Enter your name.");
  const requestedBb = Math.round(Number(bb)) || 20;
  const bigBlind = Math.min(1_000_000, Math.max(2, requestedBb));
  const requestedStack = Math.round(Number(stack)) || 1000;
  const startingStack = Math.min(100_000_000, Math.max(bigBlind * 10, requestedStack)); // at least 10 big blinds
  const code = randomBytes(4).toString("hex"); // 8-char random hash = the invite code
  // ponytail: no retry on a code collision (1 in 4 billion per table); add one if tables pile up
  const table: TableData = {
    stack: startingStack,
    bb: bigBlind,
    seats: [{ name: host, userId, seenAt: Date.now() }],
    game: null,
    turnAt: Date.now(),
  };
  await prisma.table.create({ data: { code, data: table as unknown as Prisma.InputJsonObject } });
  return { code };
}

export async function readTable(code: string, userId: string) {
  const table = await updateTable(code, (current) => {
    const now = Date.now();
    const seen = markSeen(current, userId, now);
    const ran = runTimers(current, now);
    return seen || ran;
  });
  return tableViewFor(code, table, userId);
}

export async function joinTable(code: string, userId: string, name: unknown) {
  const wanted = cleanName(name) || fail(400, "Enter your name.");
  const table = await updateTable(code, (current) => {
    if (seatOf(current, userId) >= 0) {
      fail(409, "You're already at this table.");
    }
    if (current.seats.length >= MAX_SEATS) {
      fail(409, "This table is full.");
    }
    // Names stay unique at the table: "Ana", then "Ana 2", "Ana 3"...
    const taken = new Set(current.seats.map((seat) => seat.name));
    let seatName = wanted;
    for (let suffix = 2; taken.has(seatName); suffix++) {
      seatName = `${wanted} ${suffix}`;
    }
    // Seat numbers run clockwise, the order of play, so a chair between two players means a seat number between theirs.
    const seat = joinSeat(current.seats.length);
    current.seats.splice(seat, 0, { name: seatName, userId, seenAt: Date.now() });
    if (current.game) {
      current.game = addPlayer(current.game, seatName, current.stack, seat); // plays from the next hand
    }
    return true;
  });
  return tableViewFor(code, table, userId);
}

export async function dealFirstHand(code: string, userId: string) {
  const table = await updateTable(code, (current) => {
    if (seatOf(current, userId) !== hostSeat(current, Date.now())) {
      fail(403, "Only the host can deal.");
    }
    if (current.game) {
      fail(409, "The game has already started.");
    }
    if (current.seats.length < 2) {
      fail(409, "Wait for at least one friend to join.");
    }
    const names = current.seats.map((seat) => seat.name);
    current.game = startHand(newGame(names, current.stack, current.bb));
    current.turnAt = Date.now();
    return true;
  });
  return tableViewFor(code, table, userId);
}

export async function playerAction(code: string, userId: string, action: SeatAction) {
  const table = await updateTable(code, (current) => {
    const seat = seatOf(current, userId);
    if (seat < 0) {
      fail(403, "You're not seated at this table.");
    }
    if (current.seats[seat].leaving) {
      fail(409, "You've stood up from this table.");
    }
    const game = current.game ?? fail(409, "The game hasn't started yet.");

    if (action.type === "rebuy") {
      const player = game.players[seat];
      const inPlayingHand = player.cards.length > 0 && game.street !== "done";
      if (player.stack > 0 || inPlayingHand) {
        fail(409, "You can rebuy once you're out of chips.");
      }
      player.stack = current.stack;
      player.buyIn += current.stack;
      player.rebuys++;
      return true;
    }

    if (action.type === "sitOut" || action.type === "sitIn") {
      game.players[seat].sittingOut = action.type === "sitOut";
      current.seats[seat].missedTurns = 0;
      playForAbsentPlayers(current, Date.now()); // sitting out on your turn plays it at once
      return true;
    }

    if (game.street === "done" || game.turn !== seat) {
      fail(409, "It's not your turn.");
    }
    current.game = act(game, legalize(game, action));
    current.seats[seat].missedTurns = 0;
    current.turnAt = Date.now();
    playForAbsentPlayers(current, current.turnAt); // whoever is next and has stood up or is away plays at once
    return true;
  });
  return tableViewFor(code, table, userId);
}

/**
 * Stand up: the only way to leave a table. Out of the hand (or between hands) you leave at once; in a hand you fold
 * when your turn comes (straight away if it is now) and leave when the hand ends. Your chips leave with you.
 */
export async function standUp(code: string, userId: string) {
  await updateTable(code, (current) => {
    const seat = seatOf(current, userId);
    if (seat < 0) {
      fail(403, "You're not seated at this table.");
    }
    current.seats[seat].leaving = true;
    playForAbsentPlayers(current, Date.now());
    return true;
  });
}
