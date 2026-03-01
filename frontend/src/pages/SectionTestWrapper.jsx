import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import LoadingPage from "./LoadingPage";
import CodingQuestion from "./CodingQuestion";

const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

const SectionTestWrapper = () => {
  const { sessionId, topic, difficulty } = useParams();
  const navigate = useNavigate();
  const [questions, setQuestions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    generateQuestions();
  }, [sessionId, topic, difficulty]);

  const generateQuestions = async () => {
    try {
      const token = localStorage.getItem("mockmate_token");

      const response = await axios.post(
        `${API_BASE}/generate-section-questions?session_id=${encodeURIComponent(
          sessionId
        )}&topic=${encodeURIComponent(topic)}&difficulty=${encodeURIComponent(
          difficulty
        )}&num_questions=8`,
        {},
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.data.success) {
        setQuestions(response.data.questions);
        setLoading(false);
      } else {
        setError("Failed to generate questions");
        setLoading(false);
      }
    } catch (err) {
      console.error("Error generating questions:", err);
      setError(
        err.response?.data?.detail || "Failed to generate questions"
      );
      setLoading(false);
    }
  };

  if (error) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f5f3ff",
          padding: "20px",
        }}
      >
        <div
          style={{
            backgroundColor: "white",
            borderRadius: "12px",
            padding: "40px",
            textAlign: "center",
            maxWidth: "500px",
            boxShadow: "0 4px 24px rgba(99,102,241,0.08)",
          }}
        >
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>❌</div>
          <h2 style={{ color: "#dc2626", marginBottom: "16px" }}>Error</h2>
          <p style={{ color: "#666", marginBottom: "24px" }}>{error}</p>
          <button
            onClick={() => navigate("/dashboard")}
            style={{
              padding: "12px 24px",
              backgroundColor: "#6366f1",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
              fontWeight: "600",
            }}
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return <LoadingPage topic={topic} difficulty={difficulty} />;
  }

  if (questions && questions.length > 0) {
    // Return the Test component with pre-loaded questions
    return (
      <SectionTest
        questions={questions}
        topic={topic}
        difficulty={difficulty}
        sessionId={sessionId}
      />
    );
  }

  return null;
};

