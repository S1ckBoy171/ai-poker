"use client";

// "Start Match with Bots": who plays, the API keys the bots may use, and the bots at the table.
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useState, type FormEvent } from "react";
import { EFFORTS, MAX_SEATS, PROVIDERS, PROVIDER_IDS, type Agent, type Config, type ModelOption, type Provider } from "@/lib/config";
import { fetchJson } from "@/lib/fetch-json";
import { defaultModel, fitToKeys, numberRepeats, seatNameFor, type BotChoice, type Catalog } from "@/lib/match-bots";
import type { SettingsResponse } from "./api/settings/route";
import type { KeyEdits } from "./settings";
import { Icon } from "./ui";

type Opponents = "you" | "your-agent";
type Status = { kind: "idle" | "busy" | "ok" | "error"; text: string };
/** One API key the bots may use; `models` is what the key can use, once it has been checked. */
type KeyRow = { provider: Provider; key: string; status: Status; models: ModelOption[] | null };
/** A bot as chosen. `check` belongs to the provider, model and effort it was run for (`for`). */
type Bot = BotChoice & { check: Status & { for?: string } };

const MAX_BOTS = MAX_SEATS - 1; // one seat is yours
const BOT_COUNTS = Array.from({ length: MAX_BOTS }, (_, i) => i + 1);
const PROVIDER_PREFERENCE: Provider[] = ["openrouter", "anthropic", "openai"]; // the order saved keys are listed in
const IDLE: Status = { kind: "idle", text: "" };
const STATUS_COLORS: Record<Status["kind"], string> = {
  idle: "text-cream/70",
  busy: "text-cream/70",
  ok: "text-emerald-300",
  error: "text-red-200",
};
const OPENROUTER_MODELS_LIST = "openrouter-models"; // datalist id: suggestions for the free-text OpenRouter model
const JSON_HEADERS = { "Content-Type": "application/json" };

/** Guess the provider from the key's prefix. */
function guessProvider(key: string): Provider | null {
  if (key.startsWith("sk-ant-")) {
    return "anthropic";
  }
  if (key.startsWith("sk-or-")) {
    return "openrouter";
  }
  if (key.startsWith("sk-")) {
    return "openai";
  }
  return null;
}

function catalogOf(rows: KeyRow[]): Catalog {
  const catalog: Catalog = new Map();
  for (const row of rows) {
    if (row.status.kind === "ok" && row.models) {
      catalog.set(row.provider, row.models);
    }
  }
  return catalog;
}

/** What a bot's check is valid for: changing any of these makes it unchecked again. */
const checkSignature = (bot: Bot) => [bot.provider, bot.model.trim(), bot.effort].join("|");

export function MatchSetup() {
  const [opponents, setOpponents] = useState<Opponents>("you");
  return (
    <>
      <div className="text-center">
        <h2 className="font-display text-2xl tracking-wide text-white">
          Do you play against agents or does your agent play against agents?
        </h2>
        <div className="seg mx-auto mt-4 w-fit" role="group" aria-label="Who plays">
          <button type="button" aria-pressed={opponents === "you"} onClick={() => setOpponents("you")}>
            I play against agents
          </button>
          <button type="button" aria-pressed={opponents === "your-agent"} onClick={() => setOpponents("your-agent")}>
            My agent plays against agents
          </button>
        </div>
      </div>
      {opponents === "you" && <PlayAgainstBots />}
      {opponents === "your-agent" && (
        <div className="mt-8 grid min-h-48 place-items-center rounded-2xl border border-dashed border-gold/25 text-cream/50">
          Coming soon
        </div>
      )}
    </>
  );
}

