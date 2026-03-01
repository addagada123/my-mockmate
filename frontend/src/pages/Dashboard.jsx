import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

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

  const handleResumeUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      setUploadMessage("❌ Only PDF files are supported");
      return;
    }

    setUploadingResume(true);
    setUploadMessage("📤 Uploading resume...");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const token = localStorage.getItem("mockmate_token");
      const response = await axios.post(
        `${API_BASE}/upload-resume`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "multipart/form-data",
          },
        }
      );

      if (response.data.success) {
        const questions = response.data.questions || [];
        setResumeQuestions(questions);

        // Prefer topics detected from resume; fallback to topics derived from questions
        const detected = response.data.topicsDetected || [];
        const topics = detected.length > 0
          ? detected
          : [...new Set(questions.map((q) => q.topic || "Misc"))];
        setGeneratedTopics(topics);

        setUploadMessage(
          `✅ ${response.data.message} Topics found: ${topics.join(", ")}`
        );
        
        // Show success modal
        setShowSuccessModal(true);
        setTimeout(() => setShowSuccessModal(false), 5000);
      }
    } catch (error) {
      setUploadMessage(
        `❌ Error: ${error.response?.data?.detail || error.message}`
      );
    } finally {
      setUploadingResume(false);
    }
  };

  const handleTopicClick = (topic) => {
    setSelectedTopic(topic);
    // Navigate to proctored test page with topic
    navigate(`/test/${encodeURIComponent(topic)}`);
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
        background: "#f5f7fa",
        padding: "24px",
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
            backgroundColor: "white",
            padding: "20px",
            borderRadius: "12px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "32px" }}>🎯</span>
              <span style={{ fontSize: "24px", fontWeight: "800", color: "#0073e6" }}>Mockmate</span>
            </div>
            <div style={{ width: "1px", height: "36px", backgroundColor: "#cce0f5" }}></div>
            <div>
              <h1 style={{ margin: 0, fontSize: "22px", color: "#1e293b" }}>
                Practice Dashboard
              </h1>
              <p style={{ margin: "4px 0 0 0", color: "#666", fontSize: "14px" }}>
                Welcome, {user?.full_name ? user.full_name.split(" ")[0] : user?.email?.split("@")[0]}
              </p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            style={{
              padding: "10px 20px",
              backgroundColor: "#0073e6",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
              fontWeight: "600",
              transition: "all 0.3s ease",
            }}
            onMouseEnter={(e) => (e.target.style.backgroundColor = "#005bb5")}
            onMouseLeave={(e) => (e.target.style.backgroundColor = "#0073e6")}
          >
          </button>
        </div>

        {/* Main Content - 2 Column SaaS Layout */}
        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "24px" }}>
          {/* Left Sidebar */}
          <div style={{ backgroundColor: "white", borderRadius: "12px", padding: "20px", boxShadow: "0 4px 12px rgba(0,0,0,0.08)", height: "fit-content" }}>
            <h2 style={{ fontSize: "18px", margin: "0 0 16px 0", color: "#1e293b" }}>
              Menu
            </h2>

            {/* Topics Section */}
            <div style={{ marginBottom: "16px" }}>
              <button
                onClick={toggleTopic}
                style={{
                  width: "100%",
                  padding: "12px",
                  textAlign: "left",
                  backgroundColor: expandedTopics ? "#e0f0ff" : "transparent",
                  border: "1px solid #cce0f5",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontWeight: "600",
                  color: "#0073e6",
                }}>
                {expandedTopics ? "▼" : "▶"} Topics
              </button>
              {expandedTopics && (
                <div style={{ marginTop: "8px", paddingLeft: "16px" }}>
                  {displayTopics.map((topic, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleTopicClick(topic)}
                      style={{
                        display: "block",
                        width: "100%",
                        padding: "8px",
                        textAlign: "left",
                        backgroundColor: "transparent",
                        border: "none",
                        borderRadius: "6px",
                        cursor: "pointer",
                        color: "#666",
                        fontSize: "13px",
                        marginBottom: "4px",
                        transition: "all 0.2s ease",
                        fontWeight: generatedTopics.includes(topic) ? "600" : "400",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#e0f0ff")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                      • {topic} {generatedTopics.includes(topic) ? "⭐" : ""}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Navigation Buttons */}
            <div style={{ marginTop: "24px", borderTop: "1px solid #cce0f5", paddingTop: "16px" }}>
              <button
                onClick={() => navigate("/performance")}
                style={{
                  width: "100%",
                  padding: "10px",
                  marginBottom: "8px",
                  backgroundColor: "#0073e6",
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontSize: "13px",
                  fontWeight: "600",
                  transition: "all 0.3s ease",
                }}
                onMouseEnter={(e) => (e.target.style.backgroundColor = "#005bb5")}
                onMouseLeave={(e) => (e.target.style.backgroundColor = "#0073e6")}
              >
                📊 Performance
              </button>
              <button
                onClick={() => navigate("/jobs")}
                style={{
                  width: "100%",
                  padding: "10px",
                  backgroundColor: "#0073e6",
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontSize: "13px",
                  fontWeight: "600",
                  transition: "all 0.3s ease",
                }}
                onMouseEnter={(e) => (e.target.style.backgroundColor = "#005bb5")}
                onMouseLeave={(e) => (e.target.style.backgroundColor = "#0073e6")}
              >
                💼 Jobs
              </button>
            </div>
          </div>

          {/* Right Panel - Welcome / Resume Upload */}
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            {/* Welcome Card */}
            <div style={{ backgroundColor: "white", borderRadius: "12px", padding: "32px", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
              <h2 style={{ fontSize: "32px", margin: "0 0 16px 0", color: "#1e293b", fontWeight: "800" }}>
                👋 Welcome Back!
              </h2>
              <p style={{ fontSize: "16px", color: "#666", lineHeight: "1.6", margin: 0 }}>
                Ready to ace your interview? Upload your resume to get personalized questions based on your skills, or start with any topic below.
              </p>
              <div style={{ marginTop: "20px", display: "flex", gap: "12px" }}>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: "13px", color: "#999", margin: "0 0 8px 0" }}>Topics Available</p>
                  <p style={{ fontSize: "24px", fontWeight: "700", color: "#0073e6", margin: 0 }}>
                    {displayTopics.length}
                  </p>
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: "13px", color: "#999", margin: "0 0 8px 0" }}>Personalized Questions</p>
                  <p style={{ fontSize: "24px", fontWeight: "700", color: "#0073e6", margin: 0 }}>
                    {resumeQuestions.length}
                  </p>
                </div>
              </div>
            </div>

            {/* Resume Upload Card */}
            <div style={{ backgroundColor: "white", borderRadius: "12px", padding: "24px", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
              <h3 style={{ fontSize: "18px", margin: "0 0 16px 0", color: "#1e293b", fontWeight: "700" }}>
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
                  border: "2px dashed #0073e6",
                  borderRadius: "8px",
                  padding: "32px",
                  textAlign: "center",
                  cursor: uploadingResume ? "not-allowed" : "pointer",
                  transition: "all 0.3s ease",
                  backgroundColor: uploadingResume ? "#f0f0f0" : "#f8f9ff",
                  opacity: uploadingResume ? 0.6 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!uploadingResume) {
                    e.currentTarget.style.backgroundColor = "#e0f0ff";
                    e.currentTarget.style.borderColor = "#005bb5";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!uploadingResume) {
                    e.currentTarget.style.backgroundColor = "#f8f9ff";
                    e.currentTarget.style.borderColor = "#0073e6";
                  }
                }}
              >
                <p style={{ fontSize: "40px", margin: "0 0 8px 0" }}>
                  {uploadingResume ? "⏳" : "📤"}
                </p>
                <p style={{ margin: "0 0 4px 0", color: "#0073e6", fontWeight: "600", fontSize: "16px" }}>
                  {uploadingResume ? "Processing..." : "Drop your resume"}
                </p>
                <p style={{ margin: 0, fontSize: "14px", color: "#999" }}>
                  {uploadingResume ? "Please wait..." : "or click to browse (PDF only)"}
                </p>
              </div>
              <p style={{ fontSize: "12px", color: "#999", marginTop: "12px", textAlign: "center", margin: "12px 0 0 0" }}>
                Max 5MB • Supports PDF format
              </p>
              {uploadMessage && (
                <p
                  style={{
                    marginTop: "12px",
                    padding: "12px",
                    backgroundColor: uploadMessage.includes("✅") ? "#d1fae5" : "#fee2e2",
                    color: uploadMessage.includes("✅") ? "#065f46" : "#991b1b",
                    borderRadius: "6px",
                    fontSize: "13px",
                    textAlign: "center",
                  }}
                >
                  {uploadMessage}
                </p>
              )}
              {generatedTopics.length > 0 && (
                <div style={{ marginTop: "16px", paddingTop: "16px", borderTop: "1px solid #cce0f5" }}>
                  <p style={{ fontSize: "12px", color: "#0073e6", fontWeight: "600", marginBottom: "8px" }}>
                    ✨ Generated Topics:
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {generatedTopics.map((topic, idx) => (
                      <span
                        key={idx}
                        style={{
                          backgroundColor: "#e0f0ff",
                          color: "#0073e6",
                          padding: "4px 8px",
                          borderRadius: "4px",
                          fontSize: "11px",
                          fontWeight: "600",
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
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            backgroundColor: "white",
            padding: "32px",
            borderRadius: "12px",
            boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
            textAlign: "center",
            maxWidth: "400px",
          }}
        >
          <p style={{ fontSize: "48px", margin: "0 0 16px 0" }}>🎉</p>
          <h2 style={{ fontSize: "24px", margin: "0 0 12px 0", color: "#1e293b" }}>
            Resume Processed!
          </h2>
          <p style={{ color: "#666", marginBottom: "16px", lineHeight: "1.6" }}>
            ✅ We've extracted your skills and generated interview questions!
          </p>
          <p style={{ color: "#0073e6", fontWeight: "600", margin: "16px 0", fontSize: "16px" }}>
            📖 Check out the <strong>Topics</strong> section on the left to start practicing!
          </p>
          <p style={{ color: "#999", fontSize: "13px", margin: "12px 0 0 0" }}>
            Select a topic → Choose difficulty → Take the proctored test
          </p>
        </div>
      )}
      {showSuccessModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.5)",
            zIndex: 999,
          }}
          onClick={() => setShowSuccessModal(false)}
        />
      )}
    </div>
  );
}

export default Dashboard;
