// Table + agent settings shared by the UI and the API routes. API keys are not in here: they live only in the DB.

export type Provider = "anthropic" | "openai" | "openrouter";
export type Effort = "default" | "low" | "medium" | "high";
export type Agent = { name: string; provider: Provider; model: string; effort: Effort };

export type Config = {
  seats: 5 | 9;
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
  anthropic: { label: "Anthropic", color: "#d97757", models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"] },
  openai: { label: "OpenAI", color: "#10a37f", models: ["gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna", "gpt-6-astra"] },
  openrouter: {
    label: "OpenRouter",
    color: "#7c7ff5",
    models: ["google/gemini-3.8-flash", "x-ai/grok-4.7", "deepseek/deepseek-v4.1-flash", "qwen/qwen3.8-max-prime", "anthropic/claude-sonnet-5.5", "openai/gpt-6.1-sol"],
  },
};
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
  const c = { ...DEFAULTS, ...(raw && typeof raw === "object" ? raw : {}) } as Config;
  const bb = Math.max(2, Math.round(Number(c.bb)) || DEFAULTS.bb);
  return {
    seats: c.seats === 9 ? 9 : 5,
    speed: c.speed === "fast" ? "fast" : "normal",
    bb,
    stack: Math.max(bb, Math.round(Number(c.stack)) || DEFAULTS.stack),
    rebuy: !!c.rebuy,
    topOff: !!c.topOff,
    playing: !!c.playing,
    reveal: !!c.reveal,
    agents: DEFAULTS.agents.map((d, i) => {
      const a = { ...d, ...(Array.isArray(c.agents) ? c.agents[i] : {}) };
      return {
        name: String(a.name).slice(0, 24) || d.name,
        provider: a.provider in PROVIDERS ? a.provider : d.provider,
        model: String(a.model).trim().slice(0, 120) || d.model,
        effort: EFFORTS.includes(a.effort) ? a.effort : d.effort,
      };
    }),
  };
}

/** DB ids for API keys: one per provider, plus optional per-seat overrides. */
export const KEY_ID = /^(anthropic|openai|openrouter|seat:[0-8])$/;
