# KnowledgeCore — Local Setup

> Engineering setup only. For project vision and the L0–L3 roadmap, see the workspace-root docs.

## Prerequisites

- [Bun](https://bun.sh) >= 1.3
- [Docker](https://docs.docker.com/get-docker/) (Compose v2)
- A Google GenAI API key (`GOOGLE_GENAI_API_KEY`) — **mandatory**. The app runs live-only; every LLM-backed service requires this key and the registry throws on startup without it.
- An OpenAlex API key (`OPENALEX_API_KEY`) — **mandatory** for the academic source tier. The mailto polite-pool was deprecated on 2026-02-13; the client throws on startup without this key. Obtain at https://openalex.org/accounts. Credit-based limits apply (~$0.001 per search query).

## First-time setup

```bash
# 1. Install dependencies
bun install

# 2. Start Postgres + Qdrant
bun run db:up

# 3. Copy env template and fill in secrets
cp .env.example .env
# Required at minimum: GOOGLE_GENAI_API_KEY, OPENALEX_API_KEY, TAVILY_API_KEY, BETTER_AUTH_SECRET, DATABASE_URL

# 4. Generate BETTER_AUTH_SECRET
openssl rand -base64 32  # paste into BETTER_AUTH_SECRET in .env

# 5. Run Prisma migrations
bun run prisma:migrate

# 6. Smoke-test external services (LLMs + OpenAlex)
bun run smoke

# 7. Start the dev server
bun run dev
```

## What runs where

| Service | Port | Purpose |
|---|---|---|
| Next.js dev server | 3000 | App |
| Postgres | 5440 (host) | Relational DB (users, sessions, learning paths, sources, chunks) |
| Qdrant | 6433 (REST), 6434 (gRPC) (host) | Vector DB (embeddings for L2 provenance retrieval) |

## Key directories

```
app/                Next.js App Router routes
lib/
  auth.ts           Better Auth server config (email+password)
  auth-client.ts    Better Auth browser client
  llm/              Direct provider SDKs + thin internal client
  services/         Service registry (live-only; no mock fallback except MockResearchAgent seam)
  research/         Academic + web search clients (OpenAlex, Semantic Scholar, Tavily, Firecrawl)
  vector/           Qdrant client wrapper
prisma/             Schema and migrations
middleware.ts       Route protection
scripts/            Verify scripts and smoke tests
docker-compose.yml  Local Postgres + Qdrant
```

## Live-only services

KnowledgeCore has no mock fallback. All LLM-backed services are live and require
`GOOGLE_GENAI_API_KEY`. The research (academic) tier additionally requires
`OPENALEX_API_KEY` and `TAVILY_API_KEY`; both are checked at call time and throw
a clear error if absent.

There are no `LIVE_*` opt-out environment flags.
