# KnowledgeCore — Local Setup

> Engineering setup only. For project vision and the L0–L3 roadmap, see the workspace-root docs (`README.md`, `L0.md`, `DECISIONS.md`, `RESEARCH.md`).

## Prerequisites

- [Bun](https://bun.sh) >= 1.3
- [Docker](https://docs.docker.com/get-docker/) (Compose v2)
- A Google Cloud OAuth app (for Auth.js Google provider) — see step 4

## First-time setup

```bash
# 1. Install dependencies
bun install

# 2. Start Postgres + Qdrant
bun run db:up

# 3. Copy env template and fill in secrets
cp .env.example .env

# 4. Generate AUTH_SECRET
openssl rand -base64 32  # paste into AUTH_SECRET in .env

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
| Postgres | 5432 | Relational DB (users, sessions, learning paths, sources, chunks) |
| Qdrant | 6333 (REST), 6334 (gRPC) | Vector DB (embeddings for L2 provenance retrieval, L3 recommendations) |

## Key directories

```
app/                Next.js App Router routes
lib/
  llm/              Direct provider SDKs + thin internal client
  research/         Academic + web search clients (OpenAlex, Semantic Scholar, Tavily, Firecrawl)
  vector/           Qdrant client wrapper
  theme/            MUI theme + design tokens placeholder
prisma/             Schema and migrations
auth.ts             Auth.js v5 entry
auth.config.ts      Edge-safe Auth.js config (used by middleware)
middleware.ts       Route protection
scripts/            One-off scripts (smoke tests, etc.)
docker-compose.yml  Local Postgres + Qdrant
```
