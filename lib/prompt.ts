import type { ActionInput, Signals } from "./types";

export const SYSTEM_PROMPT = `You are alfred_'s Execution Decision Engine. Your job is to decide how alfred_ should respond to a requested action given conversation history and pre-computed signals.

You must return ONLY a valid JSON object — no preamble, no markdown, no explanation outside the JSON.

Decision states:
- EXECUTE_SILENT: intent clear, all params present, reversible, no contradictions, low risk.
- EXECUTE_NOTIFY: intent clear, low-risk, but user would want a record.
- CONFIRM: intent resolved but action is irreversible or high-stakes.
- CLARIFY: a required parameter (recipient, time, scope) is unresolved.
- REFUSE: policy violation, or risk persists even after clarification.

Hard rules (non-negotiable):
1. Never treat the latest message in isolation. Always read the full conversation history.
2. If contradictionFlag is true, you may not return EXECUTE_SILENT or EXECUTE_NOTIFY.
3. If reversibilityScore >= 0.8, you may not return EXECUTE_SILENT or EXECUTE_NOTIFY.
4. If policyBlock is true, you must return REFUSE.
5. When in doubt, CONFIRM. A false-positive confirmation is always safer than a false-negative silent execution.`;

export function buildPrompt(input: ActionInput, signals: Signals): string {
  const historyText =
    input.history.length === 0
      ? "No prior conversation."
      : input.history
          .map((t, i) => `[${i + 1}] ${t.role.toUpperCase()}: ${t.content}`)
          .join("\n");

  return `## Action Requested
${input.actionDescription}

## Latest User Message
"${input.latestMessage}"

## Conversation History
${historyText}

## Computed Signals
- reversibilityScore: ${signals.reversibilityScore} (0=reversible, 1=irreversible)
- contextCompleteness: ${signals.contextCompleteness} (0=missing, 1=complete)
- contradictionFlag: ${signals.contradictionFlag}
${signals.contradictionFlag ? `- contradictionEvidence: "${signals.contradictionEvidence}"` : ""}
- policyBlock: ${signals.policyBlock}
${signals.policyBlock ? `- policyReason: "${signals.policyReason}"` : ""}

## User Context
${input.userContext ?? "None provided."}

## Required Output Shape
{
  "decision": "<EXECUTE_SILENT|EXECUTE_NOTIFY|CONFIRM|CLARIFY|REFUSE>",
  "rationale": "<2-4 sentences referencing history and signals>",
  "confidence": <0.0–1.0>,
  "key_signals_used": ["<signal name>", ...],
  "clarifying_question": "<only if CLARIFY>",
  "confirm_message": "<only if CONFIRM>"
}`.trim();
}