// Custom Test component adapted for section-based testing
const SectionTest = ({ questions, topic, difficulty, sessionId }) => {
  const navigate = useNavigate();
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [codingResults, setCodingResults] = useState({});
  const [testSubmitted, setTestSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [timeLeft, setTimeLeft] = useState(questions.length * 60); // 1 min per question
  const testContainerRef = useRef(null);
  const warningRef = useRef(null);

  const currentQuestion = questions[currentQuestionIndex];
  const isCodingSection = difficulty === "coding" || currentQuestion?.type === "coding";
  const progress = ((currentQuestionIndex + 1) / questions.length) * 100;

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  // Timer countdown
  useEffect(() => {
    if (timeLeft > 0 && !testSubmitted) {
      const timer = setTimeout(() => {
        setTimeLeft(timeLeft - 1);
      }, 1000);

      if (timeLeft === 0) {
        submitTest();
      }

      return () => clearTimeout(timer);
    }
  }, [timeLeft, testSubmitted]);

  // Tab switch detection
  useEffect(() => {
    const handler = () => {
      if (document.hidden) {
        setTabSwitchCount((prev) => {
          const next = prev + 1;
          showWarning(`⚠️ Tab switch detected! (${next}/5)`);
          if (next >= 5) {
            showWarning("❌ Auto-submitted due to tab switches!");
            setTimeout(() => submitTest(), 500);
          }
          return next;
        });
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  const showWarning = (msg) => {
    if (warningRef.current) {
      warningRef.current.textContent = msg;
      warningRef.current.style.display = "block";
      setTimeout(() => {
        if (warningRef.current) warningRef.current.style.display = "none";
      }, 3000);
    }
  };

  const handleAnswerChange = (value) => {
    setAnswers({
      ...answers,
      [currentQuestionIndex]: value,
    });
  };

  const handleCodingRunResult = (runResult) => {
    setCodingResults((prev) => ({
      ...prev,
      [currentQuestionIndex]: runResult,
    }));
  };

  const submitTest = async () => {
    if (submitting) return;
    setSubmitting(true);
    setTestSubmitted(true);

    const totalTimeSecs = questions.length * 60;
    const elapsed = totalTimeSecs - (timeLeft || 0);

    try {
      const token = localStorage.getItem("mockmate_token");

      const answersPayload = questions.map((q, idx) => {
        // For coding questions, use code result info as user_answer
        const codeResult = codingResults[idx];
        const userAnswer =
          q.type === "coding" && codeResult
            ? `[Code submitted] Score: ${codeResult.score}%, Passed: ${codeResult.passed}/${codeResult.total}`
            : answers[idx] || "";
        return {
          question: q.question,
          user_answer: userAnswer,
          correct_answer: q.answer || "",
        };
      });

      const resp = await axios.post(
        `${API_BASE}/submit-test`,
        {
          session_id: sessionId,
          answers: answersPayload,
          topic: decodeURIComponent(topic),
          difficulty: difficulty,
          time_spent: elapsed,
          tab_switches: tabSwitchCount,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (resp.data) {
        setSubmitResult(resp.data);
        localStorage.setItem("lastTestScore", resp.data.percentage ?? 0);
      }
    } catch (err) {
      console.error("Error submitting test:", err);
    } finally {
      setSubmitting(false);
      if (document.fullscreenElement) document.exitFullscreen();
    }
  };

  if (testSubmitted) {
    const pct = submitResult?.percentage ?? 0;
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#f5f3ff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px",
        }}
      >
        <div
          style={{
            backgroundColor: "white",
            borderRadius: "12px",
            padding: "40px",
            maxWidth: "500px",
            boxShadow: "0 4px 24px rgba(99,102,241,0.08)",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: "40px", margin: "0 0 16px 0" }}>✅</h1>
          <h2 style={{ fontSize: "28px", margin: "0 0 16px 0", color: "#1e293b" }}>
            Test Submitted!
          </h2>
          {submitResult && (
            <div
              style={{
                backgroundColor: pct >= 70 ? "#d1fae5" : pct >= 40 ? "#fef3c7" : "#fee2e2",
                borderRadius: "12px",
                padding: "20px",
                marginBottom: "20px",
              }}
            >
              <p style={{ margin: "0 0 6px 0", color: "#64748b", fontSize: "13px" }}>Score</p>
              <p
                style={{
                  margin: 0,
                  fontSize: "42px",
                  fontWeight: "700",
                  color: pct >= 70 ? "#065f46" : pct >= 40 ? "#92400e" : "#991b1b",
                }}
              >
                {Math.round(pct)}%
              </p>
            </div>
          )}
          <div
            style={{
              backgroundColor: "#f5f3ff",
              borderRadius: "8px",
              padding: "12px",
              marginBottom: "20px",
              textAlign: "left",
            }}
          >
            <p style={{ margin: "4px 0", color: "#334155", fontSize: "14px" }}>
              <strong>Topic:</strong> {decodeURIComponent(topic)}
            </p>
            <p style={{ margin: "4px 0", color: "#334155", fontSize: "14px" }}>
              <strong>Difficulty:</strong>{" "}
              {difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}
            </p>
            <p
              style={{
                margin: "4px 0",
                color: tabSwitchCount > 0 ? "#dc2626" : "#334155",
                fontSize: "14px",
              }}
            >
              <strong>Tab Switches:</strong> {tabSwitchCount}/5
            </p>
          </div>
          <p style={{ color: "#666", marginBottom: "24px" }}>
            Great job! Your answers have been recorded.
          </p>
          <button
            onClick={() => navigate("/dashboard")}
            style={{
              padding: "12px 24px",
              backgroundColor: "#6366f1",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
              fontWeight: "600",
              width: "100%",
            }}
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={testContainerRef}
      style={{
        minHeight: "100vh",
        background: "#f5f3ff",
        padding: "20px",
      }}
    >
      {/* Warning Banner */}
      <div
        ref={warningRef}
        style={{
          display: "none",
          position: "fixed",
          top: "12px",
          left: "50%",
          transform: "translateX(-50%)",
          backgroundColor: "#fef3c7",
          color: "#92400e",
          padding: "10px 24px",
          borderRadius: "8px",
          fontWeight: "600",
          fontSize: "14px",
          zIndex: 9999,
          boxShadow: "0 4px 12px rgba(99,102,241,0.12)",
        }}
      />

      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "20px",
          backgroundColor: "rgba(255,255,255,0.95)",
          padding: "16px 20px",
          borderRadius: "8px",
          boxShadow: "0 4px 12px rgba(99,102,241,0.08)",
        }}
      >
        <div>
          <h1 style={{ margin: 0, color: "#1e293b", fontSize: "20px" }}>
            {decodeURIComponent(topic)} -{" "}
            {difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}
          </h1>
          <p style={{ margin: "4px 0 0 0", color: "#666", fontSize: "13px" }}>
            Question {currentQuestionIndex + 1} of {questions.length}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          {tabSwitchCount > 0 && (
            <span style={{ color: "#dc2626", fontWeight: "600", fontSize: "13px" }}>
              ⚠️ Tab switches: {tabSwitchCount}/5
            </span>
          )}
          <div style={{ fontSize: "24px", fontWeight: "700", color: "#1e293b" }}>
            ⏱️ {formatTime(timeLeft || 0)}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div
        style={{
          backgroundColor: "white",
          borderRadius: "12px",
          padding: "32px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
          maxWidth: "1000px",
          margin: "0 auto",
        }}
      >
        {/* Progress Bar */}
        <div style={{ marginBottom: "24px" }}>
          <div
            style={{
              height: "6px",
              backgroundColor: "#eef2ff",
              borderRadius: "3px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                backgroundColor: "#6366f1",
                width: `${progress}%`,
                transition: "width 0.3s ease",
              }}
            />
          </div>
        </div>

        {/* Question */}
        <div style={{ marginBottom: "24px" }}>
          <h2
            style={{
              fontSize: "20px",
              color: "#1e293b",
              margin: 0,
              lineHeight: "1.6",
            }}
          >
            {currentQuestion.question}
          </h2>
        </div>

        {/* Answer Input — Coding or Text */}
        <div style={{ marginBottom: "32px" }}>
          {isCodingSection ? (
            <CodingQuestion
              question={currentQuestion}
              initialCode={answers[currentQuestionIndex] || ""}
              onCodeChange={(val) => handleAnswerChange(val)}
              onRunResult={handleCodingRunResult}
            />
          ) : (
            <textarea
              value={answers[currentQuestionIndex] || ""}
              onChange={(e) => handleAnswerChange(e.target.value)}
              placeholder="Type your answer here..."
              style={{
                width: "100%",
                height: "200px",
                padding: "12px",
                border: "1px solid #e0e7ff",
                borderRadius: "8px",
                fontSize: "14px",
                fontFamily: "monospace",
                resize: "none",
                boxSizing: "border-box",
              }}
            />
          )}
        </div>

        {/* Navigation Buttons */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "12px",
          }}
        >
          <button
            onClick={() =>
              setCurrentQuestionIndex(Math.max(0, currentQuestionIndex - 1))
            }
            disabled={currentQuestionIndex === 0}
            style={{
              padding: "12px 20px",
              backgroundColor:
                currentQuestionIndex === 0 ? "#eef2ff" : "#6366f1",
              color: currentQuestionIndex === 0 ? "#999" : "white",
              border: "none",
              borderRadius: "8px",
              cursor:
                currentQuestionIndex === 0 ? "not-allowed" : "pointer",
              fontWeight: "600",
            }}
          >
            ← Previous
          </button>

          <button
            onClick={() =>
              setCurrentQuestionIndex(
                Math.min(questions.length - 1, currentQuestionIndex + 1)
              )
            }
            disabled={currentQuestionIndex === questions.length - 1}
            style={{
              padding: "12px 20px",
              backgroundColor:
                currentQuestionIndex === questions.length - 1
                  ? "#eef2ff"
                  : "#6366f1",
              color:
                currentQuestionIndex === questions.length - 1
                  ? "#999"
                  : "white",
              border: "none",
              borderRadius: "8px",
              cursor:
                currentQuestionIndex === questions.length - 1
                  ? "not-allowed"
                  : "pointer",
              fontWeight: "600",
            }}
          >
            Next →
          </button>

          <button
            onClick={submitTest}
            disabled={submitting}
            style={{
              padding: "12px 20px",
              backgroundColor: submitting ? "#94a3b8" : "#059669",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: submitting ? "not-allowed" : "pointer",
              fontWeight: "600",
            }}
          >
            {submitting ? "⏳ Submitting..." : "✅ Submit Test"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SectionTestWrapper;
