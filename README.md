# alfred_ / Execution Decision Layer

**Live demo**: [execution-decision-layer.vercel.app](https://execution-decision-layer.vercel.app)  
**Stack**: Next.js 16 · TypeScript · Anthropic SDK · Vercel

---

## What This Is

alfred_ is an AI assistant embedded in SMS that manages email, calendar, and scheduling on behalf of users. As its capabilities grow, the central product challenge is **when to act vs. when to pause**.

This prototype implements the **Execution Decision Layer** — the guardrail that prevents alfred_ from becoming a liability. It evaluates every requested action and returns one of five decisions:

| Decision | When |
|----------|------|
| `EXECUTE_SILENT` | Low-risk, reversible, all params present, no contradictions |
| `EXECUTE_NOTIFY` | Low-risk, reversible, but user would want a record |
| `CONFIRM` | Intent resolved but action is irreversible or high-stakes |
| `CLARIFY` | A required parameter (recipient, time, scope) is unresolved |
| `REFUSE` | Policy violation, or risk persists even after clarification |

**Default safe fallback**: `CONFIRM` — when uncertain, the system always asks rather than acts.

---

## Architecture

### The Core Problem with Pure LLM

A system that only reads the latest message will make dangerous mistakes at exactly the moments that matter most. The message *"Yep, send it"* means something very different after *"Actually hold off — let legal review this first"* than it does after a clean approval. Context is not optional; it is the decision.

A pure LLM approach fails here for a different reason: policy enforcement becomes probabilistic. A jailbreak, an edge case, or a bad day for the model could cause an irreversible action. That is unacceptable.

### Hybrid Code + LLM Pipeline

The solution is a two-stage pipeline where **code handles everything that can be enumerated, and the LLM handles only what genuinely requires contextual judgment**.

```
INPUT (actionType, actionDescription, latestMessage, history, userContext)
        │
        ▼
[STAGE 1 — CODE] Signal Extraction
  - computeReversibility(actionType)         → 0.0–1.0
  - computeContextCompleteness(...)          → 0.0–1.0
  - detectContradiction(message, history)    → bool + evidence
  - checkPolicy(actionType, description)     → bool + reason
        │
        ├─ policyBlock === true ─────────────► REFUSE  (no LLM)
        ├─ contextCompleteness < 0.5 ────────► CLARIFY (no LLM)
        │
        ▼
[STAGE 2 — PROMPT ASSEMBLY]
  Signals injected as structured facts, not inference tasks
        │
        ▼
[STAGE 3 — LLM] claude-sonnet-4-6
  Full contextual judgment across all 5 states
        │
        ├─ timeout / API error ──────────────► CONFIRM fallback
        │
        ▼
[STAGE 4 — CODE] Parse + Validate
  - Strip markdown fences, JSON.parse()
  - Validate shape and enum values
  - Enforce escalation-only signal overrides
        │
        ├─ malformed output ─────────────────► CONFIRM fallback
        │
        ▼
OUTPUT → DecideResponse (all pipeline stages exposed)
```

---

## Signal Design Rationale

Signals are the most consequential design decision in the system. They determine what the LLM receives as input, which determines what it can reason about.

### Why signals are computed in code, not by the LLM

The LLM *will* detect a contradiction — but only if we trust it never to miss one. A missed contradiction on a `send_email` action is catastrophic. Keyword-based contradiction detection computed before the prompt is assembled means the LLM receives contradiction as a **fact**, not as an inference task. This shifts cognitive load from uncertain inference to certain input.

The same logic applies to policy blocks and reversibility. These are enumerated properties of actions, not contextual judgments. Code is the right tool.

### Signal definitions

**`reversibilityScore`** (0.0–1.0): A lookup table by action type.
- `1.0` → send_email, reply_message, forward_email, delete_event, delete_email
- `0.2` → create_event, set_reminder
- `0.1` → archive_email, create_draft
- `0.5` → unknown

**`contextCompleteness`** (0.0–1.0): Required parameter check by action type. `send_email` requires recipient + subject/thread ref. `create_event` requires datetime + title. `set_reminder` requires time + task. Returns `0.0` (none), `0.5` (partial), `1.0` (all present).

**`contradictionFlag`**: Scans conversation history for hold keywords (`hold`, `wait`, `cancel`, `don't`, `stop`, `pause`, `not yet`) and go keywords (`send`, `go`, `confirm`, `yes`, `proceed`). If the most-recent hold instruction is newer than the most-recent go instruction, the flag fires. The conflicting turn is preserved as `contradictionEvidence` and passed to the LLM as a fact.

**`policyBlock`**: Hard regex checks. Blocks: "delete all / clear everything" without explicit numeric scope; forwarding to more than one external recipient; any action targeting more than 10 items.

### Signal priority table

Higher rows override lower rows. Signals can only **escalate** the LLM's decision — never downgrade it.

| Priority | Condition | Forced Decision |
|----------|-----------|-----------------|
| 1 | `policyBlock === true` | `REFUSE` (LLM skipped) |
| 2 | `contradictionFlag && reversibilityScore >= 0.8` | `CONFIRM` (hard) |
| 3 | `contextCompleteness < 0.5` | `CLARIFY` (LLM skipped) |
| 4 | `reversibilityScore >= 0.8` | LLM may not return EXECUTE_SILENT/NOTIFY |
| 5 | `contradictionFlag === true` | LLM must return at minimum CONFIRM |
| 6 | All signals nominal | Full LLM judgment |
| 7 | Any failure (timeout / parse error) | `CONFIRM` fallback |

---

## Code vs. LLM Responsibility Split

| Responsibility | Owner | Reason |
|----------------|-------|--------|
| Reversibility scoring | Code | Deterministic lookup; no inference needed |
| Policy enforcement | Code | Must be categorical, not probabilistic |
| Contradiction detection | Code | Too consequential to delegate to inference |
| Context completeness | Code | Structural check; doesn't require NLU |
| Linguistic ambiguity resolution | LLM | Requires reading intent across full history |
| Risk calibration | LLM | Requires contextual judgment, not rules |
| Final decision (nominal case) | LLM | Constrained by signal overrides |
| Escalation enforcement | Code | LLM output validated post-generation |
| Failure fallback | Code | System failure must never result in silent execution |

**Key invariant**: The LLM can never produce a *less cautious* decision than the signals require. A signal can force `CONFIRM` over `EXECUTE_SILENT`, but nothing can force `EXECUTE_SILENT` over `CONFIRM`.

---

## Prompt Design

The system prompt gives the LLM five decision states and five hard rules. The hard rules mirror the signal priority table: they are redundant by design. If the code-level enforcement fails for any reason, the LLM has been told the same rules explicitly.

The user message injects signals as **structured labeled facts** at the bottom of the prompt — below the action, below the history. This positioning is intentional: the LLM reads the full context first, then receives the pre-computed signals as confirmation or escalation, not as a replacement for reading.

The rationale field in the LLM output is required to reference history and signals explicitly. This makes the system auditable: every decision can be traced back to specific evidence.

---

## Failure Modes

| Failure | Trigger | Behavior | Why `CONFIRM`? |
|---------|---------|----------|----------------|
| LLM timeout | API > 25s | `CONFIRM` fallback, `failureMode: "timeout"` | A timeout doesn't mean the action is bad — it means the system failed. Blocking on infra instability destroys usability; `REFUSE` would be dishonest. |
| Malformed output | Non-JSON or missing required fields | `parseLLMOutput` fails, `CONFIRM` fallback, `failureMode: "malformed"` | Asking the user a clarifying question when the real problem is a parse error is dishonest UX. `CONFIRM` surfaces the failure without misdirecting blame. |
| Missing context | `contextCompleteness < 0.5` | Short-circuit before LLM, `CLARIFY` returned | The action is underspecified, not risky — `CLARIFY` is always correct here. |
| Policy violation | Bulk delete / multi-recipient forward / >10 items | Short-circuit before LLM, `REFUSE` returned | Policy violations are categorical. No LLM input, no context overrides. |

**Invariant**: The system never falls back to `EXECUTE_SILENT` or `EXECUTE_NOTIFY` under any failure condition.

`CONFIRM` was chosen as the universal failure fallback over the alternatives:
- `REFUSE` — too aggressive; a timeout isn't evidence the action is wrong
- `CLARIFY` — dishonest; the failure isn't the user's fault
- `EXECUTE_SILENT` — obviously wrong; acting without judgment under uncertainty

---

## Known Limitations

**Contradiction detection misses semantic holds.** The phrase *"let's wait on this"* or *"I'm not sure yet"* won't trigger the contradiction flag. The current keyword approach covers the 95% case. The fix is embedding-based semantic similarity over conversation history — doable, but over-engineered for a prototype.

**Reversibility lookup doesn't account for action content.** `send_email` is always `1.0`, even if the email is to an internal alias and easily recalled. A more accurate model would score reversibility against the action description, not just the type.

**Policy regex has false positives.** "Delete all spam" without a numeric scope will block. Log all `REFUSE` decisions; review and refine patterns over time.

**User context is trusted.** The system accepts `userContext` as a free-text string with no validation. In production, this field needs to come from a verified session store, not user input.

---

## Evolution Roadmap

### Near-term: riskier action types

As alfred_ gains access to richer tools, the stakes rise significantly. The same pipeline applies, but signal thresholds need recalibration:

| Action | Key Risk | Signal Response |
|--------|----------|-----------------|
| `send_payment` | Financial irreversibility | reversibilityScore = 1.0; amount-based policy blocks |
| `delete_thread` | Bulk irreversible loss | Policy block on >3 items without explicit scope |
| `share_document` | Data leakage | Recipient domain check; external = higher reversibility score |
| `create_recurring_event` | Scope creep | Require explicit recurrence confirmation; CONFIRM always |
| `unsubscribe_all` | Bulk irreversible | Policy block unconditionally |

The hybrid architecture handles these cleanly: add policy rules in code, adjust reversibility scores, LLM judgment layer needs no changes.

### Medium-term: semantic contradiction detection

Replace keyword scanning with a small embedding model over conversation history. This catches *"I'm not comfortable with that"*, *"let's revisit"*, and other soft holds that the current system misses.

### Medium-term: confidence-gated execution

Rather than a binary execute/pause, use confidence score to modulate behavior. `EXECUTE_SILENT` at confidence > 0.95; `EXECUTE_NOTIFY` at 0.80–0.95; `CONFIRM` below 0.80. The LLM already returns a confidence score — it just needs to gate the decision path.

---

## 6-Month Vision

The Execution Decision Layer is not a safety feature bolted onto alfred_. It is the central abstraction that makes alfred_ trustworthy enough to be given real capabilities.

The path from prototype to production has three phases:

**Phase 1 — Signal hardening** (months 1–2): Replace regex-based policy checks with a structured rule engine. Add session-state-aware context completeness (recipient from address book, not just description). Instrument every CONFIRM and REFUSE decision for review.

**Phase 2 — Trust calibration** (months 3–4): Build per-user trust profiles. A user who has confirmed 50 `send_email` actions without incident gets a lower confirmation threshold. A user who once said "hold off" and then had alfred_ ignore it gets a higher one. Trust is earned, not assumed.

**Phase 3 — Agentic expansion** (months 5–6): As alfred_ gains multi-step capabilities (draft → review → send), the decision layer needs to reason about action sequences, not just individual actions. A sequence that is individually safe can be collectively risky. The hybrid architecture handles this by extending the signal extraction phase to compute sequence-level reversibility — the minimum reversibility score across a proposed action chain.

The 6-month goal: alfred_ can be handed a real inbox and calendar, and a reasonable person would trust it to act on their behalf without supervision for routine tasks — while always pausing when something unexpected appears.

---

## Local Development

```bash
git clone https://github.com/ichbinlucaskim/alfred-decision-layer
cd alfred-decision-layer
npm install
cp .env.local.example .env.local  # add ANTHROPIC_API_KEY
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The UI exposes the full pipeline on every request: inputs → signals → prompt sent → raw LLM output → parsed result. Use the failure simulation buttons to trigger timeout, malformed output, and missing context paths without touching the API.
