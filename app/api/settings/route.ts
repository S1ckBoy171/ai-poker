import { connection } from "next/server";
import { KEY_ID, normalize, type Config } from "@/lib/config";
import { getConfig, keyHints, saveSettings } from "@/lib/db";
import { ownPageOnly } from "@/lib/guard";

const MAX_KEY_LENGTH = 400;

export type SettingsResponse = { config: Config; keys: Record<string, string> }; // keys: id -> masked hint

async function settingsFor(userId: string): Promise<SettingsResponse> {
  return { config: await getConfig(userId), keys: await keyHints(userId) };
}

export async function GET(req: Request) {
  await connection(); // always read the DB at request time
  const userId = await ownPageOnly(req);
  if (userId instanceof Response) {
    return userId;
  }
  return Response.json(await settingsFor(userId));
}

/** Body: { config?, keys?: { [id]: "new key" | null to delete } } - omitted keys stay unchanged. */
export async function PUT(req: Request) {
  const userId = await ownPageOnly(req);
  if (userId instanceof Response) {
    return userId;
  }
  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "bad request" }, { status: 400 });
  }

  const { config, keys } = body as { config?: unknown; keys?: unknown };
  const keyEdits = Object.entries((keys ?? {}) as Record<string, unknown>);
  const isValidEdit = ([id, key]: [string, unknown]) => {
    const validKey = key === null || (typeof key === "string" && key.length <= MAX_KEY_LENGTH);
    return KEY_ID.test(id) && validKey;
  };
  const badEdit = keyEdits.find((edit) => !isValidEdit(edit));
  if (badEdit) {
    return Response.json({ error: `bad key ${badEdit[0]}` }, { status: 400 });
  }

  // A blank key deletes it, like null.
  const cleanedEdits = keyEdits.map(([id, key]): [string, string | null] => [id, typeof key === "string" ? key.trim() || null : null]);
  await saveSettings(userId, config ? normalize(config) : undefined, cleanedEdits);
  return Response.json(await settingsFor(userId));
}
