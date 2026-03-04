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
    { label: "Best Score", value: "0%" },
    { label: "Worst Score", value: "0%" },
    { label: "Median Score", value: "0%" },
    { label: "Percentile", value: "—" },
    { label: "Streak 🔥", value: "0 / 0" },
    { label: "Improvement", value: "—" },
  ]);
  const [topicBreakdown, setTopicBreakdown] = useState([]);
  const [difficultyBreakdown, setDifficultyBreakdown] = useState({});
  const [timeEfficiency, setTimeEfficiency] = useState(null);
  const [studyRecommendations, setStudyRecommendations] = useState([]);
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
                tabSwitches: r.tabSwitches || 0,
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
            { label: "Best Score", value: `${stats.bestScore?.toFixed(1) || 0}%` },
            { label: "Worst Score", value: `${stats.worstScore?.toFixed(1) || 0}%` },
            { label: "Median Score", value: `${stats.medianScore?.toFixed(1) || 0}%` },
            { label: "Percentile", value: stats.percentileRank != null ? `Top ${(100 - stats.percentileRank).toFixed(0)}%` : "—" },
            { label: "Streak 🔥", value: `${stats.currentStreak || 0} / ${stats.bestStreak || 0}` },
            { label: "Improvement", value: stats.improvementRate != null ? `${stats.improvementRate > 0 ? "+" : ""}${stats.improvementRate}/test` : "—" },
          ]);
          setTopicBreakdown(response.data.topicBreakdown || []);
          setDifficultyBreakdown(response.data.difficultyBreakdown || {});
          setTimeEfficiency(response.data.timeEfficiency || null);
          setStudyRecommendations(response.data.studyRecommendations || []);
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
    if (r === "good") return "#6366f1";
    if (r === "average") return "#d97706";
    return "#dc2626";
  };

  const ratingBg = (rating) => {
    if (!rating) return "#f1f5f9";
    const r = rating.toLowerCase();
    if (r === "excellent") return "#d1fae5";
    if (r === "good") return "#e0e7ff";
    if (r === "average") return "#fef3c7";
    return "#fee2e2";
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f5f3ff",
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
                  color: "#6366f1",
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
                  color: "#6366f1",
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
                background: activeTab === tab.key ? "#6366f1" : "transparent",
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
            boxShadow: "0 4px 24px rgba(99, 102, 241, 0.08)",
            marginBottom: "24px",
            border: "1px solid rgba(99,102,241,0.06)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "4px", background: "linear-gradient(135deg, #6366f1, #8b5cf6, #06b6d4)" }} />
          <h2 style={{ color: "#1e1b4b", marginBottom: "20px", fontSize: "20px", fontWeight: "700" }}>
            📈 Overall Statistics
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "16px",
            }}
          >
            {overallStats.map((stat, idx) => (
              <div
                key={stat.label}
                style={{
                  background: idx % 3 === 0 ? "linear-gradient(135deg, #6366f1, #8b5cf6)" : idx % 3 === 1 ? "linear-gradient(135deg, #06b6d4, #14b8a6)" : "linear-gradient(135deg, #f97316, #f59e0b)",
                  borderRadius: "12px",
                  padding: "20px",
                  color: "white",
                  textAlign: "center",
                  boxShadow: idx % 3 === 0 ? "0 4px 12px rgba(99,102,241,0.3)" : idx % 3 === 1 ? "0 4px 12px rgba(6,182,212,0.3)" : "0 4px 12px rgba(245,158,11,0.3)",
                  transition: "transform 0.2s ease",
                }}
                onMouseEnter={(e) => e.currentTarget.style.transform = "translateY(-2px)"}
                onMouseLeave={(e) => e.currentTarget.style.transform = "translateY(0)"}
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
            boxShadow: "0 4px 24px rgba(99, 102, 241, 0.06)",
            marginBottom: "24px",
            border: "1px solid rgba(99,102,241,0.06)",
          }}
        >
          <h2 style={{ color: "#1e1b4b", marginBottom: "20px", fontSize: "20px", fontWeight: "700" }}>
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
                      Tab Switches
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
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#f5f3ff")}
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
                        {record.tabSwitches > 0 ? (
                          <span style={{
                            padding: "3px 8px", borderRadius: "4px", fontSize: "12px", fontWeight: "600",
                            background: record.tabSwitches >= 3 ? "#fee2e2" : "#fef3c7",
                            color: record.tabSwitches >= 3 ? "#991b1b" : "#92400e",
                          }}>
                            ⚠️ {record.tabSwitches}
                          </span>
                        ) : (
                          <span style={{ color: "#10b981", fontWeight: "600", fontSize: "12px" }}>✅ 0</span>
                        )}
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
            boxShadow: "0 4px 24px rgba(99, 102, 241, 0.06)",
            border: "1px solid rgba(99,102,241,0.06)",
          }}
        >
          <h2 style={{ color: "#1e1b4b", marginBottom: "12px", fontSize: "20px", fontWeight: "700" }}>
            📊 Score Trend
          </h2>
          {performanceData.length === 0 ? (
            <div
              style={{
                background: "#f5f3ff",
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
                    <path d={pathD} fill="none" stroke="#6366f1" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

                    {/* Points */}
                    {points.map((p, idx) => (
                      <g key={idx}>
                        <circle cx={p.x} cy={p.y} r={5} fill="#6366f1" stroke="white" strokeWidth={2} />
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

        {/* Topic-wise Breakdown */}
        {topicBreakdown.length > 0 && (
          <div
            style={{
              background: "white",
              borderRadius: "16px",
              padding: "24px",
              boxShadow: "0 4px 24px rgba(0, 0, 0, 0.08)",
              marginTop: "24px",
            }}
          >
            <h2 style={{ color: "#1e293b", marginBottom: "20px", fontSize: "20px", fontWeight: "700" }}>
              🎯 Topic-wise Breakdown
            </h2>
            <div style={{ display: "grid", gap: "12px" }}>
              {topicBreakdown.map((t, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: "16px",
                    borderRadius: "12px",
                    background: "#f5f3ff",
                    borderLeft: `4px solid ${t.status === "strong" ? "#10b981" : t.status === "moderate" ? "#f59e0b" : "#ef4444"}`,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <h4 style={{ margin: 0, color: "#1e293b", fontSize: "15px", fontWeight: "700" }}>{t.topic}</h4>
                      <span style={{
                        padding: "2px 8px", borderRadius: "10px", fontSize: "11px", fontWeight: "600",
                        background: t.status === "strong" ? "#d1fae5" : t.status === "moderate" ? "#fef3c7" : "#fee2e2",
                        color: t.status === "strong" ? "#065f46" : t.status === "moderate" ? "#92400e" : "#991b1b",
                      }}>
                        {t.status === "strong" ? "💪 Strong" : t.status === "moderate" ? "📈 Moderate" : "📚 Needs Work"}
                      </span>
                    </div>
                    <span style={{ fontWeight: "700", fontSize: "18px", color: t.averageScore >= 75 ? "#10b981" : t.averageScore >= 55 ? "#f59e0b" : "#ef4444" }}>
                      {t.averageScore}%
                    </span>
                  </div>
                  <div style={{ height: "6px", background: "#e2e8f0", borderRadius: "3px", marginBottom: "8px", overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: "3px",
                      width: `${Math.min(100, t.averageScore)}%`,
                      background: t.averageScore >= 75 ? "#10b981" : t.averageScore >= 55 ? "#f59e0b" : "#ef4444",
                      transition: "width 0.5s ease",
                    }} />
                  </div>
                  <div style={{ display: "flex", gap: "16px", fontSize: "12px", color: "#64748b" }}>
                    <span>{t.attempts} attempt{t.attempts > 1 ? "s" : ""}</span>
                    <span>Best: {t.bestScore}%</span>
                    <span>Worst: {t.worstScore}%</span>
                    {t.improvement !== 0 && (
                      <span style={{ color: t.improvement > 0 ? "#10b981" : "#ef4444", fontWeight: "600" }}>
                        {t.improvement > 0 ? "↑" : "↓"} {Math.abs(t.improvement).toFixed(1)}% improvement
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Difficulty Breakdown */}
        {Object.keys(difficultyBreakdown).length > 0 && (
          <div
            style={{
              background: "white",
              borderRadius: "16px",
              padding: "24px",
              boxShadow: "0 4px 24px rgba(0, 0, 0, 0.08)",
              marginTop: "24px",
            }}
          >
            <h2 style={{ color: "#1e293b", marginBottom: "20px", fontSize: "20px", fontWeight: "700" }}>
              ⚡ Difficulty Breakdown
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
              {Object.entries(difficultyBreakdown).map(([diff, data]) => (
                <div
                  key={diff}
                  style={{
                    padding: "20px",
                    borderRadius: "12px",
                    background: diff === "easy" ? "#ecfdf5" : diff === "medium" ? "#fffbeb" : "#fef2f2",
                    textAlign: "center",
                  }}
                >
                  <p style={{ fontSize: "13px", fontWeight: "600", color: "#64748b", margin: "0 0 4px 0", textTransform: "capitalize" }}>
                    {diff}
                  </p>
                  <p style={{ fontSize: "28px", fontWeight: "700", margin: "0 0 4px 0", color: diff === "easy" ? "#065f46" : diff === "medium" ? "#92400e" : "#991b1b" }}>
                    {data.averageScore}%
                  </p>
                  <p style={{ fontSize: "12px", color: "#64748b", margin: 0 }}>
                    {data.attempts} test{data.attempts > 1 ? "s" : ""} · Best: {data.bestScore}%
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Time Efficiency */}
        {timeEfficiency && (
          <div
            style={{
              background: "white",
              borderRadius: "16px",
              padding: "24px",
              boxShadow: "0 4px 24px rgba(0, 0, 0, 0.08)",
              marginTop: "24px",
            }}
          >
            <h2 style={{ color: "#1e293b", marginBottom: "20px", fontSize: "20px", fontWeight: "700" }}>
              ⏱️ Time Efficiency
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "16px" }}>
              {[
                { label: "Avg Time", value: `${timeEfficiency.averageTimeMinutes} min`, color: "#6366f1" },
                { label: "Score/Min", value: timeEfficiency.scorePerMinute.toFixed(1), color: "#10b981" },
                { label: "Fastest", value: `${timeEfficiency.fastestTest} min`, color: "#8b5cf6" },
                { label: "Slowest", value: `${timeEfficiency.slowestTest} min`, color: "#f59e0b" },
              ].map((m) => (
                <div key={m.label} style={{ padding: "16px", borderRadius: "12px", background: "#f5f3ff", textAlign: "center" }}>
                  <p style={{ fontSize: "12px", color: "#64748b", margin: "0 0 4px 0", fontWeight: "600" }}>{m.label}</p>
                  <p style={{ fontSize: "22px", fontWeight: "700", color: m.color, margin: 0 }}>{m.value}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Study Recommendations */}
        {studyRecommendations.length > 0 && (
          <div
            style={{
              background: "white",
              borderRadius: "16px",
              padding: "24px",
              boxShadow: "0 4px 24px rgba(0, 0, 0, 0.08)",
              marginTop: "24px",
            }}
          >
            <h2 style={{ color: "#1e293b", marginBottom: "20px", fontSize: "20px", fontWeight: "700" }}>
              📝 Study Recommendations
            </h2>
            <div style={{ display: "grid", gap: "12px" }}>
              {studyRecommendations.map((rec, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: "16px",
                    borderRadius: "12px",
                    background: rec.priority === "high" ? "#fef2f2" : rec.priority === "medium" ? "#fffbeb" : "#ecfdf5",
                    borderLeft: `4px solid ${rec.priority === "high" ? "#ef4444" : rec.priority === "medium" ? "#f59e0b" : "#10b981"}`,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                    <h4 style={{ margin: 0, color: "#1e293b", fontSize: "15px", fontWeight: "700" }}>{rec.topic}</h4>
                    <span style={{
                      padding: "2px 8px", borderRadius: "10px", fontSize: "11px", fontWeight: "600",
                      background: rec.priority === "high" ? "#fee2e2" : rec.priority === "medium" ? "#fef3c7" : "#d1fae5",
                      color: rec.priority === "high" ? "#991b1b" : rec.priority === "medium" ? "#92400e" : "#065f46",
                      textTransform: "capitalize",
                    }}>
                      {rec.priority} priority
                    </span>
                  </div>
                  <p style={{ color: "#64748b", fontSize: "13px", margin: "4px 0 0 0" }}>{rec.reason}</p>
                  <p style={{ color: "#334155", fontSize: "13px", margin: "4px 0 0 0", fontWeight: "500" }}>💡 {rec.action}</p>
                </div>
              ))}
            </div>
          </div>
        )}
          </>
        )}

        {/* ===== TAB: Communication Feedback Report ===== */}
        {activeTab === "comm-report" && (
          <div>
            {commLoading && (
              <div style={{
                background: "white", borderRadius: "16px", padding: "60px 24px",
                boxShadow: "0 4px 24px rgba(99,102,241,0.06)", textAlign: "center",
              }}>
                <div style={{
                  width: "48px", height: "48px", border: "4px solid #e2e8f0",
                  borderTop: "4px solid #6366f1", borderRadius: "50%",
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
                boxShadow: "0 4px 24px rgba(99,102,241,0.06)", textAlign: "center",
              }}>
                <div style={{ fontSize: "48px", marginBottom: "16px" }}>{"\uD83D\uDCDD"}</div>
                <h3 style={{ color: "#1e293b", marginBottom: "8px" }}>No Communication Tests Yet</h3>
                <p style={{ color: "#64748b", marginBottom: "20px" }}>
                  Take a communication test first to get your personalized feedback report.
                </p>
                <button onClick={() => navigate("/communication-test")} style={{
                  padding: "12px 28px", background: "#6366f1", color: "white",
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
                    boxShadow: "0 4px 24px rgba(99,102,241,0.06)", marginBottom: "20px",
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
                      boxShadow: "0 4px 24px rgba(99,102,241,0.06)",
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
                      boxShadow: "0 4px 24px rgba(99,102,241,0.06)",
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
                    boxShadow: "0 4px 24px rgba(99,102,241,0.06)", marginBottom: "20px",
                  }}>
                    <h3 style={{ color: "#1e293b", fontSize: "18px", fontWeight: "700", margin: "0 0 20px 0" }}>
                      Section-wise Analysis
                    </h3>
                    {(rpt.section_feedback || []).map((sf, i) => (
                      <div key={i} style={{
                        padding: "16px", borderRadius: "12px", background: "#f5f3ff",
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
                            background: sf.score >= 80 ? "#059669" : sf.score >= 60 ? "#6366f1" : sf.score >= 40 ? "#d97706" : "#dc2626",
                            transition: "width 0.5s ease",
                          }} />
                        </div>
                        <p style={{ color: "#334155", fontSize: "13px", lineHeight: "1.6", margin: "0 0 8px 0" }}>
                          {sf.feedback}
                        </p>
                        {sf.tips && sf.tips.length > 0 && (
                          <div style={{ paddingLeft: "12px", borderLeft: "2px solid #6366f1" }}>
                            {sf.tips.map((tip, ti) => (
                              <p key={ti} style={{ color: "#6366f1", fontSize: "12px", margin: "4px 0", fontWeight: "500" }}>
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
                      boxShadow: "0 4px 24px rgba(99,102,241,0.06)", marginBottom: "20px",
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
                            background: "#f5f3ff", borderRadius: "12px", padding: "16px",
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
                      boxShadow: "0 4px 24px rgba(99,102,241,0.06)", marginBottom: "20px",
                    }}>
                      <h3 style={{ color: "#1e293b", fontSize: "18px", fontWeight: "700", margin: "0 0 20px 0" }}>
                        {"\uD83D\uDCC5"} Personalized Improvement Plan
                      </h3>
                      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                        {rpt.improvement_plan.map((plan, i) => (
                          <div key={i} style={{
                            flex: "1 1 220px", background: "#f5f3ff", borderRadius: "12px",
                            padding: "16px", borderTop: "3px solid #6366f1",
                          }}>
                            <p style={{ color: "#6366f1", fontWeight: "700", fontSize: "13px", margin: "0 0 4px 0" }}>
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
                      boxShadow: "0 4px 24px rgba(99,102,241,0.06)", marginBottom: "20px",
                    }}>
                      <h3 style={{ color: "#1e293b", fontSize: "18px", fontWeight: "700", margin: "0 0 20px 0" }}>
                        {"\uD83D\uDCDA"} Recommended Resources
                      </h3>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "12px" }}>
                        {rpt.recommended_resources.map((res, i) => (
                          <div key={i} style={{
                            display: "flex", gap: "12px", alignItems: "flex-start",
                            padding: "14px", background: "#f5f3ff", borderRadius: "10px",
                          }}>
                            <span style={{
                              padding: "4px 10px", borderRadius: "6px", fontSize: "11px",
                              fontWeight: "700", background: "#e0e7ff", color: "#6366f1",
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
                      padding: "12px 28px", background: "white", color: "#6366f1",
                      border: "2px solid #6366f1", borderRadius: "8px", fontWeight: "600",
                      cursor: "pointer", fontSize: "14px",
                    }}>Regenerate Report</button>
                    <button onClick={() => navigate("/communication-test")} style={{
                      padding: "12px 28px", background: "#6366f1", color: "white",
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
