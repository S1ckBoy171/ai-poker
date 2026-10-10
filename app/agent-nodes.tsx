"use client";

// The four nodes on the Build Your Agent canvas. Each shows a short summary; its settings open in the side panel.
import { Handle, Position, type NodeProps, type NodeTypes } from "@xyflow/react";
import { createContext, useContext, type ReactNode } from "react";
import type { AgentFields, NodeId } from "@/lib/built-agents";
import { PROVIDERS } from "@/lib/config";

const PROMPT_PREVIEW_LENGTH = 90;

/** The agent being edited, so the nodes can show its prompt and model without copying them into node data. */
export const AgentFieldsContext = createContext<AgentFields | null>(null);

function useAgentFields(): AgentFields {
  const fields = useContext(AgentFieldsContext);
  if (!fields) {
    throw new Error("Agent nodes must be rendered inside AgentFieldsContext");
  }
  return fields;
}

type NodeCardProps = { title: string; locked?: boolean; selected: boolean; children: ReactNode };

function NodeCard({ title, locked = false, selected, children }: NodeCardProps) {
  const border = selected ? "border-gold ring-2 ring-gold/40" : "border-gold/40";
  return (
    <div className={`w-52 rounded-xl border bg-[#22050a]/95 px-3 py-2 text-left shadow-lg ${border}`}>
      <div className="flex items-center justify-between font-display text-sm tracking-wider text-gold">
        {title}
        {locked && <span className="text-[10px] uppercase tracking-widest text-cream/50">locked</span>}
      </div>
      <div className="mt-1 text-xs leading-snug text-cream/80">{children}</div>
    </div>
  );
}

function TableStateNode({ selected }: NodeProps) {
  return (
    <NodeCard title="TABLE STATE" locked selected={selected}>
      Every turn: the table, the agent&apos;s cards, every action this hand, and &ldquo;It is your turn&rdquo;.
      <Handle type="source" position={Position.Right} />
    </NodeCard>
  );
}

function PromptNode({ selected }: NodeProps) {
  const { prompt } = useAgentFields();
  const preview = prompt.length > PROMPT_PREVIEW_LENGTH ? `${prompt.slice(0, PROMPT_PREVIEW_LENGTH)}…` : prompt;
  return (
    <NodeCard title="PROMPT" selected={selected}>
      {preview || <span className="italic text-cream/50">Write the agent&apos;s persona and strategy</span>}
      <Handle type="source" position={Position.Right} />
    </NodeCard>
  );
}

function ModelNode({ selected }: NodeProps) {
  const { provider, model, effort } = useAgentFields();
  return (
    <NodeCard title="MODEL" selected={selected}>
      <span className="block truncate">
        {PROVIDERS[provider].label} · {model || <span className="italic text-cream/50">choose a model</span>}
      </span>
      {effort !== "default" && <span className="text-cream/60">effort: {effort}</span>}
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </NodeCard>
  );
}

function OutputNode({ selected }: NodeProps) {
  return (
    <NodeCard title="OUTPUT" locked selected={selected}>
      One legal move as strict JSON: action, amount, say. Anything else is sent back to the agent.
      <Handle type="target" position={Position.Left} />
    </NodeCard>
  );
}

/** The React Flow node type of each node. Not the bare ids: React Flow styles its own "output" type. */
export const NODE_TYPE_OF: Record<NodeId, string> = {
  table: "tableStateNode",
  prompt: "promptNode",
  model: "modelNode",
  output: "outputNode",
};

export const AGENT_NODE_TYPES: NodeTypes = {
  tableStateNode: TableStateNode,
  promptNode: PromptNode,
  modelNode: ModelNode,
  outputNode: OutputNode,
};
