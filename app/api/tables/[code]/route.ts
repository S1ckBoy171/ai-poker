import { dealFirstHand, failure, joinTable, playerAction, readTable } from "@/lib/tables";

// Each player's secret token (from creating or joining) travels in this header and is the only proof of who they are.
const tokenOf = (req: Request) => req.headers.get("x-table-token") ?? "";
const ACTIONS = new Set(["fold", "check", "call", "raise", "rebuy"]);

/** The table as you see it. Polled by every player; also applies turn timeouts and deals the next hand. */
export async function GET(req: Request, ctx: RouteContext<"/api/tables/[code]">) {
  const { code } = await ctx.params;
  try {
    return Response.json(await readTable(code, tokenOf(req)));
  } catch (e) {
    return failure(e);
  }
}

/** Body: { op: "join", name } | { op: "deal" } | { op: "act", action: { type, amount? } } */
export async function POST(req: Request, ctx: RouteContext<"/api/tables/[code]">) {
  const { code } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  try {
    if (body.op === "join") return Response.json(await joinTable(code, tokenOf(req), body.name));
    if (body.op === "deal") return Response.json({ view: await dealFirstHand(code, tokenOf(req)) });
    const a = body.action ?? {};
    if (body.op !== "act" || !ACTIONS.has(a.type)) return Response.json({ error: "bad request" }, { status: 400 });
    return Response.json({ view: await playerAction(code, tokenOf(req), { type: a.type, amount: Number(a.amount) || undefined }) });
  } catch (e) {
    return failure(e);
  }
}
