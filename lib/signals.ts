import type { ActionType, ActionInput, ConversationTurn, Signals } from "./types";

const REVERSIBILITY: Record<ActionType, number> = {
  send_email: 1.0,
  reply_message: 1.0,
  forward_email: 1.0,
  delete_event: 1.0,
  delete_email: 1.0,
  create_event: 0.2,
  set_reminder: 0.2,
  archive_email: 0.1,
  create_draft: 0.1,
  unknown: 0.5,
};

export function computeReversibility(actionType: ActionType): number {
  return REVERSIBILITY[actionType] ?? 0.5;
}

export function computeContextCompleteness(
  actionType: ActionType,
  actionDescription: string
): number {
  const desc = actionDescription.toLowerCase();

  const hasRecipient = /\b(to|recipient|@|for)\b/.test(desc) ||
    /@[\w.]+\.\w+/.test(desc) ||
    /\b[A-Z][a-z]+ [A-Z][a-z]+\b/.test(actionDescription);

  const hasSubjectOrThread = /\b(subject|re:|fwd:|thread|regarding|about)\b/.test(desc) ||
    desc.length > 40;

  const hasDateTime = /\b(\d{1,2}(am|pm|:\d{2})|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}\/\d{1,2}|next week)\b/.test(desc);

  const hasTitleOrDescription = desc.length > 20;

  const hasTimeAndTask = hasDateTime && desc.length > 15;

  if (actionType === "send_email" || actionType === "reply_message" || actionType === "forward_email") {
    if (hasRecipient && hasSubjectOrThread) return 1.0;
    if (hasRecipient || hasSubjectOrThread) return 0.5;
    return 0.0;
  }

  if (actionType === "create_event") {
    if (hasDateTime && hasTitleOrDescription) return 1.0;
    if (hasDateTime || hasTitleOrDescription) return 0.5;
    return 0.0;
  }

  if (actionType === "set_reminder") {
    if (hasTimeAndTask) return 1.0;
    if (hasDateTime || desc.length > 10) return 0.5;
    return 0.0;
  }

  // archive_email, create_draft, delete_email, delete_event, unknown
  return 1.0;
}

const HOLD_KEYWORDS = /\b(hold|wait|cancel|don't|dont|stop|pause|not yet|hold off|hold on)\b/i;
const GO_KEYWORDS = /\b(send|go|confirm|yes|yep|do it|proceed|ok|okay|go ahead)\b/i;

export function detectContradiction(
  latestMessage: string,
  history: ConversationTurn[]
): { contradictionFlag: boolean; contradictionEvidence: string } {
  // Scan history (oldest → newest) to find most-recent hold and go indices
  let lastHoldIndex = -1;
  let lastHoldContent = "";
  let lastGoIndex = -1;

  history.forEach((turn, i) => {
    if (HOLD_KEYWORDS.test(turn.content)) {
      lastHoldIndex = i;
      lastHoldContent = turn.content;
    }
    if (GO_KEYWORDS.test(turn.content)) {
      lastGoIndex = i;
    }
  });

  // If the latest message itself is a "go" signal after a hold in history
  const latestIsGo = GO_KEYWORDS.test(latestMessage);
  if (latestIsGo && lastHoldIndex > lastGoIndex && lastHoldIndex >= 0) {
    return { contradictionFlag: true, contradictionEvidence: lastHoldContent };
  }

  // If hold appears after the last go in history
  if (lastHoldIndex > lastGoIndex && lastHoldIndex >= 0) {
    return { contradictionFlag: true, contradictionEvidence: lastHoldContent };
  }

  return { contradictionFlag: false, contradictionEvidence: "" };
}

export function checkPolicy(
  actionType: ActionType,
  actionDescription: string
): { policyBlock: boolean; policyReason: string } {
  const desc = actionDescription.toLowerCase();

  // "delete all" or "clear everything" without explicit numeric scope
  if (/\b(delete all|clear everything|remove all|delete every)\b/.test(desc)) {
    const hasNumericScope = /\b\d+\s+(email|message|event|item)/.test(desc);
    if (!hasNumericScope) {
      return {
        policyBlock: true,
        policyReason: 'Bulk delete without explicit numeric scope ("delete all", "clear everything") is not permitted.',
      };
    }
  }

  // Forward to >1 external recipient in a single action
  if (actionType === "forward_email") {
    const emailMatches = actionDescription.match(/[\w.+-]+@[\w.-]+\.\w+/g) ?? [];
    const nameMatches = actionDescription.match(/\bto\s+([A-Z][a-z]+ [A-Z][a-z]+(?:,\s*[A-Z][a-z]+ [A-Z][a-z]+)+)/)?.[0];
    if (emailMatches.length > 1 || nameMatches) {
      return {
        policyBlock: true,
        policyReason: "Forwarding to more than one external recipient in a single action is not permitted.",
      };
    }
  }

  // Any action targeting >10 items
  const bulkMatch = desc.match(/\b(\d+)\s+(email|message|event|item|reminder)/);
  if (bulkMatch && parseInt(bulkMatch[1], 10) > 10) {
    return {
      policyBlock: true,
      policyReason: `Action targets ${bulkMatch[1]} items, which exceeds the 10-item limit per action.`,
    };
  }

  return { policyBlock: false, policyReason: "" };
}

export function extractSignals(input: ActionInput): Signals {
  const reversibilityScore = computeReversibility(input.actionType);
  const contextCompleteness = computeContextCompleteness(input.actionType, input.actionDescription);
  const { contradictionFlag, contradictionEvidence } = detectContradiction(input.latestMessage, input.history);
  const { policyBlock, policyReason } = checkPolicy(input.actionType, input.actionDescription);

  return {
    reversibilityScore,
    contextCompleteness,
    contradictionFlag,
    contradictionEvidence,
    policyBlock,
    policyReason,
  };
}
