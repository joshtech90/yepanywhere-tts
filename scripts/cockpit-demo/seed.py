#!/usr/bin/env python3
"""Write fictional Claude and Codex sessions for Cockpit UI previews."""

from __future__ import annotations

import argparse
import json
import os
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any


BASE_TIME = datetime(2026, 9, 24, 8, 0, tzinfo=UTC)
NAMESPACE = uuid.UUID("2fd30888-64a1-4e79-9533-f17040ce53d9")
PROJECTS = {
    "atlas": "/demo/atlas-notes",
    "field": "/demo/field-guide",
    "signal": "/demo/signal-lab",
}


def stable_id(name: str) -> str:
    return str(uuid.uuid5(NAMESPACE, name))


def stamp(minutes: int) -> str:
    return (BASE_TIME + timedelta(minutes=minutes)).isoformat().replace(
        "+00:00", "Z"
    )


def write_jsonl(path: Path, records: list[dict[str, Any]], minutes: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")))
            handle.write("\n")
    activity_time = (BASE_TIME + timedelta(minutes=minutes)).timestamp()
    os.utime(path, (activity_time, activity_time))


def claude_record(
    *,
    session_id: str,
    project: str,
    name: str,
    minutes: int,
    record_type: str,
    message: dict[str, Any] | None = None,
    parent: str | None = None,
    **extra: Any,
) -> dict[str, Any]:
    record = {
        "parentUuid": parent,
        "isSidechain": False,
        "type": record_type,
        "uuid": stable_id(f"claude:{session_id}:{name}"),
        "timestamp": stamp(minutes),
        "cwd": project,
        "sessionId": session_id,
        "version": "2.1.258-demo",
        "gitBranch": "demo/cockpit",
    }
    if message is not None:
        record["message"] = message
    record.update(extra)
    return record


def claude_session(
    name: str,
    project: str,
    start: int,
    turns: list[dict[str, Any]],
    model: str = "claude-sonnet-4-5",
) -> tuple[str, list[dict[str, Any]]]:
    session_id = stable_id(f"claude-session:{name}")
    records: list[dict[str, Any]] = [
        claude_record(
            session_id=session_id,
            project=project,
            name="init",
            minutes=start,
            record_type="system",
            subtype="init",
            message={"model": model, "role": "system", "content": ""},
        )
    ]
    parent = records[-1]["uuid"]
    for index, turn in enumerate(turns, start=1):
        role = turn["role"]
        content = turn["content"]
        record = claude_record(
            session_id=session_id,
            project=project,
            name=f"{index}-{role}",
            minutes=start + index,
            record_type=role,
            parent=parent,
            message={
                "model": model,
                "role": "assistant" if role == "assistant" else "user",
                "content": content,
            },
            **turn.get("extra", {}),
        )
        records.append(record)
        parent = record["uuid"]
    return session_id, records


def codex_record(minutes: int, ordinal: int, kind: str, payload: dict[str, Any]):
    return {
        "timestamp": stamp(minutes),
        "ordinal": ordinal,
        "type": kind,
        "payload": payload,
    }


def codex_session(
    name: str,
    project: str,
    start: int,
    events: list[tuple[str, dict[str, Any]]],
    model: str = "gpt-5.6-luna",
) -> tuple[str, list[dict[str, Any]]]:
    session_id = stable_id(f"codex-session:{name}")
    turn_id = stable_id(f"codex-turn:{name}")
    records = [
        codex_record(
            start,
            0,
            "session_meta",
            {
                "session_id": session_id,
                "id": session_id,
                "timestamp": stamp(start),
                "cwd": project,
                "originator": "cockpit-demo",
                "cli_version": "0.154.0-demo",
                "source": "exec",
                "model_provider": "openai",
            },
        ),
        codex_record(
            start,
            1,
            "turn_context",
            {
                "turn_id": turn_id,
                "root_turn_id": turn_id,
                "cwd": project,
                "approval_policy": "on-request",
                "sandbox_policy": {"type": "workspace-write"},
                "model": model,
                "effort": "medium",
            },
        ),
    ]
    for ordinal, (kind, payload) in enumerate(events, start=2):
        if kind == "event_msg":
            payload = {
                "thread_id": session_id,
                "turn_id": turn_id,
                **payload,
            }
        records.append(codex_record(start + ordinal, ordinal, kind, payload))
    return session_id, records


def claude_demo_sessions() -> list[tuple[str, str, int, list[dict[str, Any]]]]:
    edit_tool_id = "toolu_demo_edit"
    shell_tool_id = "toolu_demo_shell"
    missing_tool_id = "toolu_demo_missing"
    question_tool_id = "toolu_demo_question"
    long_markdown = """## Atlas launch review

The fictional Atlas workspace is ready for a calm preview. The most important
checks are easy to scan:

- **Navigation:** every sample session has a clear title and project.
- **Long-form reading:** this answer contains headings, lists, a table, and code.
- **Safety:** every name and message in this dataset is invented.

| Area | Result | Follow-up |
| --- | --- | --- |
| Desktop | Ready | Inspect spacing |
| Mobile | Ready | Check the bottom navigation |
| Read aloud | Available | Try start and stop |

```text
preview = quiet + readable + reversible
```

The remaining work is visual review only. No deployment, message delivery, or
real project data is involved."""
    return [
        (
            "atlas-long-review",
            PROJECTS["atlas"],
            80,
            [
                {"role": "user", "content": "Review the fictional Atlas launch plan."},
                {
                    "role": "assistant",
                    "content": [
                        {
                            "type": "thinking",
                            "thinking": "I should present the evidence in a short, readable order.",
                            "signature": "demo-thinking-signature",
                        },
                        {"type": "text", "text": long_markdown},
                    ],
                },
            ],
        ),
        (
            "atlas-shell-check",
            PROJECTS["atlas"],
            65,
            [
                {"role": "user", "content": "Check the demo notes without changing them."},
                {
                    "role": "assistant",
                    "content": [
                        {"type": "text", "text": "I will run one read-only check."},
                        {
                            "type": "tool_use",
                            "id": shell_tool_id,
                            "name": "Bash",
                            "input": {"command": "printf 'DEMO_OK\\n'"},
                        },
                    ],
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": shell_tool_id,
                            "content": "DEMO_OK\n",
                            "is_error": False,
                        }
                    ],
                    "extra": {
                        "toolUseResult": {
                            "stdout": "DEMO_OK\n",
                            "stderr": "",
                            "interrupted": False,
                        }
                    },
                },
                {
                    "role": "assistant",
                    "content": "The read-only demo check completed successfully.",
                },
            ],
        ),
        (
            "field-edit",
            PROJECTS["field"],
            50,
            [
                {"role": "user", "content": "Make the sample field note easier to scan."},
                {
                    "role": "assistant",
                    "content": [
                        {"type": "text", "text": "I will tighten the fictional note."},
                        {
                            "type": "tool_use",
                            "id": edit_tool_id,
                            "name": "Edit",
                            "input": {
                                "file_path": "/demo/field-guide/notes/fern.md",
                                "old_string": "Status: needs a careful second pass.",
                                "new_string": "Status: ready for visual review.",
                            },
                        },
                    ],
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": edit_tool_id,
                            "content": "Updated notes/fern.md",
                            "is_error": False,
                        }
                    ],
                    "extra": {
                        "toolUseResult": {
                            "filePath": "/demo/field-guide/notes/fern.md",
                            "oldString": "Status: needs a careful second pass.",
                            "newString": "Status: ready for visual review.",
                            "structuredPatch": [
                                {
                                    "oldStart": 3,
                                    "oldLines": 1,
                                    "newStart": 3,
                                    "newLines": 1,
                                    "lines": [
                                        "-Status: needs a careful second pass.",
                                        "+Status: ready for visual review.",
                                    ],
                                }
                            ],
                        }
                    },
                },
                {
                    "role": "assistant",
                    "content": "The sample note now has one direct status line.",
                },
            ],
        ),
        (
            "field-missing-file",
            PROJECTS["field"],
            35,
            [
                {"role": "user", "content": "Open the imaginary observation log."},
                {
                    "role": "assistant",
                    "content": [
                        {
                            "type": "tool_use",
                            "id": missing_tool_id,
                            "name": "Read",
                            "input": {
                                "file_path": "/demo/field-guide/notes/missing.md"
                            },
                        }
                    ],
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": missing_tool_id,
                            "content": "File not found: notes/missing.md",
                            "is_error": True,
                        }
                    ],
                    "extra": {"toolUseResult": "File not found: notes/missing.md"},
                },
                {
                    "role": "assistant",
                    "content": "The fictional file does not exist, so I left the workspace unchanged.",
                },
            ],
        ),
        (
            "signal-question",
            PROJECTS["signal"],
            20,
            [
                {"role": "user", "content": "Choose a color for the imaginary signal card."},
                {
                    "role": "assistant",
                    "content": [
                        {"type": "text", "text": "I need one preference before continuing."},
                        {
                            "type": "tool_use",
                            "id": question_tool_id,
                            "name": "AskUserQuestion",
                            "input": {
                                "questions": [
                                    {
                                        "question": "Which accent should the fictional card use?",
                                        "header": "Accent",
                                        "options": [
                                            {
                                                "label": "Teal",
                                                "description": "Calm and restrained",
                                            },
                                            {
                                                "label": "Coral",
                                                "description": "Warmer and more visible",
                                            },
                                        ],
                                        "multiSelect": False,
                                    }
                                ]
                            },
                        },
                    ],
                },
            ],
        ),
    ]


