import { requireUser } from "@/lib/guard";
import { dealFirstHand, errorResponse, joinTable, playerAction, readTable, type SeatAction } from "@/lib/tables";

// Signed in to reach a table at all; then each player's secret seat token (from creating or joining) travels in this header and proves which seat is theirs.
const tokenOf = (req: Request) => req.headers.get("x-table-token") ?? "";

const ACTION_TYPES = new Set<unknown>(["fold", "check", "call", "raise", "rebuy"]);
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
    return Response.json(await readTable(code, tokenOf(req)));
  } catch (e) {
    return errorResponse(e);
  }
}

/** Body: { op: "join", name } | { op: "deal" } | { op: "act", action: { type, amount? } } */
export async function POST(req: Request, ctx: RouteContext<"/api/tables/[code]">) {
  const userId = await requireUser(req);
  if (userId instanceof Response) {
    return userId;
  }
  const { code } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as TableRequest;
  try {
    if (body.op === "join") {
      return Response.json(await joinTable(code, tokenOf(req), body.name));
    }
    if (body.op === "deal") {
      return Response.json({ view: await dealFirstHand(code, tokenOf(req)) });
    }

    const requested = body.action ?? {};
    if (body.op !== "act" || !isActionType(requested.type)) {
      return Response.json({ error: "bad request" }, { status: 400 });
    }
    const amount = Number(requested.amount) || undefined;
    const action: SeatAction = requested.type === "rebuy" ? { type: "rebuy" } : { type: requested.type, amount };
    return Response.json({ view: await playerAction(code, tokenOf(req), action) });
  } catch (e) {
    return errorResponse(e);
  }
}
