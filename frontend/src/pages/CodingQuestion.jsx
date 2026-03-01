import React, { useState, useRef } from "react";
import Editor from "@monaco-editor/react";
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

// Monaco language IDs for each supported language
const LANG_MONACO_MAP = {
  python: "python",
  java: "java",
  cpp: "cpp",
  "c++": "cpp",
  javascript: "javascript",
  js: "javascript",
  c: "c",
  typescript: "typescript",
};

const CodingQuestion = ({
  question,       // The full question object { question, type, language, starter_code, test_cases, ... }
  onCodeChange,   // (code: string) => void — so Test.jsx can track the answer
  onRunResult,    // (result: { passed, total, all_passed, score }) => void — so Test.jsx can grade
  initialCode,    // Pre-filled code from answers state
}) => {
  const [code, setCode] = useState(initialCode || question.starter_code || "");
  const [selectedLang, setSelectedLang] = useState(question.language || "python");
  const [results, setResults] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const editorRef = useRef(null);

  const testCases = question.test_cases || [];

  const handleEditorDidMount = (editor) => {
    editorRef.current = editor;
  };

  const handleCodeChange = (value) => {
    setCode(value || "");
    if (onCodeChange) onCodeChange(value || "");
  };

  const handleLangChange = (e) => {
    setSelectedLang(e.target.value);
  };

  const runCode = async () => {
    setRunning(true);
    setError(null);
    setResults(null);
    try {
      const token = localStorage.getItem("mockmate_token");
      const resp = await axios.post(
        `${API_BASE}/run-code`,
        {
          language: selectedLang,
          code,
          test_cases: testCases.length > 0 ? testCases : undefined,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setResults(resp.data);
      if (onRunResult) onRunResult(resp.data);
    } catch (err) {
      const msg =
        err.response?.data?.detail || err.message || "Failed to execute code";
      setError(msg);
    } finally {
      setRunning(false);
    }
  };

  const monacoLang = LANG_MONACO_MAP[selectedLang] || "plaintext";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Language Selector + Run Button Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <label style={{ fontWeight: "600", color: "#334155", fontSize: "14px" }}>
            Language:
          </label>
          <select
            value={selectedLang}
            onChange={handleLangChange}
            style={{
              padding: "6px 12px",
              borderRadius: "6px",
              border: "1px solid #cce0f5",
              fontSize: "14px",
              fontWeight: "600",
              backgroundColor: "white",
              color: "#1e293b",
              cursor: "pointer",
            }}
          >
            <option value="python">Python</option>
            <option value="java">Java</option>
            <option value="cpp">C++</option>
            <option value="c">C</option>
            <option value="javascript">JavaScript</option>
            <option value="typescript">TypeScript</option>
          </select>
        </div>

        <button
          onClick={runCode}
          disabled={running}
          style={{
            padding: "10px 24px",
            backgroundColor: running ? "#94a3b8" : "#059669",
            color: "white",
            border: "none",
            borderRadius: "8px",
            cursor: running ? "not-allowed" : "pointer",
            fontWeight: "700",
            fontSize: "14px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            transition: "all 0.2s ease",
          }}
        >
          {running ? (
            <>⏳ Running...</>
          ) : (
            <>▶ Run Code</>
          )}
        </button>
      </div>

      {/* Monaco Code Editor */}
      <div
        style={{
          border: "1px solid #cce0f5",
          borderRadius: "8px",
          overflow: "hidden",
        }}
      >
        <Editor
          height="350px"
          language={monacoLang}
          value={code}
          onChange={handleCodeChange}
          onMount={handleEditorDidMount}
          theme="vs-dark"
          options={{
            fontSize: 14,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 4,
            wordWrap: "on",
            padding: { top: 12 },
          }}
        />
      </div>

      {/* Test Cases Panel */}
      {testCases.length > 0 && (
        <div
          style={{
            backgroundColor: "#f8fafc",
            borderRadius: "8px",
            padding: "16px",
            border: "1px solid #e2e8f0",
          }}
        >
          <h4 style={{ margin: "0 0 12px 0", color: "#1e293b", fontSize: "14px" }}>
            🧪 Test Cases ({testCases.length})
          </h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {testCases.map((tc, i) => (
              <div
                key={i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "8px",
                  padding: "10px",
                  backgroundColor: "white",
                  borderRadius: "6px",
                  border: "1px solid #e2e8f0",
                  fontSize: "13px",
                }}
              >
                <div>
                  <span style={{ fontWeight: "600", color: "#64748b", fontSize: "11px" }}>
                    INPUT
                  </span>
                  <pre
                    style={{
                      margin: "4px 0 0 0",
                      fontFamily: "monospace",
                      color: "#1e293b",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                    }}
                  >
                    {tc.input || "(empty)"}
                  </pre>
                </div>
                <div>
                  <span style={{ fontWeight: "600", color: "#64748b", fontSize: "11px" }}>
                    EXPECTED OUTPUT
                  </span>
                  <pre
                    style={{
                      margin: "4px 0 0 0",
                      fontFamily: "monospace",
                      color: "#1e293b",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                    }}
                  >
                    {tc.expected_output || "(empty)"}
                  </pre>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div
          style={{
            padding: "12px 16px",
            backgroundColor: "#fee2e2",
            color: "#991b1b",
            borderRadius: "8px",
            borderLeft: "4px solid #dc2626",
            fontSize: "13px",
            fontFamily: "monospace",
            whiteSpace: "pre-wrap",
          }}
        >
          ❌ {error}
        </div>
      )}

      {/* Results Panel */}
      {results && (
        <div
          style={{
            borderRadius: "8px",
            overflow: "hidden",
            border: `2px solid ${results.all_passed ? "#22c55e" : "#f59e0b"}`,
          }}
        >
          {/* Summary Header */}
          <div
            style={{
              padding: "12px 16px",
              backgroundColor: results.all_passed ? "#dcfce7" : "#fef3c7",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span
              style={{
                fontWeight: "700",
                color: results.all_passed ? "#166534" : "#92400e",
                fontSize: "14px",
              }}
            >
              {results.all_passed
                ? "✅ All Test Cases Passed!"
                : `⚠️ ${results.passed}/${results.total} Test Cases Passed`}
            </span>
            <span
              style={{
                fontWeight: "700",
                fontSize: "16px",
                color: results.all_passed ? "#166534" : "#92400e",
              }}
            >
              Score: {results.score}%
            </span>
          </div>

          {/* Per-Test-Case Results */}
          <div style={{ padding: "12px 16px", backgroundColor: "white" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {results.results.map((r, i) => (
                <div
                  key={i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr 1fr 1fr",
                    gap: "12px",
                    alignItems: "start",
                    padding: "10px",
                    borderRadius: "6px",
                    backgroundColor: r.passed ? "#f0fdf4" : "#fef2f2",
                    border: `1px solid ${r.passed ? "#bbf7d0" : "#fecaca"}`,
                    fontSize: "13px",
                  }}
                >
                  {/* Pass/Fail Icon */}
                  <div
                    style={{
                      fontWeight: "700",
                      fontSize: "16px",
                      paddingTop: "2px",
                    }}
                  >
                    {r.passed ? "✅" : "❌"}
                  </div>

                  {/* Input */}
                  <div>
                    <span
                      style={{
                        fontWeight: "600",
                        color: "#64748b",
                        fontSize: "11px",
                        display: "block",
                      }}
                    >
                      INPUT
                    </span>
                    <pre
                      style={{
                        margin: "2px 0 0 0",
                        fontFamily: "monospace",
                        color: "#1e293b",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                      }}
                    >
                      {r.input || "(empty)"}
                    </pre>
                  </div>

                  {/* Expected */}
                  <div>
                    <span
                      style={{
                        fontWeight: "600",
                        color: "#64748b",
                        fontSize: "11px",
                        display: "block",
                      }}
                    >
                      EXPECTED
                    </span>
                    <pre
                      style={{
                        margin: "2px 0 0 0",
                        fontFamily: "monospace",
                        color: "#1e293b",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                      }}
                    >
                      {r.expected || "(empty)"}
                    </pre>
                  </div>

                  {/* Actual */}
                  <div>
                    <span
                      style={{
                        fontWeight: "600",
                        color: "#64748b",
                        fontSize: "11px",
                        display: "block",
                      }}
                    >
                      {r.error ? "ERROR" : "ACTUAL OUTPUT"}
                    </span>
                    <pre
                      style={{
                        margin: "2px 0 0 0",
                        fontFamily: "monospace",
                        color: r.error ? "#dc2626" : "#1e293b",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                      }}
                    >
                      {r.error || r.actual || "(empty)"}
                    </pre>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CodingQuestion;
