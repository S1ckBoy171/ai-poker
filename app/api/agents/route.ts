import { connection } from "next/server";
import { AGENT_LIMIT, checkAgentInput } from "@/lib/built-agents";
import { createAgent, listAgents } from "@/lib/db";
import { ownPageOnly } from "@/lib/guard";

/** This account's built agents, most recently saved first. */
export async function GET(req: Request) {
  await connection(); // always read the DB at request time
  const userId = await ownPageOnly(req);
  if (userId instanceof Response) {
    return userId;
  }
  return Response.json({ agents: await listAgents(userId) });
}

/** Body: { name, prompt, provider, model, effort, layout } - a complete agent, checked by checkAgentInput. */
export async function POST(req: Request) {
  const userId = await ownPageOnly(req);
  if (userId instanceof Response) {
    return userId;
  }

  const checked = checkAgentInput(await req.json().catch(() => null));
  if (!checked.ok) {
    return Response.json({ error: checked.error }, { status: 400 });
  }
  const created = await createAgent(userId, checked.agent);
  if (created === "limit") {
    return Response.json({ error: `You have ${AGENT_LIMIT} agents; delete one first.` }, { status: 409 });
  }
  if (created === "duplicate name") {
    return Response.json({ error: `You already have an agent named "${checked.agent.name}".` }, { status: 409 });
  }
  return Response.json({ agent: created }, { status: 201 });
}
