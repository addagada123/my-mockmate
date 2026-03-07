import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

function Jobs() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("mockmate_user"));
  const [jobs, setJobs] = useState([]);
  const [userSkills, setUserSkills] = useState([]);
  const [strongSkills, setStrongSkills] = useState([]);
  const [weakSkills, setWeakSkills] = useState([]);
  const [skillGap, setSkillGap] = useState([]);
  const [university, setUniversity] = useState("");
  const [universityCity, setUniversityCity] = useState("");
  const [experienceLevel, setExperienceLevel] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unverifiedSkills, setUnverifiedSkills] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  const [jobsSource, setJobsSource] = useState("");
  const [isLiveGenerated, setIsLiveGenerated] = useState(true);
  const [fallbackReason, setFallbackReason] = useState("");

  const fetchJobs = async () => {
    setLoading(true);
    setError("");
    try {
      const token = localStorage.getItem("mockmate_token");
      const response = await axios.get(
        `${API_BASE}/recommend-jobs`,
        {
          headers: { Authorization: `Bearer ${token}` },
          params: { _ts: Date.now() },
        }
      );
      if (response.data.success) {
        setJobs(response.data.jobs || []);
        setUserSkills(response.data.user_skills || []);
        setStrongSkills(response.data.strong_skills || []);
        setWeakSkills(response.data.weak_skills || []);
        setSkillGap(response.data.skill_gap || []);
        setUniversity(response.data.university || "");
        setUniversityCity(response.data.university_city || "");
        setExperienceLevel(response.data.experience_level || "");
        setUnverifiedSkills(response.data.unverified_skills || []);
        setJobsSource(response.data.jobs_source || "");
        setIsLiveGenerated(response.data.is_live_generated !== false);
        setFallbackReason(response.data.fallback_reason || "");
      } else {
        setError(response.data.message || "No jobs found");
      }
    } catch (err) {
      console.error("Error fetching jobs:", err);
      setError(err.response?.data?.detail || "Failed to load job recommendations");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  const formatCTC = (amount) => {
    if (!amount) return "N/A";
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
  };

  const getMatchColor = (score) => {
    if (score === 3) return "#10b981";
    if (score === 2) return "#f59e0b";
    return "#ef4444";
  };

  const getProximityStyle = (proximity) => {
    if (proximity === "Same City") return { bg: "#d1fae5", color: "#065f46", icon: "\ud83d\udccd" };
    if (proximity === "Nearby") return { bg: "#fef3c7", color: "#92400e", icon: "\ud83d\ude97" };
    return { bg: "#f3f4f6", color: "#374151", icon: "\u2708\ufe0f" };
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg, #f5f3ff 0%, #ede9fe 30%, #f5f3ff 100%)", padding: "24px" }}>
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
          <div>
            <h1 style={{ color: "#1e293b", fontSize: "28px", fontWeight: "800", margin: 0 }}>
              {"\ud83d\udcbc"} Live Jobs in India
            </h1>
            <p style={{ color: "#64748b", margin: "4px 0 0 0" }}>
              Real-time recommendations powered by AI {"\u2022"} {user?.email}
            </p>
          </div>
	          <div style={{ display: "flex", gap: "12px" }}>
	            <button
	              onClick={fetchJobs}
	              style={{
	                padding: "10px 20px", background: "#6366f1", color: "white",
	                border: "none", borderRadius: "8px", fontWeight: "600",
	                cursor: "pointer", transition: "all 0.3s ease",
	              }}
	              onMouseEnter={(e) => (e.target.style.opacity = "0.9")}
	              onMouseLeave={(e) => (e.target.style.opacity = "1")}
	            >
	              Refresh Jobs
	            </button>
	            <button
	              onClick={() => navigate("/dashboard")}
              style={{
                padding: "10px 20px", background: "white", color: "#6366f1",
                border: "none", borderRadius: "8px", fontWeight: "600",
                cursor: "pointer", transition: "all 0.3s ease",
              }}
              onMouseEnter={(e) => (e.target.style.opacity = "0.9")}
              onMouseLeave={(e) => (e.target.style.opacity = "1")}
            >
              {"\u2190"} Back to Dashboard
            </button>
            <button
              onClick={() => { localStorage.clear(); navigate("/signin"); }}
              style={{
                padding: "10px 20px", background: "white", color: "#6366f1",
                border: "none", borderRadius: "8px", fontWeight: "600",
                cursor: "pointer", transition: "all 0.3s ease",
              }}
              onMouseEnter={(e) => (e.target.style.opacity = "0.9")}
              onMouseLeave={(e) => (e.target.style.opacity = "1")}
            >
              Logout
            </button>
          </div>
	        </div>
	        {!loading && !isLiveGenerated && (
	          <div style={{ background: "#fff7ed", borderRadius: "10px", padding: "12px 14px", marginBottom: "16px", border: "1px solid #fdba74" }}>
	            <p style={{ margin: 0, color: "#9a3412", fontSize: "13px", fontWeight: "600" }}>
	              Showing fallback job suggestions right now (source: {jobsSource || "fallback-local"}).
	            </p>
	            {fallbackReason && (
	              <p style={{ margin: "4px 0 0 0", color: "#9a3412", fontSize: "12px" }}>
	                Reason: {fallbackReason}
	              </p>
	            )}
	          </div>
	        )}

	        {/* University & Skills Banner */}
        {(university || userSkills.length > 0) && !loading && (
          <div style={{ background: "white", borderRadius: "16px", padding: "20px", marginBottom: "24px", boxShadow: "0 4px 16px rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.08)" }}>
            {university && (
              <div style={{ marginBottom: userSkills.length > 0 ? "16px" : 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                  <span style={{ fontSize: "18px" }}>{"\ud83c\udf93"}</span>
                  <h2 style={{ color: "#1e293b", margin: 0, fontSize: "16px", fontWeight: "700" }}>{university}</h2>
                  {experienceLevel && (
                    <span style={{ padding: "3px 10px", borderRadius: "10px", fontSize: "11px", fontWeight: "600", background: "#e0e7ff", color: "#1e40af" }}>
                      {experienceLevel}
                    </span>
                  )}
                </div>
                <p style={{ color: "#64748b", margin: "2px 0 0 28px", fontSize: "13px" }}>
                  {universityCity ? `\ud83d\udccd ${universityCity} \u2014 Jobs ranked by match strength + proximity` : "Jobs sorted by best overall fit"}
                </p>
              </div>
            )}

            {/* Strong Skills */}
            {strongSkills.length > 0 && (
              <div style={{ marginBottom: "12px" }}>
                <h3 style={{ color: "#065f46", margin: "0 0 6px 0", fontSize: "13px", fontWeight: "600" }}>
                  💪 Strong Skills (verified by tests)
                </h3>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {strongSkills.map((skill, idx) => (
                    <span key={idx} style={{ padding: "4px 10px", backgroundColor: "#d1fae5", color: "#065f46", borderRadius: "6px", fontSize: "12px", fontWeight: "600" }}>
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* All Skills */}
            {userSkills.length > 0 && (
              <div style={{ marginBottom: (skillGap.length > 0 || weakSkills.length > 0) ? "12px" : 0 }}>
                <h3 style={{ color: "#1e293b", margin: "0 0 6px 0", fontSize: "13px", fontWeight: "600" }}>
                  {"\ud83c\udfaf"} All Skills ({userSkills.length})
                </h3>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {userSkills.slice(0, 15).map((skill, idx) => (
                    <span key={idx} style={{ padding: "4px 10px", backgroundColor: "#eef2ff", color: "#6366f1", borderRadius: "6px", fontSize: "12px", fontWeight: "600" }}>
                      {skill}
                    </span>
                  ))}
                  {userSkills.length > 15 && (
                    <span style={{ padding: "4px 10px", color: "#64748b", fontSize: "12px" }}>+{userSkills.length - 15} more</span>
                  )}
                </div>
              </div>
            )}

            {/* Unverified Skills */}
            {unverifiedSkills.length > 0 && (
              <div style={{ marginBottom: skillGap.length > 0 ? "12px" : 0 }}>
                <h3 style={{ color: "#92400e", margin: "0 0 6px 0", fontSize: "13px", fontWeight: "600" }}>
                  ❓ Unverified Skills (not yet tested)
                </h3>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {unverifiedSkills.slice(0, 10).map((skill, idx) => (
                    <span key={idx} style={{ padding: "4px 10px", backgroundColor: "#fef3c7", color: "#92400e", borderRadius: "6px", fontSize: "12px", fontWeight: "500" }}>
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Skill Gap */}
            {skillGap.length > 0 && (
              <div>
                <h3 style={{ color: "#991b1b", margin: "0 0 6px 0", fontSize: "13px", fontWeight: "600" }}>
                  📚 Skill Gap (learn to unlock more jobs)
                </h3>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {skillGap.slice(0, 10).map((skill, idx) => (
                    <span key={idx} style={{ padding: "4px 10px", backgroundColor: "#fef2f2", color: "#991b1b", borderRadius: "6px", fontSize: "12px", fontWeight: "500" }}>
                      {skill}
                    </span>
                  ))}
                  {skillGap.length > 10 && (
                    <span style={{ padding: "4px 10px", color: "#64748b", fontSize: "12px" }}>+{skillGap.length - 10} more</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Loading State */}
        {loading ? (
          <div style={{ background: "white", borderRadius: "12px", padding: "60px 40px", textAlign: "center", boxShadow: "0 4px 12px rgba(99,102,241,0.06)" }}>
            <p style={{ fontSize: "40px", margin: "0 0 16px 0" }}>{"\ud83d\udd0d"}</p>
            <p style={{ color: "#1e293b", fontSize: "18px", fontWeight: "600", margin: "0 0 8px 0" }}>Scanning live job market...</p>
            <p style={{ color: "#64748b", fontSize: "14px", margin: 0 }}>Analyzing your skills and finding the best matches across India</p>
          </div>
        ) : error ? (
          <div style={{ background: "white", borderRadius: "12px", padding: "40px", textAlign: "center", boxShadow: "0 4px 12px rgba(99,102,241,0.06)" }}>
            <p style={{ color: "#991b1b", fontSize: "16px", margin: "0 0 8px 0" }}>{error}</p>
            <p style={{ color: "#64748b", fontSize: "14px", margin: 0 }}>Please upload a resume first to get personalized job recommendations.</p>
          </div>
        ) : jobs.length === 0 ? (
          <div style={{ background: "white", borderRadius: "12px", padding: "40px", textAlign: "center", boxShadow: "0 4px 12px rgba(99,102,241,0.06)" }}>
            <p style={{ color: "#334155", fontSize: "16px" }}>No job matches found. Please upload a resume with skills.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: "16px" }}>
            {jobs.map((job, index) => {
              const proxStyle = getProximityStyle(job.proximity);
              return (
                <div
                  key={job.id || index}
                  style={{
                    background: "white", borderRadius: "16px", padding: "20px",
                    boxShadow: "0 4px 16px rgba(99,102,241,0.06)", cursor: "pointer",
                    transition: "all 0.3s ease",
                    border: selectedJob?.id === job.id ? "2px solid #6366f1" : "2px solid rgba(99,102,241,0.06)",
                  }}
                  onClick={() => setSelectedJob(selectedJob?.id === job.id ? null : job)}
                  onMouseEnter={(e) => { if (selectedJob?.id !== job.id) { e.currentTarget.style.boxShadow = "0 8px 32px rgba(99,102,241,0.12)"; e.currentTarget.style.transform = "translateY(-2px)"; } }}
                  onMouseLeave={(e) => { if (selectedJob?.id !== job.id) { e.currentTarget.style.boxShadow = "0 4px 16px rgba(99,102,241,0.06)"; e.currentTarget.style.transform = "translateY(0)"; } }}
                >
                  {/* Job Header */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
                    <div style={{ flex: 1 }}>
                      <h3 style={{ margin: "0 0 4px 0", color: "#1e293b", fontSize: "18px", fontWeight: "700" }}>{job.title}</h3>
                      <p style={{ margin: 0, color: "#64748b", fontWeight: "600", fontSize: "14px" }}>{job.company}</p>
                    </div>
                    <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
                      <span style={{ padding: "5px 10px", backgroundColor: proxStyle.bg, color: proxStyle.color, borderRadius: "6px", fontWeight: "600", fontSize: "11px", whiteSpace: "nowrap" }}>
                        {proxStyle.icon} {job.proximity}
                      </span>
                      <span style={{ padding: "5px 10px", backgroundColor: getMatchColor(job.match_score), color: "white", borderRadius: "6px", fontWeight: "600", fontSize: "11px", whiteSpace: "nowrap" }}>
                        {job.match_score_pct != null ? `${job.match_score_pct}% Match` : (
                          <>{job.match_score === 3 && "\u2713 Perfect Match"}{job.match_score === 2 && "Good Match"}{job.match_score === 1 && "Partial Match"}</>
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Job Meta Info */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "12px", marginBottom: "12px" }}>
                    <div>
                      <p style={{ margin: "0 0 2px 0", color: "#94a3b8", fontSize: "11px", fontWeight: "600", textTransform: "uppercase" }}>Location</p>
                      <p style={{ margin: 0, color: "#334155", fontWeight: "500", fontSize: "14px" }}>{"\ud83d\udccd"} {job.location}</p>
                    </div>
                    <div>
                      <p style={{ margin: "0 0 2px 0", color: "#94a3b8", fontSize: "11px", fontWeight: "600", textTransform: "uppercase" }}>CTC</p>
                      <p style={{ margin: 0, color: "#10b981", fontWeight: "700", fontSize: "14px" }}>{formatCTC(job.ctc_min)} - {formatCTC(job.ctc_max)}</p>
                    </div>
                    <div>
                      <p style={{ margin: "0 0 2px 0", color: "#94a3b8", fontSize: "11px", fontWeight: "600", textTransform: "uppercase" }}>Experience</p>
                      <p style={{ margin: 0, color: "#334155", fontWeight: "500", fontSize: "14px" }}>{job.experience}</p>
                    </div>
                    <div>
                      <p style={{ margin: "0 0 2px 0", color: "#94a3b8", fontSize: "11px", fontWeight: "600", textTransform: "uppercase" }}>Type</p>
                      <p style={{ margin: 0, color: "#334155", fontWeight: "500", fontSize: "14px" }}>{job.job_type}</p>
                    </div>
                  </div>

                  {/* Matching Skills */}
                  {job.matching_skills && job.matching_skills.length > 0 && (
                    <div style={{ marginBottom: "8px" }}>
                      <p style={{ margin: "0 0 6px 0", color: "#94a3b8", fontSize: "11px", fontWeight: "600", textTransform: "uppercase" }}>{"\u2713"} Matching Skills</p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                        {job.matching_skills.map((skill, idx) => (
                          <span key={idx} style={{ padding: "3px 8px", backgroundColor: "#d1fae5", color: "#065f46", borderRadius: "4px", fontSize: "11px", fontWeight: "600" }}>{skill}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Expandable Details */}
                  {selectedJob?.id === job.id && (
                    <div style={{ marginTop: "16px", paddingTop: "16px", borderTop: "1px solid #e5e7eb" }}>
                      <div style={{ marginBottom: "12px" }}>
                        <p style={{ margin: "0 0 6px 0", color: "#94a3b8", fontSize: "11px", fontWeight: "600", textTransform: "uppercase" }}>Job Description</p>
                        <p style={{ margin: 0, color: "#334155", lineHeight: "1.6", fontSize: "14px" }}>{job.description}</p>
                      </div>

                      {/* Why Good Fit */}
                      {job.why_good_fit && (
                        <div style={{ marginBottom: "12px", padding: "10px 14px", background: "#ecfdf5", borderRadius: "8px", borderLeft: "3px solid #10b981" }}>
                          <p style={{ margin: 0, color: "#065f46", fontSize: "13px", fontWeight: "500" }}>
                            ✨ {job.why_good_fit}
                          </p>
                        </div>
                      )}

                      <div style={{ marginBottom: "12px" }}>
                        <p style={{ margin: "0 0 6px 0", color: "#94a3b8", fontSize: "11px", fontWeight: "600", textTransform: "uppercase" }}>Required Skills</p>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                          {(job.required_skills || []).map((skill, idx) => (
                            <span key={idx} style={{
                              padding: "3px 8px",
                              backgroundColor: job.matching_skills?.includes(skill) ? "#d1fae5" : "#fee2e2",
                              color: job.matching_skills?.includes(skill) ? "#065f46" : "#991b1b",
                              borderRadius: "4px", fontSize: "11px", fontWeight: "500",
                            }}>
                              {job.matching_skills?.includes(skill) ? "\u2713" : "\u2717"} {skill}
                              {(job.strong_matches || []).includes(skill) && " 💪"}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Growth Skills */}
                      {job.growth_skills && job.growth_skills.length > 0 && (
                        <div style={{ marginBottom: "16px" }}>
                          <p style={{ margin: "0 0 6px 0", color: "#94a3b8", fontSize: "11px", fontWeight: "600", textTransform: "uppercase" }}>🚀 Skills to Learn for This Role</p>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                            {job.growth_skills.map((skill, idx) => (
                              <span key={idx} style={{
                                padding: "3px 8px", backgroundColor: "#ede9fe",
                                color: "#5b21b6", borderRadius: "4px", fontSize: "11px", fontWeight: "600",
                              }}>
                                📖 {skill}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Multi-platform Apply Buttons */}
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        {job.apply_urls?.linkedin && (
                          <a
                            href={job.apply_urls.linkedin}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              flex: "1 1 120px", textAlign: "center", padding: "10px 14px",
                              backgroundColor: "#0077b5", color: "white", border: "none",
                              borderRadius: "8px", fontWeight: "600", fontSize: "13px",
                              cursor: "pointer", textDecoration: "none",
                            }}
                          >
                            🔗 LinkedIn
                          </a>
                        )}
                        {job.apply_urls?.naukri && (
                          <a
                            href={job.apply_urls.naukri}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              flex: "1 1 120px", textAlign: "center", padding: "10px 14px",
                              backgroundColor: "#4285f4", color: "white", border: "none",
                              borderRadius: "8px", fontWeight: "600", fontSize: "13px",
                              cursor: "pointer", textDecoration: "none",
                            }}
                          >
                            🔗 Naukri
                          </a>
                        )}
                        {job.apply_urls?.indeed && (
                          <a
                            href={job.apply_urls.indeed}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              flex: "1 1 120px", textAlign: "center", padding: "10px 14px",
                              backgroundColor: "#2164f3", color: "white", border: "none",
                              borderRadius: "8px", fontWeight: "600", fontSize: "13px",
                              cursor: "pointer", textDecoration: "none",
                            }}
                          >
                            🔗 Indeed
                          </a>
                        )}
                        {!job.apply_urls && (
                          <a
                            href={job.apply_url || `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(job.title)}&location=${encodeURIComponent(job.location + ", India")}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              flex: 1, textAlign: "center", padding: "12px 16px",
                              backgroundColor: "#6366f1", color: "white", border: "none",
                              borderRadius: "8px", fontWeight: "600", fontSize: "14px",
                              cursor: "pointer", textDecoration: "none",
                            }}
                          >
                            {"\ud83d\udd17"} Search & Apply
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default Jobs;
