"use client";

// "My keys": the API keys saved in your account, with a form to add one and a button to delete each for good.
import { useEffect, useState, type FormEvent } from "react";
import { PROVIDERS, PROVIDER_IDS, guessProvider, isProvider, type Provider } from "@/lib/config";
import { fetchJson } from "@/lib/fetch-json";
import type { SettingsResponse } from "../api/settings/route";
import type { KeyEdits } from "../settings";

/** What a saved key is called: a provider's key, or the key one seat was given in the table settings. */
function keyName(id: string): string {
  if (isProvider(id)) {
    return `${PROVIDERS[id].label} key`;
  }
  const seat = Number(id.split(":")[1]);
  return `Seat ${seat + 1} key`;
}

export function MyKeys() {
  const [hints, setHints] = useState<Record<string, string> | null>(null); // key id -> masked saved key; null until loaded
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetchJson<SettingsResponse>("/api/settings")
      .then(({ keys }) => setHints(keys))
      .catch((e) => setError(`Could not load your keys: ${e.message}`));
  }, []);

  /** Save key edits to the account (null deletes a key), then show the keys it has now. True if it worked. */
  const saveKeys = async (edits: KeyEdits, doneNotice: string): Promise<boolean> => {
    setSaving(true);
    setNotice("");
    setError("");
    try {
      const reply = await fetchJson<SettingsResponse>("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: edits }),
      });
      setHints(reply.keys);
      setNotice(doneNotice);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const changeKey = (typed: string) => {
    setKey(typed);
    setProvider(guessProvider(typed.trim()) ?? provider);
  };

  const addKey = async (e: FormEvent) => {
    e.preventDefault();
    const typedKey = key.trim();
    // the server reads a blank key as "delete it", so never send one from here
    if (!typedKey) {
      return;
    }
    const saved = await saveKeys({ [provider]: typedKey }, `${keyName(provider)} saved.`);
    if (saved) {
      setKey("");
    }
  };

  const removeKey = (id: string) => {
    const name = keyName(id);
    if (window.confirm(`Delete your saved ${name}? It is removed from your account and can't be brought back.`)) {
      saveKeys({ [id]: null }, `${name} deleted.`);
    }
  };

  if (!hints) {
    if (error) {
      return (
        <p role="alert" className="text-red-200">
          {error}
        </p>
      );
    }
    return <p className="text-cream/70">Loading your keys…</p>;
  }

  const savedIds = Object.keys(hints).sort(); // providers first, then seats
  const { label } = PROVIDERS[provider];

  return (
    <div className="panel p-5 sm:p-8">
      <section aria-labelledby="saved-keys-title">
        <h2 id="saved-keys-title" className="font-display text-2xl tracking-wide text-white">
          SAVED KEYS
        </h2>
        {savedIds.length === 0 && <p className="mt-2 text-sm text-cream/70">No keys saved yet. Add one below.</p>}
        <ul className="mt-3 space-y-2">
          {savedIds.map((id) => (
            <li key={id} className="flex items-center gap-3 rounded-xl bg-black/20 px-4 py-3">
              <span className="font-bold">{keyName(id)}</span>
              <span className="text-sm text-cream/60">{hints[id]}</span>
              <button
                type="button"
                disabled={saving}
                onClick={() => removeKey(id)}
                className="ml-auto rounded-lg px-3 py-1.5 text-sm text-red-200 ring-1 ring-red-200/40 transition-colors hover:bg-red-900/40 disabled:opacity-60"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="add-key-title" className="mt-8">
        <h2 id="add-key-title" className="font-display text-2xl tracking-wide text-white">
          ADD A KEY
        </h2>
        <p className="mt-1 text-sm text-cream/70">One key per provider: saving another one for the same provider replaces it.</p>
        <form onSubmit={addKey} className="mt-3 flex flex-wrap gap-2">
          <select aria-label="Provider" className="field" value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
            {PROVIDER_IDS.map((id) => (
              <option key={id} value={id}>
                {PROVIDERS[id].label}
              </option>
            ))}
          </select>
          <input
            type="password"
            autoComplete="off"
            required
            aria-label={`${label} API key`}
            className="field min-w-0 flex-1"
            placeholder={`paste your ${label} key`}
            value={key}
            onChange={(e) => changeKey(e.target.value)}
          />
          <button disabled={saving} className="btn-gold disabled:cursor-not-allowed disabled:opacity-50">
            {hints[provider] ? "REPLACE KEY" : "SAVE KEY"}
          </button>
        </form>
      </section>

      {notice && (
        <p role="status" className="mt-4 text-sm text-emerald-300">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 text-sm text-red-200">
          {error}
        </p>
      )}
    </div>
  );
}
