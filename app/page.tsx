"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { PROVIDERS, type Config, type Provider } from "@/lib/config";
import type { ModelOption } from "./api/models/route";

type Tab = "build" | "match" | "friends";
type Bot = { name: string; model: string };

const TABS: [Tab, string][] = [
  ["build", "Build Your Agent"],
  ["match", "Start Match with Bots"],
  ["friends", "Play with Friends"],
];
const ORDER: Provider[] = ["openrouter", "anthropic", "openai"];

/** Guess the provider from the key's prefix. */
const detect = (key: string): Provider | null => (key.startsWith("sk-ant-") ? "anthropic" : key.startsWith("sk-or-") ? "openrouter" : key.startsWith("sk-") ? "openai" : null);
/** A seat name from a model's display name: "Google: Gemini 3.8 Flash" -> "Gemini 3.8 Flash", "Claude Opus 5.5" -> "Opus 5.5". */
const shortName = (m: ModelOption) => m.name.replace(/^[^:]+:\s*/, "").replace(/^Claude\s+/, "").slice(0, 18);
/** Several bots on one model would share a name at the table: number the repeats. */
const dedupe = (bots: Bot[]) => {
  const seen = new Map<string, number>();
  return bots.map((b, i) => {
    if (i === 0) return b;
    const n = (seen.get(b.name) ?? 0) + 1;
    seen.set(b.name, n);
    return n === 1 ? b : { ...b, name: `${b.name.slice(0, 20)} ${n}` };
  });
};

