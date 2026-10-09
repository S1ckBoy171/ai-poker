/**
 * Routes that spend your API keys or change settings answer only this app's own page in a local browser,
 * and never in friends mode (`npm run friends`), where the server is reachable by other people.
 * Friend tables don't use this: each player's secret token guards those.
 */
export function ownPageOnly(req: Request): Response | null {
  if (process.env.FRIENDS_ONLY) return Response.json({ error: "Bot matches and API keys are switched off while the server is open to friends." }, { status: 403 });
  if (req.headers.get("sec-fetch-site") !== "same-origin") return Response.json({ error: "forbidden" }, { status: 403 });
  return null;
}
