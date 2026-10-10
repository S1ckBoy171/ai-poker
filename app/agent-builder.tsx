"use client";

// Build Your Agent: the player's saved agents, the canvas an agent is wired on, the selected node's settings, and
// a test run. Part 1 agents are one chain: Table state + Prompt -> Model -> Output (see lib/built-agents.ts).
import {
  Background,
  Controls,
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useEffectEvent, useState } from "react";
import {
  AGENT_LIMIT,
  MAX_AGENT_NAME,
  NODE_IDS,
  NODE_LABELS,
  REQUIRED_WIRES,
  isAllowedWire,
  newAgentLayout,
  whatIsMissing,
  type AgentFields,
  type AgentLayout,
  type AgentSummary,
  type NodeId,
  type NodePosition,
  type SavedAgent,
  type Wire,
} from "@/lib/built-agents";
import { PROVIDERS, PROVIDER_IDS } from "@/lib/config";
import { fetchJson } from "@/lib/fetch-json";
import type { SettingsResponse } from "./api/settings/route";
import { AGENT_NODE_TYPES, AgentFieldsContext, NODE_TYPE_OF } from "./agent-nodes";
import { NodePanel } from "./agent-panels";
import { AgentTest } from "./agent-test";

const JSON_HEADERS = { "Content-Type": "application/json" };
const NEW_AGENT_NAME = "My Agent";
const LOCKED_NODES: NodeId[] = ["table", "output"];
const REMOVABLE_NODES: NodeId[] = ["prompt", "model"];

const toFlowNode = (id: NodeId, position: NodePosition): Node => ({
  id,
  type: NODE_TYPE_OF[id],
  position,
  data: {},
  deletable: !LOCKED_NODES.includes(id),
});

function toFlowNodes(layout: AgentLayout): Node[] {
  return NODE_IDS.flatMap((id) => {
    const position = layout.positions[id];
    return position ? [toFlowNode(id, position)] : [];
  });
}

const toFlowEdge = (source: string, target: string): Edge => ({ id: `${source}->${target}`, source, target, animated: true });

const toFlowEdges = (wires: Wire[]): Edge[] => wires.map((wire) => toFlowEdge(wire.from, wire.to));

/** The canvas as it is saved: whole-pixel positions in node order, wires in chain order. */
function layoutOf(nodes: Node[], edges: Edge[]): AgentLayout {
  const positions: AgentLayout["positions"] = {};
  for (const id of NODE_IDS) {
    const node = nodes.find((candidate) => candidate.id === id);
    if (node) {
      positions[id] = { x: Math.round(node.position.x), y: Math.round(node.position.y) };
    }
  }
  const wires = REQUIRED_WIRES.filter((wire) => edges.some((edge) => edge.source === wire.from && edge.target === wire.to));
  return { positions, wires };
}

/** A comparable copy of everything that gets saved, to tell whether there are unsaved changes. */
const snapshot = (fields: AgentFields, layout: AgentLayout) =>
  JSON.stringify([fields.name, fields.prompt, fields.provider, fields.model, fields.effort, layout]);

const fieldsOf = (agent: SavedAgent): AgentFields => ({
  name: agent.name,
  prompt: agent.prompt,
  provider: agent.provider,
  model: agent.model,
  effort: agent.effort,
});

const summaryOf = (agent: SavedAgent): AgentSummary => ({
  id: agent.id,
  name: agent.name,
  provider: agent.provider,
  model: agent.model,
  effort: agent.effort,
  updatedAt: agent.updatedAt,
});

/** A new agent: the first name not taken yet, on the first provider with a saved key. */
function newAgentFields(existing: AgentSummary[], keyHints: Record<string, string>): AgentFields {
  const taken = new Set(existing.map((agent) => agent.name));
  let name = NEW_AGENT_NAME;
  for (let number = 2; taken.has(name); number++) {
    name = `${NEW_AGENT_NAME} ${number}`;
  }
  const provider = PROVIDER_IDS.find((id) => keyHints[id]) ?? "anthropic";
  return { name, prompt: "", provider, model: "", effort: "default" };
}

