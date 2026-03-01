import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

/* ── Animated loading screen ── */
const loadingMessages = [
  { icon: "🧠", text: "Warming up the AI engine..." },
  { icon: "📝", text: "Crafting reading comprehension passage..." },
  { icon: "📧", text: "Building email writing scenarios..." },
  { icon: "🔤", text: "Preparing grammar & vocabulary questions..." },
  { icon: "💼", text: "Designing situational communication challenges..." },
  { icon: "🎤", text: "Setting up spoken English prompts..." },
  { icon: "✨", text: "Polishing your personalised test..." },
  { icon: "🚀", text: "Almost ready — hang tight!" },
];

const LoadingScreen = () => {
  const [msgIdx, setMsgIdx] = useState(0);
  const [dots, setDots] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const msgTimer = setInterval(() => setMsgIdx((p) => (p + 1) % loadingMessages.length), 2400);
    const dotTimer = setInterval(() => setDots((p) => (p + 1) % 4), 500);
    const progTimer = setInterval(() => setProgress((p) => Math.min(p + Math.random() * 6, 92)), 800);
    return () => { clearInterval(msgTimer); clearInterval(dotTimer); clearInterval(progTimer); };
  }, []);

  const msg = loadingMessages[msgIdx];

  return (
    <div style={{
      minHeight: "100vh", background: "linear-gradient(135deg, #f5f3ff 0%, #ede9fe 50%, #f5f3ff 100%)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: "20px",
    }}>
      <div style={{
        backgroundColor: "white", borderRadius: "20px", padding: "50px 40px", maxWidth: "460px",
        width: "100%", boxShadow: "0 20px 60px rgba(99,102,241,0.12)", textAlign: "center",
        position: "relative", overflow: "hidden",
      }}>
        {/* Decorative top line */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: "4px",
          background: "linear-gradient(90deg, #6366f1, #818cf8, #6366f1)",
          backgroundSize: "200% 100%",
          animation: "shimmer 2s ease-in-out infinite",
        }} />

        {/* Bouncing icon */}
        <div style={{
          fontSize: "56px", marginBottom: "20px",
          animation: "bounce 1.2s ease-in-out infinite",
          display: "inline-block",
        }}>
          {msg.icon}
        </div>

        <h2 style={{
          color: "#1e293b", fontSize: "22px", fontWeight: "700", margin: "0 0 8px 0",
        }}>
          Generating Your Assessment
        </h2>

        <p style={{
          color: "#6366f1", fontSize: "15px", fontWeight: "600", margin: "0 0 6px 0",
          minHeight: "22px", transition: "opacity 0.3s ease",
        }}>
          {msg.text}
        </p>

        <p style={{ color: "#94a3b8", fontSize: "13px", margin: "0 0 28px 0" }}>
          AI is crafting 15 corporate communication questions{".".repeat(dots)}
        </p>

        {/* Progress bar */}
        <div style={{
          height: "8px", backgroundColor: "#eef2ff", borderRadius: "4px",
          overflow: "hidden", marginBottom: "16px",
        }}>
          <div style={{
            height: "100%", borderRadius: "4px", transition: "width 0.8s ease",
            width: `${progress}%`,
            background: "linear-gradient(90deg, #6366f1, #818cf8)",
          }} />
        </div>

        <p style={{ color: "#94a3b8", fontSize: "12px", margin: 0 }}>
          {Math.round(progress)}% — This typically takes 10–15 seconds
        </p>

        {/* CSS animations via style tag */}
        <style>{`
          @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-12px); }
          }
          @keyframes shimmer {
            0% { background-position: -200% 0; }
            100% { background-position: 200% 0; }
          }
        `}</style>
      </div>
    </div>
  );
};

