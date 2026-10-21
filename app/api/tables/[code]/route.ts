import { requireUser } from "@/lib/guard";
import { dealFirstHand, errorResponse, joinTable, playerAction, readTable, standUp, type SeatAction } from "@/lib/tables";

// Signed in to reach a table at all; a seat belongs to the account that took it, so it is found again from any device.
const ACTION_TYPES = new Set<unknown>(["fold", "check", "call", "raise", "rebuy", "sitOut", "sitIn"]);
const isActionType = (type: unknown): type is SeatAction["type"] => ACTION_TYPES.has(type);

type TableRequest = { op?: unknown; name?: unknown; action?: { type?: unknown; amount?: unknown } };

/** The table as you see it. Polled by every player; also applies turn timeouts and deals the next hand. */
export async function GET(req: Request, ctx: RouteContext<"/api/tables/[code]">) {
  const userId = await requireUser(req);
  if (userId instanceof Response) {
    return userId;
  }
  const { code } = await ctx.params;
  try {
    return Response.json(await readTable(code, userId));
  } catch (e) {
    return errorResponse(e);
  }
}

/** Body: { op: "join", name } | { op: "deal" } | { op: "stand" } | { op: "act", action: { type, amount? } } */
export async function POST(req: Request, ctx: RouteContext<"/api/tables/[code]">) {
  const userId = await requireUser(req);
  if (userId instanceof Response) {
    return userId;
  }
  const { code } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as TableRequest;
  try {
    if (body.op === "join") {
      return Response.json({ view: await joinTable(code, userId, body.name) });
    }
    if (body.op === "deal") {
      return Response.json({ view: await dealFirstHand(code, userId) });
    }
    if (body.op === "stand") {
      await standUp(code, userId);
      return Response.json({ ok: true });
    }

    const requested = body.action ?? {};
    if (body.op !== "act" || !isActionType(requested.type)) {
      return Response.json({ error: "bad request" }, { status: 400 });
    }
    const amount = Number(requested.amount) || undefined;
    const isPokerAction = requested.type !== "rebuy" && requested.type !== "sitOut" && requested.type !== "sitIn";
    const action: SeatAction = isPokerAction ? { type: requested.type, amount } : { type: requested.type };
    return Response.json({ view: await playerAction(code, userId, action) });
  } catch (e) {
    return errorResponse(e);
  }
}
