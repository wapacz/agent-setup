---
name: obsidian-daily
description: >-
  Save tasks, daily summaries, and session digests into Michal's Obsidian vault
  following its conventions (Tasks plugin priorities/dates, daily-note sections,
  ADHD micro-steps). Also use to READ or BROWSE the vault: open/read a specific
  note, search notes by content or title, list recent notes, or explore folders.
  Use when the user wants to add or complete a task, log what they did today,
  create today's daily note, run a weekly review, read/find/browse existing
  notes, or (only on explicit request) gather notes from all of today's Pi
  sessions into the daily note. Triggers: "dodaj task", "zapisz zadanie",
  "odhacz", "zrobione", "podsumuj dzień", "notatka z całego dnia",
  "przegląd tygodnia", "wczytaj notatkę", "otwórz notatkę", "znajdź notatkę",
  "pokaż notatki", "co mam w vaultcie".
---

# Obsidian Daily

Write tasks, summaries, and session digests into the Obsidian vault using its
established structure. Respect conventions exactly — the vault is an ADHD-support
system where fake data breaks trust in the momentum charts.

## Vault location

```
VAULT="/mnt/c/Users/qmiclap/OneDrive - Ericsson/Documents/Obsidian Vault"
```

Always quote the path (it contains spaces). Key files:

- Daily note: `$VAULT/📅 Daily Notes/YYYY-MM-DD.md`
- Central TODO: `$VAULT/📋 Dashboard/✅ TODO.md`
- Weekly review: `$VAULT/📋 Dashboard/🗓️ Weekly Review.md`
- Inbox: `$VAULT/📄 Inbox/`

Get "today" with `date +%F`. Never hardcode the date.

## Conventions (read before writing anything)

**Daily note structure** (H1 + three sections):

```markdown
# 📅 YYYY-MM-DD

## ✅ Zadania

## 📝 Notatki

## 🔗 Linki
```

**Tasks plugin syntax** (used in every task line):

- Priority emoji: `🔺` highest/today · `⏫` urgent · `🔼` this week · `🔽` someday
- Dates: `📅 YYYY-MM-DD` due · `🛫 YYYY-MM-DD` start · `🔁 every ...` recurring
- Tag: `#todo` (required for a task to appear in the dashboard dataview views)
- Completion: `- [x] ... ✅ YYYY-MM-DD` — the date is the REAL day it was done.
  **Never invent or backfill ✅ dates**; they feed `📊 Progress`.
- Break any non-trivial task into 15–25 min micro-steps as indented subtasks.

**Linking:** use `[[Double Brackets]]` for internal links. Keep emoji folder
prefixes intact.

**No redundant H1 title:** Obsidian shows the filename as the page header
automatically. Do NOT add a top-level `# Title` that just repeats the filename
(e.g. a note `2026-07-15 — baseline.md` should start with its first `##` section,
not `# 2026-07-15 — baseline`). The daily-note scaffold above keeps its `# 📅 <date>`
heading for backward compatibility, but for any NEW standalone note start straight
with content/`##` sections.

## Capabilities

### 1. Add task (smart routing)

Decide destination by context:

- **No priority and no deadline** → append to `## ✅ Zadania` in today's daily note.
- **Has a priority or a deadline** (user said "pilne", "na jutro", gave a date,
  etc.) → append to the `## 📥 Quick Capture` section in `📋 Dashboard/✅ TODO.md`
  with the matching priority/date emoji and `#todo`.

Format big tasks with micro-step subtasks. Example (daily note):

```markdown
- [ ] Poprawić CSS w CHANGELOG (preprocessing portal) #todo
	- [ ] Znaleźć regułę CSS odpowiedzialną za CHANGELOG
	- [ ] Poprawić kontrast wg zmiennych motywu
	- [ ] Zweryfikować w dark + light mode
```

Example (TODO Quick Capture, prioritized + due):

```markdown
- [ ] Deploy mcp-gateway na SCLProd01 🔼 📅 2026-07-18 #todo
```

Append without disturbing other lines; don't duplicate an existing task.

### 2. Complete a task

Find the task (search today's daily note first, then `✅ TODO.md`, then vault-wide
if needed). Flip `- [ ]` → `- [x]` and append `✅ <today>` using the real date
from `date +%F`. If several match, ask which one. Never fake the date.

### 3. Daily summary

Append a concise bullet summary of what was done / decided to the `## 📝 Notatki`
section of today's daily note. Keep it factual and short; link projects with `[[]]`
when relevant. Create the daily note first if it doesn't exist (capability 4).

