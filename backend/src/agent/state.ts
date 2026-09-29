import { Annotation } from '@langchain/langgraph';

export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type Message =
  | { role: 'user' | 'system'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[]; [key: string]: unknown }
  | { role: 'tool'; tool_call_id: string; content: string };
export type ToolEvent = { name: string; success: boolean; summary: string };
export type ToolTrace = { name: string; arguments: unknown; result: Record<string, unknown>; durationMs: number };
export type ModelUsage = { promptTokens: number; completionTokens: number };

export const AgentState = Annotation.Root({
  userId: Annotation<string>,
  request: Annotation<string>,
  rounds: Annotation<number>,
  messages: Annotation<Message[]>({ reducer: (left, right) => left.concat(right), default: () => [] }),
  events: Annotation<ToolEvent[]>({ reducer: (left, right) => left.concat(right), default: () => [] }),
  toolTrace: Annotation<ToolTrace[]>({ reducer: (left, right) => left.concat(right), default: () => [] }),
  usage: Annotation<ModelUsage[]>({ reducer: (left, right) => left.concat(right), default: () => [] })
});
