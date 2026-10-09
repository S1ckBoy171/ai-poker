import { askAgent, isKeyRejected } from "@/lib/agents";
import { EFFORTS, PROVIDERS, isProvider, type Effort } from "@/lib/config";
import { typedOrSavedKey } from "@/lib/db";
import { ownPageOnly } from "@/lib/guard";

const MAX_MODEL_LENGTH = 120;
const CHECK_PROMPT = 'This is a connection check. Reply with only {"action":"check"}.';

const isEffort = (value: unknown): value is Effort => EFFORTS.includes(value as Effort);

/**
 * Body: { provider, model, effort?, key? } - sends one short message to the model, the way a real turn would
 * (same effort), to prove this key may use it: a listed model can still be off-limits for a restricted key.
 * No key = the saved one.
 */
export async function POST(req: Request) {
  const userId = await ownPageOnly(req);
  if (userId instanceof Response) {
    return userId;
  }

  const body = (await req.json().catch(() => ({}))) as { provider?: unknown; model?: unknown; effort?: unknown; key?: unknown };
  const { provider } = body;
  const model = typeof body.model === "string" ? body.model.trim() : "";
  const effort = body.effort ?? "default";
  const validModel = model.length > 0 && model.length <= MAX_MODEL_LENGTH;
  if (!isProvider(provider) || !validModel || !isEffort(effort)) {
    return Response.json({ error: "bad request" }, { status: 400 });
  }

  const { label } = PROVIDERS[provider];
  const key = await typedOrSavedKey(userId, provider, body.key);
  if (!key) {
    return Response.json({ error: `Enter your ${label} API key.` }, { status: 400 });
  }

  try {
    const agent = { name: "Check", provider, model, effort };
    await askAgent({ agent, key, prompt: CHECK_PROMPT, signal: req.signal });
    return Response.json({ ok: true });
  } catch (e) {
    if (isKeyRejected(e)) {
      return Response.json({ error: `${label} rejected this API key for ${model}.` }, { status: 401 });
    }
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
