#!/usr/bin/env python3
"""Gather Pi coding-agent sessions for a given day into condensed JSON.

Reads ~/.pi/agent/sessions/--<cwd>--/<ISO>_<uuid>.jsonl transcripts, keeps the
sessions that had activity on the target date (local time), and emits a compact
JSON summary the agent can cluster by topic and turn into daily-note entries.

Usage:
    gather_sessions.py [--date YYYY-MM-DD] [--sessions-dir PATH]
                       [--max-msgs N] [--max-chars N]

Output (stdout): JSON { "date", "count", "sessions": [ ... ] }
Each session: { id, cwd, project, start_local, end_local, msg_count,
                first_prompt, user_prompts[], assistant_snippets[] }
This script is READ-ONLY. It never writes to the vault or the session logs.
"""
import argparse
import datetime as dt
import glob
import json
import os
import sys

DEFAULT_SESSIONS_DIR = os.path.expanduser("~/.pi/agent/sessions")


def parse_iso(ts):
    """Parse a timestamp into an aware datetime.

    Accepts ISO-8601 strings (with trailing Z) and numeric epoch values
    (seconds or milliseconds).
    """
    if ts is None or ts == "":
        return None
    if isinstance(ts, (int, float)):
        seconds = ts / 1000.0 if ts > 1e11 else float(ts)
        try:
            return dt.datetime.fromtimestamp(seconds, tz=dt.timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    try:
        return dt.datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except ValueError:
        return None


def local_date(ts):
    parsed = parse_iso(ts)
    if parsed is None:
        return None
    return parsed.astimezone().date()


def local_hm(ts):
    parsed = parse_iso(ts)
    if parsed is None:
        return None
    return parsed.astimezone().strftime("%H:%M")


def extract_text(content):
    """Pull visible text out of a message content field (str or block list)."""
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                text = (block.get("text") or "").strip()
                if text:
                    parts.append(text)
        return "\n".join(parts).strip()
    return ""


def project_name(cwd):
    if not cwd:
        return "(unknown)"
    return os.path.basename(cwd.rstrip("/")) or cwd


def summarize_session(path, target_date, max_msgs, max_chars):
    session_meta = None
    messages = []
    try:
        with open(path, "r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                rtype = record.get("type")
                if rtype == "session":
                    session_meta = record
                elif rtype == "message":
                    messages.append(record)
    except OSError:
        return None

    # Keep only sessions that were active on the target date (local time).
    active_today = [
        m for m in messages if local_date(m.get("message", {}).get("timestamp")) == target_date
    ]
    if not active_today:
        return None

    user_prompts = []
    assistant_snippets = []
    for m in messages:
        inner = m.get("message", {})
        role = inner.get("role")
        text = extract_text(inner.get("content"))
        if not text:
            continue
        if role == "user":
            user_prompts.append(text[:max_chars])
        elif role == "assistant":
            assistant_snippets.append(text[:max_chars])

    user_prompts = user_prompts[:max_msgs]
    assistant_snippets = assistant_snippets[:max_msgs]

    timestamps = [
        m.get("message", {}).get("timestamp") for m in active_today
    ]
    timestamps = [t for t in timestamps if t]
    timestamps.sort()

    cwd = (session_meta or {}).get("cwd") or ""
    return {
        "id": (session_meta or {}).get("id") or os.path.basename(path),
        "file": path,
        "cwd": cwd,
        "project": project_name(cwd),
        "start_local": local_hm(timestamps[0]) if timestamps else None,
        "end_local": local_hm(timestamps[-1]) if timestamps else None,
        "msg_count": len(messages),
        "first_prompt": user_prompts[0] if user_prompts else "",
        "user_prompts": user_prompts,
        "assistant_snippets": assistant_snippets,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", default=dt.date.today().isoformat(),
                        help="Target local date YYYY-MM-DD (default: today)")
    parser.add_argument("--sessions-dir", default=DEFAULT_SESSIONS_DIR)
    parser.add_argument("--max-msgs", type=int, default=12,
                        help="Max user prompts / assistant snippets kept per session")
    parser.add_argument("--max-chars", type=int, default=600,
                        help="Max characters kept per message")
    args = parser.parse_args()

    try:
        target_date = dt.date.fromisoformat(args.date)
    except ValueError:
        print(f"Invalid --date: {args.date}", file=sys.stderr)
        return 2

    pattern = os.path.join(args.sessions_dir, "*", "*.jsonl")
    sessions = []
    for path in sorted(glob.glob(pattern)):
        summary = summarize_session(path, target_date, args.max_msgs, args.max_chars)
        if summary:
            sessions.append(summary)

    sessions.sort(key=lambda s: s.get("start_local") or "")
    json.dump(
        {"date": target_date.isoformat(), "count": len(sessions), "sessions": sessions},
        sys.stdout,
        ensure_ascii=False,
        indent=2,
    )
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