export default function Home() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("match");
  const [cfg, setCfg] = useState<Config | null>(null);
  const [hints, setHints] = useState<Record<string, string>>({});
  const [provider, setProvider] = useState<Provider>("openrouter");
  const [key, setKey] = useState("");
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [status, setStatus] = useState<{ kind: "idle" | "busy" | "ok" | "error"; text: string }>({ kind: "idle", text: "" });
  const [seats, setSeats] = useState<5 | 9>(5);
  const [bots, setBots] = useState<Bot[]>([]); // index = seat; seat 0 is you
  const [starting, setStarting] = useState(false);
  const [friend, setFriend] = useState({ name: "", stack: 1000, bb: 20, code: "" });
  const [friendError, setFriendError] = useState("");
  const { data: session } = authClient.useSession();
  const signOut = async () => {
    await authClient.signOut();
    router.push("/login");
  };

  useEffect(() => {
    fetch("/api/settings")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        return j as { config: Config; keys: Record<string, string> };
      })
      .then(({ config, keys }) => {
        const current = config.agents[1].provider;
        setCfg(config);
        setHints(keys);
        setSeats(config.seats);
        setProvider(keys[current] ? current : (ORDER.find((p) => keys[p]) ?? "openrouter"));
        setBots(config.agents.map((a) => ({ name: a.name, model: a.model })));
      })
      .catch((e) => setStatus({ kind: "error", text: `Could not load your saved settings: ${e.message}` }));
  }, []);

  const pickProvider = (p: Provider) => {
    setProvider(p);
    setModels(null);
    setStatus({ kind: "idle", text: "" });
  };
  const onKeyInput = (v: string) => {
    setKey(v);
    setModels(null); // a different key may see different models
    setStatus({ kind: "idle", text: "" });
    const p = detect(v.trim());
    if (p) setProvider(p);
  };

  const checkModels = async (e?: FormEvent) => {
    e?.preventDefault();
    setStatus({ kind: "busy", text: `Checking the key with ${PROVIDERS[provider].label}…` });
    try {
      const res = await fetch("/api/models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, key }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      const list: ModelOption[] = j.models;
      if (!list.length) throw new Error("This key works, but no chat models came back.");
      const has = (id: string) => list.some((m) => m.id === id);
      const fallback = list.find((m) => m.id === PROVIDERS[provider].models.find(has)) ?? list[0];
      setModels(list);
      setBots((b) => b.map((bot, i) => (i === 0 || has(bot.model) ? bot : { name: shortName(fallback), model: fallback.id })));
      setStatus({ kind: "ok", text: `Key works: ${j.total} models available${j.total > list.length ? `, showing the newest ${list.length}` : ""}.` });
    } catch (err) {
      setModels(null);
      setStatus({ kind: "error", text: (err as Error).message });
    }
  };

  const setModel = (seat: number | "all", id: string) => {
    const m = models?.find((x) => x.id === id);
    if (m) setBots((b) => b.map((bot, i) => (i > 0 && (seat === "all" || seat === i) ? { name: shortName(m), model: m.id } : bot)));
  };

  const start = async () => {
    if (!cfg || !models) return;
    setStarting(true);
    const named = dedupe(bots);
    const config: Config = { ...cfg, seats, playing: true, agents: cfg.agents.map((a, i) => (i === 0 ? a : { ...a, provider, model: named[i].model, name: named[i].name })) };
    // one key for every bot: clear per-seat keys so they can't override it
    const keys = { ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`seat:${i + 1}`, null])), ...(key.trim() && { [provider]: key.trim() }) };
    const res = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config, keys }) });
    if (res.ok) return router.push("/play");
    setStarting(false);
    setStatus({ kind: "error", text: (await res.json().catch(() => ({}))).error ?? "Could not save the match settings." });
  };

  const createTable = async (e: FormEvent) => {
    e.preventDefault();
    setFriendError("");
    const res = await fetch("/api/tables", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...friend, name: friend.name || session?.user.name }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return setFriendError(j.error ?? "Could not create the table.");
    try {
      localStorage.setItem(`agent-holdem-table:${j.code}`, j.token); // your seat's secret, kept in this browser
    } catch {}
    router.push(`/t/${j.code}`);
  };
  const joinTable = (e: FormEvent) => {
    e.preventDefault();
    const code = friend.code.toLowerCase().match(/[0-9a-f]{8}/)?.[0]; // accepts the code or the whole invite link
    if (code) router.push(`/t/${code}`);
    else setFriendError("A table code is 8 letters and digits, like 3f9a1c0b.");
  };

  const tabKeys = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const i = TABS.findIndex(([id]) => id === tab);
    const next = TABS.at((i + (e.key === "ArrowRight" ? 1 : -1)) % TABS.length)![0];
    setTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  };

  return (
    <main className="min-h-dvh px-4 pb-16">
      <header className="mx-auto flex max-w-5xl items-center justify-between py-4">
        <div className="flex items-center gap-2 font-display text-xl tracking-wide sm:text-2xl">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-[#c4202c] text-white shadow ring-2 ring-gold/60">♠</span>
          AGENT <span className="text-gold">HOLD&apos;EM</span>
        </div>
        <nav className="flex items-center gap-2 text-sm">
          <Link href="/play" className="rounded-full px-3 py-1.5 text-cream/80 ring-1 ring-gold/30 transition-colors hover:bg-black/30 hover:text-cream">
            Table
          </Link>
          <Link href="/history" className="rounded-full px-3 py-1.5 text-cream/80 ring-1 ring-gold/30 transition-colors hover:bg-black/30 hover:text-cream">
            History
          </Link>
          {session && <span className="ml-2 hidden max-w-40 truncate text-cream/70 sm:inline" title={session.user.email}>{session.user.name}</span>}
          <button onClick={signOut} className="rounded-full px-3 py-1.5 text-cream/80 ring-1 ring-gold/30 transition-colors hover:bg-black/30 hover:text-cream">
            Sign out
          </button>
        </nav>
      </header>

      <section className="mx-auto max-w-5xl pt-6 text-center sm:pt-12">
        <h1 className="font-display text-5xl font-bold tracking-wide text-white sm:text-7xl">PLAY POKER WITH AI</h1>
        <p className="mx-auto mt-3 max-w-xl text-cream/75">No-limit Texas Hold&apos;em against models from Anthropic, OpenAI and OpenRouter.</p>
        <div role="tablist" aria-label="Choose a mode" className="seg mx-auto mt-8 w-fit" onKeyDown={tabKeys}>
          {TABS.map(([id, text]) => (
            <button key={id} id={`tab-${id}`} role="tab" aria-selected={tab === id} aria-controls={`panel-${id}`} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)}>
              {text}
            </button>
          ))}
        </div>
      </section>

      <section key={tab} role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="anim-rise panel mx-auto mt-6 max-w-5xl p-5 sm:p-9">
        {tab === "friends" ? (
          <div className="grid gap-8 md:grid-cols-2">
            <form onSubmit={createTable}>
              <h2 className="font-display text-2xl tracking-wide text-white">CREATE A TABLE</h2>
              <p className="mt-1 text-sm text-cream/70">You host it and deal the first hand. Humans only, up to 9 players.</p>
              <label className="mt-4 block text-sm">
                Your name
                <input maxLength={16} placeholder={session?.user.name.slice(0, 16)} className="field mt-1 w-full text-lg" value={friend.name} onChange={(e) => setFriend({ ...friend, name: e.target.value })} />
              </label>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <label className="text-sm">
                  Starting chips
                  <input type="number" min={100} className="field mt-1 w-full" value={friend.stack || ""} onChange={(e) => setFriend({ ...friend, stack: Number(e.target.value) })} />
                </label>
                <label className="text-sm">
                  Big blind
                  <input type="number" min={2} className="field mt-1 w-full" value={friend.bb || ""} onChange={(e) => setFriend({ ...friend, bb: Number(e.target.value) })} />
                </label>
              </div>
              <button className="btn-gold mt-5">CREATE TABLE</button>
            </form>
            <form onSubmit={joinTable} className="md:border-l md:border-gold/20 md:pl-8">
              <h2 className="font-display text-2xl tracking-wide text-white">JOIN A TABLE</h2>
              <p className="mt-1 text-sm text-cream/70">Enter the code a friend sent you, or paste their invite link.</p>
              <label className="mt-4 block text-sm">
                Table code
                <input required className="field mt-1 w-full font-display text-xl tracking-[0.2em]" placeholder="3f9a1c0b" value={friend.code} onChange={(e) => setFriend({ ...friend, code: e.target.value })} />
              </label>
              <button className="btn-gold mt-5">JOIN TABLE</button>
            </form>
            {friendError && (
              <p role="alert" className="text-red-200 md:col-span-2">
                {friendError}
              </p>
            )}
          </div>
        ) : tab === "build" ? (
          <div className="grid place-items-center py-16">
            <div className="tooltip-wrap">
              <button aria-disabled="true" aria-describedby="build-tip" className="btn-gold cursor-not-allowed opacity-85">
                BUILD YOUR AGENT
              </button>
              <div id="build-tip" role="tooltip" className="tooltip">
                Coming soon
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-8 lg:grid-cols-[1fr_1.15fr]">
              <form onSubmit={checkModels}>
                <h2 className="font-display text-2xl tracking-wide text-white">1 · API KEY</h2>
                <p className="mt-1 text-sm text-cream/70">One key runs every bot. It is saved in your database and never sent back to the browser.</p>
                <div className="seg mt-4" role="group" aria-label="Provider">
                  {(Object.keys(PROVIDERS) as Provider[]).map((p) => (
                    <button key={p} type="button" aria-pressed={provider === p} onClick={() => pickProvider(p)}>
                      {PROVIDERS[p].label}
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <input
                    type="password"
                    autoComplete="off"
                    aria-label={`${PROVIDERS[provider].label} API key`}
                    className="field w-full"
                    placeholder={hints[provider] ? `saved ${hints[provider]}, leave empty to use it` : `paste your ${PROVIDERS[provider].label} key`}
                    value={key}
                    onChange={(e) => onKeyInput(e.target.value)}
                  />
                  <button type="submit" disabled={status.kind === "busy"} className="whitespace-nowrap rounded-lg bg-wine px-4 font-display tracking-wide ring-1 ring-gold/50 transition-colors hover:bg-[#5a121b] disabled:opacity-60">
                    {status.kind === "busy" ? "CHECKING…" : "CHECK MODELS"}
                  </button>
                </div>
                <p role="status" className={`mt-2 min-h-5 text-sm ${status.kind === "error" ? "text-red-200" : status.kind === "ok" ? "text-emerald-300" : "text-cream/70"}`}>
                  {status.text}
                </p>
                {models && (
                  <div className="anim-rise mt-3">
                    <h3 className="text-xs uppercase tracking-wider text-cream/50">Available models · click one to give it to every bot</h3>
                    <ul className="mt-2 flex max-h-56 flex-wrap gap-1.5 overflow-y-auto rounded-xl bg-black/25 p-2">
                      {models.map((m) => (
                        <li key={m.id}>
                          <button type="button" title={m.id} onClick={() => setModel("all", m.id)} className="rounded-full bg-black/35 px-2.5 py-1 text-xs ring-1 ring-gold/25 transition-colors hover:bg-[#5a121b] hover:ring-gold/60">
                            {m.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </form>

              <div>
                <h2 className="font-display text-2xl tracking-wide text-white">2 · BOTS</h2>
                <p className="mt-1 text-sm text-cream/70">You sit in seat 1. Pick a model for each bot, or one for all of them.</p>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <div className="seg" role="group" aria-label="Players at the table">
                    {([5, 9] as const).map((n) => (
                      <button key={n} type="button" aria-pressed={seats === n} onClick={() => setSeats(n)}>
                        {n} players
                      </button>
                    ))}
                  </div>
                  <select aria-label="Model for all bots" disabled={!models} className="field min-w-0 flex-1" value="" onChange={(e) => setModel("all", e.target.value)}>
                    <option value="">{models ? "Same model for all bots…" : "Check your key to load models"}</option>
                    {models?.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                <ol className="mt-3 space-y-2">
                  {bots.slice(1, seats).map((b, k) => (
                    <li key={k + 1} className="grid grid-cols-[4rem_1fr] items-center gap-2 rounded-xl bg-black/20 p-2 sm:grid-cols-[4rem_1fr_1.4fr]">
                      <span className="text-sm font-bold">Seat {k + 2}</span>
                      <span className="truncate text-sm text-cream/85" title={b.name}>
                        {b.name}
                      </span>
                      <select aria-label={`Seat ${k + 2} model`} disabled={!models} className="field col-span-2 min-w-0 sm:col-span-1" value={models ? b.model : ""} onChange={(e) => setModel(k + 1, e.target.value)}>
                        {!models && <option value="">{b.model}</option>}
                        {models?.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
            <div className="mt-8 flex flex-wrap items-center justify-end gap-4">
              {!models && <span className="text-sm text-cream/60">Check your key first: the bots need a model it can use.</span>}
              <button onClick={start} disabled={!models || !cfg || starting} className="btn-gold disabled:cursor-not-allowed disabled:opacity-50">
                {starting ? "STARTING…" : "START MATCH"}
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
