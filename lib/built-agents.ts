// Player-built agents as they are saved: the limits on names and prompts, the model settings, and the canvas the
// agent was built on. Part 1 agents are one chain: Table state + Prompt -> Model -> Output.
import { EFFORTS, isProvider, type Effort, type Provider } from "./config.ts";

export const AGENT_LIMIT = 10;
export const MAX_AGENT_NAME = 24;
export const MAX_PROMPT_LENGTH = 4000;
const MAX_MODEL_LENGTH = 120;
const MAX_LAYOUT_LENGTH = 10_000; // characters of JSON
const BAD_LAYOUT = "The canvas layout is invalid. Reload the agent and try again.";

export type NodeId = "table" | "prompt" | "model" | "output";
export const NODE_IDS: NodeId[] = ["table", "prompt", "model", "output"];
export const NODE_LABELS: Record<NodeId, string> = { table: "Table state", prompt: "Prompt", model: "Model", output: "Output" };

export type Wire = { from: NodeId; to: NodeId };
export type NodePosition = { x: number; y: number };

/** Where each node sits on the canvas (Prompt and Model may have been removed) and the wires drawn between them. */
export type AgentLayout = { positions: Partial<Record<NodeId, NodePosition>>; wires: Wire[] };

export type AgentInput = { name: string; prompt: string; provider: Provider; model: string; effort: Effort; layout: AgentLayout };
/** Everything about an agent except its canvas. */
export type AgentFields = Omit<AgentInput, "layout">;
export type SavedAgent = AgentInput & { id: string; updatedAt: string };
export type AgentSummary = Pick<SavedAgent, "id" | "name" | "provider" | "model" | "effort" | "updatedAt">;

/** The chain every agent needs, in the order a player builds it. These are also the only wires that can be drawn. */
export const REQUIRED_WIRES: Wire[] = [
  { from: "table", to: "model" },
  { from: "prompt", to: "model" },
  { from: "model", to: "output" },
];

export type CheckedAgent = { ok: true; agent: AgentInput } | { ok: false; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const isNodeId = (value: unknown): value is NodeId => NODE_IDS.some((id) => id === value);

const isEffort = (value: unknown): value is Effort => EFFORTS.some((effort) => effort === value);

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function isAllowedWire(from: string, to: string): boolean {
  return REQUIRED_WIRES.some((wire) => wire.from === from && wire.to === to);
}

/** A new agent's canvas: all four nodes placed left to right, nothing wired yet. */
export function newAgentLayout(): AgentLayout {
  return {
    positions: {
      table: { x: 0, y: 0 },
      prompt: { x: 0, y: 170 },
      model: { x: 280, y: 85 },
      output: { x: 560, y: 85 },
    },
    wires: [],
  };
}

/** The first thing an agent still needs before it can be saved, or null when it is complete. */
export function whatIsMissing(agent: { prompt: string; model: string; layout: AgentLayout }): string | null {
  if (!agent.layout.positions.prompt) {
    return "Add a Prompt node.";
  }
  if (!agent.layout.positions.model) {
    return "Add a Model node.";
  }
  if (!agent.prompt.trim()) {
    return "Write the agent's prompt.";
  }
  if (!agent.model.trim()) {
    return "Choose a model.";
  }
  const missingWire = REQUIRED_WIRES.find((required) => !agent.layout.wires.some((wire) => wire.from === required.from && wire.to === required.to));
  if (missingWire) {
    return `Connect the ${NODE_LABELS[missingWire.from]} to the ${NODE_LABELS[missingWire.to]}.`;
  }
  return null;
}

/** Check an agent sent by the browser and return it cleaned up, or the first problem with it. */
export function checkAgentInput(raw: unknown): CheckedAgent {
  const fields = isRecord(raw) ? raw : {};

  const name = typeof fields.name === "string" ? fields.name.trim() : "";
  if (!name || name.length > MAX_AGENT_NAME) {
    return { ok: false, error: `Give the agent a name of 1 to ${MAX_AGENT_NAME} characters.` };
  }
  const prompt = typeof fields.prompt === "string" ? fields.prompt.trim() : "";
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return { ok: false, error: `The prompt can be at most ${MAX_PROMPT_LENGTH.toLocaleString("en-US")} characters.` };
  }
  if (!isProvider(fields.provider)) {
    return { ok: false, error: "Choose a provider for the model." };
  }
  const model = typeof fields.model === "string" ? fields.model.trim() : "";
  if (model.length > MAX_MODEL_LENGTH) {
    return { ok: false, error: `A model id can be at most ${MAX_MODEL_LENGTH} characters.` };
  }
  if (!isEffort(fields.effort)) {
    return { ok: false, error: "Choose a reasoning effort for the model." };
  }
  const layout = checkLayout(fields.layout);
  if (!layout) {
    return { ok: false, error: BAD_LAYOUT };
  }

  const missing = whatIsMissing({ prompt, model, layout });
  if (missing) {
    return { ok: false, error: missing };
  }
  return { ok: true, agent: { name, prompt, provider: fields.provider, model, effort: fields.effort, layout } };
}

/** The layout with only known nodes, numeric positions and allowed wires (each once), or null if it has anything else. */
function checkLayout(raw: unknown): AgentLayout | null {
  if (!isRecord(raw) || JSON.stringify(raw).length > MAX_LAYOUT_LENGTH) {
    return null;
  }
  if (!isRecord(raw.positions) || !Array.isArray(raw.wires)) {
    return null;
  }

  const positions: AgentLayout["positions"] = {};
  for (const [id, rawPosition] of Object.entries(raw.positions)) {
    if (rawPosition === undefined) {
      continue; // a removed node
    }
    const position = readPosition(rawPosition);
    if (!isNodeId(id) || !position) {
      return null;
    }
    positions[id] = position;
  }

  const rawWires: unknown[] = raw.wires;
  const wires: Wire[] = [];
  for (const rawWire of rawWires) {
    const wire = readWire(rawWire);
    if (!wire) {
      return null;
    }
    const alreadyAdded = wires.some((added) => added.from === wire.from && added.to === wire.to);
    if (!alreadyAdded) {
      wires.push(wire);
    }
  }
  return { positions, wires };
}

function readPosition(raw: unknown): NodePosition | null {
  if (!isRecord(raw) || !isFiniteNumber(raw.x) || !isFiniteNumber(raw.y)) {
    return null;
  }
  return { x: raw.x, y: raw.y };
}

function readWire(raw: unknown): Wire | null {
  if (!isRecord(raw) || !isNodeId(raw.from) || !isNodeId(raw.to) || !isAllowedWire(raw.from, raw.to)) {
    return null;
  }
  return { from: raw.from, to: raw.to };
}
