import { auth } from "./auth";

/** Every app API route: a signed-in session, checked against the database (not just the cookie). Returns the user id, or the error response to send. */
export async function requireUser(req: Request): Promise<string | Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return Response.json({ error: "Sign in first." }, { status: 401 });
  }
  return session.user.id;
}

/**
 * Routes that spend your API keys or change settings: signed in, from this app's own page in a local browser,
 * and never in friends mode (`npm run friends`), where the server is reachable by other people.
 */
export async function ownPageOnly(req: Request): Promise<string | Response> {
  if (process.env.FRIENDS_ONLY) {
    return Response.json({ error: "Bot matches and API keys are switched off while the server is open to friends." }, { status: 403 });
  }
  if (req.headers.get("sec-fetch-site") !== "same-origin") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  return requireUser(req);
}
