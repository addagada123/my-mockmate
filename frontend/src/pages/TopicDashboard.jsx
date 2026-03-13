import React, { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

const TopicDashboard = () => {
  const navigate = useNavigate();
  const { sessionId } = useParams();
  const [topics, setTopics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
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

        if (cancelled) return;
        if (response.data.success) {
          setTopics(response.data.topics || []);
        }
      } catch (err) {
        if (cancelled) return;
        console.error("Error fetching topics:", err);
        setError("Failed to load topics");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const handleSectionClick = (topic, difficulty) => {
    const base = `/test/${encodeURIComponent(topic)}?difficulty=${encodeURIComponent(difficulty)}&session_id=${encodeURIComponent(sessionId)}&mode=normal`;
    navigate(base);
  };

  const handleVRClick = (topic, difficulty) => {
    const base = `/test/${encodeURIComponent(topic)}?difficulty=${encodeURIComponent(difficulty)}&session_id=${encodeURIComponent(sessionId)}&mode=vr`;
    navigate(base);
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f3ff" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>Loading...</div>
          <p style={{ fontSize: "18px", color: "#666" }}>Loading your topics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f3ff", padding: "20px" }}>
        <div style={{ backgroundColor: "white", borderRadius: "12px", padding: "40px", textAlign: "center", maxWidth: "500px", boxShadow: "0 4px 24px rgba(99,102,241,0.08)" }}>
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>Error</div>
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

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg, #f5f3ff 0%, #ede9fe 30%, #f5f3ff 100%)", padding: "20px" }}>
      <div
        style={{
          background: "linear-gradient(135deg, #0f172a, #1e293b)",
          padding: "24px 28px",
          borderRadius: "16px",
          marginBottom: "24px",
          boxShadow: "0 8px 32px rgba(15, 23, 42, 0.25)",
        }}
      >
        <h1 style={{ margin: "0 0 8px 0", color: "#ffffff", fontSize: "28px", fontWeight: "800" }}>
          Select a Topic to Practice
        </h1>
        <p style={{ margin: 0, color: "#94a3b8", fontSize: "14px" }}>
          Choose a topic and difficulty level to start.
        </p>
        <div style={{ marginTop: "14px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button
            onClick={() => navigate("/dashboard")}
            style={{
              padding: "10px 14px",
              backgroundColor: "transparent",
              color: "#cbd5e1",
              border: "1px solid rgba(203,213,225,0.35)",
              borderRadius: "8px",
              cursor: "pointer",
              fontWeight: "600",
              fontSize: "13px",
            }}
          >
            Back
          </button>
        </div>
      </div>

      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        {topics && topics.length > 0 ? (
          topics.map((topic, index) => (
            <div
              key={index}
              style={{
                backgroundColor: "white",
                borderRadius: "16px",
                padding: "24px",
                marginBottom: "20px",
                boxShadow: "0 4px 16px rgba(99,102,241,0.06)",
                border: "1px solid rgba(99,102,241,0.08)",
                transition: "all 0.2s ease",
              }}
            >
              <h2 style={{ margin: "0 0 16px 0", color: "#1e293b", fontSize: "20px" }}>
                {topic}
              </h2>

              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", width: "100%" }}>
                  <div style={{ backgroundColor: "#f8fafc", padding: "16px", borderRadius: "12px", border: "1px solid #e2e8f0", flex: 1, minWidth: "250px" }}>
                    <h3 style={{ margin: "0 0 12px 0", fontSize: "16px", color: "#334155" }}>🟢 Easy Mode</h3>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        onClick={() => handleSectionClick(topic, "easy")}
                        style={{ padding: "10px 14px", backgroundColor: "#22c55e", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: "600", fontSize: "13px", flex: 1 }}
                      >
                        Normal Test
                      </button>
                      <button
                        onClick={() => handleVRClick(topic, "easy")}
                        style={{ padding: "10px 14px", backgroundColor: "#06b6d4", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: "600", fontSize: "13px", flex: 1 }}
                      >
                        Take Test in VR
                      </button>
                    </div>
                  </div>

                  <div style={{ backgroundColor: "#f8fafc", padding: "16px", borderRadius: "12px", border: "1px solid #e2e8f0", flex: 1, minWidth: "250px" }}>
                    <h3 style={{ margin: "0 0 12px 0", fontSize: "16px", color: "#334155" }}>🟡 Medium Mode</h3>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        onClick={() => handleSectionClick(topic, "medium")}
                        style={{ padding: "10px 14px", backgroundColor: "#f59e0b", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: "600", fontSize: "13px", flex: 1 }}
                      >
                        Normal Test
                      </button>
                      <button
                        onClick={() => handleVRClick(topic, "medium")}
                        style={{ padding: "10px 14px", backgroundColor: "#06b6d4", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: "600", fontSize: "13px", flex: 1 }}
                      >
                        Take Test in VR
                      </button>
                    </div>
                  </div>

                  <div style={{ backgroundColor: "#f8fafc", padding: "16px", borderRadius: "12px", border: "1px solid #e2e8f0", flex: 1, minWidth: "250px" }}>
                    <h3 style={{ margin: "0 0 12px 0", fontSize: "16px", color: "#334155" }}>🔴 Hard Mode</h3>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        onClick={() => handleSectionClick(topic, "hard")}
                        style={{ padding: "10px 14px", backgroundColor: "#ef4444", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: "600", fontSize: "13px", flex: 1 }}
                      >
                        Normal Test
                      </button>
                      <button
                        onClick={() => handleVRClick(topic, "hard")}
                        style={{ padding: "10px 14px", backgroundColor: "#06b6d4", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: "600", fontSize: "13px", flex: 1 }}
                      >
                        Take Test in VR
                      </button>
                    </div>
                  </div>

                   <div style={{ backgroundColor: "#f1f5f9", padding: "16px", borderRadius: "12px", border: "1px solid #e2e8f0", flex: 1, minWidth: "200px", display: "flex", flexDirection: "column", gap: "8px" }}>
                    <h3 style={{ margin: "0 0 12px 0", fontSize: "16px", color: "#334155" }}>⚡ Special Tests</h3>
                    <button
                      onClick={() => handleSectionClick(topic, "coding")}
                      style={{ padding: "12px 14px", backgroundColor: "#8b5cf6", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: "700", fontSize: "13px", flex: 1 }}
                    >
                      💻 Coding Test
                    </button>
                    <button
                      onClick={() => navigate("/communication-test")}
                      style={{ padding: "12px 14px", backgroundColor: "#06b6d4", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: "700", fontSize: "13px", flex: 1 }}
                    >
                      🗣️ Communication
                    </button>
                  </div>
                </div>
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
              boxShadow: "0 2px 8px rgba(99,102,241,0.06)",
            }}
          >
            <p style={{ color: "#999", fontSize: "16px" }}>No topics found. Upload a resume to get started.</p>
            <button
              onClick={() => navigate("/dashboard")}
              style={{
                marginTop: "16px",
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
        )}
      </div>
    </div>
  );
};

export default TopicDashboard;
