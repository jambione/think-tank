# Think Tank

A VS Code extension that adds three Copilot Chat participants. Obi-Wan orchestrates Luke (GPT-4.1) and Han (Claude Haiku 4.5) to build the sharpest possible questions for any topic, then synthesizes your answers into a well-reasoned conclusion.

## Agents

| Participant | Model | Role |
|-------------|-------|------|
| `@obi-wan` | GPT-4.1 | Orchestrator — runs the full session |
| `@luke` | GPT-4.1 | The seeker — optimistic, probing, fearless |
| `@han` | Claude Haiku 4.5 | The realist — pragmatic, sharp, no-nonsense |

Agent personalities live in `agents/*.md`. Edit them freely — the file becomes the system prompt.

## Setup

```bash
npm install
npm run compile
```

Then press `F5` in VS Code to launch the Extension Development Host, or package it:

```bash
npm run package   # produces think-tank-0.1.0.vsix
```

Install the VSIX via **Extensions → Install from VSIX**.

## Usage

Open Copilot Chat and start with `@obi-wan`:

```
@obi-wan  What should our team prioritize this quarter?
```

Obi-Wan assembles Luke and Han, shows their collaboration, then presents **3 synthesized questions**. Answer each one in a follow-up message. After the third answer, Obi-Wan delivers a conclusion with actionable recommendations.

You can also talk to Luke or Han directly:

```
@luke  What assumptions are we making about our users?
@han   What's the cheapest path to validating this idea?
```

## Knowledge Base

Drop `.md` or `.txt` files into `knowledge/`. Both Luke and Han will read them before drafting questions. Leave the folder empty to start from scratch.

## Session Flow

```
@obi-wan [topic]
  → Luke drafts questions (GPT-4.1)
  → Han drafts questions (Claude Haiku 4.5)
  → Luke + Han refine in parallel
  → Obi-Wan synthesizes 3 final questions

@obi-wan [answer to Q1]
@obi-wan [answer to Q2]
@obi-wan [answer to Q3]
  → Obi-Wan concludes with recommendations
```
