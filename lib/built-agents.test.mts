// Run: npm test
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { checkAgentInput, isAllowedWire, newAgentLayout, REQUIRED_WIRES, whatIsMissing, type AgentLayout } from "./built-agents.ts";

const wiredLayout = (): AgentLayout => ({ ...newAgentLayout(), wires: [...REQUIRED_WIRES] });

const validInput = () => ({
  name: "  River Shark ",
  prompt: "Play tight preflop and bluff the river.\n",
  provider: "openrouter",
  model: " x-ai/grok-4.7 ",
  effort: "low",
  layout: wiredLayout(),
});

function expectError(raw: unknown, errorPart: string) {
  const result = checkAgentInput(raw);
  assert.equal(result.ok, false, `expected ${JSON.stringify(raw).slice(0, 80)} to be refused`);
  if (!result.ok) {
    assert.ok(result.error.includes(errorPart), `"${result.error}" should mention "${errorPart}"`);
  }
}

describe("saving an agent", () => {
  test("a complete agent is accepted, with names, prompts and models trimmed", () => {
    const result = checkAgentInput(validInput());
    assert.deepEqual(result, {
      ok: true,
      agent: {
        name: "River Shark",
        prompt: "Play tight preflop and bluff the river.",
        provider: "openrouter",
        model: "x-ai/grok-4.7",
        effort: "low",
        layout: wiredLayout(),
      },
    });
  });

  test("names, prompts and models must fit their limits", () => {
    expectError({ ...validInput(), name: "   " }, "name");
    expectError({ ...validInput(), name: "x".repeat(25) }, "name");
    expectError({ ...validInput(), prompt: "" }, "prompt");
    expectError({ ...validInput(), prompt: "x".repeat(4001) }, "prompt");
    expectError({ ...validInput(), model: "" }, "model");
    expectError({ ...validInput(), model: "m".repeat(121) }, "model");
  });

  test("the provider and effort must be ones the app knows", () => {
    expectError({ ...validInput(), provider: "acme" }, "provider");
    expectError({ ...validInput(), effort: "extreme" }, "effort");
    expectError(null, "name");
  });

  test("the chain must be fully wired", () => {
    const missingPromptWire = { ...newAgentLayout(), wires: REQUIRED_WIRES.filter((wire) => wire.from !== "prompt") };
    expectError({ ...validInput(), layout: missingPromptWire }, "Connect the Prompt to the Model");
    const withoutPromptNode: AgentLayout = { positions: { ...wiredLayout().positions, prompt: undefined }, wires: wiredLayout().wires };
    expectError({ ...validInput(), layout: withoutPromptNode }, "Add a Prompt node");
  });

  test("a layout with unknown nodes, bad positions, disallowed wires or too much data is refused", () => {
    const layout = wiredLayout();
    expectError({ ...validInput(), layout: { ...layout, positions: { ...layout.positions, extra: { x: 0, y: 0 } } } }, "layout");
    expectError({ ...validInput(), layout: { ...layout, positions: { ...layout.positions, table: { x: "left", y: 0 } } } }, "layout");
    expectError({ ...validInput(), layout: { ...layout, wires: [...layout.wires, { from: "output", to: "table" }] } }, "layout");
    expectError({ ...validInput(), layout: { ...layout, note: "x".repeat(10_001) } }, "layout");
    expectError({ ...validInput(), layout: "not a layout" }, "layout");
  });
});

describe("the canvas rules", () => {
  test("only the chain's three wires can be drawn", () => {
    assert.equal(isAllowedWire("table", "model"), true);
    assert.equal(isAllowedWire("prompt", "model"), true);
    assert.equal(isAllowedWire("model", "output"), true);
    assert.equal(isAllowedWire("prompt", "output"), false);
    assert.equal(isAllowedWire("model", "table"), false);
    assert.equal(isAllowedWire("output", "model"), false);
  });

  test("the status says the first thing missing, in the order a player builds", () => {
    const layout = newAgentLayout();
    assert.equal(whatIsMissing({ prompt: "", model: "", layout }), "Write the agent's prompt.");
    assert.equal(whatIsMissing({ prompt: "Bluff a lot.", model: "", layout }), "Choose a model.");
    assert.equal(whatIsMissing({ prompt: "Bluff a lot.", model: "m", layout }), "Connect the Table state to the Model.");
    assert.equal(whatIsMissing({ prompt: "Bluff a lot.", model: "m", layout: wiredLayout() }), null);
    const noModelNode: AgentLayout = { positions: { ...layout.positions, model: undefined }, wires: [] };
    assert.equal(whatIsMissing({ prompt: "", model: "", layout: noModelNode }), "Add a Model node.");
  });
});
