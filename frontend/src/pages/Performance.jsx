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
              Ã°Å¸â€œÅ  Performance Analytics
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
              Ã¢â€ Â Back to Dashboard
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
            Ã°Å¸â€œË† Overall Statistics
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
            Ã°Å¸â€œâ€¹ All Test Results
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
                        {record.score >= 80 ? "Ã¢Å“â€¦ Excellent" : record.score >= 70 ? "Ã¢Å¡Â Ã¯Â¸Â Good" : "Ã¢ÂÅ’ Needs Work"}
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
            Ã°Å¸â€œÅ  Score Trend
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
                return { x, y, label: `${r.date} Ã¢â‚¬Â¢ ${r.topic} Ã¢â‚¬Â¢ ${r.score}%` };
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
      </div>
    </div>
  );
}

export default Performance;
