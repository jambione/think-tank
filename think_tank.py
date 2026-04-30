#!/usr/bin/env python3
"""
Think Tank — Obi-Wan orchestrates Luke (GPT) and Han (Anthropic) toward well-formed solutions.

Usage:
    export GITHUB_TOKEN=<your token>
    python think_tank.py
"""

import os
import sys
from pathlib import Path
from openai import OpenAI

ENDPOINT = "https://models.inference.ai.azure.com"
LUKE_MODEL = "gpt-4.1"              # free GPT model via GitHub Models
HAN_MODEL = "claude-haiku-4-5"      # free Anthropic model via GitHub Models
OBI_MODEL = "gpt-4.1"               # orchestrator

ROOT = Path(__file__).parent
AGENTS_DIR = ROOT / "agents"
KNOWLEDGE_DIR = ROOT / "knowledge"


def load_persona(name: str) -> str:
    return (AGENTS_DIR / f"{name}.md").read_text()


def load_knowledge() -> str:
    files = sorted(f for f in KNOWLEDGE_DIR.iterdir() if f.is_file() and f.name != ".gitkeep")
    if not files:
        return ""
    return "\n\n---\n\n".join(f.read_text() for f in files)


def call(client: OpenAI, model: str, system: str, user: str) -> str:
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    return resp.choices[0].message.content.strip()


def rule(label: str = "") -> None:
    width = 60
    if label:
        pad = (width - len(label) - 2) // 2
        print(f"\n{'─' * pad} {label} {'─' * (width - pad - len(label) - 2)}\n")
    else:
        print(f"\n{'─' * width}\n")


def collect_answer(prompt: str) -> str:
    print(prompt)
    lines: list[str] = []
    while True:
        line = input()
        if not line and lines:
            break
        lines.append(line)
    return "\n".join(lines).strip()


def main() -> None:
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        print("Error: GITHUB_TOKEN is not set. Export it and try again.")
        sys.exit(1)

    client = OpenAI(base_url=ENDPOINT, api_key=token)

    obi = load_persona("obi-wan")
    luke = load_persona("luke")
    han = load_persona("han")

    knowledge = load_knowledge()
    if knowledge:
        kb = f"\n\n## Shared Knowledge Base\n\n{knowledge}"
        luke += kb
        han += kb

    rule("THINK TANK  ·  May the Force be with you")
    topic = input("Topic: ").strip()
    if not topic:
        sys.exit(0)

    seed = f"Topic under exploration: {topic}"

    # Round 1 — independent drafts
    print("\n[Luke is consulting the Force...]\n")
    luke_draft = call(client, LUKE_MODEL, luke,
        f"{seed}\n\nDraft 3 sharp, probing questions about this topic.")

    print("[Han is calculating the odds...]\n")
    han_draft = call(client, HAN_MODEL, han,
        f"{seed}\n\nDraft 3 sharp, probing questions about this topic.")

    # Round 2 — collaboration
    print("[Luke and Han are comparing notes...]\n")

    luke_refined = call(client, LUKE_MODEL, luke,
        f"{seed}\n\n"
        f"Your draft:\n{luke_draft}\n\n"
        f"Han's draft:\n{han_draft}\n\n"
        "Review both. Propose a refined list of 3–5 questions combining the best of both.")

    han_refined = call(client, HAN_MODEL, han,
        f"{seed}\n\n"
        f"Your draft:\n{han_draft}\n\n"
        f"Luke's draft:\n{luke_draft}\n\n"
        "Review both. Propose a refined list of 3–5 questions combining the best of both.")

    # Obi-Wan synthesizes
    print("[Obi-Wan is synthesizing...]\n")

    questions = call(client, OBI_MODEL, obi,
        f"{seed}\n\n"
        f"Luke's refined list:\n{luke_refined}\n\n"
        f"Han's refined list:\n{han_refined}\n\n"
        "Synthesize into exactly 3 powerful questions. Number them. Nothing else.")

    rule("Obi-Wan presents your questions")
    print(questions)
    rule()

    # Collect answers
    print("Answer each question. Press Enter twice to move to the next.\n")
    answers: list[str] = []
    for i in range(1, 4):
        answer = collect_answer(f"Answer to question {i}:")
        answers.append(answer)

    # Obi-Wan concludes
    print("\n[Obi-Wan is building toward a conclusion...]\n")

    qa = "\n\n".join(f"Answer {i+1}: {a}" for i, a in enumerate(answers))

    conclusion = call(client, OBI_MODEL, obi,
        f"{seed}\n\n"
        f"Questions presented:\n{questions}\n\n"
        f"User's answers:\n{qa}\n\n"
        "Synthesize a clear conclusion and actionable recommendations.")

    rule("Obi-Wan's Conclusion")
    print(conclusion)
    print()


if __name__ == "__main__":
    main()
