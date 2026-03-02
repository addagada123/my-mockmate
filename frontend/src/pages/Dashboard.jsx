import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import mockmateLogoVideo from "../assets/mockmate-logo.mp4";

const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

function Dashboard() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const user = JSON.parse(localStorage.getItem("mockmate_user"));
  const [expandedTopics, setExpandedTopics] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState(null);
  const [resumeQuestions, setResumeQuestions] = useState([]);
  const [generatedTopics, setGeneratedTopics] = useState([]);
  const [uploadingResume, setUploadingResume] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  // Removed fixed fallback topics; topics are fully dynamic from resume

  const toggleTopic = () => setExpandedTopics(!expandedTopics);

  // Fetch user's stored topics and questions on component mount
  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const token = localStorage.getItem("mockmate_token");
        const response = await axios.get(
          `${API_BASE}/user-session`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (response.data.success) {
          const questions = response.data.questions || [];
          const topics = response.data.topicsDetected || [];
          
          setResumeQuestions(questions);
          setGeneratedTopics(topics);
        }
      } catch (error) {
        // Silently handle error - user may not have uploaded resume yet
        console.log("No existing user session data");
      }
    };

    fetchUserData();
  }, []);

  const handleResumeUpload = (event) => {
    // Delegate to the unified handler
    handleFileSelected(event);
  };

  const handleTopicClick = (topic) => {
    setSelectedTopic(topic);
    // Navigate to proctored test page with topic
    navigate(`/test/${encodeURIComponent(topic)}`);
  };

  const handleRegenerate = async () => {
    // Re-upload the last resume with force_regenerate=true
    // We need the user to pick their file again (browser security prevents re-using file refs)
    setRegenerating(true);
    setUploadMessage("🔄 Pick your resume again to generate fresh questions...");
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      if (regenerating) setRegenerating(false);
      return;
    }

    if (file.type !== "application/pdf") {
      setUploadMessage("❌ Only PDF files are supported");
      setRegenerating(false);
      return;
    }

    const isRegen = regenerating;
    setUploadingResume(true);
    setUploadMessage(isRegen ? "🔄 Regenerating fresh questions..." : "📤 Uploading resume...");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const token = localStorage.getItem("mockmate_token");
      const url = isRegen
        ? `${API_BASE}/upload-resume?force_regenerate=true`
        : `${API_BASE}/upload-resume`;

      const response = await axios.post(url, formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "multipart/form-data",
        },
      });

      if (response.data.success) {
        const topics = response.data.topicsDetected || [];
        const sessionId = response.data.session_id;

        setUploadMessage(
          isRegen
            ? `🔄 Regenerated! ${response.data.message}`
            : `✅ ${response.data.message}`
        );

        setShowSuccessModal(true);

        // Redirect to TopicDashboard after 1.5 seconds
        setTimeout(() => {
          navigate(`/topic-dashboard/${encodeURIComponent(sessionId)}`);
        }, 1500);
      }
    } catch (error) {
      setUploadMessage(
        `❌ Error: ${error.response?.data?.detail || error.message}`
      );
    } finally {
      setUploadingResume(false);
      setRegenerating(false);
    }
  };

  const handleLogout = () => {
    localStorage.clear();
    navigate("/signin");
  };

  // Get questions for selected topic
  const topicQuestions = selectedTopic
    ? resumeQuestions.filter((q) => q.topic === selectedTopic)
    : [];

  const displayTopics = generatedTopics;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #f5f3ff 0%, #ede9fe 30%, #f5f3ff 100%)",
        padding: "24px",
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "24px",
            background: "linear-gradient(135deg, #0f172a, #1e293b)",
            padding: "20px 28px",
            borderRadius: "16px",
            boxShadow: "0 8px 32px rgba(15, 23, 42, 0.25)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <video
                src={mockmateLogoVideo}
                autoPlay
                loop
                muted
                playsInline
                style={{ width: '48px', height: '48px', objectFit: 'contain', mixBlendMode: 'screen', borderRadius: '10px' }}
              />
              <span style={{ fontSize: "24px", fontWeight: "800", background: "linear-gradient(135deg, #818cf8, #c084fc)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Mockmate</span>
            </div>
            <div style={{ width: "1px", height: "36px", backgroundColor: "rgba(255,255,255,0.15)" }}></div>
            <div>
              <h1 style={{ margin: 0, fontSize: "22px", color: "#ffffff", fontWeight: "700" }}>
                Practice Dashboard
              </h1>
              <p style={{ margin: "4px 0 0 0", color: "#94a3b8", fontSize: "14px" }}>
                Welcome, {user?.full_name ? user.full_name.split(" ")[0] : user?.email?.split("@")[0]}
              </p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            style={{
              padding: "10px 20px",
              background: "rgba(255,255,255,0.1)",
              color: "#e0e7ff",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: "10px",
              cursor: "pointer",
              fontWeight: "600",
              fontSize: "13px",
              transition: "all 0.3s ease",
              backdropFilter: "blur(8px)",
            }}
            onMouseEnter={(e) => { e.target.style.background = "rgba(255,255,255,0.2)"; e.target.style.color = "#fff"; }}
            onMouseLeave={(e) => { e.target.style.background = "rgba(255,255,255,0.1)"; e.target.style.color = "#e0e7ff"; }}
          >
            Sign Out
          </button>
        </div>

        {/* Main Content - 2 Column SaaS Layout */}
        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "24px" }}>
          {/* Left Sidebar */}
          <div style={{ background: "linear-gradient(180deg, #0f172a, #1e293b)", borderRadius: "16px", padding: "24px", boxShadow: "0 8px 32px rgba(15, 23, 42, 0.2)", height: "fit-content" }}>
            <h2 style={{ fontSize: "16px", margin: "0 0 20px 0", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "1px", fontWeight: "600" }}>
              Navigation
            </h2>

            {/* Topics Section */}
            <div style={{ marginBottom: "16px" }}>
              <button
                onClick={toggleTopic}
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  textAlign: "left",
                  backgroundColor: expandedTopics ? "rgba(99, 102, 241, 0.2)" : "rgba(255,255,255,0.05)",
                  border: expandedTopics ? "1px solid rgba(99, 102, 241, 0.4)" : "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "10px",
                  cursor: "pointer",
                  fontWeight: "600",
                  color: expandedTopics ? "#818cf8" : "#cbd5e1",
                  fontSize: "14px",
                  transition: "all 0.2s ease",
                }}>
                {expandedTopics ? "▼" : "▶"} Topics
              </button>
              {expandedTopics && (
                <div style={{ marginTop: "8px", paddingLeft: "12px" }}>
                  {displayTopics.map((topic, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleTopicClick(topic)}
                      style={{
                        display: "block",
                        width: "100%",
                        padding: "8px 10px",
                        textAlign: "left",
                        backgroundColor: "transparent",
                        border: "none",
                        borderRadius: "6px",
                        cursor: "pointer",
                        color: "#94a3b8",
                        fontSize: "13px",
                        marginBottom: "2px",
                        transition: "all 0.2s ease",
                        fontWeight: generatedTopics.includes(topic) ? "600" : "400",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(99,102,241,0.15)"; e.currentTarget.style.color = "#c7d2fe"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "#94a3b8"; }}
                    >
                      • {topic} {generatedTopics.includes(topic) ? "⭐" : ""}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Navigation Buttons */}
            <div style={{ marginTop: "24px", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "20px", display: "flex", flexDirection: "column", gap: "8px" }}>
              <button
                onClick={() => navigate("/performance")}
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                  color: "white",
                  border: "none",
                  borderRadius: "10px",
                  cursor: "pointer",
                  fontSize: "13px",
                  fontWeight: "600",
                  transition: "all 0.3s ease",
                  boxShadow: "0 4px 12px rgba(99, 102, 241, 0.3)",
                }}
                onMouseEnter={(e) => { e.target.style.transform = "translateY(-1px)"; e.target.style.boxShadow = "0 6px 20px rgba(99, 102, 241, 0.4)"; }}
                onMouseLeave={(e) => { e.target.style.transform = "translateY(0)"; e.target.style.boxShadow = "0 4px 12px rgba(99, 102, 241, 0.3)"; }}
              >
                📊 Performance
              </button>
              <button
                onClick={() => navigate("/communication-test")}
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  background: "linear-gradient(135deg, #06b6d4, #14b8a6)",
                  color: "white",
                  border: "none",
                  borderRadius: "10px",
                  cursor: "pointer",
                  fontSize: "13px",
                  fontWeight: "600",
                  transition: "all 0.3s ease",
                  boxShadow: "0 4px 12px rgba(6, 182, 212, 0.3)",
                }}
                onMouseEnter={(e) => { e.target.style.transform = "translateY(-1px)"; e.target.style.boxShadow = "0 6px 20px rgba(6, 182, 212, 0.4)"; }}
                onMouseLeave={(e) => { e.target.style.transform = "translateY(0)"; e.target.style.boxShadow = "0 4px 12px rgba(6, 182, 212, 0.3)"; }}
              >
                {"\ud83d\udde3\ufe0f"} Communication Test
              </button>
              <button
                onClick={() => navigate("/jobs")}
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  background: "linear-gradient(135deg, #f97316, #f59e0b)",
                  color: "white",
                  border: "none",
                  borderRadius: "10px",
                  cursor: "pointer",
                  fontSize: "13px",
                  fontWeight: "600",
                  transition: "all 0.3s ease",
                  boxShadow: "0 4px 12px rgba(245, 158, 11, 0.3)",
                }}
                onMouseEnter={(e) => { e.target.style.transform = "translateY(-1px)"; e.target.style.boxShadow = "0 6px 20px rgba(245, 158, 11, 0.4)"; }}
                onMouseLeave={(e) => { e.target.style.transform = "translateY(0)"; e.target.style.boxShadow = "0 4px 12px rgba(245, 158, 11, 0.3)"; }}
              >
                💼 Jobs
              </button>
            </div>
          </div>

          {/* Right Panel - Welcome / Resume Upload */}
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            {/* Welcome Card */}
            <div style={{
              background: "linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.06))",
              borderRadius: "16px",
              padding: "36px",
              boxShadow: "0 4px 16px rgba(99, 102, 241, 0.06)",
              border: "1px solid rgba(99, 102, 241, 0.1)",
              position: "relative",
              overflow: "hidden",
            }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "4px", background: "linear-gradient(135deg, #6366f1, #8b5cf6, #06b6d4)" }} />
              <h2 style={{ fontSize: "32px", margin: "0 0 12px 0", color: "#1e1b4b", fontWeight: "800" }}>
                👋 Welcome Back!
              </h2>
              <p style={{ fontSize: "16px", color: "#475569", lineHeight: "1.7", margin: 0, maxWidth: "600px" }}>
                Ready to ace your interview? Upload your resume to get personalized questions based on your skills, or start with any topic.
              </p>
              <div style={{ marginTop: "24px", display: "flex", gap: "20px" }}>
                <div style={{ flex: 1, background: "rgba(255,255,255,0.7)", borderRadius: "12px", padding: "16px", border: "1px solid rgba(99,102,241,0.1)" }}>
                  <p style={{ fontSize: "12px", color: "#94a3b8", margin: "0 0 6px 0", textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: "600" }}>Topics Available</p>
                  <p style={{ fontSize: "28px", fontWeight: "800", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", margin: 0 }}>
                    {displayTopics.length}
                  </p>
                </div>
                <div style={{ flex: 1, background: "rgba(255,255,255,0.7)", borderRadius: "12px", padding: "16px", border: "1px solid rgba(99,102,241,0.1)" }}>
                  <p style={{ fontSize: "12px", color: "#94a3b8", margin: "0 0 6px 0", textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: "600" }}>Personalized Questions</p>
                  <p style={{ fontSize: "28px", fontWeight: "800", background: "linear-gradient(135deg, #06b6d4, #14b8a6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", margin: 0 }}>
                    {resumeQuestions.length}
                  </p>
                </div>
              </div>
            </div>

            {/* Resume Upload Card */}
            <div style={{ backgroundColor: "white", borderRadius: "16px", padding: "28px", boxShadow: "0 4px 16px rgba(99, 102, 241, 0.06)", border: "1px solid #e0e7ff" }}>
              <h3 style={{ fontSize: "18px", margin: "0 0 16px 0", color: "#1e1b4b", fontWeight: "700" }}>
                📄 Upload Resume
              </h3>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                onChange={handleResumeUpload}
                style={{ display: "none" }}
              />
              <div
                onClick={() => !uploadingResume && fileInputRef.current?.click()}
                style={{
                  border: "2px dashed #c7d2fe",
                  borderRadius: "12px",
                  padding: "36px",
                  textAlign: "center",
                  cursor: uploadingResume ? "not-allowed" : "pointer",
                  transition: "all 0.3s ease",
                  backgroundColor: uploadingResume ? "#f1f5f9" : "#eef2ff",
                  opacity: uploadingResume ? 0.6 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!uploadingResume) {
                    e.currentTarget.style.backgroundColor = "#e0e7ff";
                    e.currentTarget.style.borderColor = "#6366f1";
                    e.currentTarget.style.boxShadow = "0 0 20px rgba(99,102,241,0.1)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!uploadingResume) {
                    e.currentTarget.style.backgroundColor = "#eef2ff";
                    e.currentTarget.style.borderColor = "#c7d2fe";
                    e.currentTarget.style.boxShadow = "none";
                  }
                }}
              >
                <p style={{ fontSize: "40px", margin: "0 0 8px 0" }}>
                  {uploadingResume ? "⏳" : "📤"}
                </p>
                <p style={{ margin: "0 0 4px 0", color: "#1e1b4b", fontWeight: "600", fontSize: "16px" }}>
                  {uploadingResume ? "Processing..." : "Drop your resume"}
                </p>
                <p style={{ margin: 0, fontSize: "14px", color: "#94a3b8" }}>
                  {uploadingResume ? "Please wait..." : "or click to browse (PDF only)"}
                </p>
              </div>
              <p style={{ fontSize: "12px", color: "#94a3b8", marginTop: "12px", textAlign: "center", margin: "12px 0 0 0" }}>
                Max 5MB • Supports PDF format
              </p>
              {uploadMessage && (
                <p
                  style={{
                    marginTop: "12px",
                    padding: "12px 16px",
                    backgroundColor: uploadMessage.includes("✅") || uploadMessage.includes("🔄 Regenerated") ? "#ecfdf5" : uploadMessage.includes("🔄") ? "#fef3c7" : "#fff1f2",
                    color: uploadMessage.includes("✅") || uploadMessage.includes("🔄 Regenerated") ? "#065f46" : uploadMessage.includes("🔄") ? "#92400e" : "#991b1b",
                    borderRadius: "10px",
                    fontSize: "13px",
                    textAlign: "center",
                    border: uploadMessage.includes("✅") || uploadMessage.includes("🔄 Regenerated") ? "1px solid #a7f3d0" : uploadMessage.includes("🔄") ? "1px solid #fcd34d" : "1px solid #fecdd3",
                  }}
                >
                  {uploadMessage}
                </p>
              )}
              {/* Regenerate Button */}
              {generatedTopics.length > 0 && (
                <div style={{ marginTop: "16px", textAlign: "center" }}>
                  <button
                    onClick={handleRegenerate}
                    disabled={uploadingResume || regenerating}
                    style={{
                      padding: "10px 24px",
                      background: uploadingResume || regenerating ? "#94a3b8" : "linear-gradient(135deg, #f97316, #f59e0b)",
                      color: "white",
                      border: "none",
                      borderRadius: "10px",
                      cursor: uploadingResume || regenerating ? "not-allowed" : "pointer",
                      fontWeight: "700",
                      fontSize: "13px",
                      transition: "all 0.3s ease",
                      boxShadow: uploadingResume || regenerating ? "none" : "0 4px 12px rgba(245, 158, 11, 0.3)",
                    }}
                    onMouseEnter={(e) => {
                      if (!uploadingResume && !regenerating) { e.target.style.transform = "translateY(-1px)"; e.target.style.boxShadow = "0 6px 20px rgba(245, 158, 11, 0.4)"; }
                    }}
                    onMouseLeave={(e) => {
                      if (!uploadingResume && !regenerating) { e.target.style.transform = "translateY(0)"; e.target.style.boxShadow = "0 4px 12px rgba(245, 158, 11, 0.3)"; }
                    }}
                  >
                    {regenerating ? "⏳ Regenerating..." : "🔄 Regenerate Questions"}
                  </button>
                  <p style={{ fontSize: "11px", color: "#94a3b8", marginTop: "6px" }}>
                    Bypass cache and generate brand-new questions from your resume
                  </p>
                </div>
              )}
              {generatedTopics.length > 0 && (
                <div style={{ marginTop: "16px", paddingTop: "16px", borderTop: "1px solid #e0e7ff" }}>
                  <p style={{ fontSize: "12px", color: "#475569", fontWeight: "600", marginBottom: "8px" }}>
                    ✨ Generated Topics:
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {generatedTopics.map((topic, idx) => (
                      <span
                        key={idx}
                        style={{
                          background: "linear-gradient(135deg, #eef2ff, #e0e7ff)",
                          color: "#4f46e5",
                          padding: "5px 10px",
                          borderRadius: "6px",
                          fontSize: "11px",
                          fontWeight: "600",
                          border: "1px solid #c7d2fe",
                        }}
                      >
                        {topic}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Success Modal */}
      {showSuccessModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(15, 23, 42, 0.6)",
            backdropFilter: "blur(4px)",
            zIndex: 999,
          }}
          onClick={() => setShowSuccessModal(false)}
        />
      )}
      {showSuccessModal && (
        <div
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            backgroundColor: "white",
            padding: "40px",
            borderRadius: "20px",
            boxShadow: "0 20px 60px rgba(99,102,241,0.2)",
            textAlign: "center",
            maxWidth: "420px",
            zIndex: 1000,
            animation: "scaleIn 0.3s ease-out",
          }}
        >
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "4px", background: "linear-gradient(135deg, #6366f1, #8b5cf6, #06b6d4)", borderRadius: "20px 20px 0 0" }} />
          <p style={{ fontSize: "56px", margin: "0 0 16px 0" }}>🎉</p>
          <h2 style={{ fontSize: "24px", margin: "0 0 12px 0", color: "#1e1b4b", fontWeight: "800" }}>
            Resume Processed!
          </h2>
          <p style={{ color: "#475569", marginBottom: "16px", lineHeight: "1.6" }}>
            We've extracted your skills and generated interview questions!
          </p>
          <p style={{ color: "#1e1b4b", fontWeight: "600", margin: "16px 0", fontSize: "16px" }}>
            📖 Check out the <strong>Topics</strong> section to start practicing!
          </p>
          <p style={{ color: "#94a3b8", fontSize: "13px", margin: "12px 0 0 0" }}>
            Select a topic → Choose difficulty → Take the proctored test
          </p>
        </div>
      )}
    </div>
  );
}

export default Dashboard;