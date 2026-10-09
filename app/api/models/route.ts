import Anthropic from "@anthropic-ai/sdk";
import { PROVIDERS, type Provider } from "@/lib/config";
import { getKey } from "@/lib/db";
import { ownPageOnly } from "@/lib/guard";

export type ModelOption = { id: string; name: string };

const MAX = 100; // newest first; OpenRouter alone lists several hundred
// OpenAI's list also has embedding, audio, image and moderation models that can't play a hand.
const OPENAI_CHAT = /^(gpt-|o\d|chatgpt-)/;
const OPENAI_NOT_CHAT = /(audio|realtime|tts|transcribe|image|embedding|moderation|search|whisper|dall-e|instruct)/;

/** Body: { provider, key? } - checks the key with the provider and lists the models it can use. No key = the saved one. */
export async function POST(req: Request) {
  const denied = ownPageOnly(req);
  if (denied) return denied;
  const { provider, key: typed } = (await req.json().catch(() => ({}))) as { provider?: unknown; key?: unknown };
  if (typeof provider !== "string" || !Object.hasOwn(PROVIDERS, provider)) return Response.json({ error: "bad request" }, { status: 400 });
  const p = provider as Provider;
  const key = (typeof typed === "string" && typed.trim().slice(0, 400)) || (await getKey(p));
  if (!key) return Response.json({ error: `Enter your ${PROVIDERS[p].label} API key.` }, { status: 400 });
  try {
    const models = p === "anthropic" ? await anthropic(key, req.signal) : p === "openai" ? await openai(key, req.signal) : await openrouter(key, req.signal);
    return Response.json({ models: models.slice(0, MAX), total: models.length });
  } catch (e) {
    const status = e instanceof Anthropic.APIError ? e.status : (e as { status?: number }).status;
    const rejected = status === 401 || status === 403;
    return Response.json({ error: rejected ? `${PROVIDERS[p].label} rejected this API key.` : (e as Error).message }, { status: rejected ? 401 : 502 });
  }
}

async function anthropic(key: string, signal: AbortSignal): Promise<ModelOption[]> {
  const out: ModelOption[] = [];
  for await (const m of new Anthropic({ apiKey: key }).models.list({ lifecycle: ["active"], limit: 100 }, { signal })) {
    out.push({ id: m.id, name: m.display_name });
    if (out.length >= MAX) break;
  }
  return out; // the API lists newest first
}

async function openai(key: string, signal: AbortSignal): Promise<ModelOption[]> {
  const { data } = await get("https://api.openai.com/v1/models", key, signal);
  return (data as { id: string; created: number }[])
    .filter((m) => OPENAI_CHAT.test(m.id) && !OPENAI_NOT_CHAT.test(m.id))
    .sort((a, b) => b.created - a.created)
    .map((m) => ({ id: m.id, name: m.id }));
}

async function openrouter(key: string, signal: AbortSignal): Promise<ModelOption[]> {
  await get("https://openrouter.ai/api/v1/key", key, signal); // the model list is public, so check the key on its own
  const { data } = await get("https://openrouter.ai/api/v1/models", key, signal);
  return (data as { id: string; name: string; created: number; architecture?: { output_modalities?: string[] } }[])
    .filter((m) => m.architecture?.output_modalities?.includes("text") ?? true)
    .sort((a, b) => b.created - a.created)
    .map((m) => ({ id: m.id, name: m.name }));
}

async function get(url: string, key: string, signal: AbortSignal) {
  const res = await fetch(url, { signal, headers: { Authorization: `Bearer ${key}` } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error?.message ?? `HTTP ${res.status}`), { status: res.status });
  return json;
}
