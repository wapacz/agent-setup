# Design — skill `obsidian-daily`

Date: 2026-07-15 · Status: approved & implemented

## Goal
Pi skill that writes tasks, daily summaries, and Pi-session digests into Michal's
Obsidian vault following its existing conventions (Tasks plugin, daily-note
sections, ADHD micro-steps).

## Vault conventions relied on
- Daily note `📅 Daily Notes/YYYY-MM-DD.md` with `## ✅ Zadania / ## 📝 Notatki / ## 🔗 Linki`.
- Tasks plugin: priorities `🔺⏫🔼🔽`, dates `📅/🛫/🔁`, tag `#todo`, completion `✅ YYYY-MM-DD`.
- Central TODO `📋 Dashboard/✅ TODO.md` with `📥 Quick Capture`.
- `📊 Progress` counts real `✅` dates — never fake them.

## Decisions
- **Task routing:** smart — no priority/deadline → daily note `✅ Zadania`;
  with priority/deadline → TODO `📥 Quick Capture`.
- **Session harvest destination:** today's daily note `📝 Notatki`.
- **Harvest grouping:** cluster sessions by topic/task (shared cwd, related
  themes, tickets, files) — not one bullet per session — because one task often
  spans several sessions.
- **Harvest trigger:** only on explicit "notatka z całego dnia".

## Components
- `SKILL.md` — workflow + conventions + 6 capabilities.
- `scripts/gather_sessions.py` — READ-ONLY collector of today's Pi sessions from
  `~/.pi/agent/sessions/*/*.jsonl` → condensed JSON (handles ISO and epoch
  timestamps, local-date filtering, per-message caps). The agent clusters and
  presents a multi-select questionnaire.

## Capabilities
1. Add task (smart routing, micro-steps)
2. Complete task (real ✅ date)
3. Daily summary → `📝 Notatki`
4. Create daily note (scaffold if missing)
5. Weekly review helper
6. Harvest Pi sessions → grouped digest in daily note (explicit request only)

## Safety
Append/merge only, idempotent, never fabricate ✅ dates, gather script never
writes, preserve emoji prefixes and formatting.
