import { saveHand } from "@/lib/db";
import { ownPageOnly } from "@/lib/guard";
import type { HandRecord } from "@/lib/poker";

/** Body: { gameId, hand: HandRecord } - sent by the table when a hand finishes. */
export async function POST(req: Request) {
  const userId = await ownPageOnly(req);
  if (userId instanceof Response) return userId;
  const text = await req.text();
  if (text.length > 100_000) return Response.json({ error: "too large" }, { status: 413 });
  let body: { gameId?: unknown; hand?: Partial<HandRecord> };
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  const { gameId, hand } = body;
  const ok =
    typeof gameId === "string" &&
    /^[\w-]{1,64}$/.test(gameId) &&
    Number.isInteger(hand?.number) &&
    hand!.number! > 0 &&
    [hand!.board, hand!.history, hand!.players, hand!.winners].every(Array.isArray);
  if (!ok) return Response.json({ error: "bad request" }, { status: 400 });
  await saveHand(userId, gameId, hand as HandRecord);
  return Response.json({ ok: true });
}
