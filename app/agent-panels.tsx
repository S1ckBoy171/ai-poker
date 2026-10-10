"use client";

// The side panel of the Build Your Agent canvas: the settings of whichever node is selected.
import { useEffect, useEffectEvent, useState } from "react";
import { MAX_PROMPT_LENGTH, NODE_LABELS, type AgentFields, type NodeId } from "@/lib/built-agents";
import { EFFORTS, PROVIDERS, PROVIDER_IDS, type Effort, type ModelOption, type Provider } from "@/lib/config";
import { fetchJson } from "@/lib/fetch-json";
import { defaultModel } from "@/lib/match-bots";
import { briefing, sampleSpot } from "@/lib/turn-rules";

type NodePanelProps = {
  node: NodeId | null; // null: the selected node was removed from the canvas
  fields: AgentFields;
  keyHints: Record<string, string>; // key id -> masked saved key
  onChange: (patch: Partial<AgentFields>) => void;
};

type CheckStatus = { kind: "idle" | "busy" | "ok" | "error"; text: string };

const CHECK_IDLE: CheckStatus = { kind: "idle", text: "" };
const CHECK_COLORS: Record<CheckStatus["kind"], string> = {
  idle: "text-cream/70",
  busy: "text-cream/70",
  ok: "text-emerald-300",
  error: "text-red-200",
};
const JSON_HEADERS = { "Content-Type": "application/json" };
const KEYS_LOCATION = "Start Match with Bots → API keys";

export function NodePanel({ node, fields, keyHints, onChange }: NodePanelProps) {
  if (!node) {
    return <p className="text-sm text-cream/70">Select a node on the canvas to see its settings.</p>;
  }
  return (
    <div>
      <h3 className="font-display text-xl tracking-wider text-gold">{NODE_LABELS[node].toUpperCase()}</h3>
      {node === "table" && <TableStatePanel agentName={fields.name} />}
      {node === "prompt" && <PromptPanel prompt={fields.prompt} onChange={onChange} />}
      {node === "model" && <ModelPanel fields={fields} keyHints={keyHints} onChange={onChange} />}
      {node === "output" && <OutputPanel />}
    </div>
  );
}

