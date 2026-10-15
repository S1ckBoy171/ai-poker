// Human-only friend tables. The server owns the game; each player only ever receives their own view of it.
import { randomBytes, randomUUID } from "node:crypto";
import { prisma } from "./db";
import type { Prisma } from "./generated/prisma/client";
import { act, addPlayer, legalize, newGame, playersWithChips, removePlayer, startHand, viewFor, type Action, type Game } from "./poker";
import { joinSeat } from "./table-shape";

export const TURN_MS = 30_000; // time to act before an automatic check (or fold)
const NEXT_HAND_MS = 5_000; // everyone sees the result before the next deal
const MAX_SEATS = 9;
const UPDATE_ATTEMPTS = 5;
export const CODE = /^[0-9a-f]{8}$/;

type Seat = { name: string; token: string; leaving?: boolean }; // leaving: stood up mid-hand, goes when the hand ends
type TableData = {
  stack: number;
  bb: number;
  seats: Seat[]; // index = seat, clockwise round the table; seat 0 is the host
  game: Game | null; // null until the host deals
  turnAt: number; // when the current turn started, or the last hand ended (epoch ms)
};

export type TableView = {
  code: string;
  you: number; // your seat, -1 if you haven't joined
  names: string[];
  stack: number;
  bb: number;
  game: Game | null;
  turnMsLeft: number;
  turnMs: number;
};

/** What a seated player can do: a poker action, or a rebuy once they're out of chips. */
export type SeatAction = Action | { type: "rebuy" };

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

const seatOf = (table: TableData, token: string) => table.seats.findIndex((seat) => seat.token === token);

/** The table as the holder of `token` may see it. */
function tableViewFor(code: string, table: TableData, token: string): TableView {
  const you = seatOf(table, token);
  const game = table.game;
  const turnRunning = !!game && game.street !== "done";
  return {
    code,
    you,
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

/**
 * Players who stood up: one whose turn it is folds at once, and between hands (or before the first deal) they leave
 * the table. Returns whether anything changed.
 */
function seatLeavers(table: TableData, now: number): boolean {
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

/** Steps nobody clicks for: a turn running out, and the next deal. Runs whenever anyone looks at the table. */
function runTimers(table: TableData, now: number): boolean {
  const leaversSeated = seatLeavers(table, now);
  const game = table.game;
  if (!game) {
    return leaversSeated;
  }
  const handRunning = game.street !== "done";
  if (handRunning && now - table.turnAt > TURN_MS) {
    table.game = act(game, legalize(game, { type: "check" })); // a fold when they owe chips
    table.turnAt = now;
    return true;
  }
  const nextHandDue = !handRunning && now - table.turnAt > NEXT_HAND_MS;
  if (nextHandDue && playersWithChips(game) >= 2) {
    table.game = startHand(game);
    table.turnAt = now;
    return true;
  }
  return leaversSeated;
}

export async function createTable(name: unknown, stack: unknown, bb: unknown) {
  const host = cleanName(name) || fail(400, "Enter your name.");
  const requestedBb = Math.round(Number(bb)) || 20;
  const bigBlind = Math.min(1_000_000, Math.max(2, requestedBb));
  const requestedStack = Math.round(Number(stack)) || 1000;
  const startingStack = Math.min(100_000_000, Math.max(bigBlind * 10, requestedStack)); // at least 10 big blinds
  const token = randomUUID();
  const code = randomBytes(4).toString("hex"); // 8-char random hash = the invite code
  // ponytail: no retry on a code collision (1 in 4 billion per table); add one if tables pile up
  const table: TableData = {
    stack: startingStack,
    bb: bigBlind,
    seats: [{ name: host, token }],
    game: null,
    turnAt: Date.now(),
  };
  await prisma.table.create({ data: { code, data: table as unknown as Prisma.InputJsonObject } });
  return { code, token };
}

export async function readTable(code: string, token: string) {
  const table = await updateTable(code, (current) => runTimers(current, Date.now()));
  return tableViewFor(code, table, token);
}

export async function joinTable(code: string, token: string, name: unknown) {
  const wanted = cleanName(name) || fail(400, "Enter your name.");
  const newToken = randomUUID();
  const table = await updateTable(code, (current) => {
    if (seatOf(current, token) >= 0) {
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
    current.seats.splice(seat, 0, { name: seatName, token: newToken });
    if (current.game) {
      current.game = addPlayer(current.game, seatName, current.stack, seat); // plays from the next hand
    }
    return true;
  });
  return { token: newToken, view: tableViewFor(code, table, newToken) };
}

export async function dealFirstHand(code: string, token: string) {
  const table = await updateTable(code, (current) => {
    if (seatOf(current, token) !== 0) {
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
  return tableViewFor(code, table, token);
}

export async function playerAction(code: string, token: string, action: SeatAction) {
  const table = await updateTable(code, (current) => {
    const seat = seatOf(current, token);
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

    if (game.street === "done" || game.turn !== seat) {
      fail(409, "It's not your turn.");
    }
    current.game = act(game, legalize(game, action));
    current.turnAt = Date.now();
    seatLeavers(current, current.turnAt); // a player who stood up and is next folds at once
    return true;
  });
  return tableViewFor(code, table, token);
}

/**
 * Stand up: the only way to leave a table. Out of the hand (or between hands) you leave at once; in a hand you fold
 * when your turn comes (straight away if it is now) and leave when the hand ends. Your chips leave with you.
 */
export async function standUp(code: string, token: string) {
  await updateTable(code, (current) => {
    const seat = seatOf(current, token);
    if (seat < 0) {
      fail(403, "You're not seated at this table.");
    }
    current.seats[seat].leaving = true;
    seatLeavers(current, Date.now());
    return true;
  });
}