### 4. Create today's daily note

If `$VAULT/📅 Daily Notes/<today>.md` is missing, create it with the exact
scaffold shown in Conventions (H1 `# 📅 <today>` + the three empty sections).
Do this automatically before writing tasks/notes/summaries when the file is absent.

### 5. Weekly review helper

Open `📋 Dashboard/🗓️ Weekly Review.md` and follow its ritual. Practically:
read the `📥 Quick Capture` items in `✅ TODO.md`, and for each, propose where it
belongs (assign priority/date, move under a project, or drop it). Apply the user's
decisions. Keep it to a 15-minute reset — don't over-engineer.

### 6. Harvest today's Pi sessions → daily note (ONLY on explicit request)

Trigger only when the user asks for "notatka z całego dnia" / a whole-day note.
Do NOT run this for a normal daily summary.

Steps:

1. Run the gather script (READ-ONLY over session logs):

   ```bash
   python3 ~/.pi/agent/skills/obsidian-daily/scripts/gather_sessions.py --date "$(date +%F)"
   ```

   It returns JSON with today's sessions: `cwd`, `project`, `start_local`,
   `end_local`, `first_prompt`, `user_prompts[]`, `assistant_snippets[]`.

2. **Cluster the sessions by topic/task**, not one-per-session. Multiple sessions
   often cover one task or related tasks — group them by shared `cwd`/project,
   related themes, referenced tickets (e.g. `SYCOMPLAB-xxx`), or file names.
   Ignore trivial/noise sessions (smoke tests, one-line pings, empty prompts).

3. Present a **questionnaire (multi-select)** listing the *clusters*, e.g.
   "Preprocessing portal — obrazy w zipie (3 sesje 09:12–14:03) — zapisać?".
   Let the user pick which clusters are worth saving.

4. Append each chosen cluster to `## 📝 Notatki` in today's daily note as a
   sub-section with an `###` heading per theme:

   ```markdown
   ### <Temat / zadanie>
   - Sesje: 09:12, 11:40, 14:03 (<project>)
   - Co ustalono: <zwięźle>
   - Następny krok: <opcjonalnie> (zaproponuj utworzenie taska wg capability 1)
   ```

   Link related clusters with `[[]]` when they share a project. Offer to turn any
   "następny krok" into a task.

### 7. Read / find / browse notes (READ-ONLY)

Use when the user wants to open a note, search the vault, or explore what's
there. This is read-only — never modify anything under this capability.

**Open a specific note by name.** The user usually gives a title, not a path.
Resolve it case-insensitively across the whole vault (titles contain spaces,
em-dashes `—`, and emoji), then `read` the match:

```bash
VAULT="/mnt/c/Users/qmiclap/OneDrive - Ericsson/Documents/Obsidian Vault"
find "$VAULT" -type f -iname "*<fragment>*.md" -not -path "*/.git/*" -not -path "*/.obsidian/*"
```

If several match, list them (with folder) and ask which one. Always exclude
`.git/` and `.obsidian/` from every search.

**Search by content** (full-text across notes):

```bash
grep -rl --include="*.md" "<phrase>" "$VAULT" | grep -v "/.git/" | grep -v "/.obsidian/"
# add -i for case-insensitive; use rg if available for speed
```

Report matches as note titles + the relevant snippet, not raw paths only.

**List recent notes** (what was touched lately):

```bash
find "$VAULT" -type f -name "*.md" -not -path "*/.git/*" -not -path "*/.obsidian/*" \
  -printf "%TY-%Tm-%Td %p\n" | sort -r | head -20
```

**Browse structure / folders:**

```bash
find "$VAULT" -maxdepth 1 -type d -not -name ".*"          # top-level folders
ls -1 "$VAULT/📄 Inbox"                                    # notes in a folder
```

Key folders to know: `📅 Daily Notes/`, `📋 Dashboard/`, `📄 Inbox/`, plus any
project/topic folders. When following `[[wikilinks]]` from a note, resolve the
link text to a `.md` filename with the same `-iname "*<link>*.md"` search.

After reading, give a concise summary (not a full dump unless asked) and offer
relevant follow-ups (e.g. turn a "następny krok" into a task via capability 1).

## Safety rules

- Append/merge into the correct section; never overwrite existing content.
- Idempotent: don't create duplicate tasks or repeat digest entries.
- Never fabricate `✅` completion dates.
- The gather script only reads session logs — it must never write anywhere.
- Preserve emoji folder/section prefixes and existing formatting exactly.