function TableStatePanel({ agentName }: { agentName: string }) {
  const [sample, setSample] = useState("");
  return (
    <div className="mt-2 space-y-3 text-sm">
      <p className="text-cream/75">
        Locked. On every turn the agent is told the whole table: blinds, its hole cards, the board, the pot, every player&apos;s stack and bet, and
        every action so far this hand. Then &ldquo;It is your turn to act now&rdquo;, its legal moves with the minimum and maximum amounts, and the
        answer format.
      </p>
      <button type="button" className="rounded-full bg-black/35 px-3 py-1.5 text-xs ring-1 ring-gold/30 hover:bg-[#5a121b]" onClick={() => setSample(briefing(sampleSpot(agentName || "Your agent")))}>
        {sample ? "Deal another sample hand" : "Show a sample briefing"}
      </button>
      {sample && <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-black/40 p-3 text-xs text-cream/85">{sample}</pre>}
    </div>
  );
}

function PromptPanel({ prompt, onChange }: { prompt: string; onChange: (patch: Partial<AgentFields>) => void }) {
  return (
    <label className="mt-2 block text-sm">
      <span className="text-cream/75">The agent&apos;s whole personality and strategy. It replaces the built-in &ldquo;expert player&rdquo; instructions.</span>
      <textarea
        className="field mt-2 h-56 w-full resize-y font-sans text-sm"
        maxLength={MAX_PROMPT_LENGTH}
        placeholder="You are a patient, tight player. Fold weak hands early, raise big with premium pairs, and bluff the river when the board scares your opponent."
        value={prompt}
        onChange={(e) => onChange({ prompt: e.target.value })}
      />
      <span className="mt-1 block text-right text-xs text-cream/50">
        {prompt.length.toLocaleString("en-US")} / {MAX_PROMPT_LENGTH.toLocaleString("en-US")}
      </span>
    </label>
  );
}

type ModelPanelProps = { fields: AgentFields; keyHints: Record<string, string>; onChange: (patch: Partial<AgentFields>) => void };

function ModelPanel({ fields, keyHints, onChange }: ModelPanelProps) {
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [listError, setListError] = useState("");
  const [check, setCheck] = useState<CheckStatus>(CHECK_IDLE);
  const hasKey = Boolean(keyHints[fields.provider]);
  const { label } = PROVIDERS[fields.provider];

  // A new agent, or one that just switched provider, gets the provider's usual model once the list is in.
  const pickDefaultModel = useEffectEvent((listed: ModelOption[]) => {
    if (!fields.model) {
      onChange({ model: defaultModel(fields.provider, listed) });
    }
  });

  useEffect(() => {
    if (!hasKey) {
      return;
    }
    let stillWanted = true;
    fetchJson<{ models: ModelOption[] }>("/api/models", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ provider: fields.provider }) })
      .then(({ models: listed }) => {
        if (stillWanted) {
          setModels(listed);
          pickDefaultModel(listed);
        }
      })
      .catch((e: Error) => stillWanted && setListError(e.message));
    return () => {
      stillWanted = false;
    };
  }, [fields.provider, hasKey]);

  const changeProvider = (provider: Provider) => {
    setModels(null);
    setListError("");
    setCheck(CHECK_IDLE);
    onChange({ provider, model: "", effort: "default" });
  };

  const changeModel = (model: string) => {
    setCheck(CHECK_IDLE);
    const option = models?.find((listed) => listed.id === model);
    const effortFixed = option?.effort === false;
    onChange(effortFixed ? { model, effort: "default" } : { model });
  };

  const checkModel = async () => {
    setCheck({ kind: "busy", text: `Asking ${label}…` });
    try {
      await fetchJson("/api/models/check", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ provider: fields.provider, model: fields.model, effort: fields.effort }),
      });
      setCheck({ kind: "ok", text: "This key can use it." });
    } catch (e) {
      setCheck({ kind: "error", text: (e as Error).message });
    }
  };

  const selectedOption = models?.find((listed) => listed.id === fields.model);
  const showEffort = selectedOption?.effort !== false;
  const listedModel = Boolean(selectedOption);

  return (
    <div className="mt-2 space-y-3 text-sm">
      <label className="block">
        Provider
        <select aria-label="Provider" className="field mt-1 w-full" value={fields.provider} onChange={(e) => changeProvider(e.target.value as Provider)}>
          {PROVIDER_IDS.map((provider) => (
            <option key={provider} value={provider}>
              {PROVIDERS[provider].label}
            </option>
          ))}
        </select>
      </label>

      {hasKey ? (
        <p className="text-xs text-cream/60">
          Uses your saved {label} key {keyHints[fields.provider]}.
        </p>
      ) : (
        <p className="text-xs text-red-200">
          No {label} key saved. Add one in {KEYS_LOCATION}; until then you can type a model id, but the agent can&apos;t be tested.
        </p>
      )}

      <label className="block">
        Model
        {models ? (
          <select aria-label="Model" className="field mt-1 w-full" value={fields.model} onChange={(e) => changeModel(e.target.value)}>
            {!listedModel && <option value={fields.model}>{fields.model || "Choose a model…"}</option>}
            {models.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        ) : (
          <input
            aria-label="Model id"
            className="field mt-1 w-full"
            placeholder={hasKey && !listError ? "Loading models…" : "model id, e.g. claude-haiku-5-5"}
            value={fields.model}
            onChange={(e) => changeModel(e.target.value)}
          />
        )}
      </label>
      {listError && <p className="text-xs text-red-200">Could not list models: {listError}</p>}

      {showEffort && (
        <label className="block">
          Reasoning effort
          <select aria-label="Reasoning effort" className="field mt-1 w-full" value={fields.effort} onChange={(e) => onChange({ effort: e.target.value as Effort })}>
            {EFFORTS.map((effort) => (
              <option key={effort} value={effort}>
                {effort}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!hasKey || !fields.model || check.kind === "busy"}
          onClick={checkModel}
          className="rounded-full bg-black/35 px-3 py-1.5 text-xs ring-1 ring-gold/30 hover:bg-[#5a121b] disabled:opacity-50"
        >
          Check model
        </button>
        <span role="status" className={`text-xs ${CHECK_COLORS[check.kind]}`}>
          {check.text}
        </span>
      </div>
    </div>
  );
}

function OutputPanel() {
  return (
    <div className="mt-2 space-y-3 text-sm text-cream/75">
      <p>Locked. Every answer must be exactly one JSON object with these three fields, and nothing else:</p>
      <pre className="overflow-auto rounded-lg bg-black/40 p-3 text-xs text-cream/85">
        {'{\n  "action": one of this turn\'s legal moves,\n  "amount": a whole number for bet or raise, otherwise null,\n  "say": short table talk, or ""\n}'}
      </pre>
      <p>
        The legal moves come from the table each turn: fold, check, call, bet, raise or all-in, with the minimum and maximum amount. Nothing is
        rounded or fixed: an illegal move or an amount out of range is sent back to the agent with the reason, until it answers correctly or its
        turn time runs out. Then it checks if it can, or folds.
      </p>
    </div>
  );
}
