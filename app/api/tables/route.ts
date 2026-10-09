import { requireUser } from "@/lib/guard";
import { createTable, failure } from "@/lib/tables";

/** Body: { name, stack?, bb? } -> { code, token }. The creator is the host, in seat 1. */
export async function POST(req: Request) {
  const userId = await requireUser(req);
  if (userId instanceof Response) return userId;
  const body = await req.json().catch(() => ({}));
  try {
    return Response.json(await createTable(body.name, body.stack, body.bb));
  } catch (e) {
    return failure(e);
  }
}

