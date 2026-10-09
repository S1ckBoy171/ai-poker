import Anthropic from "@anthropic-ai/sdk";
import { PROVIDERS, type Agent } from "@/lib/config";
import { getAgentKey, getConfig } from "@/lib/db";
import { ownPageOnly } from "@/lib/guard";
import { system } from "@/lib/poker";

type Call = { agent: Agent; key: string; prompt: string; signal: AbortSignal };

/** Body: { seat, prompt }. Provider, model, effort and key come from the DB, never from the browser. */
export async function POST(req: Request) {
  const denied = ownPageOnly(req);
  if (denied) return denied;
  const { seat, prompt } = (await req.json().catch(() => ({}))) as { seat?: unknown; prompt?: unknown };
  const agent = Number.isInteger(seat) ? (await getConfig()).agents[seat as number] : undefined;
  if (!agent || typeof prompt !== "string" || prompt.length > 20_000) return Response.json({ error: "bad request" }, { status: 400 });
  const key = await getAgentKey(seat as number, agent.provider);
  if (!key) return Response.json({ error: `no ${PROVIDERS[agent.provider].label} API key saved` }, { status: 400 });
  try {
    const call = { agent, key, prompt, signal: req.signal };
    const text = agent.provider === "anthropic" ? await claude(call) : agent.provider === "openai" ? await openai(call) : await openrouter(call);
    return Response.json({ text });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

async function claude({ agent, key, prompt, signal }: Call) {
  const res = await new Anthropic({ apiKey: key }).messages.create(
    {
      model: agent.model,
      max_tokens: 16000,
      system: system(agent.name),
      messages: [{ role: "user", content: prompt }],
      ...(agent.effort !== "default" && { thinking: { type: "adaptive" as const }, output_config: { effort: agent.effort } }),
    },
    { signal },
  );
  if (res.stop_reason === "refusal") throw new Error("model declined to answer");
  return res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
}

async function openai({ agent, key, prompt, signal }: Call) {
  const res = await post("https://api.openai.com/v1/responses", key, signal, {
    model: agent.model,
    instructions: system(agent.name),
    input: prompt,
    ...(agent.effort !== "default" && { reasoning: { effort: agent.effort } }),
  });
  type Item = { type: string; content?: { type: string; text?: string }[] };
  return (res.output as Item[]).flatMap((o) => (o.type === "message" ? o.content ?? [] : [])).map((c) => (c.type === "output_text" ? c.text : "")).join("");
}

async function openrouter({ agent, key, prompt, signal }: Call) {
  const res = await post("https://openrouter.ai/api/v1/chat/completions", key, signal, {
    model: agent.model,
    messages: [
      { role: "system", content: system(agent.name) },
      { role: "user", content: prompt },
    ],
    ...(agent.effort !== "default" && { reasoning: { effort: agent.effort } }),
  });
  return String(res.choices?.[0]?.message?.content ?? "");
}

async function post(url: string, key: string, signal: AbortSignal, body: object) {
  const res = await fetch(url, { method: "POST", signal, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  return json;
}
