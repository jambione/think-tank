# Think Tank

A lightweight multi-agent reasoning session. Obi-Wan orchestrates Luke (GPT) and Han (Anthropic) to build the sharpest possible questions for any topic, collect your answers, and synthesize a well-reasoned conclusion.

## Agents

| Agent | Model | Role |
|-------|-------|------|
| **Luke** (`agents/luke.md`) | `gpt-4.1` | Seeks the truth — optimistic, probing, fearless |
| **Han** (`agents/han.md`) | `claude-haiku-4-5` | Grounds the thinking — pragmatic, sharp, no-nonsense |
| **Obi-Wan** (`agents/obi-wan.md`) | `gpt-4.1` | Synthesizes Luke and Han into the best questions, then builds the conclusion |

Models are the free tier via [GitHub Models](https://github.com/marketplace/models). Check the catalog for exact model IDs if names change.

## Setup

```bash
pip install -r requirements.txt
export GITHUB_TOKEN=your_token_here   # needs GitHub Models access
python think_tank.py
```

## Session Flow

1. You enter a topic
2. Luke and Han each draft questions independently
3. They review each other's drafts and propose a refined set
4. Obi-Wan synthesizes the 3 most powerful questions and presents them to you
5. You answer each one
6. Obi-Wan builds a conclusion with actionable recommendations

## Knowledge Base

Drop any `.md` or `.txt` files into `knowledge/`. Luke and Han will read them before drafting questions. Leave the folder empty to start from scratch.

## Customizing Personalities

Each agent is just a markdown file in `agents/`. Edit freely — the file becomes the system prompt.
