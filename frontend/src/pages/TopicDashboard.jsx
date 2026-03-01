import React, { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

const TopicDashboard = () => {
  const navigate = useNavigate();
  const { sessionId } = useParams();
  const [topics, setTopics] = useState([]);
  const [languages, setLanguages] = useState([]);
  const [experience, setExperience] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedTopic, setSelectedTopic] = useState(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState(null);

  useEffect(() => {
    fetchSessionTopics();
  }, [sessionId]);

  const fetchSessionTopics = async () => {
    try {
      const token = localStorage.getItem("mockmate_token");
      const response = await axios.get(
        `${API_BASE}/get-session-topics?session_id=${encodeURIComponent(sessionId)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.data.success) {
        setTopics(response.data.topics || []);
        setLanguages(response.data.detected_languages || []);
        setExperience(response.data.experience || "");
      }
      setLoading(false);
    } catch (err) {
      console.error("Error fetching topics:", err);
      setError("Failed to load topics");
      setLoading(false);
    }
  };

  const handleSectionClick = (topic, difficulty) => {
    setSelectedTopic(topic);
    setSelectedDifficulty(difficulty);
    // Navigate to section test wrapper which will show loading page
    navigate(
      `/section-test/${encodeURIComponent(sessionId)}/${encodeURIComponent(
        topic
      )}/${encodeURIComponent(difficulty)}`
    );
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>⏳</div>
          <p style={{ fontSize: "18px", color: "#666" }}>Loading your topics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc", padding: "20px" }}>
        <div style={{ backgroundColor: "white", borderRadius: "12px", padding: "40px", textAlign: "center", maxWidth: "500px", boxShadow: "0 4px 24px rgba(0,0,0,0.1)" }}>
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

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", padding: "20px" }}>
      {/* Header */}
      <div
        style={{
          backgroundColor: "white",
          padding: "24px",
          borderRadius: "12px",
          marginBottom: "24px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
        }}
      >
        <h1 style={{ margin: "0 0 8px 0", color: "#1e293b", fontSize: "28px" }}>
          📚 Select a Topic to Practice
        </h1>
        <p style={{ margin: 0, color: "#666", fontSize: "14px" }}>
          Choose a topic and difficulty level to generate interview questions
        </p>
      </div>

      {/* Topics Grid */}
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        {topics && topics.length > 0 ? (
          topics.map((topic, index) => (
            <div
              key={index}
              style={{
                backgroundColor: "white",
                borderRadius: "12px",
                padding: "24px",
                marginBottom: "20px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                border: "1px solid #e2e8f0",
              }}
            >
              {/* Topic Title */}
              <h2 style={{ margin: "0 0 16px 0", color: "#1e293b", fontSize: "20px" }}>
                🎯 {topic}
              </h2>

              {/* Section Buttons */}
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                {/* Coding Section (if languages detected) */}
                {languages && languages.length > 0 && (
                  <button
                    onClick={() => handleSectionClick(topic, "coding")}
                    disabled={selectedTopic === topic && selectedDifficulty === "coding"}
                    style={{
                      padding: "12px 20px",
                      backgroundColor:
                        selectedTopic === topic && selectedDifficulty === "coding"
                          ? "#7c3aed"
                          : "#8b5cf6",
                      color: "white",
                      border: "none",
                      borderRadius: "8px",
                      cursor: "pointer",
                      fontWeight: "600",
                      fontSize: "14px",
                      transition: "all 0.3s ease",
                      opacity:
                        selectedTopic === topic && selectedDifficulty === "coding"
                          ? 0.9
                          : 1,
                    }}
                    onMouseEnter={(e) => {
                      if (!(selectedTopic === topic && selectedDifficulty === "coding")) {
                        e.target.style.backgroundColor = "#7c3aed";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!(selectedTopic === topic && selectedDifficulty === "coding")) {
                        e.target.style.backgroundColor = "#8b5cf6";
                      }
                    }}
                  >
                    💻 Coding
                  </button>
                )}

                {/* Easy Section */}
                <button
                  onClick={() => handleSectionClick(topic, "easy")}
                  disabled={selectedTopic === topic && selectedDifficulty === "easy"}
                  style={{
                    padding: "12px 20px",
                    backgroundColor:
                      selectedTopic === topic && selectedDifficulty === "easy"
                        ? "#16a34a"
                        : "#22c55e",
                    color: "white",
                    border: "none",
                    borderRadius: "8px",
                    cursor: "pointer",
                    fontWeight: "600",
                    fontSize: "14px",
                    transition: "all 0.3s ease",
                    opacity:
                      selectedTopic === topic && selectedDifficulty === "easy" ? 0.9 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!(selectedTopic === topic && selectedDifficulty === "easy")) {
                      e.target.style.backgroundColor = "#16a34a";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!(selectedTopic === topic && selectedDifficulty === "easy")) {
                      e.target.style.backgroundColor = "#22c55e";
                    }
                  }}
                >
                  🟢 Easy
                </button>

                {/* Medium Section */}
                <button
                  onClick={() => handleSectionClick(topic, "medium")}
                  disabled={selectedTopic === topic && selectedDifficulty === "medium"}
                  style={{
                    padding: "12px 20px",
                    backgroundColor:
                      selectedTopic === topic && selectedDifficulty === "medium"
                        ? "#b45309"
                        : "#f59e0b",
                    color: "white",
                    border: "none",
                    borderRadius: "8px",
                    cursor: "pointer",
                    fontWeight: "600",
                    fontSize: "14px",
                    transition: "all 0.3s ease",
                    opacity:
                      selectedTopic === topic && selectedDifficulty === "medium"
                        ? 0.9
                        : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!(selectedTopic === topic && selectedDifficulty === "medium")) {
                      e.target.style.backgroundColor = "#b45309";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!(selectedTopic === topic && selectedDifficulty === "medium")) {
                      e.target.style.backgroundColor = "#f59e0b";
                    }
                  }}
                >
                  🟡 Medium
                </button>

                {/* Hard Section */}
                <button
                  onClick={() => handleSectionClick(topic, "hard")}
                  disabled={selectedTopic === topic && selectedDifficulty === "hard"}
                  style={{
                    padding: "12px 20px",
                    backgroundColor:
                      selectedTopic === topic && selectedDifficulty === "hard"
                        ? "#b91c1c"
                        : "#ef4444",
                    color: "white",
                    border: "none",
                    borderRadius: "8px",
                    cursor: "pointer",
                    fontWeight: "600",
                    fontSize: "14px",
                    transition: "all 0.3s ease",
                    opacity:
                      selectedTopic === topic && selectedDifficulty === "hard" ? 0.9 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!(selectedTopic === topic && selectedDifficulty === "hard")) {
                      e.target.style.backgroundColor = "#b91c1c";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!(selectedTopic === topic && selectedDifficulty === "hard")) {
                      e.target.style.backgroundColor = "#ef4444";
                    }
                  }}
                >
                  🔴 Hard
                </button>
              </div>
            </div>
          ))
        ) : (
          <div
            style={{
              backgroundColor: "white",
              borderRadius: "12px",
              padding: "40px",
              textAlign: "center",
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            }}
          >
            <p style={{ color: "#999", fontSize: "16px" }}>No topics found. Upload a resume to get started.</p>
            <button
              onClick={() => navigate("/dashboard")}
              style={{
                marginTop: "16px",
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
        )}
      </div>

      {/* Back Button */}
      <div style={{ textAlign: "center", marginTop: "40px" }}>
        <button
          onClick={() => navigate("/dashboard")}
          style={{
            padding: "12px 24px",
            backgroundColor: "transparent",
            color: "#0073e6",
            border: "2px solid #0073e6",
            borderRadius: "8px",
            cursor: "pointer",
            fontWeight: "600",
            transition: "all 0.3s ease",
          }}
          onMouseEnter={(e) => {
            e.target.backgroundColor = "#0073e6";
            e.target.color = "white";
          }}
          onMouseLeave={(e) => {
            e.target.backgroundColor = "transparent";
            e.target.color = "#0073e6";
          }}
        >
          ← Back to Dashboard
        </button>
      </div>
    </div>
  );
};

export default TopicDashboard;
