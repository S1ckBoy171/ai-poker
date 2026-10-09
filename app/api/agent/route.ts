import Anthropic from "@anthropic-ai/sdk";
import { PROVIDERS, type Agent } from "@/lib/config";
import { getAgentKey, getConfig } from "@/lib/db";
import { ownPageOnly } from "@/lib/guard";
import { system } from "@/lib/poker";

const MAX_PROMPT_LENGTH = 20_000;

type Call = { agent: Agent; key: string; prompt: string; signal: AbortSignal };

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

function askAgent(call: Call): Promise<string> {
  if (call.agent.provider === "anthropic") {
    return askClaude(call);
  }
  if (call.agent.provider === "openai") {
    return askOpenAI(call);
  }
  return askOpenRouter(call);
}

async function askClaude({ agent, key, prompt, signal }: Call) {
  const reasoning = agent.effort !== "default" && { thinking: { type: "adaptive" as const }, output_config: { effort: agent.effort } };
  const response = await new Anthropic({ apiKey: key }).messages.create(
    {
      model: agent.model,
      max_tokens: 16000,
      system: system(agent.name),
      messages: [{ role: "user", content: prompt }],
      ...reasoning,
    },
    { signal },
  );
  if (response.stop_reason === "refusal") {
    throw new Error("model declined to answer");
  }
  return response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
}

type OpenAIResponse = { output: { type: string; content?: { type: string; text?: string }[] }[] };

async function askOpenAI({ agent, key, prompt, signal }: Call) {
  const response = await postJson<OpenAIResponse>("https://api.openai.com/v1/responses", key, signal, {
    model: agent.model,
    instructions: system(agent.name),
    input: prompt,
    ...(agent.effort !== "default" && { reasoning: { effort: agent.effort } }),
  });
  return response.output
    .flatMap((item) => (item.type === "message" ? (item.content ?? []) : []))
    .map((part) => (part.type === "output_text" ? part.text : ""))
    .join("");
}

type OpenRouterResponse = { choices?: { message?: { content?: unknown } }[] };

async function askOpenRouter({ agent, key, prompt, signal }: Call) {
  const response = await postJson<OpenRouterResponse>("https://openrouter.ai/api/v1/chat/completions", key, signal, {
    model: agent.model,
    messages: [
      { role: "system", content: system(agent.name) },
      { role: "user", content: prompt },
    ],
    ...(agent.effort !== "default" && { reasoning: { effort: agent.effort } }),
  });
  return String(response.choices?.[0]?.message?.content ?? "");
}

/** POST JSON with a bearer key; a failed status throws the provider's own error message. */
async function postJson<T>(url: string, key: string, signal: AbortSignal, body: object): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error?.message ?? `HTTP ${response.status}`);
  }
  return json as T;
}
