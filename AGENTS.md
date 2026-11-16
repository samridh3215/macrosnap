# AGENTS.md: Macro Snap

Share a food photo from the Android gallery, get calories and macros you can trust, judged against targets that adapt to training and real metabolism. v1 is self-hosted: Docker, SQLite, Redis cache, Tailscale for HTTPS.

## Memory lives in the KnowledgeBase, not here

All project memory (decisions, plan, tasks, post drafts, learnings) is written to the Obsidian vault at `~/Documents/KnowledgeBase`. Do not keep notes, plans or decision logs in this repo, and do not create a memory folder here.

Before starting work, read:
- `~/Documents/KnowledgeBase/AGENTS.md` for the vault's folders and formats. Follow it exactly: the dashboard reads those files.
- `~/Documents/KnowledgeBase/Pages/Macro Snap.md` for scope and milestones.
- `~/Documents/KnowledgeBase/Pages/Macro Snap - Decisions.md` for every decision made so far and why.

Write there, in the vault's formats:
- **Decisions:** append a dated line to `Pages/Macro Snap - Decisions.md` whenever scope, architecture or a plan changes. Newest first.
- **Tasks:** one note per task in `TaskNotes/Tasks/<Title>.md` with `projects: ["[[Macro Snap]]"]`, tags `task`, `macrosnap` and a milestone tag (`m1-selfhost`, `m2-launch`, `v2-backlog`). Set `status: done` and `completedDate` when finished. Titles can't contain `/ \ : * ? " < > | # ^ [ ]`.
- **Posts:** the social posts and their status live in `Pages/Macro Snap - Post drafts.md`.
- **Anything else** (learnings, ideas): follow the "Where things go" table in the vault's AGENTS.md. Search `Pages/` first and append rather than duplicating.
- Never write secrets (tokens, API keys) into the vault. Don't commit or push the vault unless asked.

## Working in this repo

- Node 22.13+ (Docker uses node:24-slim). `npm test` and `npm run typecheck` must pass before you finish.
- `npm run dev:fake` runs with a fake AI and an in-memory store, no keys needed.
- Storage: SQLite when `SQLITE_FILE` is set (Couchbase overrides it if configured). Redis is a cache only; losing it must never break the app.
- The Jev judge is off by default (`JUDGE=jev` to enable) and must never block logging; it falls back to similarity rules.
- Out of scope for v1: image embeddings and photo memory. The hosted multi-user version lives on the `prod` branch behind `MODE=hosted` (`npm run dev:hosted` to try it); self-hosted behaviour must not change when `MODE` is unset. New ideas go to the v2 backlog in the vault, not into this weekend's work.
- Git repo, `main` tracks `origin` (GitHub `samridh3215/macrosnap`). Don't commit or push unless asked.
