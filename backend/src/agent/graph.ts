import { END, START, StateGraph } from '@langchain/langgraph';
import { AgentState, type Message, type ToolEvent, type ToolTrace } from './state.js';
import { callModel } from './model.js';
import { executeTool } from './tools.js';

const actionNames = new Set(['addBook', 'updateBook', 'updateReadingProgress', 'saveNote', 'saveQuote', 'createReadingGoal', 'updateReadingGoal', 'createReadingTask', 'createReadingPlan', 'completeReadingTask', 'saveMemory', 'forgetMemory']);
const same = (left: string | undefined, right: string | undefined) => left?.trim().toLowerCase() === right?.trim().toLowerCase();

function visibleEvents(events: ToolEvent[], trace: ToolTrace[]) {
  return events.filter((event, index) => {
    if (event.name !== 'getBook' || event.success) return true;
    const lookup = trace[index]?.arguments as { title?: string; author?: string } | undefined;
    if (!lookup?.title) return true;
    return !trace.slice(index + 1).some(item => {
      if (item.name !== 'addBook' || item.result.success !== true) return false;
      const book = item.result.book as { title?: string; author?: string } | undefined;
      return same(lookup.title, book?.title) && (!lookup.author || same(lookup.author, book?.author));
    });
  });
}

function summarizeEvents(events: ToolEvent[]) {
  const actions = events.filter(event => actionNames.has(event.name));
  const failures = events.filter(event => !event.success && !actionNames.has(event.name));
  return [...(actions.length ? actions : events.filter(event => event.success)), ...failures].map(event => event.summary).join('. ') || 'I could not complete the request.';
}

const graph = new StateGraph(AgentState)
  .addNode('model', async state => {
    if (state.rounds >= 12) return { messages: [{ role: 'assistant' as const, content: `I reached the tool-call limit. These are the results so far: ${summarizeEvents(visibleEvents(state.events, state.toolTrace))}.` }] };
    try { const { message, usage } = await callModel(state.messages); return { messages: [message], usage: usage ? [usage] : [] }; }
    catch (error) {
      if (!state.events.length) throw error;
      return { messages: [{ role: 'assistant' as const, content: `The assistant stopped after these tool results: ${summarizeEvents(visibleEvents(state.events, state.toolTrace))}.` }] };
    }
  })
  .addNode('tools', async state => {
    const last = state.messages.at(-1);
    if (last?.role !== 'assistant') throw new Error('Expected assistant tool calls');
    const messages: Message[] = [];
    const events = [];
    const toolTrace = [];
    for (const call of last.tool_calls ?? []) {
      const started = Date.now();
      const { result, event } = await executeTool(state.userId, call, state.request);
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      events.push(event);
      let args: unknown;
      try { args = JSON.parse(call.function.arguments); } catch { args = call.function.arguments; }
      toolTrace.push({ name: call.function.name, arguments: args, result, durationMs: Date.now() - started });
    }
    return { messages, events, toolTrace, rounds: state.rounds + 1 };
  })
  .addEdge(START, 'model')
  .addConditionalEdges('model', state => {
    const last = state.messages.at(-1);
    return last?.role === 'assistant' && last.tool_calls?.length ? 'tools' : END;
  }, ['tools', END])
  .addEdge('tools', 'model')
  .compile();

export async function runAgent(userId: string, request: string, history: Message[] = []) {
  const state = await graph.invoke({ userId, request, rounds: 0, messages: [...history, { role: 'user', content: request }], events: [], toolTrace: [], usage: [] }, { recursionLimit: 30 });
  const last = state.messages.at(-1);
  if (last?.role !== 'assistant' || !last.content) throw new Error('Agent did not produce a final answer');
  const events = visibleEvents(state.events, state.toolTrace);
  const details = { events, toolTrace: state.toolTrace, usage: state.usage.reduce((total, item) => ({ promptTokens: total.promptTokens + item.promptTokens, completionTokens: total.completionTokens + item.completionTokens }), { promptTokens: 0, completionTokens: 0 }) };
  return { reply: events.some(event => !event.success) ? summarizeEvents(events) : last.content, ...details };
}
