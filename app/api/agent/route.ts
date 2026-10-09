import { askAgent } from "@/lib/agents";
import { PROVIDERS } from "@/lib/config";
import { getAgentKey, getConfig } from "@/lib/db";
import { ownPageOnly } from "@/lib/guard";

const MAX_PROMPT_LENGTH = 20_000;

/** Body: { seat, prompt }. Provider, model, effort and key come from this account's saved settings, never from the browser. */
export async function POST(req: Request) {
  const userId = await ownPageOnly(req);
  if (userId instanceof Response) {
    return userId;
  }

  const { seat, prompt } = (await req.json().catch(() => ({}))) as { seat?: unknown; prompt?: unknown };
  const badRequest = () => Response.json({ error: "bad request" }, { status: 400 });
  if (typeof seat !== "number" || !Number.isInteger(seat)) {
    return badRequest();
  }
  const agent = (await getConfig(userId)).agents[seat];
  const validPrompt = typeof prompt === "string" && prompt.length <= MAX_PROMPT_LENGTH;
  if (!agent || !validPrompt) {
    return badRequest();
  }

  const key = await getAgentKey(userId, seat, agent.provider);
  if (!key) {
    return Response.json({ error: `no ${PROVIDERS[agent.provider].label} API key saved` }, { status: 400 });
  }

  try {
    const text = await askAgent({ agent, key, prompt, signal: req.signal });
    return Response.json({ text });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
