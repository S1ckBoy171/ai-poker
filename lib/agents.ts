// Server-only: calls to an agent's provider (Anthropic, OpenAI or OpenRouter) with the account's key.
import Anthropic from "@anthropic-ai/sdk";
import { AI_CALL_MS, type Agent } from "./config.ts";
import { system as botSystemPrompt } from "./poker.ts";

export type AgentCall = { agent: Agent; key: string; prompt: string; signal: AbortSignal; timeoutMs?: number }; // timeoutMs: AI_CALL_MS unless given

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
const RETRY_AFTER_MS = 1000; // a busy provider gets a moment before the one retry

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

/** Worth asking once more: the provider was busy (429) or failed on its side (5xx). */
export function isRetryable(error: unknown): boolean {
  const status = errorStatus(error);
  return status === 429 || (status !== undefined && status >= 500);
}

/** True when Claude declined to answer (stop reason "refusal") instead of the request failing. */
export function isRefusal(error: unknown): boolean {
  return (error as { refused?: unknown } | null)?.refused === true;
}

/**
 * The agent's reply text to one prompt, as the Bots table asks it. A busy or failing provider is asked once more,
 * and the whole turn gets `timeoutMs` (AI_CALL_MS by default). A failed request throws the provider's error; running
 * out of time throws "no answer within N s".
 */
export async function askAgent(call: AgentCall): Promise<string> {
  const timeoutMs = call.timeoutMs ?? AI_CALL_MS;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeoutMs);
  const signal = AbortSignal.any([call.signal, deadline.signal]);
  const ask = () =>
    askModel({
      agent: call.agent,
      key: call.key,
      system: botSystemPrompt(call.agent.name),
      messages: [{ role: "user", content: call.prompt }],
      signal,
    });

  try {
    try {
      return await ask();
    } catch (error) {
      if (!isRetryable(error) || signal.aborted) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS));
      return await ask();
    }
  } catch (error) {
    const outOfTime = deadline.signal.aborted && !call.signal.aborted;
    if (outOfTime) {
      throw new Error(`no answer within ${timeoutMs / 1000} s`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
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
  let text = "";
  for (const block of response.content) {
    if (block.type === "text") {
      text += block.text;
    }
  }
  return text;
}

type OpenAIResponse = { output: { type: string; content?: { type: string; text?: string }[] }[] };

async function askOpenAI({ agent, key, system, messages, schema, signal }: ModelRequest) {
  const body: Record<string, unknown> = { model: agent.model, instructions: system, input: messages };
  if (agent.effort !== "default") {
    body.reasoning = { effort: agent.effort };
  }
  if (schema) {
    body.text = { format: { type: "json_schema", name: SCHEMA_NAME, schema, strict: true } };
  }

  const response = await postJson<OpenAIResponse>("https://api.openai.com/v1/responses", key, signal, body);
  let text = "";
  for (const item of response.output) {
    if (item.type !== "message") {
      continue;
    }
    for (const part of item.content ?? []) {
      if (part.type === "output_text") {
        text += part.text ?? "";
      }
    }
  }
  return text;
}

type OpenRouterResponse = { choices?: { message?: { content?: unknown } }[] };

async function askOpenRouter({ agent, key, system, messages, schema, signal }: ModelRequest) {
  const body: Record<string, unknown> = { model: agent.model, messages: [{ role: "system", content: system }, ...messages] };
  if (agent.effort !== "default") {
    body.reasoning = { effort: agent.effort };
  }
  if (schema) {
    body.response_format = { type: "json_schema", json_schema: { name: SCHEMA_NAME, strict: true, schema } };
  }

  const response = await postJson<OpenRouterResponse>("https://openrouter.ai/api/v1/chat/completions", key, signal, body);
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
