# Agent SOULs

This directory holds **SOUL.md** files — one per named agent in the factory. Each file is the agent's identity document: who it is (Star Trek reference + role), what it does, what it *doesn't* do, how it hands off, and what tier it's in (Lab → Stable).

SOUL files are read by humans (founder review, future-Architect cycles, onboarding docs) and increasingly by other agents — Phase 21-A's Master Architect can cite a SOUL when proposing changes that affect an agent's scope.

## Roster

| Agent     | Trek reference (canon)            | Role                          | Pipeline position          | Tier   |
|-----------|-----------------------------------|-------------------------------|----------------------------|--------|
| [Picard](Picard.SOUL.md)     | Capt. Jean-Luc Picard (TNG)       | Solutions Architect           | Intake 1 of 3              | Stable |
| [Sisko](Sisko.SOUL.md)       | Capt. Benjamin Sisko (DS9)        | Project Planner               | Intake 2 of 3              | Stable |
| [Troi](Troi.SOUL.md)         | Cdr. Deanna Troi (TNG)            | Enhancement / 110%            | Intake 3 of 3              | Stable |
| [Jane](Jane.SOUL.md)         | Capt. Kathryn Janeway (Voyager)   | PM / Triage + Post-dev close  | Intake → Dev handoff; Post-dev mid | Stable |
| [Spock](Spock.SOUL.md)       | Mr. Spock (TOS)                   | Auto-Research                 | Dev 1                      | Stable |
| [Torres](Torres.SOUL.md)     | B'Elanna Torres (Voyager)         | Junior Dev                    | Dev 2 (loop)               | Stable |
| [Tuvok](Tuvok.SOUL.md)       | Tuvok (Voyager)                   | QA Reviewer                   | Dev 3 (loop)               | Stable |
| [Data](Data.SOUL.md)         | Lt. Cdr. Data (TNG)               | Sr. Architect / Code Review   | Dev 4 (loop)               | Stable |
| [Crusher](Crusher.SOUL.md)   | Dr. Beverly Crusher (TNG)         | Docs & Training (B + C series) | Dev close; Post-dev open  | Stable |
| [O'Brien](OBrien.SOUL.md)    | Chief Miles O'Brien (TNG/DS9)     | SRE / Deploy                  | Dev close; Post-dev ship   | Stable |
| [Seven](Seven.SOUL.md)       | Seven of Nine (Voyager)           | Tool Evaluator (R&D)          | Off-pipeline — R&D loop    | Lab    |

## Pipeline at a glance

```
INTAKE              Picard → Sisko → Troi → Jane
                    (A1/A2)  (A3-A5) (B4,B6) (triageSpec)

DEV (loop)          Spock → Torres ⇄ Tuvok ⇄ Data
                    (dossier) (code)  (tests + QA)  (review)
                                  ↑__________________|
                                  (NEEDS_FIX loop, max 2 iterations)

DEV CLOSE           → Crusher → O'Brien
                      (B1/B2/B5)  (git + B9 audit)

POST-DEV            Crusher → Jane → O'Brien
                    (C1/C2/C3)  (P2/P5)  (C4 + final package)

R&D LOOP (parallel) Seven (evaluates external candidates against our workload)
                    Architect Daemon (Phase 21-A — runs cadence cycles)
```

See `factory_graph.js`, `pre_dev_graph.js`, `dev_graph.js`, `post_dev_graph.js` for the exact StateGraph wiring.

## Tier convention

- **Stable** — the agent has shipped real factory work end-to-end. Changes require Phase 21-A architect proposal + founder approval.
- **Lab** — the agent is new (or rebuilt). First-acceptance gate by founder promotes Lab → Stable. Seven is the first Lab-tier agent (Phase 21-A.1, 2026-05-09).

## Conventions for new SOULs

When a new agent is onboarded:
1. Pick a Star Trek reference (TNG / DS9 / Voyager / TOS prefered for continuity). Reference must be one the founder recognises — these names get used in conversation.
2. Capture the agent's *negative space*: a SOUL.md without a "What X does NOT do" section is incomplete. Knowing what *not* to do is half the role.
3. Add the agent's row to the roster table in this README.
4. If the agent participates in the pipeline graph, update the pipeline diagram + the relevant `*_graph.js` file.
5. New agents start at **Lab** tier. Founder promotes after the first accepted real-work output.

## Why "SOUL.md"?

Two reasons:
- **Identity, not config.** A SOUL.md is *who the agent is* — not its model, not its prompt, not its tools. Those things change; identity persists.
- **Mirror of `CLAUDE.md`.** Claude Code reads `CLAUDE.md` for its operating context; factory agents read (or have read on their behalf) their SOUL.md for theirs. Same idea, factory-local.

Phase 21-B.3 (deferred — needs OpenRouter cycle) will wire each agent's `runPass` to include its SOUL.md as a system-message prefix. Today the SOULs are human-readable identity docs; tomorrow they're load-bearing context.
