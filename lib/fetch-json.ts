/** Fetch one of the app's own JSON routes; a failed status throws the route's `error` message (or the HTTP status). */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  return body as T;
}
