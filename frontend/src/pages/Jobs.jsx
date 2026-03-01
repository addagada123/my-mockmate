import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

function Jobs() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("mockmate_user"));
  const [jobs, setJobs] = useState([]);
  const [userSkills, setUserSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState(null);

  // Fetch recommended jobs on mount
  useEffect(() => {
    const fetchJobs = async () => {
      try {
        const token = localStorage.getItem("mockmate_token");
        const response = await axios.get(
          `${API_BASE}/recommend-jobs`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (response.data.success) {
          setJobs(response.data.jobs || []);
          setUserSkills(response.data.user_skills || []);
        }
      } catch (error) {
        console.error("Error fetching jobs:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchJobs();
  }, []);

  const formatCTC = (amount) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getMatchColor = (score) => {
    if (score === 3) return "#10b981"; // Green
    if (score === 2) return "#f59e0b"; // Orange
    return "#ef4444"; // Red
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f5f7fa",
        padding: "24px",
      }}
    >
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "24px",
          }}
        >
          <div>
            <h1 style={{ color: "#0073e6", fontSize: "28px", fontWeight: "800", margin: 0 }}>
              💼 Recommended Jobs
            </h1>
            <p style={{ color: "#64748b", margin: "4px 0 0 0" }}>
              {user?.email}
            </p>
          </div>
          <div style={{ display: "flex", gap: "12px" }}>
            <button
              onClick={() => navigate("/dashboard")}
              style={{
                padding: "10px 20px",
                background: "white",
                color: "#0073e6",
                border: "none",
                borderRadius: "8px",
                fontWeight: "600",
                cursor: "pointer",
                transition: "all 0.3s ease",
              }}
              onMouseEnter={(e) => (e.target.style.opacity = "0.9")}
              onMouseLeave={(e) => (e.target.style.opacity = "1")}
            >
              ← Back to Dashboard
            </button>
            <button
              onClick={() => {
                localStorage.clear();
                navigate("/signin");
              }}
              style={{
                padding: "10px 20px",
                background: "white",
                color: "#0073e6",
                border: "none",
                borderRadius: "8px",
                fontWeight: "600",
                cursor: "pointer",
                transition: "all 0.3s ease",
              }}
              onMouseEnter={(e) => (e.target.style.opacity = "0.9")}
              onMouseLeave={(e) => (e.target.style.opacity = "1")}
            >
              Logout
            </button>
          </div>
        </div>

        {/* Your Skills Section */}
        {userSkills.length > 0 && (
          <div
            style={{
              background: "white",
              borderRadius: "12px",
              padding: "20px",
              marginBottom: "24px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            }}
          >
            <h2 style={{ color: "#1e293b", marginTop: 0, marginBottom: "12px", fontSize: "18px" }}>
              🎯 Your Skills
            </h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {userSkills.map((skill, idx) => (
                <span
                  key={idx}
                  style={{
                    padding: "6px 12px",
                    backgroundColor: "#e0f0ff",
                    color: "#0073e6",
                    borderRadius: "6px",
                    fontSize: "13px",
                    fontWeight: "600",
                  }}
                >
                  {skill}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Jobs List */}
        {loading ? (
          <div
            style={{
              background: "white",
              borderRadius: "12px",
              padding: "40px",
              textAlign: "center",
              boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            }}
          >
            <p style={{ color: "#666", fontSize: "16px" }}>⏳ Loading job recommendations...</p>
          </div>
        ) : jobs.length === 0 ? (
          <div
            style={{
              background: "white",
              borderRadius: "12px",
              padding: "40px",
              textAlign: "center",
              boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            }}
          >
            <p style={{ color: "#666", fontSize: "16px" }}>
              No job matches found. Please upload a resume with skills.
            </p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: "16px" }}>
            {jobs.map((job) => (
              <div
                key={job.id}
                style={{
                  background: "white",
                  borderRadius: "12px",
                  padding: "20px",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                  cursor: "pointer",
                  transition: "all 0.3s ease",
                  border: selectedJob?.id === job.id ? "2px solid #0073e6" : "2px solid transparent",
                }}
                onClick={() => setSelectedJob(selectedJob?.id === job.id ? null : job)}
                onMouseEnter={(e) => {
                  if (selectedJob?.id !== job.id) {
                    e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.15)";
                    e.currentTarget.style.transform = "translateY(-2px)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (selectedJob?.id !== job.id) {
                    e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.1)";
                    e.currentTarget.style.transform = "translateY(0)";
                  }
                }}
              >
                {/* Job Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
                  <div>
                    <h3 style={{ margin: "0 0 4px 0", color: "#1e293b", fontSize: "18px", fontWeight: "700" }}>
                      {job.title}
                    </h3>
                    <p style={{ margin: 0, color: "#0073e6", fontWeight: "600", fontSize: "14px" }}>
                      {job.company}
                    </p>
                  </div>
                  <div
                    style={{
                      padding: "6px 12px",
                      backgroundColor: getMatchColor(job.match_score),
                      color: "white",
                      borderRadius: "6px",
                      fontWeight: "600",
                      fontSize: "12px",
                      textAlign: "center",
                    }}
                  >
                    {job.match_score === 3 && "Perfect Match ✓"}
                    {job.match_score === 2 && "Good Match"}
                    {job.match_score === 1 && "Partial Match"}
                  </div>
                </div>

                {/* Job Meta Info */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px", marginBottom: "12px" }}>
                  <div>
                    <p style={{ margin: "0 0 4px 0", color: "#999", fontSize: "12px", fontWeight: "600" }}>
                      📍 Location
                    </p>
                    <p style={{ margin: 0, color: "#1e293b", fontWeight: "500" }}>
                      {job.location}
                    </p>
                  </div>
                  <div>
                    <p style={{ margin: "0 0 4px 0", color: "#999", fontSize: "12px", fontWeight: "600" }}>
                      💰 CTC
                    </p>
                    <p style={{ margin: 0, color: "#10b981", fontWeight: "700", fontSize: "14px" }}>
                      {formatCTC(job.ctc_min)} - {formatCTC(job.ctc_max)}
                    </p>
                  </div>
                  <div>
                    <p style={{ margin: "0 0 4px 0", color: "#999", fontSize: "12px", fontWeight: "600" }}>
                      📅 Experience
                    </p>
                    <p style={{ margin: 0, color: "#1e293b", fontWeight: "500" }}>
                      {job.experience}
                    </p>
                  </div>
                  <div>
                    <p style={{ margin: "0 0 4px 0", color: "#999", fontSize: "12px", fontWeight: "600" }}>
                      🏢 Type
                    </p>
                    <p style={{ margin: 0, color: "#1e293b", fontWeight: "500" }}>
                      {job.job_type}
                    </p>
                  </div>
                </div>

                {/* Matching Skills */}
                {job.matching_skills && job.matching_skills.length > 0 && (
                  <div style={{ marginBottom: "12px" }}>
                    <p style={{ margin: "0 0 6px 0", color: "#999", fontSize: "12px", fontWeight: "600" }}>
                      ✓ Matching Skills
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                      {job.matching_skills.map((skill, idx) => (
                        <span
                          key={idx}
                          style={{
                            padding: "4px 10px",
                            backgroundColor: "#d1fae5",
                            color: "#065f46",
                            borderRadius: "4px",
                            fontSize: "12px",
                            fontWeight: "600",
                          }}
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Expandable Details */}
                {selectedJob?.id === job.id && (
                  <div
                    style={{
                      marginTop: "16px",
                      paddingTop: "16px",
                      borderTop: "1px solid #cce0f5",
                    }}
                  >
                    <div style={{ marginBottom: "12px" }}>
                      <p style={{ margin: "0 0 6px 0", color: "#999", fontSize: "12px", fontWeight: "600" }}>
                        📋 Job Description
                      </p>
                      <p style={{ margin: 0, color: "#1e293b", lineHeight: "1.6", fontSize: "14px" }}>
                        {job.description}
                      </p>
                    </div>

                    <div>
                      <p style={{ margin: "0 0 6px 0", color: "#999", fontSize: "12px", fontWeight: "600" }}>
                        🎯 Required Skills
                      </p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                        {job.required_skills.map((skill, idx) => (
                          <span
                            key={idx}
                            style={{
                              padding: "4px 10px",
                              backgroundColor: job.matching_skills?.includes(skill) ? "#d1fae5" : "#f3f4f6",
                              color: job.matching_skills?.includes(skill) ? "#065f46" : "#666",
                              borderRadius: "4px",
                              fontSize: "12px",
                              fontWeight: "500",
                            }}
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Apply Button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        alert(`To apply for ${job.title} at ${job.company}, please visit the company career page.`);
                      }}
                      style={{
                        marginTop: "16px",
                        width: "100%",
                        padding: "10px 16px",
                        backgroundColor: "#0073e6",
                        color: "white",
                        border: "none",
                        borderRadius: "6px",
                        fontWeight: "600",
                        cursor: "pointer",
                        transition: "all 0.3s ease",
                      }}
                      onMouseEnter={(e) => (e.target.style.backgroundColor = "#005bb5")}
                      onMouseLeave={(e) => (e.target.style.backgroundColor = "#0073e6")}
                    >
                      Apply Now
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default Jobs;

