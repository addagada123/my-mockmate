import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import LoadingPage from "./LoadingPage";

const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

// Import Test component but we'll use it differently
import Test from "./Test";

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
          background: "#f8fafc",
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
            boxShadow: "0 4px 24px rgba(0,0,0,0.1)",
          }}
        >
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>❌</div>
          <h2 style={{ color: "#dc2626", marginBottom: "16px" }}>Error</h2>
          <p style={{ color: "#666", marginBottom: "24px" }}>{error}</p>
          <button
            onClick={() => navigate("/dashboard")}
            style={{
              padding: "12px 24px",
              backgroundColor: "#0073e6",
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
  const [testSubmitted, setTestSubmitted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [timeLeft, setTimeLeft] = useState(questions.length * 60); // 1 min per question

  const currentQuestion = questions[currentQuestionIndex];
  const progress = ((currentQuestionIndex + 1) / questions.length) * 100;

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

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

  const handleAnswerChange = (value) => {
    setAnswers({
      ...answers,
      [currentQuestionIndex]: value,
    });
  };

  const submitTest = async () => {
    setTestSubmitted(true);
    // Here you would typically submit the answers to the backend
    // For now, just redirect to dashboard after 3 seconds
    setTimeout(() => {
      navigate("/dashboard");
    }, 3000);
  };

  if (testSubmitted) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#f8fafc",
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
            boxShadow: "0 4px 24px rgba(0,0,0,0.1)",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: "40px", margin: "0 0 16px 0" }}>✅</h1>
          <h2 style={{ fontSize: "28px", margin: "0 0 16px 0", color: "#1e293b" }}>
            Test Submitted!
          </h2>
          <p style={{ color: "#666", marginBottom: "24px" }}>
            Great job! Your answers have been recorded.
          </p>
          <button
            onClick={() => navigate("/dashboard")}
            style={{
              padding: "12px 24px",
              backgroundColor: "#0073e6",
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

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f8fafc",
        padding: "20px",
      }}
    >
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
          boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
        }}
      >
        <div>
          <h1 style={{ margin: 0, color: "#1e293b", fontSize: "20px" }}>
            {topic} - {difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}
          </h1>
          <p style={{ margin: "4px 0 0 0", color: "#666", fontSize: "13px" }}>
            Question {currentQuestionIndex + 1} of {questions.length}
          </p>
        </div>
        <div style={{ fontSize: "24px", fontWeight: "700", color: "#1e293b" }}>
          ⏱️ {formatTime(timeLeft || 0)}
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
              backgroundColor: "#e0f0ff",
              borderRadius: "3px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                backgroundColor: "#0073e6",
                width: `${progress}%`,
                transition: "width 0.3s ease",
              }}
            />
          </div>
        </div>

        {/* Question */}
        <div style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "20px", color: "#1e293b", margin: 0, lineHeight: "1.6" }}>
            {currentQuestion.question}
          </h2>
        </div>

        {/* Answer Input */}
        <div style={{ marginBottom: "32px" }}>
          <textarea
            value={answers[currentQuestionIndex] || ""}
            onChange={(e) => handleAnswerChange(e.target.value)}
            placeholder="Type your answer here..."
            style={{
              width: "100%",
              height: "200px",
              padding: "12px",
              border: "1px solid #cce0f5",
              borderRadius: "8px",
              fontSize: "14px",
              fontFamily: "monospace",
              resize: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Navigation Buttons */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
          <button
            onClick={() => setCurrentQuestionIndex(Math.max(0, currentQuestionIndex - 1))}
            disabled={currentQuestionIndex === 0}
            style={{
              padding: "12px 20px",
              backgroundColor: currentQuestionIndex === 0 ? "#e0f0ff" : "#0073e6",
              color: currentQuestionIndex === 0 ? "#999" : "white",
              border: "none",
              borderRadius: "8px",
              cursor: currentQuestionIndex === 0 ? "not-allowed" : "pointer",
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
                  ? "#e0f0ff"
                  : "#0073e6",
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
            style={{
              padding: "12px 20px",
              backgroundColor: "#059669",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
              fontWeight: "600",
            }}
          >
            ✅ Submit Test
          </button>
        </div>
      </div>
    </div>
  );
};

export default SectionTestWrapper;
