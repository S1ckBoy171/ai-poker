"use client";

import { useEffect, useState, type ReactNode } from "react";
import { EFFORTS, PROVIDERS, PROVIDER_IDS, type Agent, type Config, type Provider } from "@/lib/config";
import { Icon } from "./ui";

export type KeyEdits = Record<string, string | null>; // id -> new key, or null to delete

type SettingsModalProps = {
  cfg: Config;
  hints: Record<string, string>; // key id -> masked saved key
  onSave: (config: Config, keys: KeyEdits) => Promise<void>;
  onClose: () => void;
};

export function SettingsModal({ cfg, hints, onSave, onClose }: SettingsModalProps) {
  const [draft, setDraft] = useState(cfg);
  const [keys, setKeys] = useState<KeyEdits>({});
  const [tab, setTab] = useState<"table" | "agents">("table");
  const [error, setError] = useState("");
  const update = (patch: Partial<Config>) => setDraft({ ...draft, ...patch });
  const updateAgent = (seat: number, patch: Partial<Agent>) => {
    update({ agents: draft.agents.map((agent, i) => (i === seat ? { ...agent, ...patch } : agent)) });
  };
  const changeProvider = (seat: number, provider: Provider) => {
    updateAgent(seat, { provider, model: PROVIDERS[provider].models[0] });
  };

  useEffect(() => {
    const closeOnEscape = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  /** A password field for one API key, with a button to remove the saved one. */
  const keyField = (id: string, label: string, placeholder: string) => {
    const markedForRemoval = keys[id] === null;
    let shownPlaceholder = placeholder;
    if (markedForRemoval) {
      shownPlaceholder = "will be removed";
    } else if (hints[id]) {
      shownPlaceholder = `saved ${hints[id]}`;
    }
    return (
      <div className="flex min-w-0 gap-1">
        <input
          type="password"
          autoComplete="off"
          aria-label={label}
          className="field w-full"
          placeholder={shownPlaceholder}
          value={keys[id] ?? ""}
          onChange={(e) => setKeys({ ...keys, [id]: e.target.value })}
        />
        {hints[id] && !markedForRemoval && (
          <button
            type="button"
            aria-label={`Remove ${label}`}
            title="Remove saved key"
            className="rounded-lg px-2 text-cream/60 hover:text-cream"
            onClick={() => setKeys({ ...keys, [id]: null })}
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  };

  const save = async () => {
    setError("");
    // empty inputs mean "unchanged", not "delete"
    const edits = Object.fromEntries(Object.entries(keys).filter(([, key]) => key === null || key.trim()));
    await onSave(draft, edits).catch((e: Error) => setError(e.message));
  };

  return (
    <div className="anim-fade fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-8" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="anim-modal panel relative mx-auto mt-6 w-full max-w-5xl p-5 sm:p-9"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          aria-label="Close"
          onClick={onClose}
          className="absolute -right-3 -top-3 grid h-12 w-12 place-items-center rounded-full border-2 border-[#f0d9b5] bg-[#1c0306] shadow-lg hover:bg-[#3a0a10]"
        >
          <Icon name="x" className="h-7 w-7" />
        </button>
        <h2 id="settings-title" className="text-center font-display text-4xl font-bold tracking-wide text-white sm:text-6xl">
          TABLE SETTINGS
        </h2>
        <div className="seg mx-auto mt-5 w-fit">
          <button aria-pressed={tab === "table"} onClick={() => setTab("table")}>
            Table
          </button>
          <button aria-pressed={tab === "agents"} onClick={() => setTab("agents")}>
            Agents & Keys
          </button>
        </div>

        {tab === "table" && (
          <div className="mt-8 grid gap-8 md:grid-cols-2">
            <div className="space-y-5">
              <Row icon={<Icon name="user" className="h-12 w-12" />} label="Players">
                <Seg
                  value={draft.seats}
                  options={[
                    [5, "5"],
                    [9, "9"],
                  ]}
                  onChange={(seats) => update({ seats })}
                />
              </Row>
              <Row icon={<Icon name="timer" className="h-12 w-12" />} label="Speed">
                <Seg
                  value={draft.speed}
                  options={[
                    ["fast", "Fast"],
                    ["normal", "Normal"],
                  ]}
                  onChange={(speed) => update({ speed })}
                />
              </Row>
              <Row icon={<span className="chip text-5xl" />} label="Starting chips">
                <NumberField label="Starting chips" value={draft.stack} onChange={(stack) => update({ stack })} />
              </Row>
              <Row
                icon={<span className="grid h-12 w-12 place-items-center rounded-full bg-[#f0d9b5] font-display text-xl text-[#2a0609]">BB</span>}
                label="Big blind"
              >
                <NumberField label="Big blind" value={draft.bb} onChange={(bb) => update({ bb })} />
              </Row>
            </div>
            <div className="space-y-4">
              <Check checked={draft.rebuy} onChange={(rebuy) => update({ rebuy })}>
                Auto Re-Buy
              </Check>
              <Check checked={draft.topOff} onChange={(topOff) => update({ topOff })}>
                Auto Top-Off
              </Check>
              <Check checked={draft.playing} onChange={(playing) => update({ playing })}>
                Play at the table
              </Check>
              <Check checked={draft.reveal} onChange={(reveal) => update({ reveal })}>
                Reveal AI cards
              </Check>
              <p className="pt-2 text-sm text-cream/60">Changing players, chips, blinds or “Play at the table” starts a new game.</p>
            </div>
          </div>
        )}

        {tab === "agents" && (
          <div className="mt-8 space-y-7">
            <section>
              <h3 className="font-display text-xl tracking-wider text-gold">API KEYS</h3>
              <div className="mt-2 grid gap-3 sm:grid-cols-3">
                {PROVIDER_IDS.map((provider) => (
                  <label key={provider} className="text-sm">
                    {PROVIDERS[provider].label}
                    <div className="mt-1">{keyField(provider, `${PROVIDERS[provider].label} API key`, "paste API key")}</div>
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-cream/60">
                Stored in the app&apos;s Postgres database and never sent back to the browser. Seats with no key are played by a simple house bot.
              </p>
            </section>
            <section>
              <h3 className="font-display text-xl tracking-wider text-gold">PLAYERS</h3>
              <div className="mt-2 space-y-2">
                {draft.agents.slice(0, draft.seats).map((agent, seat) => {
                  if (draft.playing && seat === 0) {
                    return (
                      <div key={seat} className="rounded-xl bg-black/20 px-3 py-2.5 text-sm">
                        <b>Seat 1</b> · You
                      </div>
                    );
                  }
                  const seatLabel = `Seat ${seat + 1}`;
                  return (
                    <div key={seat} className="grid grid-cols-2 items-center gap-2 rounded-xl bg-black/20 p-2 lg:grid-cols-[4.5rem_1fr_8.5rem_1.6fr_9rem_1.2fr]">
                      <span className="col-span-2 flex items-center gap-2 whitespace-nowrap text-sm font-bold lg:col-span-1">
                        <span className="h-3 w-3 rounded-full" style={{ background: PROVIDERS[agent.provider].color }} />
                        {seatLabel}
                      </span>
                      <input
                        aria-label={`${seatLabel} name`}
                        className="field"
                        maxLength={24}
                        value={agent.name}
                        onChange={(e) => updateAgent(seat, { name: e.target.value })}
                      />
                      <select
                        aria-label={`${seatLabel} provider`}
                        className="field"
                        value={agent.provider}
                        onChange={(e) => changeProvider(seat, e.target.value as Provider)}
                      >
                        {PROVIDER_IDS.map((provider) => (
                          <option key={provider} value={provider}>
                            {PROVIDERS[provider].label}
                          </option>
                        ))}
                      </select>
                      <input
                        aria-label={`${seatLabel} model`}
                        list={`models-${agent.provider}`}
                        className="field"
                        value={agent.model}
                        onChange={(e) => updateAgent(seat, { model: e.target.value })}
                      />
                      <select
                        aria-label={`${seatLabel} reasoning effort`}
                        className="field"
                        value={agent.effort}
                        onChange={(e) => updateAgent(seat, { effort: e.target.value as Agent["effort"] })}
                      >
                        {EFFORTS.map((effort) => (
                          <option key={effort} value={effort}>
                            effort: {effort}
                          </option>
                        ))}
                      </select>
                      {keyField(`seat:${seat}`, `${seatLabel} own API key`, "own key (optional)")}
                    </div>
                  );
                })}
              </div>
              {PROVIDER_IDS.map((provider) => (
                <datalist key={provider} id={`models-${provider}`}>
                  {PROVIDERS[provider].models.map((model) => (
                    <option key={model} value={model} />
                  ))}
                </datalist>
              ))}
              <p className="mt-2 text-xs text-cream/60">
                Model is free text: any id the provider accepts works. “default” effort leaves reasoning at the model&apos;s default.
              </p>
            </section>
          </div>
        )}

        <div className="mt-8 flex items-center justify-end gap-4">
          {error && (
            <p role="alert" className="mr-auto text-sm text-red-200">
              {error}
            </p>
          )}
          <button onClick={onClose} className="px-3 text-cream/75 hover:text-cream">
            Cancel
          </button>
          <button onClick={save} className="btn-gold">
            SAVE
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-5">
      <span className="grid w-14 flex-none place-items-center text-[#ecc99a]" title={label}>
        {icon}
      </span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (value: T) => void }) {
  return (
    <div className="seg">
      {options.map(([option, text]) => (
        <button key={String(option)} type="button" aria-pressed={option === value} onClick={() => onChange(option)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-lg">
      {label}
      <input type="number" min={1} className="field w-32 text-right text-lg" value={value || ""} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-5 text-2xl">
      <input type="checkbox" className="check" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}
