// Server-only: calls to an agent's provider (Anthropic, OpenAI or OpenRouter) with the account's key.
import Anthropic from "@anthropic-ai/sdk";
import type { Agent } from "./config.ts";
import { system as botSystemPrompt } from "./poker.ts";

export type AgentCall = { agent: Agent; key: string; prompt: string; signal: AbortSignal };

/** One turn of a conversation with a model. A conversation starts with the user. */
export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ModelSettings = Pick<Agent, "provider" | "model" | "effort">;

/** A call to a model: its instructions, the conversation so far and, optionally, the JSON schema its answer must follow. */
export type ModelRequest = {
  agent: ModelSettings;
  key: string;
  system: string;
  messages: ChatMessage[];
  schema?: Record<string, unknown>;
  signal: AbortSignal;
};

const MAX_TOKENS = 16000;
const SCHEMA_NAME = "poker_move";

/** The HTTP status a provider answered a failed request with, if there was one. */
export function errorStatus(error: unknown): number | undefined {
  if (error instanceof Anthropic.APIError) {
    return error.status;
  }
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

/** True when the provider refused the API key itself (401 or 403), as opposed to the request. */
export function isKeyRejected(error: unknown): boolean {
  const status = errorStatus(error);
  return status === 401 || status === 403;
}

/** True when Claude declined to answer (stop reason "refusal") instead of the request failing. */
export function isRefusal(error: unknown): boolean {
  return (error as { refused?: unknown } | null)?.refused === true;
}

/** The agent's reply text to one prompt, as the Bots table asks it. A failed request throws the provider's error. */
export function askAgent(call: AgentCall): Promise<string> {
  return askModel({
    agent: call.agent,
    key: call.key,
    system: botSystemPrompt(call.agent.name),
    messages: [{ role: "user", content: call.prompt }],
    signal: call.signal,
  });
}

/** The model's reply text. A failed request throws the provider's error, carrying its HTTP status. */
export function askModel(request: ModelRequest): Promise<string> {
  if (request.agent.provider === "anthropic") {
    return askClaude(request);
  }
  if (request.agent.provider === "openai") {
    return askOpenAI(request);
  }
  return askOpenRouter(request);
}

async function askClaude({ agent, key, system, messages, schema, signal }: ModelRequest) {
  const params: Anthropic.MessageCreateParamsNonStreaming = { model: agent.model, max_tokens: MAX_TOKENS, system, messages };
  if (agent.effort !== "default") {
    params.thinking = { type: "adaptive" };
    params.output_config = { effort: agent.effort };
  }
  if (schema) {
    params.output_config = { ...params.output_config, format: { type: "json_schema", schema } };
  }

  const response = await new Anthropic({ apiKey: key }).messages.create(params, { signal });
  if (response.stop_reason === "refusal") {
    throw Object.assign(new Error("model declined to answer"), { refused: true });
  }
  return response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
}

type OpenAIResponse = { output: { type: string; content?: { type: string; text?: string }[] }[] };

async function askOpenAI({ agent, key, system, messages, schema, signal }: ModelRequest) {
  const response = await postJson<OpenAIResponse>("https://api.openai.com/v1/responses", key, signal, {
    model: agent.model,
    instructions: system,
    input: messages,
    ...(agent.effort !== "default" && { reasoning: { effort: agent.effort } }),
    ...(schema && { text: { format: { type: "json_schema", name: SCHEMA_NAME, schema, strict: true } } }),
  });
  return response.output
    .flatMap((item) => (item.type === "message" ? (item.content ?? []) : []))
    .map((part) => (part.type === "output_text" ? part.text : ""))
    .join("");
}

type OpenRouterResponse = { choices?: { message?: { content?: unknown } }[] };

async function askOpenRouter({ agent, key, system, messages, schema, signal }: ModelRequest) {
  const response = await postJson<OpenRouterResponse>("https://openrouter.ai/api/v1/chat/completions", key, signal, {
    model: agent.model,
    messages: [{ role: "system", content: system }, ...messages],
    ...(agent.effort !== "default" && { reasoning: { effort: agent.effort } }),
    ...(schema && { response_format: { type: "json_schema", json_schema: { name: SCHEMA_NAME, strict: true, schema } } }),
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
