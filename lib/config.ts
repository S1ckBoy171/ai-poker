// Table + agent settings shared by the UI and the API routes. API keys are not in here: they live only in the DB.

export type Provider = "anthropic" | "openai" | "openrouter";
export type Effort = "default" | "low" | "medium" | "high";
export type Agent = { name: string; provider: Provider; model: string; effort: Effort };

export type Config = {
  seats: number; // players at the table, 2-9: you (when playing) plus 1-8 bots
  speed: "fast" | "normal";
  stack: number; // every player starts with this many chips
  bb: number;
  rebuy: boolean;
  topOff: boolean;
  playing: boolean; // you sit in seat 1 (index 0)
  reveal: boolean;
  agents: Agent[]; // one per seat (9); seat 0 is only used when you're not playing
};

export const PROVIDERS: Record<Provider, { label: string; color: string; models: string[] }> = {
  anthropic: {
    label: "Anthropic",
    color: "#d97757",
    models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"],
  },
  openai: {
    label: "OpenAI",
    color: "#10a37f",
    models: ["gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna", "gpt-6-astra"],
  },
  openrouter: {
    label: "OpenRouter",
    color: "#7c7ff5",
    models: ["google/gemini-3.8-flash", "x-ai/grok-4.7", "deepseek/deepseek-v4.1-flash", "qwen/qwen3.8-max-prime", "anthropic/claude-sonnet-5.5", "openai/gpt-6.1-sol"],
  },
};
export const PROVIDER_IDS = Object.keys(PROVIDERS) as Provider[];

export const isProvider = (value: unknown): value is Provider => typeof value === "string" && Object.hasOwn(PROVIDERS, value);

/** A model an API key can use, as /api/models lists it. */
export type ModelOption = {
  id: string;
  name: string;
  effort?: boolean; // whether its reasoning effort can be set; missing when the provider doesn't say
};
export const MIN_SEATS = 2;
export const MAX_SEATS = 9;
export const EFFORTS: Effort[] = ["default", "low", "medium", "high"];

const agent = (name: string, provider: Provider, model: string): Agent => ({ name, provider, model, effort: "low" });

export const DEFAULTS: Config = {
  seats: 5,
  speed: "normal",
  stack: 1000,
  bb: 20,
  rebuy: false,
  topOff: false,
  playing: true,
  reveal: false,
  agents: [
    agent("Haiku", "anthropic", "claude-haiku-5-5"),
    agent("Opus", "anthropic", "claude-opus-5-5"),
    agent("Sol", "openai", "gpt-6.1-sol"),
    agent("Gemini", "openrouter", "google/gemini-3.8-flash"),
    agent("Grok", "openrouter", "x-ai/grok-4.7"),
    agent("Sonnet", "anthropic", "claude-sonnet-5-5"),
    agent("Luna", "openai", "gpt-6-luna"),
    agent("DeepSeek", "openrouter", "deepseek/deepseek-v4.1-flash"),
    agent("Qwen", "openrouter", "qwen/qwen3.8-max-prime"),
  ],
};

/** Fill gaps and clamp anything untrusted (old DB rows, request bodies) into a valid Config. */
export function normalize(raw: unknown): Config {
  const fields = raw && typeof raw === "object" ? raw : {};
  // Typed as a Config only so each field can be read; every value is still checked below.
  const merged = { ...DEFAULTS, ...fields } as Config;
  const bb = Math.max(2, Math.round(Number(merged.bb)) || DEFAULTS.bb);
  const savedAgents = Array.isArray(merged.agents) ? merged.agents : [];
  return {
    seats: Math.min(MAX_SEATS, Math.max(MIN_SEATS, Math.round(Number(merged.seats)) || DEFAULTS.seats)),
    speed: merged.speed === "fast" ? "fast" : "normal",
    bb,
    stack: Math.max(bb, Math.round(Number(merged.stack)) || DEFAULTS.stack),
    rebuy: Boolean(merged.rebuy),
    topOff: Boolean(merged.topOff),
    playing: Boolean(merged.playing),
    reveal: Boolean(merged.reveal),
    agents: DEFAULTS.agents.map((fallback, seat) => normalizeAgent(savedAgents[seat], fallback)),
  };
}

function normalizeAgent(saved: Agent | undefined, fallback: Agent): Agent {
  const merged = { ...fallback, ...saved };
  return {
    name: String(merged.name).slice(0, 24) || fallback.name,
    provider: merged.provider in PROVIDERS ? merged.provider : fallback.provider,
    model: String(merged.model).trim().slice(0, 120) || fallback.model,
    effort: EFFORTS.includes(merged.effort) ? merged.effort : fallback.effort,
  };
}

/** DB ids for API keys: one per provider, plus optional per-seat overrides. */
export const KEY_ID = /^(anthropic|openai|openrouter|seat:[0-8])$/;
