import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

function Performance() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("mockmate_user"));
  const [performanceData, setPerformanceData] = useState([]);
  const [overallStats, setOverallStats] = useState([
    { label: "Total Tests", value: "0" },
    { label: "Average Score", value: "0%" },
    { label: "Accuracy Rate", value: "0%" },
  ]);
  const [loading, setLoading] = useState(true);

  // Communication feedback state
  const [commReport, setCommReport] = useState(null);
  const [commLoading, setCommLoading] = useState(false);
  const [commError, setCommError] = useState("");
  const [activeTab, setActiveTab] = useState("overview"); // overview | comm-report

  // Fetch performance data on mount
  useEffect(() => {
    const fetchPerformance = async () => {
      try {
        const token = localStorage.getItem("mockmate_token");
        const response = await axios.get(
          `${API_BASE}/performance`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (response.data.success) {
          const results = response.data.results || [];
          const stats = response.data.stats || {};

          // Transform results for display
          const displayData = results
            .map((r) => {
              const dt = new Date(r.submittedAt);
              return {
                date: dt.toLocaleDateString("en-IN"),
                topic: r.topic,
                score: r.score,
                difficulty: r.difficulty,
                timeSpent: Math.round(r.timeSpent / 60),
                ts: dt.getTime(),
              };
            })
            .filter((r) => !Number.isNaN(r.ts))
            .sort((a, b) => b.ts - a.ts);

          setPerformanceData(displayData);
          setOverallStats([
            { label: "Total Tests", value: stats.totalTests?.toString() || "0" },
            { label: "Average Score", value: `${stats.averageScore?.toFixed(1) || 0}%` },
            { label: "Accuracy Rate", value: `${stats.accuracyRate?.toFixed(1) || 0}%` },
          ]);
        }
      } catch (error) {
        console.error("Error fetching performance:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchPerformance();
  }, []);

  const fetchCommFeedback = async () => {
    setCommLoading(true);
    setCommError("");
    try {
      const token = localStorage.getItem("mockmate_token");
      const resp = await axios.get(`${API_BASE}/communication-feedback`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.data.success) {
        setCommReport(resp.data);
      }
    } catch (err) {
      setCommError(err.response?.data?.detail || "Failed to load feedback report.");
    } finally {
      setCommLoading(false);
    }
  };

  const ratingColor = (rating) => {
    if (!rating) return "#64748b";
    const r = rating.toLowerCase();
    if (r === "excellent") return "#059669";
    if (r === "good") return "#0073e6";
    if (r === "average") return "#d97706";
    return "#dc2626";
  };

  const ratingBg = (rating) => {
    if (!rating) return "#f1f5f9";
    const r = rating.toLowerCase();
    if (r === "excellent") return "#d1fae5";
    if (r === "good") return "#dbeafe";
    if (r === "average") return "#fef3c7";
    return "#fee2e2";
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f8fafc",
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
            <h1 style={{ color: "#1e293b", fontSize: "28px", fontWeight: "800", margin: 0 }}>
              📊 Performance Analytics
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

        {/* Tab Navigation */}
        <div
          style={{
            display: "flex",
            gap: "0",
            marginBottom: "24px",
            background: "white",
            borderRadius: "12px",
            padding: "4px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
          }}
        >
          {[
            { key: "overview", label: "Test Overview" },
            { key: "comm-report", label: "Communication Feedback Report" },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setActiveTab(tab.key);
                if (tab.key === "comm-report" && !commReport && !commLoading) {
                  fetchCommFeedback();
                }
              }}
              style={{
                flex: 1,
                padding: "12px 20px",
                border: "none",
                borderRadius: "8px",
                fontWeight: "600",
                fontSize: "14px",
                cursor: "pointer",
                transition: "all 0.3s ease",
                background: activeTab === tab.key ? "#0073e6" : "transparent",
                color: activeTab === tab.key ? "white" : "#64748b",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ===== TAB: Overview ===== */}
        {activeTab === "overview" && (
          <>
        {/* Overall Statistics */}
        <div
          style={{
            background: "white",
            borderRadius: "16px",
            padding: "24px",
            boxShadow: "0 4px 24px rgba(0, 0, 0, 0.08)",
            marginBottom: "24px",
          }}
        >
          <h2 style={{ color: "#1e293b", marginBottom: "20px", fontSize: "20px", fontWeight: "700" }}>
            📈 Overall Statistics
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "16px",
            }}
          >
            {overallStats.map((stat) => (
              <div
                key={stat.label}
                style={{
                  background: "#0073e6",
                  borderRadius: "12px",
                  padding: "20px",
                  color: "white",
                  textAlign: "center",
                }}
              >
                <p style={{ fontSize: "13px", opacity: 0.9, margin: "0 0 8px 0" }}>
                  {stat.label}
                </p>
                <p style={{ fontSize: "28px", fontWeight: "700", margin: 0 }}>
                  {stat.value}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Performance */}
        <div
          style={{
            background: "white",
            borderRadius: "16px",
            padding: "24px",
            boxShadow: "0 4px 24px rgba(0, 0, 0, 0.08)",
            marginBottom: "24px",
          }}
        >
          <h2 style={{ color: "#1e293b", marginBottom: "20px", fontSize: "20px", fontWeight: "700" }}>
            📋 All Test Results
          </h2>
          {loading ? (
            <p style={{ color: "#666", textAlign: "center" }}>Loading performance data...</p>
          ) : performanceData.length === 0 ? (
            <p style={{ color: "#666", textAlign: "center" }}>No test results yet. Start with a test to see your performance!</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                }}
              >
                <thead>
                  <tr style={{ borderBottom: "2px solid #e2e8f0" }}>
                    <th style={{ padding: "12px", textAlign: "left", color: "#64748b", fontWeight: "600", fontSize: "13px" }}>
                      Date
                    </th>
                    <th style={{ padding: "12px", textAlign: "left", color: "#64748b", fontWeight: "600", fontSize: "13px" }}>
                      Topic
                    </th>
                    <th style={{ padding: "12px", textAlign: "left", color: "#64748b", fontWeight: "600", fontSize: "13px" }}>
                      Difficulty
                    </th>
                    <th style={{ padding: "12px", textAlign: "left", color: "#64748b", fontWeight: "600", fontSize: "13px" }}>
                      Score
                    </th>
                    <th style={{ padding: "12px", textAlign: "left", color: "#64748b", fontWeight: "600", fontSize: "13px" }}>
                      Time (mins)
                    </th>
                    <th style={{ padding: "12px", textAlign: "left", color: "#64748b", fontWeight: "600", fontSize: "13px" }}>
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {performanceData.map((record, idx) => (
                    <tr
                      key={idx}
                      style={{ borderBottom: "1px solid #e2e8f0", transition: "all 0.2s ease" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <td style={{ padding: "12px", color: "#334155", fontSize: "13px" }}>
                        {record.date}
                      </td>
                      <td style={{ padding: "12px", color: "#334155", fontSize: "13px" }}>
                        {record.topic}
                      </td>
                      <td style={{ padding: "12px", color: "#334155", fontSize: "13px" }}>
                        <span style={{
                          padding: "4px 8px",
                          borderRadius: "4px",
                          fontSize: "12px",
                          fontWeight: "500",
                          background: record.difficulty === "easy" ? "#d1fae5" : record.difficulty === "medium" ? "#fef3c7" : "#fee2e2",
                          color: record.difficulty === "easy" ? "#065f46" : record.difficulty === "medium" ? "#92400e" : "#991b1b"
                        }}>
                          {record.difficulty}
                        </span>
                      </td>
                      <td style={{ padding: "12px", fontSize: "13px" }}>
                        <span
                          style={{
                            padding: "4px 12px",
                            borderRadius: "16px",
                            fontWeight: "600",
                            color: record.score >= 80 ? "#065f46" : record.score >= 70 ? "#92400e" : "#991b1b",
                            background: record.score >= 80 ? "#d1fae5" : record.score >= 70 ? "#fef3c7" : "#fee2e2",
                          }}
                        >
                          {record.score}%
                        </span>
                      </td>
                      <td style={{ padding: "12px", color: "#334155", fontSize: "13px" }}>
                        {record.timeSpent}
                      </td>
                      <td style={{ padding: "12px", fontSize: "13px" }}>
                        {record.score >= 80 ? "✅ Excellent" : record.score >= 70 ? "⚠️ Good" : "❌ Needs Work"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Chart */}
        <div
          style={{
            background: "white",
            borderRadius: "16px",
            padding: "24px",
            boxShadow: "0 4px 24px rgba(0, 0, 0, 0.08)",
          }}
        >
          <h2 style={{ color: "#1e293b", marginBottom: "12px", fontSize: "20px", fontWeight: "700" }}>
            📊 Score Trend
          </h2>
          {performanceData.length === 0 ? (
            <div
              style={{
                background: "#f8fafc",
                padding: "32px",
                borderRadius: "12px",
                color: "#64748b",
                textAlign: "center",
              }}
            >
              <p>No test results yet to plot.</p>
            </div>
          ) : (
            (() => {
              const h = 180;
              const w = Math.max(360, performanceData.length * 80);
              const padding = { top: 20, right: 20, bottom: 30, left: 32 };
              const usableW = w - padding.left - padding.right;
              const usableH = h - padding.top - padding.bottom;
              const sorted = [...performanceData].sort((a, b) => a.ts - b.ts);
              const step = sorted.length > 1 ? usableW / (sorted.length - 1) : usableW / 2;

              const points = sorted.map((r, idx) => {
                const x = padding.left + idx * step;
                const y = padding.top + (1 - Math.min(Math.max(r.score, 0), 100) / 100) * usableH;
                return { x, y, label: `${r.date} • ${r.topic} • ${r.score}%` };
              });

              const pathD = points
                .map((p, idx) => `${idx === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
                .join(" ");

              return (
                <div style={{ overflowX: "auto" }}>
                  <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Score trend line chart">
                    {/* Axes */}
                    <line x1={padding.left} y1={padding.top} x2={padding.left} y2={h - padding.bottom} stroke="#e2e8f0" />
                    <line x1={padding.left} y1={h - padding.bottom} x2={w - padding.right} y2={h - padding.bottom} stroke="#e2e8f0" />
                    {/* Y ticks */}
                    {[0, 25, 50, 75, 100].map((t) => {
                      const y = padding.top + (1 - t / 100) * usableH;
                      return (
                        <g key={t}>
                          <line x1={padding.left - 6} y1={y} x2={padding.left} y2={y} stroke="#cbd5e1" />
                          <text x={padding.left - 10} y={y + 4} textAnchor="end" fontSize="10" fill="#64748b">
                            {t}
                          </text>
                        </g>
                      );
                    })}

                    {/* Line */}
                    <path d={pathD} fill="none" stroke="#0073e6" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

                    {/* Points */}
                    {points.map((p, idx) => (
                      <g key={idx}>
                        <circle cx={p.x} cy={p.y} r={5} fill="#0073e6" stroke="white" strokeWidth={2} />
                        <title>{p.label}</title>
                      </g>
                    ))}

                    {/* X labels */}
                    {points.map((p, idx) => (
                      <text
                        key={`lbl-${idx}`}
                        x={p.x}
                        y={h - padding.bottom + 12}
                        fontSize="10"
                        fill="#64748b"
                        textAnchor="middle"
                      >
                        {sorted[idx].date}
                      </text>
                    ))}
                  </svg>
                </div>
              );
            })()
          )}
        </div>
          </>
        )}

        {/* ===== TAB: Communication Feedback Report ===== */}
        {activeTab === "comm-report" && (
          <div>
            {commLoading && (
              <div style={{
                background: "white", borderRadius: "16px", padding: "60px 24px",
                boxShadow: "0 4px 24px rgba(0,0,0,0.08)", textAlign: "center",
              }}>
                <div style={{
                  width: "48px", height: "48px", border: "4px solid #e2e8f0",
                  borderTop: "4px solid #0073e6", borderRadius: "50%",
                  margin: "0 auto 16px", animation: "spin 1s linear infinite",
                }} />
                <p style={{ color: "#334155", fontWeight: "600", fontSize: "16px" }}>
                  Analyzing your communication skills...
                </p>
                <p style={{ color: "#64748b", fontSize: "13px" }}>
                  GPT is reviewing your test results and generating personalized feedback
                </p>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            )}

            {commError && (
              <div style={{
                background: "#fee2e2", borderRadius: "12px", padding: "20px",
                color: "#991b1b", marginBottom: "16px",
              }}>
                {commError}
                <button onClick={fetchCommFeedback} style={{
                  marginLeft: "12px", padding: "6px 16px", background: "#dc2626",
                  color: "white", border: "none", borderRadius: "6px", cursor: "pointer",
                  fontWeight: "600", fontSize: "13px",
                }}>Retry</button>
              </div>
            )}

            {commReport && !commReport.has_data && (
              <div style={{
                background: "white", borderRadius: "16px", padding: "60px 24px",
                boxShadow: "0 4px 24px rgba(0,0,0,0.08)", textAlign: "center",
              }}>
                <div style={{ fontSize: "48px", marginBottom: "16px" }}>{"\uD83D\uDCDD"}</div>
                <h3 style={{ color: "#1e293b", marginBottom: "8px" }}>No Communication Tests Yet</h3>
                <p style={{ color: "#64748b", marginBottom: "20px" }}>
                  Take a communication test first to get your personalized feedback report.
                </p>
                <button onClick={() => navigate("/communication-test")} style={{
                  padding: "12px 28px", background: "#0073e6", color: "white",
                  border: "none", borderRadius: "8px", fontWeight: "600",
                  cursor: "pointer", fontSize: "15px",
                }}>Take Communication Test</button>
              </div>
            )}

            {commReport && commReport.has_data && commReport.report && (() => {
              const rpt = commReport.report;
              return (
                <>
                  {/* Overall Rating Banner */}
                  <div style={{
                    background: "white", borderRadius: "16px", padding: "28px",
                    boxShadow: "0 4px 24px rgba(0,0,0,0.08)", marginBottom: "20px",
                    display: "flex", alignItems: "center", gap: "24px", flexWrap: "wrap",
                  }}>
                    <div style={{
                      width: "90px", height: "90px", borderRadius: "50%",
                      background: ratingBg(rpt.overall_rating),
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0,
                    }}>
                      <span style={{
                        fontSize: "28px", fontWeight: "800",
                        color: ratingColor(rpt.overall_rating),
                      }}>
                        {commReport.overall_average}%
                      </span>
                    </div>
                    <div style={{ flex: 1, minWidth: "200px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "6px" }}>
                        <h2 style={{ color: "#1e293b", fontSize: "22px", fontWeight: "800", margin: 0 }}>
                          Communication Skills Report
                        </h2>
                        <span style={{
                          padding: "4px 14px", borderRadius: "20px", fontSize: "13px",
                          fontWeight: "700", background: ratingBg(rpt.overall_rating),
                          color: ratingColor(rpt.overall_rating),
                        }}>{rpt.overall_rating}</span>
                      </div>
                      <p style={{ color: "#334155", fontSize: "14px", lineHeight: "1.6", margin: 0 }}>
                        {rpt.overall_summary}
                      </p>
                      <p style={{ color: "#64748b", fontSize: "12px", margin: "8px 0 0 0" }}>
                        Based on {commReport.tests_analyzed} communication test{commReport.tests_analyzed > 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>

                  {/* Strengths & Weaknesses */}
                  <div style={{
                    display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px",
                    marginBottom: "20px",
                  }}>
                    {/* Strengths */}
                    <div style={{
                      background: "white", borderRadius: "16px", padding: "24px",
                      boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
                      borderLeft: "4px solid #059669",
                    }}>
                      <h3 style={{ color: "#059669", fontSize: "16px", fontWeight: "700", margin: "0 0 16px 0" }}>
                        {"\u2705"} Strengths
                      </h3>
                      {(rpt.strengths || []).map((s, i) => (
                        <div key={i} style={{ marginBottom: "12px" }}>
                          <p style={{ color: "#1e293b", fontWeight: "600", fontSize: "14px", margin: "0 0 2px 0" }}>
                            {s.area}
                          </p>
                          <p style={{ color: "#64748b", fontSize: "13px", margin: 0, lineHeight: "1.5" }}>
                            {s.detail}
                          </p>
                        </div>
                      ))}
                    </div>
                    {/* Weaknesses */}
                    <div style={{
                      background: "white", borderRadius: "16px", padding: "24px",
                      boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
                      borderLeft: "4px solid #dc2626",
                    }}>
                      <h3 style={{ color: "#dc2626", fontSize: "16px", fontWeight: "700", margin: "0 0 16px 0" }}>
                        {"\u26A0\uFE0F"} Areas to Improve
                      </h3>
                      {(rpt.weaknesses || []).map((w, i) => (
                        <div key={i} style={{ marginBottom: "12px" }}>
                          <p style={{ color: "#1e293b", fontWeight: "600", fontSize: "14px", margin: "0 0 2px 0" }}>
                            {w.area}
                          </p>
                          <p style={{ color: "#64748b", fontSize: "13px", margin: 0, lineHeight: "1.5" }}>
                            {w.detail}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Section-wise Feedback */}
                  <div style={{
                    background: "white", borderRadius: "16px", padding: "24px",
                    boxShadow: "0 4px 24px rgba(0,0,0,0.08)", marginBottom: "20px",
                  }}>
                    <h3 style={{ color: "#1e293b", fontSize: "18px", fontWeight: "700", margin: "0 0 20px 0" }}>
                      Section-wise Analysis
                    </h3>
                    {(rpt.section_feedback || []).map((sf, i) => (
                      <div key={i} style={{
                        padding: "16px", borderRadius: "12px", background: "#f8fafc",
                        marginBottom: i < (rpt.section_feedback || []).length - 1 ? "12px" : 0,
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                          <h4 style={{ color: "#1e293b", fontSize: "15px", fontWeight: "700", margin: 0 }}>
                            {sf.section}
                          </h4>
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            <span style={{
                              padding: "3px 10px", borderRadius: "12px", fontSize: "12px",
                              fontWeight: "600", background: ratingBg(sf.rating),
                              color: ratingColor(sf.rating),
                            }}>{sf.rating}</span>
                            <span style={{ fontWeight: "700", color: "#1e293b", fontSize: "15px" }}>
                              {sf.score}%
                            </span>
                          </div>
                        </div>
                        {/* Score bar */}
                        <div style={{
                          height: "6px", background: "#e2e8f0", borderRadius: "3px",
                          marginBottom: "10px", overflow: "hidden",
                        }}>
                          <div style={{
                            height: "100%", borderRadius: "3px",
                            width: `${Math.min(100, sf.score || 0)}%`,
                            background: sf.score >= 80 ? "#059669" : sf.score >= 60 ? "#0073e6" : sf.score >= 40 ? "#d97706" : "#dc2626",
                            transition: "width 0.5s ease",
                          }} />
                        </div>
                        <p style={{ color: "#334155", fontSize: "13px", lineHeight: "1.6", margin: "0 0 8px 0" }}>
                          {sf.feedback}
                        </p>
                        {sf.tips && sf.tips.length > 0 && (
                          <div style={{ paddingLeft: "12px", borderLeft: "2px solid #0073e6" }}>
                            {sf.tips.map((tip, ti) => (
                              <p key={ti} style={{ color: "#0073e6", fontSize: "12px", margin: "4px 0", fontWeight: "500" }}>
                                {"\uD83D\uDCA1"} {tip}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Speaking / Writing Analysis */}
                  {rpt.speaking_analysis && (
                    <div style={{
                      background: "white", borderRadius: "16px", padding: "24px",
                      boxShadow: "0 4px 24px rgba(0,0,0,0.08)", marginBottom: "20px",
                    }}>
                      <h3 style={{ color: "#1e293b", fontSize: "18px", fontWeight: "700", margin: "0 0 20px 0" }}>
                        {"\uD83C\uDF99\uFE0F"} Speaking & Writing Analysis
                      </h3>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
                        {[
                          { key: "fluency", label: "Fluency", icon: "\uD83D\uDDE3\uFE0F" },
                          { key: "grammar_accuracy", label: "Grammar Accuracy", icon: "\u2705" },
                          { key: "vocabulary_range", label: "Vocabulary Range", icon: "\uD83D\uDCDA" },
                          { key: "professionalism", label: "Professionalism", icon: "\uD83D\uDC54" },
                          { key: "confidence_indicators", label: "Confidence", icon: "\uD83D\uDCAA" },
                        ].map((item) => (
                          <div key={item.key} style={{
                            background: "#f8fafc", borderRadius: "12px", padding: "16px",
                          }}>
                            <p style={{ fontSize: "13px", fontWeight: "700", color: "#1e293b", margin: "0 0 6px 0" }}>
                              {item.icon} {item.label}
                            </p>
                            <p style={{ fontSize: "13px", color: "#334155", margin: 0, lineHeight: "1.5" }}>
                              {rpt.speaking_analysis[item.key] || "No data"}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Improvement Plan */}
                  {rpt.improvement_plan && rpt.improvement_plan.length > 0 && (
                    <div style={{
                      background: "white", borderRadius: "16px", padding: "24px",
                      boxShadow: "0 4px 24px rgba(0,0,0,0.08)", marginBottom: "20px",
                    }}>
                      <h3 style={{ color: "#1e293b", fontSize: "18px", fontWeight: "700", margin: "0 0 20px 0" }}>
                        {"\uD83D\uDCC5"} Personalized Improvement Plan
                      </h3>
                      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                        {rpt.improvement_plan.map((plan, i) => (
                          <div key={i} style={{
                            flex: "1 1 220px", background: "#f8fafc", borderRadius: "12px",
                            padding: "16px", borderTop: "3px solid #0073e6",
                          }}>
                            <p style={{ color: "#0073e6", fontWeight: "700", fontSize: "13px", margin: "0 0 4px 0" }}>
                              {plan.week}
                            </p>
                            <p style={{ color: "#1e293b", fontWeight: "600", fontSize: "14px", margin: "0 0 8px 0" }}>
                              {plan.focus}
                            </p>
                            <ul style={{ margin: 0, paddingLeft: "18px" }}>
                              {(plan.activities || []).map((act, ai) => (
                                <li key={ai} style={{ color: "#334155", fontSize: "13px", marginBottom: "4px" }}>
                                  {act}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Recommended Resources */}
                  {rpt.recommended_resources && rpt.recommended_resources.length > 0 && (
                    <div style={{
                      background: "white", borderRadius: "16px", padding: "24px",
                      boxShadow: "0 4px 24px rgba(0,0,0,0.08)", marginBottom: "20px",
                    }}>
                      <h3 style={{ color: "#1e293b", fontSize: "18px", fontWeight: "700", margin: "0 0 20px 0" }}>
                        {"\uD83D\uDCDA"} Recommended Resources
                      </h3>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "12px" }}>
                        {rpt.recommended_resources.map((res, i) => (
                          <div key={i} style={{
                            display: "flex", gap: "12px", alignItems: "flex-start",
                            padding: "14px", background: "#f8fafc", borderRadius: "10px",
                          }}>
                            <span style={{
                              padding: "4px 10px", borderRadius: "6px", fontSize: "11px",
                              fontWeight: "700", background: "#dbeafe", color: "#0073e6",
                              whiteSpace: "nowrap",
                            }}>{res.type}</span>
                            <div>
                              <p style={{ color: "#1e293b", fontWeight: "600", fontSize: "13px", margin: "0 0 2px 0" }}>
                                {res.title}
                              </p>
                              <p style={{ color: "#64748b", fontSize: "12px", margin: 0 }}>
                                {res.why}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Regenerate / Retake */}
                  <div style={{ display: "flex", gap: "12px", justifyContent: "center", marginTop: "8px" }}>
                    <button onClick={fetchCommFeedback} style={{
                      padding: "12px 28px", background: "white", color: "#0073e6",
                      border: "2px solid #0073e6", borderRadius: "8px", fontWeight: "600",
                      cursor: "pointer", fontSize: "14px",
                    }}>Regenerate Report</button>
                    <button onClick={() => navigate("/communication-test")} style={{
                      padding: "12px 28px", background: "#0073e6", color: "white",
                      border: "none", borderRadius: "8px", fontWeight: "600",
                      cursor: "pointer", fontSize: "14px",
                    }}>Take Another Test</button>
                  </div>
                </>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

export default Performance;
