import type { Decision, LLMOutput, ParseResult, Signals } from "./types";

const VALID_DECISIONS: Decision[] = [
  "EXECUTE_SILENT",
  "EXECUTE_NOTIFY",
  "CONFIRM",
  "CLARIFY",
  "REFUSE",
];

export const CONFIRM_FALLBACK: LLMOutput = {
  decision: "CONFIRM",
  rationale:
    "System defaulted to CONFIRM due to a parsing or timeout failure. Please review the action manually.",
  confidence: 0,
  key_signals_used: ["fallback"],
  confirm_message:
    "Something went wrong evaluating this action. Please confirm manually.",
};

// Decision severity order (higher index = higher severity)
const DECISION_RANK: Record<Decision, number> = {
  EXECUTE_SILENT: 0,
  EXECUTE_NOTIFY: 1,
  CONFIRM: 2,
  CLARIFY: 2, // same tier as CONFIRM — both pause execution
  REFUSE: 3,
};

function getMinimumDecision(signals: Signals): Decision | null {
  if (signals.policyBlock) return "REFUSE";
  if (signals.contradictionFlag && signals.reversibilityScore >= 0.8) return "CONFIRM";
  if (signals.reversibilityScore >= 0.8) return "CONFIRM";
  if (signals.contradictionFlag) return "CONFIRM";
  return null;
}

export function parseLLMOutput(raw: string, signals?: Signals): ParseResult {
  let cleaned = raw.trim();

  // Strip markdown fences
  const fenceMatch = cleaned.match(/```(?:json)?\n?([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { success: false, error: `JSON parse failed: ${cleaned.slice(0, 100)}`, fallback: CONFIRM_FALLBACK };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { success: false, error: "Parsed value is not an object", fallback: CONFIRM_FALLBACK };
  }

  const obj = parsed as Record<string, unknown>;

  // Validate required fields
  for (const field of ["decision", "rationale", "confidence", "key_signals_used"]) {
    if (!(field in obj)) {
      return { success: false, error: `Missing required field: ${field}`, fallback: CONFIRM_FALLBACK };
    }
  }

  if (!VALID_DECISIONS.includes(obj.decision as Decision)) {
    return { success: false, error: `Invalid decision value: ${obj.decision}`, fallback: CONFIRM_FALLBACK };
  }

  if (obj.decision === "CLARIFY" && !obj.clarifying_question) {
    return { success: false, error: "CLARIFY decision missing clarifying_question", fallback: CONFIRM_FALLBACK };
  }

  if (obj.decision === "CONFIRM" && !obj.confirm_message) {
    // Tolerate missing confirm_message but add a default
    obj.confirm_message = "Please confirm this action before proceeding.";
  }

  const output = obj as unknown as LLMOutput;

  // Enforce escalation-only: signals can only raise the decision, never lower it
  if (signals) {
    const minimum = getMinimumDecision(signals);
    if (minimum && DECISION_RANK[output.decision] < DECISION_RANK[minimum]) {
      output.decision = minimum;
      output.key_signals_used = [...output.key_signals_used, `overridden_to_${minimum}`];
      if (minimum === "CONFIRM" && !output.confirm_message) {
        output.confirm_message = "Signal override: please confirm this action before proceeding.";
      }
    }
  }

  return { success: true, data: output };
}
