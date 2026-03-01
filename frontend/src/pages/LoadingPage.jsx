import React, { useEffect, useState } from "react";

const LoadingPage = ({ topic, difficulty, message = "Generating questions..." }) => {
  const [dots, setDots] = useState("");

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev.length < 3 ? prev + "." : ""));
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const getDifficultyEmoji = () => {
    switch (difficulty?.toLowerCase()) {
      case "easy":
        return "🟢";
      case "medium":
        return "🟡";
      case "hard":
        return "🔴";
      case "coding":
        return "💻";
      default:
        return "📝";
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
        padding: "20px",
      }}
    >
      <div
        style={{
          textAlign: "center",
          backgroundColor: "white",
          borderRadius: "20px",
          padding: "60px 40px",
          boxShadow: "0 20px 60px rgba(99,102,241,0.25)",
          maxWidth: "500px",
        }}
      >
        {/* Animated Icon */}
        <div
          style={{
            fontSize: "80px",
            marginBottom: "24px",
            animation: "bounce 2s infinite",
            display: "inline-block",
          }}
        >
          {getDifficultyEmoji()}
        </div>

        {/* Loading Text */}
        <h1 style={{ margin: "0 0 8px 0", color: "#1e293b", fontSize: "28px" }}>
          {message}
          <span style={{ color: "#6366f1" }}>{dots}</span>
        </h1>

        {/* Topic Info */}
        <p style={{ margin: "16px 0 0 0", color: "#666", fontSize: "16px" }}>
          Preparing <strong>{topic}</strong> ({difficulty}) questions
        </p>

        {/* Progress Bar */}
        <div style={{ marginTop: "40px" }}>
          <div
            style={{
              height: "4px",
              backgroundColor: "#e0e7ff",
              borderRadius: "2px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                backgroundColor: "#6366f1",
                borderRadius: "2px",
                animation: "progress 2s ease-in-out infinite",
                width: "100%",
              }}
            />
          </div>
        </div>

        {/* Helpful Tips */}
        <div
          style={{
            marginTop: "40px",
            padding: "16px",
            backgroundColor: "#eef2ff",
            borderRadius: "12px",
            borderLeft: "4px solid #6366f1",
          }}
        >
          <p style={{ margin: 0, color: "#666", fontSize: "13px", lineHeight: "1.6" }}>
            💡 <strong>Tip:</strong> We're customizing questions based on your resume. This typically takes 5-10 seconds.
          </p>
        </div>
      </div>

      {/* Keyframes */}
      <style>{`
        @keyframes bounce {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-20px);
          }
        }
        @keyframes progress {
          0% {
            width: 0%;
          }
          50% {
            width: 100%;
          }
          100% {
            width: 0%;
          }
        }
      `}</style>
    </div>
  );
};

export default LoadingPage;
