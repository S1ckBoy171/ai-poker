// Run: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, KEY_ID, normalize } from "./config.ts";

test("missing or malformed settings fall back to the defaults", () => {
  assert.deepEqual(normalize(undefined), DEFAULTS);
  assert.deepEqual(normalize(null), DEFAULTS);
  assert.deepEqual(normalize("seats=9"), DEFAULTS);
  assert.deepEqual(normalize({}), DEFAULTS);
});

test("table options keep valid values and fix the rest", () => {
  const config = normalize({ seats: 9, speed: "fast", bb: "40", stack: "5000", rebuy: 1, topOff: "yes", playing: 0, reveal: true });
  assert.equal(config.seats, 9);
  assert.equal(config.speed, "fast");
  assert.equal(config.bb, 40);
  assert.equal(config.stack, 5000);
  assert.equal(config.rebuy, true);
  assert.equal(config.topOff, true);
  assert.equal(config.playing, false);
  assert.equal(config.reveal, true);

  const odd = normalize({ seats: 7, speed: "warp" });
  assert.equal(odd.seats, 5);
  assert.equal(odd.speed, "normal");
});

test("the big blind is a whole number of at least 2, and stacks hold at least one big blind", () => {
  assert.equal(normalize({ bb: 1 }).bb, 2);
  assert.equal(normalize({ bb: -50 }).bb, 2);
  assert.equal(normalize({ bb: 25.6 }).bb, 26);
  assert.equal(normalize({ bb: 0 }).bb, DEFAULTS.bb);
  assert.equal(normalize({ bb: "abc" }).bb, DEFAULTS.bb);

  assert.equal(normalize({ bb: 100, stack: 50 }).stack, 100);
  assert.equal(normalize({ stack: 0 }).stack, DEFAULTS.stack);
  assert.equal(normalize({ stack: "lots" }).stack, DEFAULTS.stack);
});

test("all nine seats keep valid agent settings", () => {
  const config = normalize({
    agents: [
      { name: "Ace" },
      { provider: "openai", model: "  gpt-x  ", effort: "high" },
      { provider: "bogus", effort: "extreme", name: "", model: "" },
      { name: "N".repeat(30), model: "m".repeat(130) },
    ],
  });
  assert.equal(config.agents.length, 9);
  assert.deepEqual(config.agents[0], { ...DEFAULTS.agents[0], name: "Ace" });
  assert.deepEqual(config.agents[1], { name: DEFAULTS.agents[1].name, provider: "openai", model: "gpt-x", effort: "high" });
  assert.deepEqual(config.agents[2], DEFAULTS.agents[2]);
  assert.equal(config.agents[3].name, "N".repeat(24));
  assert.equal(config.agents[3].model, "m".repeat(120));
  assert.deepEqual(config.agents.slice(4), DEFAULTS.agents.slice(4));

  assert.deepEqual(normalize({ agents: "nope" }).agents, DEFAULTS.agents);
});

test("API key ids: one per provider, plus per-seat keys for seats 0-8", () => {
  for (const id of ["anthropic", "openai", "openrouter", "seat:0", "seat:8"]) {
    assert(KEY_ID.test(id), id);
  }
  for (const id of ["seat:9", "seat:", "google", "anthropic ", "xopenai", ""]) {
    assert(!KEY_ID.test(id), id);
  }
});
