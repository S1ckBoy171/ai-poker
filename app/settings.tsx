"use client";

import { useEffect, useState, type ReactNode } from "react";
import { EFFORTS, PROVIDERS, type Agent, type Config, type Provider } from "@/lib/config";
import { Icon } from "./ui";

export type KeyEdits = Record<string, string | null>; // id -> new key, or null to delete

export function SettingsModal({ cfg, hints, onSave, onClose }: { cfg: Config; hints: Record<string, string>; onSave: (c: Config, keys: KeyEdits) => Promise<void>; onClose: () => void }) {
  const [d, setD] = useState(cfg);
  const [keys, setKeys] = useState<KeyEdits>({});
  const [tab, setTab] = useState<"table" | "agents">("table");
  const [error, setError] = useState("");
  const set = (patch: Partial<Config>) => setD({ ...d, ...patch });
  const setAgent = (i: number, patch: Partial<Agent>) => set({ agents: d.agents.map((a, k) => (k === i ? { ...a, ...patch } : a)) });

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const keyField = (id: string, label: string, placeholder: string) => (
    <div className="flex min-w-0 gap-1">
      <input
        type="password"
        autoComplete="off"
        aria-label={label}
        className="field w-full"
        placeholder={keys[id] === null ? "will be removed" : hints[id] ? `saved ${hints[id]}` : placeholder}
        value={keys[id] ?? ""}
        onChange={(e) => setKeys({ ...keys, [id]: e.target.value })}
      />
      {hints[id] && keys[id] !== null && (
        <button type="button" aria-label={`Remove ${label}`} title="Remove saved key" className="rounded-lg px-2 text-cream/60 hover:text-cream" onClick={() => setKeys({ ...keys, [id]: null })}>
          <Icon name="x" className="h-4 w-4" />
        </button>
      )}
    </div>
  );

  const save = async () => {
    setError("");
    // empty inputs mean "unchanged", not "delete"
    const edits = Object.fromEntries(Object.entries(keys).filter(([, k]) => k === null || k.trim()));
    await onSave(d, edits).catch((e: Error) => setError(e.message));
  };

  return (
    <div className="anim-fade fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-8" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="settings-title" className="anim-modal panel relative mx-auto mt-6 w-full max-w-5xl p-5 sm:p-9" onClick={(e) => e.stopPropagation()}>
        <button aria-label="Close" onClick={onClose} className="absolute -right-3 -top-3 grid h-12 w-12 place-items-center rounded-full border-2 border-[#f0d9b5] bg-[#1c0306] shadow-lg hover:bg-[#3a0a10]">
          <Icon name="x" className="h-7 w-7" />
        </button>
        <h2 id="settings-title" className="text-center font-display text-4xl font-bold tracking-wide text-white sm:text-6xl">
          TABLE SETTINGS
        </h2>
        <div className="seg mx-auto mt-5 w-fit">
          <button aria-pressed={tab === "table"} onClick={() => setTab("table")}>Table</button>
          <button aria-pressed={tab === "agents"} onClick={() => setTab("agents")}>Agents & Keys</button>
        </div>

        {tab === "table" ? (
          <div className="mt-8 grid gap-8 md:grid-cols-2">
            <div className="space-y-5">
              <Row icon={<Icon name="user" className="h-12 w-12" />} label="Players">
                <Seg value={d.seats} options={[[5, "5"], [9, "9"]]} onChange={(seats) => set({ seats })} />
              </Row>
              <Row icon={<Icon name="timer" className="h-12 w-12" />} label="Speed">
                <Seg value={d.speed} options={[["fast", "Fast"], ["normal", "Normal"]]} onChange={(speed) => set({ speed })} />
              </Row>
              <Row icon={<span className="chip text-5xl" />} label="Starting chips">
                <NumberField label="Starting chips" value={d.stack} onChange={(stack) => set({ stack })} />
              </Row>
              <Row icon={<span className="grid h-12 w-12 place-items-center rounded-full bg-[#f0d9b5] font-display text-xl text-[#2a0609]">BB</span>} label="Big blind">
                <NumberField label="Big blind" value={d.bb} onChange={(bb) => set({ bb })} />
              </Row>
            </div>
            <div className="space-y-4">
              <Check checked={d.rebuy} onChange={(rebuy) => set({ rebuy })}>Auto Re-Buy</Check>
              <Check checked={d.topOff} onChange={(topOff) => set({ topOff })}>Auto Top-Off</Check>
              <Check checked={d.playing} onChange={(playing) => set({ playing })}>Play at the table</Check>
              <Check checked={d.reveal} onChange={(reveal) => set({ reveal })}>Reveal AI cards</Check>
              <p className="pt-2 text-sm text-cream/60">Changing players, chips, blinds or “Play at the table” starts a new game.</p>
            </div>
          </div>
        ) : (
          <div className="mt-8 space-y-7">
            <section>
              <h3 className="font-display text-xl tracking-wider text-gold">API KEYS</h3>
              <div className="mt-2 grid gap-3 sm:grid-cols-3">
                {(Object.keys(PROVIDERS) as Provider[]).map((p) => (
                  <label key={p} className="text-sm">
                    {PROVIDERS[p].label}
                    <div className="mt-1">{keyField(p, `${PROVIDERS[p].label} API key`, "paste API key")}</div>
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-cream/60">Stored in the app&apos;s Postgres database and never sent back to the browser. Seats with no key are played by a simple house bot.</p>
            </section>
            <section>
              <h3 className="font-display text-xl tracking-wider text-gold">PLAYERS</h3>
              <div className="mt-2 space-y-2">
                {d.agents.slice(0, d.seats).map((a, i) =>
                  d.playing && i === 0 ? (
                    <div key={i} className="rounded-xl bg-black/20 px-3 py-2.5 text-sm">
                      <b>Seat 1</b> · You
                    </div>
                  ) : (
                    <div key={i} className="grid grid-cols-2 items-center gap-2 rounded-xl bg-black/20 p-2 lg:grid-cols-[4.5rem_1fr_8.5rem_1.6fr_9rem_1.2fr]">
                      <span className="col-span-2 flex items-center gap-2 whitespace-nowrap text-sm font-bold lg:col-span-1">
                        <span className="h-3 w-3 rounded-full" style={{ background: PROVIDERS[a.provider].color }} />
                        Seat {i + 1}
                      </span>
                      <input aria-label={`Seat ${i + 1} name`} className="field" maxLength={24} value={a.name} onChange={(e) => setAgent(i, { name: e.target.value })} />
                      <select
                        aria-label={`Seat ${i + 1} provider`}
                        className="field"
                        value={a.provider}
                        onChange={(e) => {
                          const provider = e.target.value as Provider;
                          setAgent(i, { provider, model: PROVIDERS[provider].models[0] });
                        }}
                      >
                        {(Object.keys(PROVIDERS) as Provider[]).map((p) => (
                          <option key={p} value={p}>
                            {PROVIDERS[p].label}
                          </option>
                        ))}
                      </select>
                      <input aria-label={`Seat ${i + 1} model`} list={`models-${a.provider}`} className="field" value={a.model} onChange={(e) => setAgent(i, { model: e.target.value })} />
                      <select aria-label={`Seat ${i + 1} reasoning effort`} className="field" value={a.effort} onChange={(e) => setAgent(i, { effort: e.target.value as Agent["effort"] })}>
                        {EFFORTS.map((x) => (
                          <option key={x} value={x}>
                            effort: {x}
                          </option>
                        ))}
                      </select>
                      {keyField(`seat:${i}`, `Seat ${i + 1} own API key`, "own key (optional)")}
                    </div>
                  ),
                )}
              </div>
              {(Object.keys(PROVIDERS) as Provider[]).map((p) => (
                <datalist key={p} id={`models-${p}`}>
                  {PROVIDERS[p].models.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              ))}
              <p className="mt-2 text-xs text-cream/60">Model is free text: any id the provider accepts works. “default” effort leaves reasoning at the model&apos;s default.</p>
            </section>
          </div>
        )}

        <div className="mt-8 flex items-center justify-end gap-4">
          {error && <p role="alert" className="mr-auto text-sm text-red-200">{error}</p>}
          <button onClick={onClose} className="px-3 text-cream/75 hover:text-cream">Cancel</button>
          <button onClick={save} className="btn-gold">SAVE</button>
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

function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map(([v, text]) => (
        <button key={String(v)} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-lg">
      {label}
      <input type="number" min={1} className="field w-32 text-right text-lg" value={value || ""} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-5 text-2xl">
      <input type="checkbox" className="check" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}