const CommunicationTest = () => {
  const navigate = useNavigate();
  const [difficulty, setDifficulty] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Test data from GPT
  const [sessionId, setSessionId] = useState(null);
  const [passage, setPassage] = useState("");
  const [sections, setSections] = useState([]);
  const [totalQuestions, setTotalQuestions] = useState(0);

  // Test state
  const [testStarted, setTestStarted] = useState(false);
  const [currentSectionIdx, setCurrentSectionIdx] = useState(0);
  const [currentQIdx, setCurrentQIdx] = useState(0);
  const [answers, setAnswers] = useState({});
  const [timeLeft, setTimeLeft] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [testSubmitted, setTestSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState(null);
  const [showPassage, setShowPassage] = useState(false);

  const testContainerRef = useRef(null);
  const warningRef = useRef(null);

  // Speech recognition for spoken section
  const recognitionRef = useRef(null);
  const [isListening, setIsListening] = useState(false);
  const keepListeningRef = useRef(false);
  const pendingStopRef = useRef(false);
  const silenceTimeoutRef = useRef(null);
  const sectionQIdxRef = useRef({ s: 0, q: 0 });

  // Keep ref in sync so speech recognition callback always has latest indices
  useEffect(() => { sectionQIdxRef.current = { s: currentSectionIdx, q: currentQIdx }; }, [currentSectionIdx, currentQIdx]);

  // Init speech recognition ONCE
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      const rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.language = "en-US";

      rec.onstart = () => setIsListening(true);
      rec.onend = () => {
        if (pendingStopRef.current) { pendingStopRef.current = false; setIsListening(false); return; }
        if (keepListeningRef.current) {
          try { rec.start(); } catch (e) { console.error(e); }
        } else { setIsListening(false); }
      };
      rec.onresult = (event) => {
        let finalT = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) finalT += event.results[i][0].transcript + " ";
        }
        if (finalT) {
          const { s, q } = sectionQIdxRef.current;
          const key = `${s}-${q}`;
          setAnswers((prev) => ({ ...prev, [key]: (prev[key] || "") + finalT }));
        }
        if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
        silenceTimeoutRef.current = setTimeout(() => {
          if (!keepListeningRef.current) return;
          keepListeningRef.current = false; pendingStopRef.current = true;
          try { rec.stop(); } catch (e) {}
        }, 3000);
      };
      rec.onerror = (e) => console.error("SR error:", e.error);
      recognitionRef.current = rec;
    }
    return () => {
      if (recognitionRef.current) { try { recognitionRef.current.abort(); } catch (e) {} }
      if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
    };
  }, []);

  // Timer
  useEffect(() => {
    if (testStarted && timeLeft !== null && timeLeft > 0) {
      const t = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
      if (timeLeft === 60) showWarning("\u26a0\ufe0f 60 seconds remaining!");
      return () => clearTimeout(t);
    }
    if (testStarted && timeLeft === 0) handleSubmitTest();
  }, [testStarted, timeLeft]);

  // Tab switch detection
  useEffect(() => {
    if (!testStarted) return;
    const handler = () => {
      if (document.hidden) {
        setTabSwitchCount((p) => {
          const n = p + 1;
          showWarning(`\u26a0\ufe0f Tab switch detected! (${n}/5)`);
          if (n >= 5) { showWarning("\u274c Auto-submitted due to tab switches!"); setTimeout(() => handleSubmitTest(), 500); }
          return n;
        });
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [testStarted]);

  // Fullscreen
  useEffect(() => {
    const h = () => { setIsFullscreen(!!document.fullscreenElement); };
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);

  const requestFullscreen = async () => {
    try {
      const el = testContainerRef.current || document.documentElement;
      if (el.requestFullscreen) { await el.requestFullscreen(); setIsFullscreen(true); }
    } catch (e) { showWarning("Please enter fullscreen mode"); }
  };

  const showWarning = (msg) => {
    if (warningRef.current) {
      warningRef.current.textContent = msg;
      warningRef.current.style.display = "block";
      setTimeout(() => { if (warningRef.current) warningRef.current.style.display = "none"; }, 3000);
    }
  };

  const getQuestionKey = (sIdx, qIdx) => `${sIdx}-${qIdx}`;

  const formatTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec < 10 ? "0" : ""}${sec}`;
  };

  // Flatten questions for global navigation (memoized)
  const allQuestions = useMemo(() => {
    const result = [];
    sections.forEach((sec, sIdx) => {
      (sec.questions || []).forEach((q, qIdx) => {
        result.push({ ...q, sectionIdx: sIdx, questionIdx: qIdx, sectionName: sec.name, sectionType: sec.type });
      });
    });
    return result;
  }, [sections]);
  const globalIdx = allQuestions.findIndex((q) => q.sectionIdx === currentSectionIdx && q.questionIdx === currentQIdx);
  const currentQ = allQuestions[globalIdx] || null;

  // Generate test
  const startTest = async (level) => {
    setDifficulty(level);
    setLoading(true);
    setError("");
    try {
      const token = localStorage.getItem("mockmate_token");
      const res = await axios.post(
        `${API_BASE}/generate-comm-test`,
        { difficulty: level },
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, timeout: 60000 }
      );
      if (res.data.success && res.data.sections?.length) {
        setSessionId(res.data.session_id);
        setPassage(res.data.passage || "");
        setSections(res.data.sections);
        setTotalQuestions(res.data.total_questions || 15);
        setTimeLeft((res.data.total_questions || 15) * 90);
        setTestStarted(true);
        // Fullscreen after state is committed — non-blocking
        requestFullscreen();
      } else {
        setError("Failed to generate test — no questions returned. Please try again.");
        setDifficulty(null);
      }
    } catch (err) {
      console.error(err);
      const msg = err.code === "ECONNABORTED"
        ? "Request timed out — the server may be starting up. Please try again in 30 seconds."
        : err.response?.data?.detail || "Failed to generate communication test. Please try again.";
      setError(msg);
      setDifficulty(null);
    } finally {
      setLoading(false);
    }
  };

  const handleMCQAnswer = (optionLetter) => {
    const key = getQuestionKey(currentSectionIdx, currentQIdx);
    setAnswers((prev) => ({ ...prev, [key]: optionLetter }));
  };

  const handleOpenAnswer = (text) => {
    const key = getQuestionKey(currentSectionIdx, currentQIdx);
    setAnswers((prev) => ({ ...prev, [key]: text }));
  };

  const toggleMic = () => {
    if (!recognitionRef.current) { showWarning("Speech recognition not supported"); return; }
    if (isListening) {
      keepListeningRef.current = false; pendingStopRef.current = true;
      if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
      recognitionRef.current.stop(); setIsListening(false);
    } else {
      keepListeningRef.current = true; pendingStopRef.current = false;
      recognitionRef.current.start();
    }
  };

  const goNext = () => {
    if (globalIdx < allQuestions.length - 1) {
      const next = allQuestions[globalIdx + 1];
      setCurrentSectionIdx(next.sectionIdx);
      setCurrentQIdx(next.questionIdx);
    }
  };
  const goPrev = () => {
    if (globalIdx > 0) {
      const prev = allQuestions[globalIdx - 1];
      setCurrentSectionIdx(prev.sectionIdx);
      setCurrentQIdx(prev.questionIdx);
    }
  };

  const handleSubmitTest = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const token = localStorage.getItem("mockmate_token");
      const payload = allQuestions.map((q) => {
        const key = getQuestionKey(q.sectionIdx, q.questionIdx);
        const qType = q.type || (q.options ? "mcq" : "open");
        return {
          question_id: q.id,
          question: q.question,
          user_answer: answers[key] || "",
          correct_answer: q.correct_answer || "",
          section: q.sectionName,
          type: qType,
        };
      });
      const res = await axios.post(
        `${API_BASE}/submit-comm-test?session_id=${sessionId}`,
        { answers: payload, time_spent: timeLeft !== null ? (totalQuestions * 90 - timeLeft) : null },
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
      );
      if (res.data.success) setResults(res.data);
    } catch (err) {
      console.error("Submit error:", err);
    }
    if (document.fullscreenElement) document.exitFullscreen();
    setTestSubmitted(true);
    setSubmitting(false);
  };

  const answeredCount = Object.keys(answers).filter((k) => answers[k] && answers[k].toString().trim()).length;

  // ====== RENDER ======

  // Difficulty selection
  if (!difficulty && !loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#f5f3ff", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
        <div style={{ backgroundColor: "white", borderRadius: "12px", padding: "40px", maxWidth: "520px", boxShadow: "0 4px 24px rgba(99,102,241,0.10)", textAlign: "center" }}>
          <h1 style={{ fontSize: "32px", margin: "0 0 8px 0", color: "#1e293b" }}>
            {"\ud83d\udde3\ufe0f"} Communication Test
          </h1>
          <p style={{ color: "#64748b", marginBottom: "8px", lineHeight: "1.6" }}>
            Corporate-style assessment covering Reading, Email Writing, Grammar, Situational Communication & Spoken English.
          </p>
          <p style={{ color: "#94a3b8", fontSize: "13px", marginBottom: "32px" }}>
            {"\u2705"} No resume required {"\u2022"} 15 questions {"\u2022"} ~20 min
          </p>
          {error && (
            <p style={{ color: "#991b1b", backgroundColor: "#fee2e2", padding: "10px", borderRadius: "8px", marginBottom: "16px", fontSize: "14px" }}>{error}</p>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {["Easy", "Medium", "Hard"].map((level) => (
              <button
                key={level}
                onClick={() => startTest(level.toLowerCase())}
                style={{
                  padding: "16px", backgroundColor: "#6366f1", color: "white",
                  border: "none", borderRadius: "8px", cursor: "pointer",
                  fontSize: "16px", fontWeight: "600", transition: "all 0.3s ease",
                }}
                onMouseEnter={(e) => (e.target.style.backgroundColor = "#4f46e5")}
                onMouseLeave={(e) => (e.target.style.backgroundColor = "#6366f1")}
              >
                {level === "Easy" ? "\ud83d\ude42" : level === "Medium" ? "\ud83d\ude10" : "\ud83d\ude24"} {level}
              </button>
            ))}
          </div>
          <button
            onClick={() => navigate("/dashboard")}
            style={{
              marginTop: "20px", padding: "12px 24px", backgroundColor: "transparent",
              color: "#6366f1", border: "2px solid #6366f1", borderRadius: "8px",
              cursor: "pointer", fontSize: "14px", fontWeight: "600",
            }}
          >
            {"\u2190"} Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // Loading
  if (loading) {
    return <LoadingScreen />;
  }

  // Results
  if (testSubmitted) {
    const pct = results?.percentage || 0;
    const sectionScores = results?.section_scores || {};

    return (
      <div style={{ minHeight: "100vh", background: "#f5f3ff", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
        <div style={{ backgroundColor: "white", borderRadius: "12px", padding: "40px", maxWidth: "600px", width: "100%", boxShadow: "0 4px 24px rgba(99,102,241,0.10)", textAlign: "center" }}>
          <h1 style={{ fontSize: "40px", margin: "0 0 16px 0" }}>{"\u2705"}</h1>
          <h2 style={{ fontSize: "28px", margin: "0 0 8px 0", color: "#1e293b" }}>Test Complete!</h2>
          <p style={{ color: "#64748b", marginBottom: "24px" }}>Communication Skills Assessment</p>

          {/* Overall Score */}
          <div style={{
            backgroundColor: pct >= 80 ? "#d1fae5" : pct >= 60 ? "#fef3c7" : "#fee2e2",
            borderRadius: "12px", padding: "24px", marginBottom: "24px",
            border: `2px solid ${pct >= 80 ? "#6ee7b7" : pct >= 60 ? "#fcd34d" : "#fca5a5"}`,
          }}>
            <p style={{ margin: "0 0 8px 0", color: "#64748b", fontSize: "13px", fontWeight: "600" }}>Overall Score</p>
            <p style={{
              margin: 0, fontSize: "48px", fontWeight: "700",
              color: pct >= 80 ? "#065f46" : pct >= 60 ? "#92400e" : "#991b1b",
            }}>{pct}%</p>
            <p style={{ margin: "8px 0 0 0", fontSize: "14px", color: "#64748b" }}>
              {pct >= 80 ? "\ud83c\udf1f Excellent communicator!" : pct >= 60 ? "\ud83d\udc4d Good, room to improve" : "\ud83d\udcaa Keep practicing!"}
            </p>
          </div>

          {/* Section Breakdown */}
          <div style={{ textAlign: "left", marginBottom: "24px" }}>
            <h3 style={{ color: "#1e293b", fontSize: "16px", margin: "0 0 12px 0" }}>Section Breakdown</h3>
            {Object.entries(sectionScores).map(([sec, data]) => (
              <div key={sec} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #f1f5f9" }}>
                <span style={{ color: "#334155", fontSize: "14px", fontWeight: "500" }}>{sec}</span>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <div style={{ width: "100px", height: "8px", backgroundColor: "#e2e8f0", borderRadius: "4px", overflow: "hidden" }}>
                    <div style={{ width: `${data.percentage}%`, height: "100%", backgroundColor: data.percentage >= 80 ? "#10b981" : data.percentage >= 60 ? "#f59e0b" : "#ef4444", borderRadius: "4px" }} />
                  </div>
                  <span style={{ color: "#1e293b", fontWeight: "600", fontSize: "14px", minWidth: "40px", textAlign: "right" }}>{data.percentage}%</span>
                </div>
              </div>
            ))}
          </div>

          {/* Details */}
          <div style={{ backgroundColor: "#f5f3ff", borderRadius: "8px", padding: "16px", marginBottom: "24px", textAlign: "left" }}>
            <p style={{ margin: "6px 0", color: "#334155", fontSize: "14px" }}><strong>Difficulty:</strong> {difficulty ? difficulty.charAt(0).toUpperCase() + difficulty.slice(1) : "Medium"}</p>
            <p style={{ margin: "6px 0", color: "#334155", fontSize: "14px" }}><strong>Questions:</strong> {totalQuestions}</p>
            <p style={{ margin: "6px 0", color: tabSwitchCount > 0 ? "#dc2626" : "#334155", fontSize: "14px" }}><strong>Tab Switches:</strong> {tabSwitchCount}/5</p>
          </div>

          <button
            onClick={() => navigate("/dashboard")}
            style={{
              width: "100%", padding: "14px", backgroundColor: "#6366f1",
              color: "white", border: "none", borderRadius: "8px", cursor: "pointer",
              fontSize: "16px", fontWeight: "600", transition: "all 0.3s ease",
            }}
            onMouseEnter={(e) => (e.target.style.backgroundColor = "#4f46e5")}
            onMouseLeave={(e) => (e.target.style.backgroundColor = "#6366f1")}
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // Waiting for questions (edge case — shouldn't normally show)
  if (!testStarted || allQuestions.length === 0) {
    return <LoadingScreen />;
  }

  // ====== MAIN TEST UI ======
  const progress = ((globalIdx + 1) / allQuestions.length) * 100;
  const currentKey = getQuestionKey(currentSectionIdx, currentQIdx);
  const currentAnswer = answers[currentKey] || "";
  const qType = currentQ?.type || (currentQ?.options ? "mcq" : "open");
  const isSpoken = currentQ?.sectionName === "Spoken English";

  return (
    <div ref={testContainerRef} style={{ minHeight: "100vh", background: "#f5f3ff", padding: "20px" }}>
      {/* Warning */}
      <div ref={warningRef} style={{
        position: "fixed", top: "20px", right: "20px", backgroundColor: "#dc2626",
        color: "white", padding: "12px 16px", borderRadius: "8px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.3)", zIndex: 1000, display: "none",
        fontSize: "14px", fontWeight: "600",
      }} />

      {/* Header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: "20px", backgroundColor: "rgba(255,255,255,0.95)",
        padding: "16px 20px", borderRadius: "8px", boxShadow: "0 4px 12px rgba(99,102,241,0.08)",
      }}>
        <div>
          <h1 style={{ margin: 0, color: "#1e293b", fontSize: "20px" }}>
            {"\ud83d\udde3\ufe0f"} Communication Test - {difficulty ? difficulty.charAt(0).toUpperCase() + difficulty.slice(1) : ""}
          </h1>
          <p style={{ margin: "4px 0 0 0", color: "#64748b", fontSize: "13px" }}>
            Section: <strong>{currentQ?.sectionName}</strong> {"\u2022"} Question {globalIdx + 1} of {allQuestions.length}
          </p>
        </div>
        <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
          <div style={{ fontSize: "24px", fontWeight: "700", color: "#1e293b" }}>
            {"\u23f1\ufe0f"} {formatTime(timeLeft || 0)}
          </div>
          <button
            onClick={requestFullscreen}
            disabled={isFullscreen}
            style={{
              padding: "4px 10px", fontSize: "11px", fontWeight: "600",
              backgroundColor: isFullscreen ? "#22c55e" : "#6366f1",
              color: "white", border: "none", borderRadius: "6px",
              cursor: isFullscreen ? "default" : "pointer",
            }}
          >
            {isFullscreen ? "\u2705 Fullscreen" : "Enter Fullscreen"}
          </button>
          <p style={{ margin: 0, color: "#64748b", fontSize: "11px" }}>
            Answered: {answeredCount}/{allQuestions.length} {"\u2022"} Tab: {tabSwitchCount}/5
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div style={{
        backgroundColor: "white", borderRadius: "12px", padding: "32px",
        boxShadow: "0 20px 60px rgba(99,102,241,0.12)", maxWidth: "900px", margin: "0 auto",
      }}>
        {/* Progress */}
        <div style={{ marginBottom: "20px" }}>
          <div style={{ height: "6px", backgroundColor: "#eef2ff", borderRadius: "3px", overflow: "hidden" }}>
            <div style={{ height: "100%", backgroundColor: "#6366f1", width: `${progress}%`, transition: "width 0.3s ease" }} />
          </div>
        </div>

        {/* Section Badge */}
        <div style={{ marginBottom: "16px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {sections.map((sec, idx) => (
            <span key={idx} style={{
              padding: "4px 10px", borderRadius: "6px", fontSize: "11px", fontWeight: "600",
              backgroundColor: idx === currentSectionIdx ? "#6366f1" : "#f1f5f9",
              color: idx === currentSectionIdx ? "white" : "#64748b",
            }}>
              {sec.name}
            </span>
          ))}
        </div>

        {/* Reading passage toggle */}
        {currentQ?.sectionName === "Reading Comprehension" && passage && (
          <div style={{ marginBottom: "16px" }}>
            <button
              onClick={() => setShowPassage(!showPassage)}
              style={{
                padding: "8px 16px", backgroundColor: "#f0f4ff", color: "#6366f1",
                border: "1px solid #e0e7ff", borderRadius: "8px", cursor: "pointer",
                fontWeight: "600", fontSize: "13px",
              }}
            >
              {showPassage ? "\u25b2 Hide Passage" : "\u25bc Show Reading Passage"}
            </button>
            {showPassage && (
              <div style={{
                marginTop: "12px", padding: "16px", backgroundColor: "#f5f3ff",
                borderRadius: "8px", borderLeft: "4px solid #6366f1",
                color: "#334155", lineHeight: "1.7", fontSize: "14px",
              }}>
                {passage}
              </div>
            )}
          </div>
        )}

        {/* Email scenario */}
        {currentQ?.sectionName === "Email Writing" && sections[currentSectionIdx]?.scenario && (
          <div style={{
            marginBottom: "16px", padding: "14px", backgroundColor: "#fffbeb",
            borderRadius: "8px", borderLeft: "4px solid #f59e0b",
            color: "#92400e", fontSize: "14px", lineHeight: "1.6",
          }}>
            <strong>{"\ud83d\udce7"} Scenario:</strong> {sections[currentSectionIdx].scenario}
          </div>
        )}

        {/* Question */}
        <div style={{ marginBottom: "24px" }}>
          <h2 style={{ fontSize: "18px", color: "#1e293b", margin: "0 0 16px 0", lineHeight: "1.6" }}>
            {currentQ?.question}
          </h2>
        </div>

        {/* MCQ options */}
        {qType === "mcq" && currentQ?.options && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "24px" }}>
            {currentQ.options.map((opt, idx) => {
              const letter = opt.charAt(0);
              const isSelected = currentAnswer === letter;
              return (
                <button
                  key={idx}
                  onClick={() => handleMCQAnswer(letter)}
                  style={{
                    padding: "14px 16px", textAlign: "left",
                    backgroundColor: isSelected ? "#eef2ff" : "white",
                    border: isSelected ? "2px solid #6366f1" : "2px solid #e2e8f0",
                    borderRadius: "8px", cursor: "pointer", fontSize: "14px",
                    color: "#334155", fontWeight: isSelected ? "600" : "400",
                    transition: "all 0.2s ease",
                  }}
                  onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.borderColor = "#94a3b8"; }}
                  onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.borderColor = "#e2e8f0"; }}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        )}

        {/* Open-ended input */}
        {(qType === "open" || (!currentQ?.options && qType !== "mcq")) && (
          <div style={{ marginBottom: "24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <label style={{ fontWeight: "600", color: "#334155", fontSize: "14px" }}>Your Response:</label>
              {isSpoken && (
                <button
                  onClick={toggleMic}
                  style={{
                    padding: "8px 12px", fontSize: "12px", fontWeight: "600",
                    backgroundColor: isListening ? "#dc2626" : "#6366f1",
                    color: "white", border: "none", borderRadius: "6px",
                    cursor: "pointer", display: "flex", alignItems: "center", gap: "6px",
                  }}
                >
                  {isListening ? "\ud83d\udfe2 Stop Recording" : "\ud83c\udf99\ufe0f Speak Answer"}
                </button>
              )}
            </div>
            <textarea
              value={currentAnswer}
              onChange={(e) => handleOpenAnswer(e.target.value)}
              placeholder={isSpoken ? "Speak your answer or type it here..." : "Type your answer here..."}
              style={{
                width: "100%", height: "160px", padding: "12px",
                border: isListening ? "2px solid #dc2626" : "1px solid #e0e7ff",
                borderRadius: "8px", fontSize: "14px", fontFamily: "inherit",
                resize: "none", boxSizing: "border-box",
                backgroundColor: isListening ? "#fff5f5" : "white",
              }}
            />
            {isListening && (
              <div style={{ marginTop: "6px", padding: "6px 12px", backgroundColor: "#fee2e2", borderRadius: "6px", color: "#991b1b", fontSize: "12px", fontWeight: "600" }}>
                {"\ud83c\udf99\ufe0f"} Listening... Speak now!
              </div>
            )}
          </div>
        )}

        {/* Navigation */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
          <button
            onClick={goPrev}
            disabled={globalIdx === 0}
            style={{
              padding: "12px 20px",
              backgroundColor: globalIdx === 0 ? "#eef2ff" : "#6366f1",
              color: globalIdx === 0 ? "#94a3b8" : "white",
              border: "none", borderRadius: "8px", fontWeight: "600",
              cursor: globalIdx === 0 ? "not-allowed" : "pointer",
            }}
          >
            {"\u2190"} Previous
          </button>

          {globalIdx < allQuestions.length - 1 ? (
            <button
              onClick={goNext}
              style={{
                padding: "12px 20px", backgroundColor: "#6366f1", color: "white",
                border: "none", borderRadius: "8px", fontWeight: "600", cursor: "pointer",
              }}
              onMouseEnter={(e) => (e.target.style.backgroundColor = "#4f46e5")}
              onMouseLeave={(e) => (e.target.style.backgroundColor = "#6366f1")}
            >
              Next {"\u2192"}
            </button>
          ) : null}

          <button
            onClick={handleSubmitTest}
            disabled={submitting}
            style={{
              padding: "12px 20px",
              backgroundColor: submitting ? "#94a3b8" : "#059669",
              color: "white", border: "none", borderRadius: "8px",
              fontWeight: "600", cursor: submitting ? "not-allowed" : "pointer",
            }}
            onMouseEnter={(e) => { if (!submitting) e.target.style.backgroundColor = "#047857"; }}
            onMouseLeave={(e) => { if (!submitting) e.target.style.backgroundColor = "#059669"; }}
          >
            {submitting ? "\u23f3 Submitting..." : "\u2705 Submit Test"}
          </button>
        </div>

        {/* Question Navigator */}
        <div style={{ marginTop: "20px", paddingTop: "16px", borderTop: "1px solid #e5e7eb" }}>
          <p style={{ margin: "0 0 8px 0", color: "#94a3b8", fontSize: "11px", fontWeight: "600", textTransform: "uppercase" }}>
            Question Navigator
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {allQuestions.map((q, idx) => {
              const key = getQuestionKey(q.sectionIdx, q.questionIdx);
              const isAnswered = !!answers[key];
              const isCurrent = idx === globalIdx;
              return (
                <button
                  key={idx}
                  onClick={() => { setCurrentSectionIdx(q.sectionIdx); setCurrentQIdx(q.questionIdx); }}
                  style={{
                    width: "32px", height: "32px", borderRadius: "6px", fontSize: "12px",
                    fontWeight: "600", border: "none", cursor: "pointer",
                    backgroundColor: isCurrent ? "#6366f1" : isAnswered ? "#d1fae5" : "#f1f5f9",
                    color: isCurrent ? "white" : isAnswered ? "#065f46" : "#64748b",
                  }}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>
        </div>

        {/* Proctoring Info */}
        <div style={{
          marginTop: "16px", padding: "10px", backgroundColor: "#fef3c7",
          borderRadius: "8px", fontSize: "12px", color: "#92400e",
          borderLeft: "4px solid #f59e0b",
        }}>
          <strong>{"\ud83d\udd12"} Proctoring:</strong> {isFullscreen ? "\u2705 Fullscreen Active" : "\u26a0\ufe0f Not in Fullscreen"} {"\u2022"} Tab Switches: {tabSwitchCount}/5
        </div>
      </div>
    </div>
  );
};

export default CommunicationTest;
