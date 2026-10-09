// Human-only friend tables. The server owns the game; each player only ever receives their own view of it.
import { randomBytes, randomUUID } from "node:crypto";
import { prisma } from "./db";
import type { Prisma } from "./generated/prisma/client";
import { act, addPlayer, legalize, newGame, startHand, viewFor, type Action, type Game } from "./poker";

export const TURN_MS = 30_000; // time to act before an automatic check (or fold)
const NEXT_HAND_MS = 5_000; // everyone sees the result before the next deal
const MAX_SEATS = 9;
export const CODE = /^[0-9a-f]{8}$/;

type Seat = { name: string; token: string };
type TableData = {
  stack: number;
  bb: number;
  seats: Seat[]; // index = seat; seat 0 is the host
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

const fail = (status: number, message: string): never => {
  throw Object.assign(new Error(message), { status });
};
/** Turn an expected failure (bad input, not your turn...) into a JSON error; anything else is a real 500. */
export function failure(e: unknown) {
  const status = (e as { status?: number }).status;
  if (!status) throw e;
  return Response.json({ error: (e as Error).message }, { status });
}
const cleanName = (name: unknown) => String(name ?? "").trim().replace(/\s+/g, " ").slice(0, 16);
const seatOf = (d: TableData, token: string) => d.seats.findIndex((s) => s.token === token);

function view(code: string, d: TableData, token: string): TableView {
  const you = seatOf(d, token);
  const g = d.game;
  return {
    code,
    you,
    names: d.seats.map((s) => s.name),
    stack: d.stack,
    bb: d.bb,
    game: g && viewFor(g, you),
    turnMsLeft: g && g.street !== "done" ? Math.max(0, d.turnAt + TURN_MS - Date.now()) : 0,
    turnMs: TURN_MS,
  };
}

/** Read-modify-write a table. `fn` returns false when it changed nothing (no write). Retries if another request wrote first. */
async function update(code: string, fn: (d: TableData) => boolean): Promise<TableData> {
  if (!CODE.test(code)) fail(404, "No table with that code.");
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await prisma.table.findUnique({ where: { code } });
    if (!row) return fail(404, "No table with that code.");
    const d = structuredClone(row.data as unknown as TableData);
    if (!fn(d)) return d;
    const { count } = await prisma.table.updateMany({
      where: { code, version: row.version },
      data: { data: d as unknown as Prisma.InputJsonObject, version: { increment: 1 } },
    });
    if (count) return d;
  }
  return fail(409, "The table is busy, try again.");
}

/** Steps nobody clicks for: a turn running out, and the next deal. Runs whenever anyone looks at the table. */
function tick(d: TableData, now: number): boolean {
  const g = d.game;
  if (!g) return false;
  if (g.street !== "done" && now - d.turnAt > TURN_MS) {
    d.game = act(g, legalize(g, { type: "check" })); // a fold when they owe chips
    d.turnAt = now;
    return true;
  }
  if (g.street === "done" && now - d.turnAt > NEXT_HAND_MS && g.players.filter((p) => p.stack > 0).length >= 2) {
    d.game = startHand(g);
    d.turnAt = now;
    return true;
  }
  return false;
}

export async function createTable(name: unknown, stack: unknown, bb: unknown) {
  const host = cleanName(name) || fail(400, "Enter your name.");
  const big = Math.min(1_000_000, Math.max(2, Math.round(Number(bb)) || 20));
  const chips = Math.min(100_000_000, Math.max(big * 10, Math.round(Number(stack)) || 1000));
  const token = randomUUID();
  const code = randomBytes(4).toString("hex"); // 8-char random hash = the invite code
  // ponytail: no retry on a code collision (1 in 4 billion per table); add one if tables pile up
  const data: TableData = { stack: chips, bb: big, seats: [{ name: host, token }], game: null, turnAt: Date.now() };
  await prisma.table.create({ data: { code, data: data as unknown as Prisma.InputJsonObject } });
  return { code, token };
}

export async function readTable(code: string, token: string) {
  return view(code, await update(code, (d) => tick(d, Date.now())), token);
}

export async function joinTable(code: string, token: string, name: unknown) {
  const wanted = cleanName(name) || fail(400, "Enter your name.");
  const newToken = randomUUID();
  const d = await update(code, (d) => {
    if (seatOf(d, token) >= 0) fail(409, "You're already at this table.");
    if (d.seats.length >= MAX_SEATS) fail(409, "This table is full.");
    const taken = new Set(d.seats.map((s) => s.name));
    let seatName = wanted;
    for (let k = 2; taken.has(seatName); k++) seatName = `${wanted} ${k}`;
    d.seats.push({ name: seatName, token: newToken });
    if (d.game) d.game = addPlayer(d.game, seatName, d.stack); // plays from the next hand
    return true;
  });
  return { token: newToken, view: view(code, d, newToken) };
}

export async function dealFirstHand(code: string, token: string) {
  const d = await update(code, (d) => {
    if (seatOf(d, token) !== 0) fail(403, "Only the host can deal.");
    if (d.game) fail(409, "The game has already started.");
    if (d.seats.length < 2) fail(409, "Wait for at least one friend to join.");
    d.game = startHand(newGame(d.seats.map((s) => s.name), d.stack, d.bb));
    d.turnAt = Date.now();
    return true;
  });
  return view(code, d, token);
}

export async function playerAction(code: string, token: string, action: Action | { type: "rebuy" }) {
  const d = await update(code, (d) => {
    const seat = seatOf(d, token);
    if (seat < 0) fail(403, "You're not seated at this table.");
    const g = d.game ?? fail(409, "The game hasn't started yet.");
    if (action.type === "rebuy") {
      const p = g.players[seat];
      if (p.stack > 0 || (p.cards.length && g.street !== "done")) fail(409, "You can rebuy once you're out of chips.");
      p.stack = d.stack;
      p.buyIn += d.stack;
      p.rebuys++;
      return true;
    }
    if (g.street === "done" || g.turn !== seat) fail(409, "It's not your turn.");
    d.game = act(g, legalize(g, action));
    d.turnAt = Date.now();
    return true;
  });
  return view(code, d, token);
}
