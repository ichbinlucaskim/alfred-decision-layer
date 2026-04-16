import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 30;
import { extractSignals } from "@/lib/signals";
import { buildPrompt, SYSTEM_PROMPT } from "@/lib/prompt";
import { parseLLMOutput, CONFIRM_FALLBACK } from "@/lib/parser";
import type { ActionInput, DecideResponse, Signals } from "@/lib/types";

const client = new Anthropic();

export async function POST(req: NextRequest) {
  const start = Date.now();

  const body = (await req.json()) as ActionInput & {
    simulateFailure?: "timeout" | "malformed" | "missing_context";
  };

  const { simulateFailure, ...actionInput } = body;

  // Apply simulateFailure: missing_context by forcing contextCompleteness = 0
  let signals: Signals;
  if (simulateFailure === "missing_context") {
    const base = extractSignals(actionInput);
    signals = { ...base, contextCompleteness: 0.0 };
  } else {
    signals = extractSignals(actionInput);
  }

  // Priority 1: policy block → REFUSE immediately, no LLM
  if (signals.policyBlock) {
    const response: DecideResponse = {
      input: actionInput,
      signals,
      promptSent: "",
      rawLLMOutput: "",
      parseResult: {
        success: true,
        data: {
          decision: "REFUSE",
          rationale: signals.policyReason,
          confidence: 1.0,
          key_signals_used: ["policyBlock"],
        },
      },
      decision: "REFUSE",
      rationale: signals.policyReason,
      confidence: 1.0,
      durationMs: Date.now() - start,
      failureMode: null,
      shortCircuit: "policy",
    };
    return NextResponse.json(response);
  }

  // Priority 3: contextCompleteness < 0.5 → CLARIFY immediately, no LLM
  if (signals.contextCompleteness < 0.5) {
    const response: DecideResponse = {
      input: actionInput,
      signals,
      promptSent: "",
      rawLLMOutput: "",
      parseResult: {
        success: true,
        data: {
          decision: "CLARIFY",
          rationale: "Required parameters are missing or incomplete. Clarification is needed before proceeding.",
          confidence: 1.0,
          key_signals_used: ["contextCompleteness"],
          clarifying_question: "Could you provide the missing details (recipient, time, or scope) for this action?",
        },
      },
      decision: "CLARIFY",
      rationale: "Required parameters are missing or incomplete. Clarification is needed before proceeding.",
      confidence: 1.0,
      durationMs: Date.now() - start,
      failureMode: simulateFailure === "missing_context" ? "missing_context" : null,
      shortCircuit: "completeness",
    };
    return NextResponse.json(response);
  }

  const prompt = buildPrompt(actionInput, signals);
  let rawLLMOutput = "";

  // Simulate timeout: just wait >10s (we use AbortController anyway)
  if (simulateFailure === "timeout") {
    const response: DecideResponse = {
      input: actionInput,
      signals,
      promptSent: prompt,
      rawLLMOutput: "",
      parseResult: { success: false, error: "LLM timeout (simulated)", fallback: CONFIRM_FALLBACK },
      decision: "CONFIRM",
      rationale: CONFIRM_FALLBACK.rationale,
      confidence: 0,
      durationMs: Date.now() - start,
      failureMode: "timeout",
      shortCircuit: null,
    };
    return NextResponse.json(response);
  }

  // Simulate malformed: skip LLM, pass garbage to parser
  if (simulateFailure === "malformed") {
    rawLLMOutput = "Sorry, I cannot determine the appropriate action here. Please try again.";
    const parseResult = parseLLMOutput(rawLLMOutput, signals);
    const response: DecideResponse = {
      input: actionInput,
      signals,
      promptSent: prompt,
      rawLLMOutput,
      parseResult,
      decision: "CONFIRM",
      rationale: CONFIRM_FALLBACK.rationale,
      confidence: 0,
      durationMs: Date.now() - start,
      failureMode: "malformed",
      shortCircuit: null,
    };
    return NextResponse.json(response);
  }

  // Real LLM call with 10s timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25_000);

  try {
    const message = await client.messages.create(
      {
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
      },
      { signal: controller.signal }
    );

    clearTimeout(timeoutId);

    rawLLMOutput =
      message.content[0].type === "text" ? message.content[0].text : "";

    const parseResult = parseLLMOutput(rawLLMOutput, signals);

    const output = parseResult.success ? parseResult.data! : CONFIRM_FALLBACK;

    const response: DecideResponse = {
      input: actionInput,
      signals,
      promptSent: prompt,
      rawLLMOutput,
      parseResult,
      decision: output.decision,
      rationale: output.rationale,
      confidence: output.confidence,
      durationMs: Date.now() - start,
      failureMode: parseResult.success ? null : "malformed",
      shortCircuit: null,
    };
    return NextResponse.json(response);
  } catch (err) {
    clearTimeout(timeoutId);

    const isTimeout =
      err instanceof Error &&
      (err.name === "AbortError" || err.message.includes("abort"));

    const failureMode: "timeout" | "malformed" = isTimeout ? "timeout" : "malformed";
    const errorMsg = isTimeout ? "LLM call timed out after 25s" : String(err);

    const response: DecideResponse = {
      input: actionInput,
      signals,
      promptSent: prompt,
      rawLLMOutput,
      parseResult: {
        success: false,
        error: errorMsg,
        fallback: CONFIRM_FALLBACK,
      },
      decision: "CONFIRM",
      rationale: CONFIRM_FALLBACK.rationale,
      confidence: 0,
      durationMs: Date.now() - start,
      failureMode,
      shortCircuit: null,
    };
    return NextResponse.json(response);
  }
}
