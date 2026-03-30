import React, { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import axios from "axios";
import { API_BASE } from "../config/runtime";

const LANG_MONACO_MAP = {
  python: "python",
  java: "java",
  cpp: "cpp",
  "c++": "cpp",
  javascript: "javascript",
  js: "javascript",
  c: "c",
  typescript: "typescript",
  sql: "sql",
};

const LANG_EXT_MAP = {
  python: "py",
  java: "java",
  cpp: "cpp",
  "c++": "cpp",
  javascript: "js",
  js: "js",
  c: "c",
  typescript: "ts",
  sql: "sql",
};

const STARTER_BY_LANG = {
  python: "def solve(input_data):\n    # Write your solution\n    return \"\"",
  java: "import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        // Write your solution\n        System.out.println();\n    }\n}",
  cpp: "#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    // Write your solution\n    return 0;\n}",
  c: "#include <stdio.h>\n\nint main() {\n    // Write your solution\n    return 0;\n}",
  javascript: "const fs = require('fs');\nconst input = fs.readFileSync(0, 'utf8').trim();\n// Write your solution\nconsole.log('');",
  typescript: "import * as fs from 'fs';\nconst input = fs.readFileSync(0, 'utf8').trim();\n// Write your solution\nconsole.log('');",
  sql: "-- Write SQL query here\nSELECT 1;",
};

const normalizeLang = (lang) => {
  const raw = (lang || "python").toLowerCase().trim();
  if (raw === "c++") return "cpp";
  if (raw === "js") return "javascript";
  return raw;
};

const CodingQuestion = ({ question, onCodeChange, onRunResult, initialCode }) => {
  const initialLang = normalizeLang(question.language || "python");
  const initialText = initialCode || question.starter_code || STARTER_BY_LANG[initialLang] || "";

  const [code, setCode] = useState(initialText);
  const [selectedLang, setSelectedLang] = useState(initialLang);
  const [results, setResults] = useState(null);
  const [compileResult, setCompileResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [execTime, setExecTime] = useState(null);

  const editorRef = useRef(null);
  const monacoRef = useRef(null);

  const testCases = question.test_cases || [];

  const handleEditorDidMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
  };

  const handleCodeChange = (value) => {
    const text = value || "";
    setCode(text);
    if (onCodeChange) onCodeChange(text);
  };

  const handleLangChange = (e) => {
    const nextLang = normalizeLang(e.target.value);
    setSelectedLang(nextLang);
    if (!code.trim()) {
      const starter = STARTER_BY_LANG[nextLang] || "";
      setCode(starter);
      if (onCodeChange) onCodeChange(starter);
    }
  };

  useEffect(() => {
    const nextLang = normalizeLang(question.language || "python");
    const nextCode = initialCode || question.starter_code || STARTER_BY_LANG[nextLang] || "";
    setSelectedLang(nextLang);
    setCode(nextCode);
  }, [question.id, question.language, question.starter_code, initialCode]);

  useEffect(() => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    if (!monaco || !editor) return;
    const model = editor.getModel();
    if (!model) return;
    monaco.editor.setModelLanguage(model, LANG_MONACO_MAP[selectedLang] || "plaintext");
  }, [selectedLang]);

  const checkCompile = async () => {
    setRunning(true);
    setError(null);
    setCompileResult(null);
    try {
      const token = localStorage.getItem("mockmate_token");
      const resp = await axios.post(
        `${API_BASE}/run-code`,
        {
          language: selectedLang,
          code,
          test_cases: testCases.length > 0 ? testCases : undefined,
          compile_only: true,
        },
        { headers: { Authorization: `Bearer ${token}` }, timeout: 60000 }
      );
      setCompileResult(resp.data);
    } catch (err) {
      const msg = err.response?.data?.detail || err.message || "Compile check failed";
      setError(msg);
    } finally {
      setRunning(false);
    }
  };

  const runCode = async () => {
    setRunning(true);
    setError(null);
    setResults(null);
    setCompileResult(null);
    setExecTime(null);
    const t0 = performance.now();
    try {
      const token = localStorage.getItem("mockmate_token");
      const resp = await axios.post(
        `${API_BASE}/run-code`,
        {
          language: selectedLang,
          code,
          test_cases: testCases.length > 0 ? testCases : undefined,
        },
        { headers: { Authorization: `Bearer ${token}` }, timeout: 60000 }
      );
      const elapsed = Math.round(performance.now() - t0);
      setExecTime(resp.data.execution_time_ms || elapsed);
      setResults(resp.data);
      if (onRunResult) onRunResult(resp.data);
    } catch (err) {
      const msg = err.response?.data?.detail || err.message || "Failed to execute code";
      setError(msg);
      setExecTime(Math.round(performance.now() - t0));
    } finally {
      setRunning(false);
    }
  };

  const monacoLang = LANG_MONACO_MAP[selectedLang] || "plaintext";
  const fileExt = LANG_EXT_MAP[selectedLang] || "txt";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <label style={{ fontWeight: "600", color: "#334155", fontSize: "14px" }}>Language:</label>
          <select
            value={selectedLang}
            onChange={handleLangChange}
            style={{
              padding: "6px 12px",
              borderRadius: "6px",
              border: "1px solid #e0e7ff",
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
            <option value="sql">SQL</option>
          </select>
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={checkCompile}
            disabled={running}
            style={{
              padding: "10px 16px",
              backgroundColor: running ? "#94a3b8" : "#2563eb",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: running ? "not-allowed" : "pointer",
              fontWeight: "700",
              fontSize: "14px",
            }}
          >
            Check Compile
          </button>
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
            }}
          >
            {running ? "Running..." : "Run Code"}
          </button>
        </div>
      </div>

      <div style={{ border: "1px solid #e0e7ff", borderRadius: "8px", overflow: "hidden" }}>
        <Editor
          key={`${question.id || "q"}-${selectedLang}`}
          height="350px"
          language={monacoLang}
          path={`main.${fileExt}`}
          value={code}
          onChange={handleCodeChange}
          onMount={handleEditorDidMount}
          theme="vs-dark"
          options={{
            fontSize: 14,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            wordWrap: "on",
            padding: { top: 12 },
          }}
        />
      </div>

      {testCases.length > 0 && (
        <div style={{ backgroundColor: "#f5f3ff", borderRadius: "8px", padding: "16px", border: "1px solid #e2e8f0" }}>
          <h4 style={{ margin: "0 0 12px 0", color: "#1e293b", fontSize: "14px" }}>Test Cases ({testCases.length})</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {testCases.map((tc, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", padding: "10px", backgroundColor: "white", borderRadius: "6px", border: "1px solid #e2e8f0", fontSize: "13px" }}>
                <div>
                  <span style={{ fontWeight: "600", color: "#64748b", fontSize: "11px" }}>INPUT / SETUP</span>
                  <pre style={{ margin: "4px 0 0 0", fontFamily: "monospace", color: "#1e293b", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{tc.input || tc.setup_sql || "(empty)"}</pre>
                </div>
                <div>
                  <span style={{ fontWeight: "600", color: "#64748b", fontSize: "11px" }}>EXPECTED OUTPUT</span>
                  <pre style={{ margin: "4px 0 0 0", fontFamily: "monospace", color: "#1e293b", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{tc.expected_output || "(empty)"}</pre>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div style={{ padding: "12px 16px", backgroundColor: "#fee2e2", color: "#991b1b", borderRadius: "8px", borderLeft: "4px solid #dc2626", fontSize: "13px", fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
          {error}
        </div>
      )}

      {compileResult && (
        <div style={{ padding: "10px 14px", borderRadius: "8px", backgroundColor: compileResult.compile_ok ? "#dcfce7" : "#fee2e2", border: `1px solid ${compileResult.compile_ok ? "#86efac" : "#fca5a5"}`, color: compileResult.compile_ok ? "#166534" : "#991b1b", fontSize: "13px", fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
          {compileResult.compile_ok ? "Compile OK" : "Compile Error"}: {compileResult.message}
        </div>
      )}

      {results && (
        <div style={{ borderRadius: "8px", overflow: "hidden", border: `2px solid ${results.all_passed ? "#22c55e" : "#f59e0b"}` }}>
          <div style={{ padding: "12px 16px", backgroundColor: results.all_passed ? "#dcfce7" : "#fef3c7", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: "700", color: results.all_passed ? "#166534" : "#92400e", fontSize: "14px" }}>
              {results.all_passed ? "All Test Cases Passed" : `${results.passed}/${results.total} Test Cases Passed`}
            </span>
            <span style={{ fontWeight: "700", fontSize: "16px", color: results.all_passed ? "#166534" : "#92400e" }}>
              Score: {results.score}%
            </span>
          </div>

          {execTime != null && (
            <div style={{ padding: "6px 16px", backgroundColor: "#f1f5f9", borderBottom: "1px solid #e2e8f0", fontSize: "12px", color: "#64748b", fontFamily: "monospace" }}>
              Executed in {execTime < 1000 ? `${execTime}ms` : `${(execTime / 1000).toFixed(1)}s`}
            </div>
          )}

          <div style={{ padding: "12px 16px", backgroundColor: "white" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {(results.results || []).map((r, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr 1fr", gap: "12px", alignItems: "start", padding: "10px", borderRadius: "6px", backgroundColor: r.passed ? "#f0fdf4" : "#fef2f2", border: `1px solid ${r.passed ? "#bbf7d0" : "#fecaca"}`, fontSize: "13px" }}>
                  <div style={{ fontWeight: "700", fontSize: "16px", paddingTop: "2px" }}>{r.passed ? "OK" : "X"}</div>
                  <div>
                    <span style={{ fontWeight: "600", color: "#64748b", fontSize: "11px", display: "block" }}>INPUT</span>
                    <pre style={{ margin: "2px 0 0 0", fontFamily: "monospace", color: "#1e293b", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{r.input || "(empty)"}</pre>
                  </div>
                  <div>
                    <span style={{ fontWeight: "600", color: "#64748b", fontSize: "11px", display: "block" }}>EXPECTED</span>
                    <pre style={{ margin: "2px 0 0 0", fontFamily: "monospace", color: "#1e293b", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{r.expected || "(empty)"}</pre>
                  </div>
                  <div>
                    <span style={{ fontWeight: "600", color: "#64748b", fontSize: "11px", display: "block" }}>{r.error ? "ERROR" : "ACTUAL"}</span>
                    <pre style={{ margin: "2px 0 0 0", fontFamily: "monospace", color: r.error ? "#dc2626" : "#1e293b", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{r.error || r.actual || "(empty)"}</pre>
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
