// Run: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelOption } from "./config.ts";
import { defaultModel, fitToKeys, numberRepeats, seatNameFor, type BotChoice, type Catalog } from "./match-bots.ts";

const ANTHROPIC: ModelOption[] = [
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", effort: false },
  { id: "claude-opus-5-5", name: "Claude Opus 5.5", effort: true },
];
const OPENROUTER: ModelOption[] = [{ id: "google/gemini-3.8-flash", name: "Google: Gemini 3.8 Flash", effort: true }];

const bot = (patch: Partial<BotChoice> = {}): BotChoice => ({
  name: "Old name",
  provider: "openai",
  model: "gpt-6.1-sol",
  effort: "high",
  nameEdited: false,
  ...patch,
});

test("a provider's default model: our usual pick when the key offers it, else the newest listed", () => {
  assert.equal(defaultModel("anthropic", ANTHROPIC), "claude-opus-5-5");
  assert.equal(defaultModel("anthropic", [{ id: "claude-new-6", name: "Claude New 6" }]), "claude-new-6");
  assert.equal(defaultModel("openai", []), "");
});

test("seat names come from the model's display name, or the typed OpenRouter id", () => {
  assert.equal(seatNameFor("google/gemini-3.8-flash", OPENROUTER[0]), "Gemini 3.8 Flash");
  assert.equal(seatNameFor("claude-opus-5-5", ANTHROPIC[1]), "Opus 5.5");
  assert.equal(seatNameFor("qwen/qwen3.8-max-prime", undefined), "qwen3.8-max-prime");
  assert.equal(seatNameFor("x", { id: "x", name: "A Very Long Model Display Name" }).length, 18);
});

test("bots sharing a name are numbered from the second on", () => {
  assert.deepEqual(numberRepeats(["Opus 5.5", "Opus 5.5", "Haiku 4.5", "Opus 5.5"]), ["Opus 5.5", "Opus 5.5 2", "Haiku 4.5", "Opus 5.5 3"]);
});

test("before any key works, a bot stays as it is", () => {
  const unchanged = bot();
  assert.equal(fitToKeys(unchanged, new Map()), unchanged);
});

test("a bot on a provider without a working key moves to the first provider that has one", () => {
  const catalog: Catalog = new Map([
    ["anthropic", ANTHROPIC],
    ["openrouter", OPENROUTER],
  ]);
  const fitted = fitToKeys(bot(), catalog);
  assert.equal(fitted.provider, "anthropic");
  assert.equal(fitted.model, "claude-opus-5-5");
  assert.equal(fitted.name, "Opus 5.5", "the name follows the model");
  assert.equal(fitted.effort, "high");
});

test("a listed model is kept; a model the key doesn't list falls back to the default", () => {
  const catalog: Catalog = new Map([["anthropic", ANTHROPIC]]);
  assert.equal(fitToKeys(bot({ provider: "anthropic", model: "claude-haiku-4-5" }), catalog).model, "claude-haiku-4-5");
  assert.equal(fitToKeys(bot({ provider: "anthropic", model: "claude-gone-1" }), catalog).model, "claude-opus-5-5");
});

test("OpenRouter models are typed: anything typed is kept, even an empty field mid-edit", () => {
  const catalog: Catalog = new Map([["openrouter", OPENROUTER]]);
  const typed = fitToKeys(bot({ provider: "openrouter", model: "qwen/qwen3.8-max-prime" }), catalog);
  assert.equal(typed.model, "qwen/qwen3.8-max-prime");
  assert.equal(typed.name, "qwen3.8-max-prime");
  assert.equal(fitToKeys(bot({ provider: "openrouter", model: "" }), catalog).model, "");
});

test("a typed name stays, and a model without adjustable effort plays at its default effort", () => {
  const catalog: Catalog = new Map([["anthropic", ANTHROPIC]]);
  const fitted = fitToKeys(bot({ provider: "anthropic", model: "claude-haiku-4-5", name: "Mine", nameEdited: true }), catalog);
  assert.equal(fitted.name, "Mine");
  assert.equal(fitted.effort, "default");
});
