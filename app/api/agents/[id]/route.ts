import { connection } from "next/server";
import { checkAgentInput } from "@/lib/built-agents";
import { deleteAgent, getAgent, updateAgent } from "@/lib/db";
import { ownPageOnly } from "@/lib/guard";

// Another account's agent id gets the same answer as an id that doesn't exist.
const notFound = () => Response.json({ error: "No agent with that id." }, { status: 404 });

/** One of this account's agents, with its prompt and canvas layout. */
export async function GET(req: Request, ctx: RouteContext<"/api/agents/[id]">) {
  await connection(); // always read the DB at request time
  const userId = await ownPageOnly(req);
  if (userId instanceof Response) {
    return userId;
  }
  const { id } = await ctx.params;
  const agent = await getAgent(userId, id);
  return agent ? Response.json({ agent }) : notFound();
}

/** Body: the whole agent, as for POST /api/agents. */
export async function PUT(req: Request, ctx: RouteContext<"/api/agents/[id]">) {
  const userId = await ownPageOnly(req);
  if (userId instanceof Response) {
    return userId;
  }
  const { id } = await ctx.params;

  const checked = checkAgentInput(await req.json().catch(() => null));
  if (!checked.ok) {
    return Response.json({ error: checked.error }, { status: 400 });
  }
  const saved = await updateAgent(userId, id, checked.agent);
  if (saved === "not found") {
    return notFound();
  }
  if (saved === "duplicate name") {
    return Response.json({ error: `You already have an agent named "${checked.agent.name}".` }, { status: 409 });
  }
  return Response.json({ agent: saved });
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/agents/[id]">) {
  const userId = await ownPageOnly(req);
  if (userId instanceof Response) {
    return userId;
  }
  const { id } = await ctx.params;
  const deleted = await deleteAgent(userId, id);
  return deleted ? new Response(null, { status: 204 }) : notFound();
}
