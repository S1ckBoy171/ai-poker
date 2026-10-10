// Run: npm test
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { askModel, errorStatus, isKeyRejected, isRefusal, type ModelRequest } from "./agents.ts";

// No real provider is called: fetch is replaced, and each test answers the way that provider would.
type SentRequest = { url: string; body: Record<string, unknown> };
const sent: SentRequest[] = [];
const realFetch = globalThis.fetch;

function answerWith(status: number, reply: unknown) {
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    sent.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(JSON.stringify(reply), { status, headers: { "content-type": "application/json" } });
  };
}

afterEach(() => {
  globalThis.fetch = realFetch;
  sent.length = 0;
});

const SCHEMA = { type: "object", properties: { action: { type: "string", enum: ["call"] } }, required: ["action"], additionalProperties: false };

function request(provider: ModelRequest["agent"]["provider"], options: Partial<ModelRequest> = {}): ModelRequest {
  return {
    agent: { provider, model: "some-model", effort: "default" },
    key: "test-key",
    system: "You are a careful player.",
    messages: [
      { role: "user", content: "Your turn." },
      { role: "assistant", content: '{"action":"check"}' },
      { role: "user", content: "Rejected: you owe 10." },
    ],
    signal: new AbortController().signal,
    ...options,
  };
}

const CLAUDE_REPLY = {
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "some-model",
  content: [{ type: "text", text: '{"action":"call"}' }],
  stop_reason: "end_turn",
  usage: { input_tokens: 1, output_tokens: 1 },
};
const OPENAI_REPLY = { output: [{ type: "message", content: [{ type: "output_text", text: '{"action":"call"}' }] }] };
const OPENROUTER_REPLY = { choices: [{ message: { content: '{"action":"call"}' } }] };

describe("calling a model", () => {
  test("Anthropic gets the system prompt, every message in order, and the schema with the effort", async () => {
    answerWith(200, CLAUDE_REPLY);
    const text = await askModel(request("anthropic", { schema: SCHEMA, agent: { provider: "anthropic", model: "some-model", effort: "low" } }));

    assert.equal(text, '{"action":"call"}');
    const [{ url, body }] = sent;
    assert.ok(url.endsWith("/v1/messages"));
    assert.equal(body.system, "You are a careful player.");
    assert.deepEqual(body.messages, request("anthropic").messages);
    assert.deepEqual(body.output_config, { effort: "low", format: { type: "json_schema", schema: SCHEMA } });
    assert.deepEqual(body.thinking, { type: "adaptive" });
  });

  test("OpenAI gets the instructions, the messages as input, and the schema in strict mode", async () => {
    answerWith(200, OPENAI_REPLY);
    const text = await askModel(request("openai", { schema: SCHEMA }));

    assert.equal(text, '{"action":"call"}');
    const [{ url, body }] = sent;
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(body.instructions, "You are a careful player.");
    assert.deepEqual(body.input, request("openai").messages);
    assert.deepEqual(body.text, { format: { type: "json_schema", name: "poker_move", schema: SCHEMA, strict: true } });
  });

  test("OpenRouter gets the system prompt first, then the messages, and the schema as the response format", async () => {
    answerWith(200, OPENROUTER_REPLY);
    const text = await askModel(request("openrouter", { schema: SCHEMA }));

    assert.equal(text, '{"action":"call"}');
    const [{ body }] = sent;
    assert.deepEqual(body.messages, [{ role: "system", content: "You are a careful player." }, ...request("openrouter").messages]);
    assert.deepEqual(body.response_format, { type: "json_schema", json_schema: { name: "poker_move", strict: true, schema: SCHEMA } });
  });

  test("without a schema, no answer format is sent", async () => {
    answerWith(200, OPENAI_REPLY);
    await askModel(request("openai"));
    answerWith(200, OPENROUTER_REPLY);
    await askModel(request("openrouter"));
    answerWith(200, CLAUDE_REPLY);
    await askModel(request("anthropic"));

    const [openai, openrouter, anthropic] = sent;
    assert.equal(openai.body.text, undefined);
    assert.equal(openrouter.body.response_format, undefined);
    assert.equal(anthropic.body.output_config, undefined);
  });
});

describe("provider failures", () => {
  test("an HTTP error carries its status, and 401 means the key was rejected", async () => {
    answerWith(401, { error: { message: "bad key" } });
    const error = await askModel(request("openrouter")).catch((e: unknown) => e);
    assert.equal(errorStatus(error), 401);
    assert.equal(isKeyRejected(error), true);
    assert.equal(isRefusal(error), false);
  });

  test("Claude declining to answer is recognized as a refusal", async () => {
    answerWith(200, { ...CLAUDE_REPLY, content: [], stop_reason: "refusal" });
    const error = await askModel(request("anthropic")).catch((e: unknown) => e);
    assert.equal(isRefusal(error), true);
    assert.equal(errorStatus(error), undefined);
  });
});
