import { askModel } from "@/lib/agents";
import { PROVIDERS, TURN_SECONDS, isTurnSeconds } from "@/lib/config";
import { getAgent, getKey } from "@/lib/db";
import { ownPageOnly } from "@/lib/guard";
import { playStrictTurn } from "@/lib/strict-turn";
import { sampleSpot } from "@/lib/turn-rules";

/**
 * Body: { turnSeconds } - plays one strict turn for the saved agent on a random sample hand, with real (paid) calls to
 * its provider on this account's key. The answer is the whole turn: briefing, every attempt and the final move.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/agents/[id]/test">) {
  const userId = await ownPageOnly(req);
  if (userId instanceof Response) {
    return userId;
  }
  const { id } = await ctx.params;

  const { turnSeconds } = (await req.json().catch(() => ({}))) as { turnSeconds?: unknown };
  if (!isTurnSeconds(turnSeconds)) {
    return Response.json({ error: `Pick a turn time of ${TURN_SECONDS.join(", ")} seconds.` }, { status: 400 });
  }
  const agent = await getAgent(userId, id);
  if (!agent) {
    return Response.json({ error: "No agent with that id." }, { status: 404 });
  }
  const key = await getKey(userId, agent.provider);
  if (!key) {
    return Response.json({ error: `Add your ${PROVIDERS[agent.provider].label} API key first.` }, { status: 400 });
  }

  const result = await playStrictTurn({
    agent,
    prompt: agent.prompt,
    key,
    game: sampleSpot(agent.name),
    turnMs: turnSeconds * 1000,
    signal: req.signal,
    ask: askModel,
  });
  return Response.json(result);
}
