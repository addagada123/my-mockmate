import React from "react";

function badgeStyle(bg, color) {
  return {
    padding: "4px 10px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: "700",
    backgroundColor: bg,
    color,
  };
}

export default function CameraProctorPanel({
  videoRef,
  permissionState,
  cameraOn,
  strictMode,
  onStrictModeChange,
  onRetryCamera,
  onTakeSnapshot,
  snapshots = [],
  compact = false,
}) {
  const statusBadge = permissionState === "granted" && cameraOn
    ? badgeStyle("#d1fae5", "#065f46")
    : permissionState === "denied"
      ? badgeStyle("#fee2e2", "#991b1b")
      : badgeStyle("#fef3c7", "#92400e");

  const statusText = permissionState === "granted" && cameraOn
    ? "Camera On"
    : permissionState === "denied"
      ? "Permission Denied"
      : permissionState === "unsupported"
        ? "Unsupported"
        : "Camera Needed";

  return (
    <div
      style={{
        background: "white",
        border: "1px solid rgba(99,102,241,0.12)",
        borderRadius: "14px",
        padding: compact ? "12px" : "16px",
        boxShadow: "0 8px 24px rgba(15,23,42,0.06)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px", gap: "12px" }}>
        <div>
          <div style={{ fontSize: "14px", fontWeight: "700", color: "#1e293b" }}>Interview Camera Preview</div>
          <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
            Live local preview only. No continuous recording.
          </div>
        </div>
        <span style={statusBadge}>{statusText}</span>
      </div>

      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "4 / 3",
          borderRadius: "12px",
          overflow: "hidden",
          background: permissionState === "granted" ? "#0f172a" : "#f8fafc",
          border: "1px solid rgba(148,163,184,0.25)",
        }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: permissionState === "granted" ? "block" : "none",
            transform: "scaleX(-1)",
          }}
        />
        {permissionState !== "granted" && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", textAlign: "center", color: "#475569", fontSize: "13px", lineHeight: 1.5 }}>
            {permissionState === "denied"
              ? "Camera access was denied. You can continue in fallback mode, but proctoring compliance will be reduced."
              : permissionState === "unsupported"
                ? "Camera is not supported in this browser."
                : "Allow camera access to simulate a real interview setup."}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "12px", alignItems: "center" }}>
        <button
          onClick={onRetryCamera}
          style={{
            padding: "10px 14px",
            borderRadius: "10px",
            border: "none",
            background: "#6366f1",
            color: "white",
            fontWeight: "700",
            cursor: "pointer",
          }}
        >
          {permissionState === "granted" ? "Refresh Camera" : "Enable Camera"}
        </button>
        <button
          onClick={onTakeSnapshot}
          style={{
            padding: "10px 14px",
            borderRadius: "10px",
            border: "1px solid rgba(99,102,241,0.2)",
            background: "#eef2ff",
            color: "#4338ca",
            fontWeight: "700",
            cursor: "pointer",
          }}
          disabled={permissionState !== "granted"}
        >
          Snapshot Check
        </button>
        <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#334155", fontWeight: "600" }}>
          <input
            type="checkbox"
            checked={strictMode}
            onChange={(e) => onStrictModeChange(e.target.checked)}
          />
          Strict snapshot mode
        </label>
      </div>

      {snapshots.length > 0 && (
        <div style={{ marginTop: "12px" }}>
          <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "8px", fontWeight: "700" }}>
            Recent snapshot checks
          </div>
          <div style={{ display: "flex", gap: "8px", overflowX: "auto" }}>
            {snapshots.map((snapshot) => (
              <img
                key={snapshot.id}
                src={snapshot.dataUrl}
                alt="snapshot"
                style={{
                  width: compact ? "64px" : "76px",
                  height: compact ? "48px" : "56px",
                  objectFit: "cover",
                  borderRadius: "8px",
                  border: "1px solid rgba(148,163,184,0.25)",
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
