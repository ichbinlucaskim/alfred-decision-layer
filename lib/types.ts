export type ActionType =
  | "send_email"
  | "delete_email"
  | "create_event"
  | "delete_event"
  | "set_reminder"
  | "reply_message"
  | "forward_email"
  | "archive_email"
  | "create_draft"
  | "unknown";

export type Decision =
  | "EXECUTE_SILENT"
  | "EXECUTE_NOTIFY"
  | "CONFIRM"
  | "CLARIFY"
  | "REFUSE";

export interface ConversationTurn {
  role: "user" | "alfred";
  content: string;
  timestamp?: string;
}

export interface ActionInput {
  actionType: ActionType;
  actionDescription: string;
  latestMessage: string;
  history: ConversationTurn[];
  userContext?: string;
}

export interface Signals {
  reversibilityScore: number;
  contextCompleteness: number;
  contradictionFlag: boolean;
  contradictionEvidence: string;
  policyBlock: boolean;
  policyReason: string;
}

export interface LLMOutput {
  decision: Decision;
  rationale: string;
  confidence: number;
  key_signals_used: string[];
  clarifying_question?: string;
  confirm_message?: string;
}

export interface ParseResult {
  success: boolean;
  data?: LLMOutput;
  error?: string;
  fallback?: LLMOutput;
}

export interface DecideResponse {
  input: ActionInput;
  signals: Signals;
  promptSent: string;
  rawLLMOutput: string;
  parseResult: ParseResult;
  decision: Decision;
  rationale: string;
  confidence: number;
  durationMs: number;
  failureMode?: "timeout" | "malformed" | "missing_context" | null;
  shortCircuit?: "policy" | "completeness" | null;
}
