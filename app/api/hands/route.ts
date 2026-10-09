import { saveHand } from "@/lib/db";
import { ownPageOnly } from "@/lib/guard";
import type { HandRecord } from "@/lib/poker";

const MAX_BODY_LENGTH = 100_000;
const GAME_ID = /^[\w-]{1,64}$/;

/** Body: { gameId, hand: HandRecord } - sent by the table when a hand finishes. */
export async function POST(req: Request) {
  const userId = await ownPageOnly(req);
  if (userId instanceof Response) {
    return userId;
  }
  const badRequest = () => Response.json({ error: "bad request" }, { status: 400 });

  const text = await req.text();
  if (text.length > MAX_BODY_LENGTH) {
    return Response.json({ error: "too large" }, { status: 413 });
  }
  let body: { gameId?: unknown; hand?: Partial<HandRecord> };
  try {
    body = JSON.parse(text);
  } catch {
    return badRequest();
  }

  // Only the shape is checked: the hand is shown back to this same account on its history page.
  const { gameId, hand } = body;
  const validGameId = typeof gameId === "string" && GAME_ID.test(gameId);
  const handNumber = hand?.number;
  const validNumber = typeof handNumber === "number" && Number.isInteger(handNumber) && handNumber > 0;
  const validLists = [hand?.board, hand?.history, hand?.players, hand?.winners].every(Array.isArray);
  if (!validGameId || !validNumber || !validLists) {
    return badRequest();
  }
  await saveHand(userId, gameId, hand as HandRecord);
  return Response.json({ ok: true });
}
