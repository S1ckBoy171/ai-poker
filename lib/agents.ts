// Server-only: one agent turn sent to its provider (Anthropic, OpenAI or OpenRouter) with the account's key.
import Anthropic from "@anthropic-ai/sdk";
import type { Agent } from "./config";
import { system } from "./poker";

export type AgentCall = { agent: Agent; key: string; prompt: string; signal: AbortSignal };

/** True when the provider refused the API key itself (401 or 403), as opposed to the request. */
export function isKeyRejected(error: unknown): boolean {
  const status = error instanceof Anthropic.APIError ? error.status : (error as { status?: number }).status;
  return status === 401 || status === 403;
}

/** The agent's reply text. A failed request throws the provider's error, carrying its HTTP status. */
export function askAgent(call: AgentCall): Promise<string> {
  if (call.agent.provider === "anthropic") {
    return askClaude(call);
  }
  if (call.agent.provider === "openai") {
    return askOpenAI(call);
  }
  return askOpenRouter(call);
}

async function askClaude({ agent, key, prompt, signal }: AgentCall) {
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

async function askOpenAI({ agent, key, prompt, signal }: AgentCall) {
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

async function askOpenRouter({ agent, key, prompt, signal }: AgentCall) {
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

/** POST JSON with a bearer key; a failed status throws the provider's own error message, carrying the HTTP status. */
async function postJson<T>(url: string, key: string, signal: AbortSignal, body: object): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = json.error?.message ?? `HTTP ${response.status}`;
    throw Object.assign(new Error(message), { status: response.status });
  }
  return json as T;
}
