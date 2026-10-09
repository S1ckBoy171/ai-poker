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
  const userId = await ownPageOnly(req);
  if (userId instanceof Response) {
    return userId;
  }

  const { provider, key: typedKey } = (await req.json().catch(() => ({}))) as { provider?: unknown; key?: unknown };
  if (typeof provider !== "string" || !Object.hasOwn(PROVIDERS, provider)) {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  const chosen = provider as Provider;
  const { label } = PROVIDERS[chosen];
  const key = (typeof typedKey === "string" && typedKey.trim().slice(0, 400)) || (await getKey(userId, chosen));
  if (!key) {
    return Response.json({ error: `Enter your ${label} API key.` }, { status: 400 });
  }

  try {
    const models = await listModels(chosen, key, req.signal);
    return Response.json({ models: models.slice(0, MAX), total: models.length });
  } catch (e) {
    const status = e instanceof Anthropic.APIError ? e.status : (e as { status?: number }).status;
    const rejected = status === 401 || status === 403;
    if (rejected) {
      return Response.json({ error: `${label} rejected this API key.` }, { status: 401 });
    }
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}

function listModels(provider: Provider, key: string, signal: AbortSignal): Promise<ModelOption[]> {
  if (provider === "anthropic") {
    return anthropicModels(key, signal);
  }
  if (provider === "openai") {
    return openAIModels(key, signal);
  }
  return openRouterModels(key, signal);
}

async function anthropicModels(key: string, signal: AbortSignal): Promise<ModelOption[]> {
  const models: ModelOption[] = [];
  for await (const model of new Anthropic({ apiKey: key }).models.list({ lifecycle: ["active"], limit: 100 }, { signal })) {
    models.push({ id: model.id, name: model.display_name });
    if (models.length >= MAX) {
      break;
    }
  }
  return models; // the API lists newest first
}

async function openAIModels(key: string, signal: AbortSignal): Promise<ModelOption[]> {
  const { data } = await getJson<{ data: { id: string; created: number }[] }>("https://api.openai.com/v1/models", key, signal);
  return data
    .filter((model) => OPENAI_CHAT.test(model.id) && !OPENAI_NOT_CHAT.test(model.id))
    .sort((a, b) => b.created - a.created)
    .map((model) => ({ id: model.id, name: model.id }));
}

type OpenRouterModel = { id: string; name: string; created: number; architecture?: { output_modalities?: string[] } };

async function openRouterModels(key: string, signal: AbortSignal): Promise<ModelOption[]> {
  await getJson("https://openrouter.ai/api/v1/key", key, signal); // the model list is public, so check the key on its own
  const { data } = await getJson<{ data: OpenRouterModel[] }>("https://openrouter.ai/api/v1/models", key, signal);
  return data
    .filter((model) => model.architecture?.output_modalities?.includes("text") ?? true)
    .sort((a, b) => b.created - a.created)
    .map((model) => ({ id: model.id, name: model.name }));
}

/** GET JSON with a bearer key; a failed status throws the provider's message, carrying the HTTP status. */
async function getJson<T>(url: string, key: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, headers: { Authorization: `Bearer ${key}` } });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = json.error?.message ?? `HTTP ${response.status}`;
    throw Object.assign(new Error(message), { status: response.status });
  }
  return json as T;
}