def codex_demo_sessions() -> list[tuple[str, str, int, list[tuple[str, dict[str, Any]]]]]:
    def user(text: str, item_id: str) -> tuple[str, dict[str, Any]]:
        return (
            "response_item",
            {
                "type": "message",
                "id": item_id,
                "role": "user",
                "content": [{"type": "input_text", "text": text}],
            },
        )

    def assistant(text: str, item_id: str) -> tuple[str, dict[str, Any]]:
        return (
            "response_item",
            {
                "type": "message",
                "id": item_id,
                "role": "assistant",
                "content": [{"type": "output_text", "text": text}],
            },
        )

    def reasoning(text: str, item_id: str) -> tuple[str, dict[str, Any]]:
        return (
            "response_item",
            {
                "type": "reasoning",
                "id": item_id,
                "summary": [{"type": "summary_text", "text": text}],
                "encrypted_content": "demo",
            },
        )

    return [
        (
            "atlas-file-change",
            PROJECTS["atlas"],
            75,
            [
                user("Update the fictional Atlas review label.", "codex-user-atlas-edit"),
                reasoning("Confirming the smallest safe sample edit", "codex-reason-atlas-edit"),
                (
                    "event_msg",
                    {
                        "type": "item_completed",
                        "item": {
                            "type": "FileChange",
                            "id": "codex-file-change-1",
                            "changes": {
                                "/demo/atlas-notes/review.md": {
                                    "type": "update",
                                    "unified_diff": "@@ -1,2 +1,2 @@\n-Review: queued\n+Review: ready\n Owner: Demo Team\n",
                                }
                            },
                            "status": "completed",
                            "stdout": "Updated review.md\n",
                            "stderr": "",
                        },
                    },
                ),
                assistant("The fictional review label now reads **ready**.", "codex-agent-atlas-edit"),
            ],
        ),
        (
            "atlas-multi-turn",
            PROJECTS["atlas"],
            60,
            [
                user("List two calm names for the sample dashboard.", "codex-user-atlas-1"),
                assistant("Two options: **Harbor** and **Northstar**.", "codex-agent-atlas-1"),
                user("Which one is quieter?", "codex-user-atlas-2"),
                reasoning("Comparing tone rather than features", "codex-reason-atlas-2"),
                assistant("**Harbor** feels quieter and less directional.", "codex-agent-atlas-2"),
            ],
        ),
        (
            "field-reasoning",
            PROJECTS["field"],
            45,
            [
                user("Summarize the fictional fern observation.", "codex-user-field-summary"),
                reasoning("Separating observation from interpretation", "codex-reason-field-summary"),
                assistant(
                    "The sample records three leaves, indirect light, and no real-world measurements.",
                    "codex-agent-field-summary",
                ),
            ],
        ),
        (
            "field-command-failure",
            PROJECTS["field"],
            30,
            [
                user("Run the intentional demo failure once.", "codex-user-field-failure"),
                (
                    "event_msg",
                    {
                        "type": "item_completed",
                        "item": {
                            "type": "CommandExecution",
                            "id": "codex-command-failure-1",
                            "command": ["/bin/bash", "-lc", "printf 'DEMO_FAILURE\\n' >&2; exit 7"],
                            "cwd": "file:///demo/field-guide",
                            "status": "failed",
                            "stdout": "",
                            "stderr": "DEMO_FAILURE\n",
                            "aggregated_output": "DEMO_FAILURE\n",
                            "exit_code": 7,
                        },
                    },
                ),
                assistant(
                    "The intentional command failed with exit code 7; I did not retry it.",
                    "codex-agent-field-failure",
                ),
            ],
        ),
        (
            "signal-running-command",
            PROJECTS["signal"],
            15,
            [
                user("Show a long-running fictional signal check.", "codex-user-signal-running"),
                reasoning("Starting a bounded preview command", "codex-reason-signal-running"),
                (
                    "event_msg",
                    {
                        "type": "item_started",
                        "item": {
                            "type": "CommandExecution",
                            "id": "codex-command-running-1",
                            "command": ["/bin/bash", "-lc", "printf 'waiting for demo signal\\n'"],
                            "cwd": "file:///demo/signal-lab",
                            "status": "in_progress",
                            "stdout": "",
                            "stderr": "",
                            "aggregated_output": "",
                            "exit_code": None,
                        },
                    },
                ),
            ],
        ),
    ]


