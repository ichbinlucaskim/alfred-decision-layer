"use client";

import { useState } from "react";
import { SCENARIOS } from "@/lib/scenarios";
import type { ActionInput, ActionType, ConversationTurn, DecideResponse } from "@/lib/types";

const ACTION_TYPES: ActionType[] = [
  "send_email", "delete_email", "create_event", "delete_event",
  "set_reminder", "reply_message", "forward_email", "archive_email",
  "create_draft", "unknown",
];

const DEFAULT_FORM: ActionInput = {
  actionType: "send_email",
  actionDescription: "",
  latestMessage: "",
  history: [],
  userContext: "",
};

export default function Home() {
  const [selectedScenario, setSelectedScenario] = useState<number>(-1);
  const [form, setForm] = useState<ActionInput>(DEFAULT_FORM);
  const [historyJson, setHistoryJson] = useState("[]");
  const [historyError, setHistoryError] = useState("");
  const [simulateFailure, setSimulateFailure] = useState<"timeout" | "malformed" | "missing_context" | null>(null);
  const [result, setResult] = useState<DecideResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());

  function handleScenarioSelect(index: number) {
    setSelectedScenario(index);
    if (index === -1) {
      setForm(DEFAULT_FORM);
      setHistoryJson("[]");
    } else {
      const s = SCENARIOS[index];
      setForm({
        actionType: s.actionType,
        actionDescription: s.actionDescription,
        latestMessage: s.latestMessage,
        history: s.history,
        userContext: s.userContext ?? "",
      });
      setHistoryJson(JSON.stringify(s.history, null, 2));
    }
    setResult(null);
    setSimulateFailure(null);
  }

  function toggleSection(id: string) {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit() {
    let history: ConversationTurn[];
    try {
      history = JSON.parse(historyJson);
      setHistoryError("");
    } catch {
      setHistoryError("Invalid JSON");
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          history,
          ...(simulateFailure ? { simulateFailure } : {}),
        }),
      });
      const data: DecideResponse = await res.json();
      setResult(data);
      setOpenSections(new Set(["inputs", "signals", "prompt", "raw", "parsed"]));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-6" style={{ fontFamily: "ui-monospace, monospace" }}>
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8 border-b border-gray-800 pb-4">
          <h1 className="text-lg font-bold text-white">alfred_ / execution-decision-layer</h1>
          <p className="text-gray-500 text-xs mt-1">
            Hybrid code + LLM · 5 decision states · full pipeline visibility
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ── LEFT: Input ── */}
          <div className="space-y-4">

            {/* Scenario selector */}
            <div className="bg-gray-900 border border-gray-800 rounded p-4">
              <label className="text-xs uppercase tracking-widest text-gray-500 block mb-2">
                Preloaded Scenario
              </label>
              <select
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-gray-500"
                value={selectedScenario}
                onChange={e => handleScenarioSelect(Number(e.target.value))}
              >
                <option value={-1}>— custom input —</option>
                {SCENARIOS.map((s, i) => (
                  <option key={i} value={i}>{s.label}</option>
                ))}
              </select>

              {selectedScenario >= 0 && (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">Expected:</span>
                    <DecisionBadge decision={SCENARIOS[selectedScenario].expectedDecision} sm />
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed">
                    {SCENARIOS[selectedScenario].designNote}
                  </p>
                </div>
              )}
            </div>

            {/* Form */}
            <div className="bg-gray-900 border border-gray-800 rounded p-4 space-y-3">
              <label className="text-xs uppercase tracking-widest text-gray-500 block">Input</label>

              <Field label="Action Type">
                <select
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-gray-500"
                  value={form.actionType}
                  onChange={e => setForm(f => ({ ...f, actionType: e.target.value as ActionType }))}
                >
                  {ACTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>

              <Field label="Action Description">
                <textarea
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-gray-500 resize-none"
                  rows={2}
                  value={form.actionDescription}
                  onChange={e => setForm(f => ({ ...f, actionDescription: e.target.value }))}
                />
              </Field>

              <Field label="Latest Message">
                <input
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-gray-500"
                  value={form.latestMessage}
                  onChange={e => setForm(f => ({ ...f, latestMessage: e.target.value }))}
                />
              </Field>

              <Field label="Conversation History (JSON array)">
                <textarea
                  className={`w-full bg-gray-800 border rounded px-3 py-2 text-xs text-gray-100 focus:outline-none resize-none leading-relaxed ${
                    historyError ? "border-red-600" : "border-gray-700 focus:border-gray-500"
                  }`}
                  rows={6}
                  value={historyJson}
                  onChange={e => { setHistoryJson(e.target.value); setHistoryError(""); }}
                />
                {historyError && (
                  <p className="text-xs text-red-400 mt-1">{historyError}</p>
                )}
              </Field>

              <Field label="User Context (optional)">
                <input
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-gray-500"
                  value={form.userContext ?? ""}
                  onChange={e => setForm(f => ({ ...f, userContext: e.target.value }))}
                />
              </Field>
            </div>

            {/* Failure simulation */}
            <div className="bg-gray-900 border border-gray-800 rounded p-4">
              <label className="text-xs uppercase tracking-widest text-gray-500 block mb-3">
                Simulate Failure
              </label>
              <div className="flex flex-wrap gap-2">
                {(["timeout", "malformed", "missing_context"] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setSimulateFailure(prev => prev === f ? null : f)}
                    className={`px-3 py-1 text-xs rounded border transition-colors cursor-pointer ${
                      simulateFailure === f
                        ? "bg-red-900 border-red-600 text-red-200"
                        : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-300"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
              {simulateFailure && (
                <p className="text-xs text-red-400 mt-2">⚠ failure mode active: {simulateFailure}</p>
              )}
            </div>

            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full bg-white text-gray-950 font-bold py-3 rounded text-sm hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {loading ? "Evaluating…" : "Run Decision Pipeline →"}
            </button>
          </div>

          {/* ── RIGHT: Output ── */}
          <div className="space-y-4">
            {result ? (
              <>
                {/* Decision card */}
                <div className="bg-gray-900 border border-gray-800 rounded p-4">
                  <label className="text-xs uppercase tracking-widest text-gray-500 block mb-3">Decision</label>

                  <div className="flex items-start gap-4 mb-4">
                    <DecisionBadge decision={result.decision} />
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-500">confidence</span>
                        <ConfidenceBar value={result.confidence} />
                        <span className="text-xs text-gray-400">{Math.round(result.confidence * 100)}%</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="text-xs text-gray-600">{result.durationMs}ms</span>
                        {result.failureMode && (
                          <span className="text-xs bg-red-950 text-red-400 border border-red-800 px-2 py-0.5 rounded">
                            failure: {result.failureMode}
                          </span>
                        )}
                        {result.shortCircuit && (
                          <span className="text-xs bg-yellow-950 text-yellow-400 border border-yellow-800 px-2 py-0.5 rounded">
                            short-circuit: {result.shortCircuit}
                          </span>
                        )}
                        {selectedScenario >= 0 && (() => {
                          const match = result.decision === SCENARIOS[selectedScenario].expectedDecision;
                          return (
                            <span className={`text-xs px-2 py-0.5 rounded border ${
                              match
                                ? "bg-green-950 text-green-400 border-green-800"
                                : "bg-red-950 text-red-400 border-red-800"
                            }`}>
                              expected {SCENARIOS[selectedScenario].expectedDecision} {match ? "✓" : "✗"}
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                  </div>

                  <p className="text-sm text-gray-300 leading-relaxed">{result.rationale}</p>

                  {result.parseResult.data?.clarifying_question && (
                    <div className="mt-3 p-3 bg-orange-950 border border-orange-900 rounded">
                      <p className="text-xs text-orange-500 mb-1">clarifying question</p>
                      <p className="text-sm text-orange-200">{result.parseResult.data.clarifying_question}</p>
                    </div>
                  )}

                  {result.parseResult.data?.confirm_message && (
                    <div className="mt-3 p-3 bg-yellow-950 border border-yellow-900 rounded">
                      <p className="text-xs text-yellow-500 mb-1">confirmation prompt</p>
                      <p className="text-sm text-yellow-200">{result.parseResult.data.confirm_message}</p>
                    </div>
                  )}
                </div>

                {/* Pipeline accordion */}
                <div className="bg-gray-900 border border-gray-800 rounded overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-800">
                    <label className="text-xs uppercase tracking-widest text-gray-500">Pipeline Debug</label>
                  </div>
                  {[
                    { id: "inputs",  label: "① Inputs",          content: JSON.stringify(result.input, null, 2) },
                    { id: "signals", label: "② Signals",         content: JSON.stringify(result.signals, null, 2) },
                    { id: "prompt",  label: "③ Prompt Sent",     content: result.promptSent || "(skipped — short-circuit before LLM)" },
                    { id: "raw",     label: "④ Raw LLM Output",  content: result.rawLLMOutput || "(no LLM call made)" },
                    { id: "parsed",  label: "⑤ Parsed Result",   content: JSON.stringify(result.parseResult, null, 2) },
                  ].map(({ id, label, content }) => (
                    <div key={id} className="border-b border-gray-800 last:border-0">
                      <button
                        onClick={() => toggleSection(id)}
                        className="w-full flex items-center justify-between px-4 py-3 text-xs text-gray-400 hover:bg-gray-800 transition-colors text-left cursor-pointer"
                      >
                        <span>{label}</span>
                        <span className="text-gray-600 text-xs">{openSections.has(id) ? "▲" : "▼"}</span>
                      </button>
                      {openSections.has(id) && (
                        <div className="px-4 pb-4">
                          <pre className="text-xs text-gray-400 bg-gray-950 rounded p-3 overflow-x-auto whitespace-pre-wrap break-words leading-relaxed max-h-64 overflow-y-auto">
                            {content}
                          </pre>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="bg-gray-900 border border-gray-800 rounded p-12 text-center">
                <p className="text-gray-600 text-sm">Select a scenario or fill in the form,</p>
                <p className="text-gray-600 text-sm">then run the pipeline.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-gray-500 block mb-1">{label}</label>
      {children}
    </div>
  );
}

function DecisionBadge({ decision, sm }: { decision: string; sm?: boolean }) {
  const palette: Record<string, string> = {
    EXECUTE_SILENT: "bg-green-950 text-green-300 border-green-800",
    EXECUTE_NOTIFY: "bg-blue-950 text-blue-300 border-blue-800",
    CONFIRM:        "bg-yellow-950 text-yellow-300 border-yellow-800",
    CLARIFY:        "bg-orange-950 text-orange-300 border-orange-800",
    REFUSE:         "bg-red-950 text-red-300 border-red-800",
  };
  const cls = palette[decision] ?? "bg-gray-800 text-gray-300 border-gray-700";
  return (
    <span className={`inline-block border rounded font-bold whitespace-nowrap ${cls} ${
      sm ? "px-2 py-0.5 text-xs" : "px-3 py-1.5 text-sm"
    }`}>
      {decision}
    </span>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 75 ? "bg-green-500" : pct >= 40 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="w-20 h-1.5 bg-gray-700 rounded-full overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