function PlayAgainstBots() {
  const router = useRouter();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [hints, setHints] = useState<Record<string, string>>({}); // provider -> masked saved key
  const [rows, setRows] = useState<KeyRow[]>([]);
  const [botCount, setBotCount] = useState(4);
  const [bots, setBots] = useState<Bot[]>([]); // always MAX_BOTS long; the first botCount play
  const [loadError, setLoadError] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");

  const catalog = catalogOf(rows);
  const shownBots = bots.slice(0, botCount).map((bot) => fitToKeys(bot, catalog));
  const providers = [...catalog.keys()];

  /** Check a key with its provider and load the models it can use. An empty key checks the saved one. */
  const checkKey = async (provider: Provider, key: string) => {
    // the row may change while the check runs: only a row still holding this provider and key takes the result
    const updateCheckedRow = (patch: Partial<KeyRow>) => {
      setRows((current) => current.map((row) => (row.provider === provider && row.key === key ? { ...row, ...patch } : row)));
    };
    const { label } = PROVIDERS[provider];
    updateCheckedRow({ status: { kind: "busy", text: `Checking the key with ${label}…` }, models: null });
    try {
      const reply = await fetchJson<{ models: ModelOption[]; total: number }>("/api/models", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ provider, key }),
      });
      if (!reply.models.length) {
        throw new Error("This key works, but no chat models came back.");
      }
      let text = `Key works: ${reply.total} models available.`;
      if (provider === "openrouter") {
        text = `Key works. Type any OpenRouter model id for a bot, or pick one of the newest ${reply.models.length}.`;
      }
      updateCheckedRow({ status: { kind: "ok", text }, models: reply.models });
    } catch (e) {
      updateCheckedRow({ status: { kind: "error", text: (e as Error).message }, models: null });
    }
  };
  const checkSavedKey = useEffectEvent((provider: Provider) => checkKey(provider, ""));

  useEffect(() => {
    fetchJson<SettingsResponse>("/api/settings")
      .then(({ config, keys }) => {
        const savedProviders = PROVIDER_PREFERENCE.filter((provider) => keys[provider]);
        const startingProviders: Provider[] = savedProviders.length ? savedProviders : ["openrouter"];
        setCfg(config);
        setHints(keys);
        setBotCount(Math.min(MAX_BOTS, Math.max(1, config.seats - 1)));
        setBots(config.agents.slice(1).map((agent) => ({ ...agent, nameEdited: false, check: IDLE })));
        setRows(startingProviders.map((provider) => ({ provider, key: "", status: IDLE, models: null })));
        // saved keys are checked straight away, so their models are ready
        savedProviders.forEach((provider) => checkSavedKey(provider));
      })
      .catch((e) => setLoadError(`Could not load your saved settings: ${e.message}`));
  }, []);

  const updateRow = (index: number, patch: Partial<KeyRow>) => {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  const changeRowProvider = (index: number, provider: Provider) => updateRow(index, { provider, status: IDLE, models: null });
  const changeRowKey = (index: number, key: string) => {
    // a different key may see different models, so it needs checking again
    const patch: Partial<KeyRow> = { key, status: IDLE, models: null };
    const guessed = guessProvider(key.trim());
    const guessedIsFree = guessed !== null && !rows.some((row, i) => i !== index && row.provider === guessed);
    if (guessed && guessedIsFree) {
      patch.provider = guessed;
    }
    updateRow(index, patch);
  };
  const addRow = () => {
    const unused = PROVIDER_IDS.find((provider) => !rows.some((row) => row.provider === provider));
    if (unused) {
      setRows([...rows, { provider: unused, key: "", status: IDLE, models: null }]);
    }
  };
  const removeRow = (index: number) => setRows(rows.filter((_, i) => i !== index));

  /** Edit the bot as it shows now (fitted to the keys that work), so the edit keeps everything else the user sees. */
  const updateBot = (index: number, patch: Partial<Bot>) => {
    setBots((current) => current.map((bot, i) => (i === index ? { ...fitToKeys(bot, catalog), ...patch } : bot)));
  };

  /** Send one short test message to the bot's model, with its effort, to prove the key may use it. */
  const checkBot = async (index: number) => {
    const bot = shownBots[index];
    const model = bot.model.trim();
    const signature = checkSignature(bot);
    const typedKey = rows.find((row) => row.provider === bot.provider)?.key.trim() ?? "";
    const setCheck = (check: Status) => {
      setBots((current) => current.map((stored, i) => (i === index ? { ...stored, check: { ...check, for: signature } } : stored)));
    };
    setCheck({ kind: "busy", text: `Asking ${model} for a test reply…` });
    try {
      await fetchJson("/api/models/check", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ provider: bot.provider, model, effort: bot.effort, key: typedKey }),
      });
      setCheck({ kind: "ok", text: `${model} answered: it works with your key.` });
    } catch (e) {
      setCheck({ kind: "error", text: (e as Error).message });
    }
  };

  const everyBotHasModel = shownBots.every((bot) => catalog.has(bot.provider) && bot.model.trim() !== "");
  const canStart = cfg !== null && providers.length > 0 && everyBotHasModel && !starting;
  let startHint = "";
  if (providers.length === 0) {
    startHint = "Check a key first: the bots can only use models your keys can use.";
  } else if (!everyBotHasModel) {
    startHint = "Give every bot a model.";
  }

  const start = async () => {
    if (!cfg || !canStart) {
      return;
    }
    setStarting(true);
    setStartError("");
    const names = numberRepeats(shownBots.map((bot) => bot.name.trim() || seatNameFor(bot.model, undefined)));
    const agents = cfg.agents.map((agent, seat) => {
      const bot = shownBots[seat - 1];
      if (seat === 0 || !bot) {
        return agent;
      }
      return { name: names[seat - 1], provider: bot.provider, model: bot.model.trim(), effort: bot.effort };
    });
    const config: Config = { ...cfg, seats: botCount + 1, playing: true, agents };
    // The bots use these provider keys: clear per-seat keys so they can't override them.
    const keys: KeyEdits = {};
    for (let seat = 1; seat <= MAX_BOTS; seat++) {
      keys[`seat:${seat}`] = null;
    }
    for (const row of rows) {
      const typedKey = row.key.trim();
      if (typedKey) {
        keys[row.provider] = typedKey;
      }
    }
    const res = await fetch("/api/settings", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ config, keys }) });
    if (res.ok) {
      return router.push("/play");
    }
    setStarting(false);
    const reply = await res.json().catch(() => ({}));
    setStartError(reply.error ?? "Could not save the match settings.");
  };

  if (loadError) {
    return (
      <p role="alert" className="mt-8 text-center text-red-200">
        {loadError}
      </p>
    );
  }

  return (
    <>
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <section aria-labelledby="keys-title">
          <h2 id="keys-title" className="font-display text-2xl tracking-wide text-white">
            1 · API KEYS
          </h2>
          <p className="mt-1 text-sm text-cream/70">
            Add a key for each provider you want bots from; one is enough.
            Keys are saved in your account and never sent back to the browser.
          </p>
          <ul className="mt-4 space-y-3">
            {rows.map((row, index) => (
              <KeyRowForm
                key={index}
                row={row}
                hint={hints[row.provider]}
                takenProviders={rows.filter((_, i) => i !== index).map((other) => other.provider)}
                removable={rows.length > 1}
                onProvider={(provider) => changeRowProvider(index, provider)}
                onKey={(key) => changeRowKey(index, key)}
                onCheck={() => checkKey(row.provider, row.key)}
                onRemove={() => removeRow(index)}
              />
            ))}
          </ul>
          {rows.length < PROVIDER_IDS.length && (
            <button type="button" onClick={addRow} className="mt-3 text-sm text-cream/75 underline hover:text-cream">
              + Add a key for another provider
            </button>
          )}
        </section>

        <section aria-labelledby="bots-title">
          <h2 id="bots-title" className="font-display text-2xl tracking-wide text-white">
            2 · BOTS
          </h2>
          <p className="mt-1 text-sm text-cream/70">You sit in seat 1. How many bots do you want to play against?</p>
          <div className="seg seg-compact mt-3" role="group" aria-label="Number of bots">
            {BOT_COUNTS.map((count) => (
              <button key={count} type="button" aria-pressed={botCount === count} onClick={() => setBotCount(count)}>
                {count}
              </button>
            ))}
          </div>
          <ol className="mt-4 space-y-3">
            {shownBots.map((bot, index) => (
              <BotBox
                key={index}
                seat={index + 2}
                bot={bot}
                catalog={catalog}
                check={bot.check.for === checkSignature(bot) ? bot.check : IDLE}
                onChange={(patch) => updateBot(index, patch)}
                onCheck={() => checkBot(index)}
              />
            ))}
          </ol>
          <datalist id={OPENROUTER_MODELS_LIST}>
            {catalog.get("openrouter")?.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </datalist>
        </section>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-end gap-4">
        {startHint && <span className="text-sm text-cream/60">{startHint}</span>}
        {startError && (
          <p role="alert" className="text-sm text-red-200">
            {startError}
          </p>
        )}
        <button onClick={start} disabled={!canStart} className="btn-gold disabled:cursor-not-allowed disabled:opacity-50">
          {starting ? "STARTING…" : "START MATCH"}
        </button>
      </div>
    </>
  );
}

