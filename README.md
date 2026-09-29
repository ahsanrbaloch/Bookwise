# Bookwise

Bookwise is a personal reading library with an AI assistant that can answer questions about your books and take actions on your behalf. It tracks books, reading progress, notes, quotes, goals, tasks, and weekly reviews.

## AI agent

- **Tool use:** A LangGraph loop lets the assistant search the library, update books and progress, save notes and quotes, manage goals and tasks, and create reading plans. Zod validates tool arguments before application services write to PostgreSQL.
- **Grounded answers:** The assistant retrieves relevant books, notes, and quotes from PostgreSQL, including full-text search results with book titles and page numbers. It uses actual tool results when reporting actions.
- **Long-term memory:** Preferences, facts, goals, and instructions are stored separately from chat history. Corrections supersede old memories; book progress and status remain authoritative in the book record.
- **Context management:** Recent turns, a summary of older turns, relevant library records, and memories are selected within a context budget. Retrieved user content is treated as data, not instructions.
- **Multi-step planning:** The assistant can create a dated reading plan from a book's page count and current progress. The database transaction saves its goal and tasks together, and retries return an existing active plan.
- **Traceability:** Requests record selected context, tool outcomes, token usage, latency, and errors. Development responses expose the context and tool trace; production responses omit those details.

```text
React chat → Express API → context retrieval → LangGraph agent → OpenAI model
                         ↑                         ↓ tool call
                    PostgreSQL ← services ← validated tools
```

The server supplies the user ID; the model cannot choose one. Queries are scoped to that user, and the assistant reports failed actions as failures. The graph bounds tool rounds, and the assistant stays focused on the user's reading library.

## Run locally

Requires Node.js 20+ and Docker. Run these commands from the project root.

```bash
docker compose up -d db
(cd backend && npm install && cp ../.env.example .env)
```

Set `OPENAI_API_KEY` in `backend/.env`, then run the backend:

```bash
cd backend && npm run dev
```

In another terminal, run the frontend:

```bash
cd frontend && npm install && npm run dev
```

Open http://localhost:5173. The default model is `gpt-4.1-mini`; `OPENAI_MODEL` can select another model that supports Chat Completions tool calling. PostgreSQL is available at localhost:5434. A new database gets its schema automatically; for an existing volume, apply the numbered files in `backend/db/` in order. The fixed development user ID and example database password are for local use; multi-user deployment needs authentication.

## Checks and evaluation

Run `npm run build` in both `backend` and `frontend`. The backend includes smoke checks for tool use, retrieval, memory, context, workflows, and data operations. Run `cd backend && npm run evaluate` for 18 live-model cases covering retrieval, memory corrections, duplicate actions, failed tools, multi-step plans, prompt injection in a note, and cross-user isolation. The evaluation uses temporary users, cleans up its data, and writes detailed results to `backend/evaluation/results/latest.json`. Live-model checks consume OpenAI API tokens.