export function AgentBuilder() {
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
  const [keyHints, setKeyHints] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState("");
  const [agentId, setAgentId] = useState<string | null>(null); // null until the agent is first saved
  const [fields, setFields] = useState<AgentFields>(() => newAgentFields([], {}));
  const [nodes, setNodes] = useState<Node[]>(() => toFlowNodes(newAgentLayout()));
  const [edges, setEdges] = useState<Edge[]>([]);
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null); // null: never saved
  const [selectedNode, setSelectedNode] = useState<NodeId | null>("prompt");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [testOpen, setTestOpen] = useState(false);

  const layout = layoutOf(nodes, edges);
  const hasUnsavedChanges = snapshot(fields, layout) !== savedSnapshot;
  const missing = whatIsMissing({ prompt: fields.prompt, model: fields.model, layout });

  const showAgent = (agent: SavedAgent) => {
    const loadedFields = fieldsOf(agent);
    const loadedNodes = toFlowNodes(agent.layout);
    const loadedEdges = toFlowEdges(agent.layout.wires);
    setAgentId(agent.id);
    setFields(loadedFields);
    setNodes(loadedNodes);
    setEdges(loadedEdges);
    setSavedSnapshot(snapshot(loadedFields, layoutOf(loadedNodes, loadedEdges)));
    setSelectedNode("prompt");
    setError("");
    setTestOpen(false);
  };

  const startNewAgent = (existing: AgentSummary[], hints: Record<string, string>) => {
    setAgentId(null);
    setFields(newAgentFields(existing, hints));
    setNodes(toFlowNodes(newAgentLayout()));
    setEdges([]);
    setSavedSnapshot(null);
    setSelectedNode("prompt");
    setError("");
    setTestOpen(false);
  };

  const openAgent = async (id: string) => {
    try {
      const { agent } = await fetchJson<{ agent: SavedAgent }>(`/api/agents/${id}`);
      showAgent(agent);
    } catch (e) {
      setError(`Could not open the agent: ${(e as Error).message}`);
    }
  };

  const showFirstAgent = useEffectEvent((list: AgentSummary[], hints: Record<string, string>) => {
    setAgents(list);
    setKeyHints(hints);
    if (list.length > 0) {
      void openAgent(list[0].id);
    } else {
      startNewAgent(list, hints);
    }
  });

  useEffect(() => {
    Promise.all([fetchJson<{ agents: AgentSummary[] }>("/api/agents"), fetchJson<SettingsResponse>("/api/settings")])
      .then(([list, settings]) => showFirstAgent(list.agents, settings.keys))
      .catch((e: Error) => setLoadError(`Could not load your agents: ${e.message}`));
  }, []);

  /** Leaving an agent with unsaved changes needs a yes from the player. */
  const mayLeaveAgent = () => !hasUnsavedChanges || window.confirm(`Discard the unsaved changes to ${fields.name || "this agent"}?`);

  const selectAgent = (id: string) => {
    if (id !== agentId && mayLeaveAgent()) {
      void openAgent(id);
    }
  };

  const newAgent = () => {
    if (mayLeaveAgent()) {
      startNewAgent(agents ?? [], keyHints);
    }
  };

  const updateFields = (patch: Partial<AgentFields>) => setFields((current) => ({ ...current, ...patch }));

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const { agent } = await fetchJson<{ agent: SavedAgent }>(agentId ? `/api/agents/${agentId}` : "/api/agents", {
        method: agentId ? "PUT" : "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ ...fields, layout }),
      });
      const savedFields = fieldsOf(agent); // trimmed by the server
      setAgentId(agent.id);
      setFields(savedFields);
      setSavedSnapshot(snapshot(savedFields, layout));
      setAgents((current) => [summaryOf(agent), ...(current ?? []).filter((listed) => listed.id !== agent.id)]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const deleteAgent = async () => {
    if (!agentId || !window.confirm(`Delete ${fields.name}? This can't be undone.`)) {
      return;
    }
    const response = await fetch(`/api/agents/${agentId}`, { method: "DELETE" });
    const alreadyGone = response.status === 404;
    if (!response.ok && !alreadyGone) {
      setError(`Could not delete the agent (HTTP ${response.status}).`);
      return;
    }
    const remaining = (agents ?? []).filter((listed) => listed.id !== agentId);
    setAgents(remaining);
    if (remaining.length > 0) {
      void openAgent(remaining[0].id);
    } else {
      startNewAgent(remaining, keyHints);
    }
  };

  const onNodesChange = (changes: NodeChange[]) => setNodes((current) => applyNodeChanges(changes, current));
  const onEdgesChange = (changes: EdgeChange[]) => setEdges((current) => applyEdgeChanges(changes, current));
  const onConnect = (connection: Connection) => setEdges((current) => addEdge(toFlowEdge(connection.source, connection.target), current));

  /** Only the chain's wires can be drawn, each once. */
  const isNewAllowedWire = (connection: Connection | Edge) => {
    const alreadyDrawn = edges.some((edge) => edge.source === connection.source && edge.target === connection.target);
    return isAllowedWire(connection.source, connection.target) && !alreadyDrawn;
  };

  const addNode = (id: NodeId) => {
    const position = newAgentLayout().positions[id];
    if (position) {
      setNodes((current) => [...current, toFlowNode(id, position)]);
      setSelectedNode(id);
    }
  };

  const selectNode = (id: string) => {
    const node = NODE_IDS.find((nodeId) => nodeId === id);
    setSelectedNode(node ?? null);
  };

  if (loadError) {
    return (
      <p role="alert" className="text-red-200">
        {loadError}
      </p>
    );
  }
  if (!agents) {
    return <p className="text-cream/70">Loading your agents…</p>;
  }

  const missingNodes = REMOVABLE_NODES.filter((id) => !nodes.some((node) => node.id === id));
  const panelNode = selectedNode && nodes.some((node) => node.id === selectedNode) ? selectedNode : null;
  const atLimit = agents.length >= AGENT_LIMIT;
  const statusText = missing ?? (hasUnsavedChanges ? "Ready to save." : "Saved.");
  const canSave = !missing && hasUnsavedChanges && fields.name.trim().length > 0 && !saving;
  const testBlockedReason = whyTestIsBlocked(agentId, hasUnsavedChanges, keyHints, fields);

  return (
    <div className="text-left">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs uppercase tracking-wider text-cream/50">Your agents</span>
        {agents.map((agent) => (
          <button
            key={agent.id}
            type="button"
            aria-current={agent.id === agentId}
            onClick={() => selectAgent(agent.id)}
            className="flex items-center gap-2 rounded-full bg-black/35 px-3 py-1.5 text-sm ring-1 ring-gold/25 transition-colors hover:bg-[#5a121b] aria-[current=true]:bg-[#5a121b] aria-[current=true]:ring-gold"
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: PROVIDERS[agent.provider].color }} />
            {agent.name}
          </button>
        ))}
        <button
          type="button"
          onClick={newAgent}
          disabled={atLimit}
          title={atLimit ? `You have ${AGENT_LIMIT} agents; delete one first.` : undefined}
          className="rounded-full px-3 py-1.5 text-sm border border-dashed border-gold/50 text-gold hover:bg-black/30 disabled:opacity-50"
        >
          + New agent
        </button>
      </div>

      <div className="mt-5 flex flex-wrap items-end gap-3">
        <label className="w-full min-w-0 text-sm sm:w-auto sm:flex-1">
          Agent name
          <input
            className="field mt-1 block w-full font-display text-xl tracking-wide"
            maxLength={MAX_AGENT_NAME}
            value={fields.name}
            onChange={(e) => updateFields({ name: e.target.value })}
          />
        </label>
        <button type="button" className="btn-gold disabled:cursor-not-allowed disabled:opacity-50" disabled={!canSave} onClick={save}>
          {saving ? "SAVING…" : "SAVE"}
        </button>
        <button
          type="button"
          aria-expanded={testOpen}
          onClick={() => setTestOpen(!testOpen)}
          className="rounded-full px-4 py-2.5 font-display tracking-wide ring-1 ring-gold/50 hover:bg-black/30"
        >
          TEST
        </button>
        {agentId && (
          <button type="button" onClick={deleteAgent} className="px-2 py-2.5 text-sm text-cream/60 hover:text-red-200">
            Delete
          </button>
        )}
      </div>
      <p role="status" className={`mt-2 min-h-5 text-sm ${missing ? "text-amber-200" : "text-emerald-300"}`}>
        {statusText}
        {error && <span className="ml-3 text-red-200">{error}</span>}
      </p>

      {testOpen && <AgentTest key={agentId ?? "new"} agentId={agentId} blockedReason={testBlockedReason} onClose={() => setTestOpen(false)} />}

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_17rem]">
        <div>
          <div className="agent-canvas h-[24rem] overflow-hidden rounded-2xl bg-black/30 ring-1 ring-gold/30 sm:h-[30rem]">
            <AgentFieldsContext value={fields}>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={AGENT_NODE_TYPES}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                isValidConnection={isNewAllowedWire}
                onNodeClick={(_, node) => selectNode(node.id)}
                deleteKeyCode={["Backspace", "Delete"]}
                colorMode="dark"
                minZoom={0.4}
                fitView
                fitViewOptions={{ padding: 0.08 }}
              >
                <Background />
                <Controls showInteractive={false} />
              </ReactFlow>
            </AgentFieldsContext>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-cream/60">
            {missingNodes.map((id) => (
              <button key={id} type="button" onClick={() => addNode(id)} className="rounded-full bg-black/35 px-3 py-1 text-cream ring-1 ring-gold/30 hover:bg-[#5a121b]">
                + Add {NODE_LABELS[id]} node
              </button>
            ))}
            <span>
              Drag from a node&apos;s right dot to another node&apos;s left dot to connect them. Select a node or wire and press Delete to remove it;
              Table state and Output are locked.
            </span>
          </div>
        </div>
        <div className="rounded-2xl bg-black/25 p-4 ring-1 ring-gold/20">
          <NodePanel key={agentId ?? "new"} node={panelNode} fields={fields} keyHints={keyHints} onChange={updateFields} />
        </div>
      </div>
    </div>
  );
}

/** Why the Test button can't run yet, or null when it can: tests play the saved agent, on a saved key. */
function whyTestIsBlocked(agentId: string | null, hasUnsavedChanges: boolean, keyHints: Record<string, string>, fields: AgentFields): string | null {
  if (!agentId) {
    return "Save the agent first.";
  }
  if (hasUnsavedChanges) {
    return "Save your changes first, so the test plays the saved agent.";
  }
  if (!keyHints[fields.provider]) {
    return `Add your ${PROVIDERS[fields.provider].label} API key first.`;
  }
  return null;
}