type KeyRowFormProps = {
  row: KeyRow;
  hint: string | undefined; // the saved key, masked
  takenProviders: Provider[]; // already used by the other key rows
  removable: boolean;
  onProvider: (provider: Provider) => void;
  onKey: (key: string) => void;
  onCheck: () => void;
  onRemove: () => void;
};

/** One provider and its API key, with a check that loads the models the key can use. */
function KeyRowForm({ row, hint, takenProviders, removable, onProvider, onKey, onCheck, onRemove }: KeyRowFormProps) {
  const { label } = PROVIDERS[row.provider];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onCheck();
  };
  return (
    <li className="rounded-xl bg-black/20 p-3">
      <form onSubmit={submit}>
        <div className="flex items-center gap-2">
          <select
            aria-label="Provider"
            className="field flex-1"
            value={row.provider}
            onChange={(e) => onProvider(e.target.value as Provider)}
          >
            {PROVIDER_IDS.map((provider) => (
              <option key={provider} value={provider} disabled={takenProviders.includes(provider)}>
                {PROVIDERS[provider].label}
              </option>
            ))}
          </select>
          {removable && (
            <button
              type="button"
              aria-label={`Remove the ${label} key`}
              title="Remove"
              onClick={onRemove}
              className="rounded-lg px-2 text-cream/60 hover:text-cream"
            >
              <Icon name="x" className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            type="password"
            autoComplete="off"
            aria-label={`${label} API key`}
            className="field w-full"
            placeholder={hint ? `saved ${hint}, leave empty to use it` : `paste your ${label} key`}
            value={row.key}
            onChange={(e) => onKey(e.target.value)}
          />
          <button
            type="submit"
            disabled={row.status.kind === "busy"}
            className="whitespace-nowrap rounded-lg bg-wine px-4 font-display tracking-wide ring-1 ring-gold/50 transition-colors hover:bg-[#5a121b] disabled:opacity-60"
          >
            {row.status.kind === "busy" ? "CHECKING…" : "CHECK"}
          </button>
        </div>
        <p role="status" className={`mt-2 min-h-5 text-sm ${STATUS_COLORS[row.status.kind]}`}>
          {row.status.text}
        </p>
      </form>
    </li>
  );
}

type BotBoxProps = {
  seat: number; // 2-9 (seat 1 is you)
  bot: Bot;
  catalog: Catalog;
  check: Status; // only when it was run for the bot's current provider, model and effort
  onChange: (patch: Partial<Bot>) => void;
  onCheck: () => void;
};

/** One bot: its name, provider (among the keys that work), model, reasoning effort when the model has one, and a check. */
function BotBox({ seat, bot, catalog, check, onChange, onCheck }: BotBoxProps) {
  const providers = [...catalog.keys()];
  const models = catalog.get(bot.provider) ?? [];
  const option = models.find((model) => model.id === bot.model);
  const hasKey = catalog.has(bot.provider);
  const showEffort = option?.effort !== false; // unknown (a typed OpenRouter id) counts as adjustable
  const seatLabel = `Seat ${seat}`;

  const chooseProvider = (provider: Provider) => {
    const providerModels = catalog.get(provider) ?? [];
    onChange({ provider, model: defaultModel(provider, providerModels) });
  };

  return (
    <li className="rounded-xl bg-black/20 p-3">
      <div className="flex items-center gap-3">
        <span className="w-14 flex-none text-sm font-bold">{seatLabel}</span>
        <input
          aria-label={`${seatLabel} name`}
          className="field min-w-0 flex-1"
          maxLength={24}
          value={bot.name}
          onChange={(e) => onChange({ name: e.target.value, nameEdited: true })}
        />
      </div>
      {!hasKey && <p className="mt-2 text-sm text-cream/50">Check a key to choose this bot&apos;s model.</p>}
      {hasKey && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {providers.length > 1 && (
            <select
              aria-label={`${seatLabel} provider`}
              className="field"
              value={bot.provider}
              onChange={(e) => chooseProvider(e.target.value as Provider)}
            >
              {providers.map((provider) => (
                <option key={provider} value={provider}>
                  {PROVIDERS[provider].label}
                </option>
              ))}
            </select>
          )}
          {providers.length === 1 && (
            <span className="rounded-lg bg-black/30 px-3 py-2 text-sm text-cream/80">{PROVIDERS[bot.provider].label}</span>
          )}
          {bot.provider === "openrouter" && (
            <input
              aria-label={`${seatLabel} model`}
              list={OPENROUTER_MODELS_LIST}
              spellCheck={false}
              placeholder="model id, e.g. qwen/qwen3.8-max-prime"
              className="field min-w-0 flex-1"
              value={bot.model}
              onChange={(e) => onChange({ model: e.target.value })}
            />
          )}
          {bot.provider !== "openrouter" && (
            <select
              aria-label={`${seatLabel} model`}
              className="field min-w-0 flex-1"
              value={bot.model}
              onChange={(e) => onChange({ model: e.target.value })}
            >
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          )}
          {showEffort && (
            <select
              aria-label={`${seatLabel} reasoning effort`}
              className="field"
              value={bot.effort}
              onChange={(e) => onChange({ effort: e.target.value as Agent["effort"] })}
            >
              {EFFORTS.map((effort) => (
                <option key={effort} value={effort}>
                  effort: {effort}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={onCheck}
            disabled={check.kind === "busy" || bot.model.trim() === ""}
            title="Sends one short test message to this model with your key"
            className="whitespace-nowrap rounded-lg bg-wine px-3 py-2 font-display text-sm tracking-wide ring-1 ring-gold/50 transition-colors hover:bg-[#5a121b] disabled:opacity-60"
          >
            {check.kind === "busy" ? "CHECKING…" : "CHECK"}
          </button>
        </div>
      )}
      {check.text && (
        <p role="status" className={`mt-2 text-sm ${STATUS_COLORS[check.kind]}`}>
          {check.text}
        </p>
      )}
    </li>
  );
}
