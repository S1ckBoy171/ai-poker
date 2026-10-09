import { connection } from "next/server";
import { KEY_ID, normalize } from "@/lib/config";
import { getConfig, keyHints, saveSettings } from "@/lib/db";
import { ownPageOnly } from "@/lib/guard";

export async function GET(req: Request) {
  await connection(); // always read the DB at request time
  const denied = ownPageOnly(req);
  if (denied) return denied;
  return Response.json({ config: await getConfig(), keys: await keyHints() });
}

/** Body: { config?, keys?: { [id]: "new key" | null to delete } } - omitted keys stay unchanged. */
export async function PUT(req: Request) {
  const denied = ownPageOnly(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ error: "bad request" }, { status: 400 });
  const keys = Object.entries(body.keys ?? {});
  const bad = keys.find(([id, key]) => !KEY_ID.test(id) || (key !== null && (typeof key !== "string" || key.length > 400)));
  if (bad) return Response.json({ error: `bad key ${bad[0]}` }, { status: 400 });
  await saveSettings(body.config ? normalize(body.config) : undefined, (keys as [string, string | null][]).map(([id, key]) => [id, key?.trim() || null]));
  return Response.json({ config: await getConfig(), keys: await keyHints() });
}