def seed(claude_root: Path, codex_root: Path) -> tuple[int, int]:
    claude_count = 0
    for name, project, start, turns in claude_demo_sessions():
        session_id, records = claude_session(name, project, start, turns)
        directory = project.replace("/", "-")
        write_jsonl(
            claude_root / directory / f"{session_id}.jsonl",
            records,
            start + len(records),
        )
        claude_count += 1

    codex_count = 0
    for name, project, start, events in codex_demo_sessions():
        session_id, records = codex_session(name, project, start, events)
        filename = f"rollout-2026-09-24T{8 + start // 60:02d}-{start % 60:02d}-00-{session_id}.jsonl"
        write_jsonl(
            codex_root / "2026" / "09" / "24" / filename,
            records,
            start + len(records),
        )
        codex_count += 1

    return claude_count, codex_count


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Write deterministic, entirely fictional Claude and Codex sessions "
            "for the Cockpit preview. Existing unrelated files are left untouched."
        )
    )
    parser.add_argument("claude_dir", type=Path, help="CLAUDE_SESSIONS_DIR target")
    parser.add_argument("codex_dir", type=Path, help="CODEX_SESSIONS_DIR target")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    claude_count, codex_count = seed(args.claude_dir, args.codex_dir)
    print(
        f"Seeded {claude_count + codex_count} fictional sessions "
        f"({claude_count} Claude, {codex_count} Codex) across 3 projects."
    )
    print(f"CLAUDE_SESSIONS_DIR={args.claude_dir}")
    print(f"CODEX_SESSIONS_DIR={args.codex_dir}")


if __name__ == "__main__":
    main()
