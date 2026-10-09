import { requireUser } from "@/lib/guard";
import { createTable, errorResponse } from "@/lib/tables";

/** Body: { name, stack?, bb? } -> { code, token }. The creator is the host, in seat 1. */
export async function POST(req: Request) {
  const userId = await requireUser(req);
  if (userId instanceof Response) {
    return userId;
  }
  const body = (await req.json().catch(() => ({}))) as { name?: unknown; stack?: unknown; bb?: unknown };
  try {
    return Response.json(await createTable(body.name, body.stack, body.bb));
  } catch (e) {
    return errorResponse(e);
  }
}
