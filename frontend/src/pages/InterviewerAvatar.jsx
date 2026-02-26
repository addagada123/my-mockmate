import React from "react";

/**
 * Animated SVG interviewer avatar.
 *
 * Props:
 *   isTalking  – true while TTS is reading the question (mouth animates)
 *   isListening – true while the user's mic / STT is active (head nods)
 *   size        – pixel width/height of the avatar (default 120)
 */
const InterviewerAvatar = ({ isTalking = false, isListening = false, size = 120 }) => {
  const styles = `
    @keyframes mouthTalk {
      0%, 100% { ry: 2; rx: 6; }
      30% { ry: 7; rx: 8; }
      60% { ry: 4; rx: 7; }
    }
    @keyframes headNod {
      0%, 100% { transform: rotate(0deg); }
      25% { transform: rotate(4deg); }
      50% { transform: rotate(-3deg); }
      75% { transform: rotate(2deg); }
    }
    @keyframes blink {
      0%, 92%, 100% { ry: 5; }
      95% { ry: 0.5; }
    }
    @keyframes breathe {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-1.5px); }
    }
    @keyframes pulseGlow {
      0%, 100% { filter: drop-shadow(0 0 4px rgba(102,126,234,0.3)); }
      50% { filter: drop-shadow(0 0 10px rgba(102,126,234,0.6)); }
    }
  `;

  return (
    <div
      style={{
        width: size,
        height: size + 28,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "6px",
        userSelect: "none",
      }}
    >
      <style>{styles}</style>
      <svg
        viewBox="0 0 120 120"
        width={size}
        height={size}
        style={{
          animation: isListening
            ? "pulseGlow 1.5s ease-in-out infinite"
            : "breathe 3s ease-in-out infinite",
        }}
      >
        {/* Head group – nods when listening */}
        <g
          style={{
            transformOrigin: "60px 70px",
            animation: isListening ? "headNod 0.9s ease-in-out infinite" : "none",
          }}
        >
          {/* Hair */}
          <ellipse cx="60" cy="38" rx="36" ry="28" fill="#3b2f2f" />

          {/* Face */}
          <ellipse cx="60" cy="52" rx="32" ry="30" fill="#fdd7a0" />

          {/* Ears */}
          <ellipse cx="28" cy="52" rx="5" ry="7" fill="#f5c882" />
          <ellipse cx="92" cy="52" rx="5" ry="7" fill="#f5c882" />

          {/* Left eyebrow */}
          <path d="M40 38 Q45 34 52 37" stroke="#3b2f2f" strokeWidth="1.5" fill="none" />
          {/* Right eyebrow */}
          <path d="M68 37 Q75 34 80 38" stroke="#3b2f2f" strokeWidth="1.5" fill="none" />

          {/* Left eye */}
          <ellipse
            cx="46"
            cy="48"
            rx="5"
            ry="5"
            fill="white"
          />
          <ellipse cx="46" cy="48" rx="2.5" ry="2.5" fill="#1e293b" />
          {/* Left eye blink overlay */}
          <ellipse
            cx="46"
            cy="48"
            rx="5"
            fill="#fdd7a0"
            style={{ animation: "blink 4s ease-in-out infinite" }}
          />

          {/* Right eye */}
          <ellipse
            cx="74"
            cy="48"
            rx="5"
            ry="5"
            fill="white"
          />
          <ellipse cx="74" cy="48" rx="2.5" ry="2.5" fill="#1e293b" />
          {/* Right eye blink overlay */}
          <ellipse
            cx="74"
            cy="48"
            rx="5"
            fill="#fdd7a0"
            style={{ animation: "blink 4s ease-in-out infinite" }}
          />

          {/* Nose */}
          <path d="M58 55 Q60 60 62 55" stroke="#d4a56a" strokeWidth="1.2" fill="none" />

          {/* Mouth */}
          {isTalking ? (
            <ellipse
              cx="60"
              cy="67"
              rx="6"
              ry="2"
              fill="#c0392b"
              style={{ animation: "mouthTalk 0.35s ease-in-out infinite" }}
            />
          ) : (
            /* Resting smile */
            <path d="M52 66 Q60 72 68 66" stroke="#c0392b" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          )}

          {/* Glasses (optional professional look) */}
          <circle cx="46" cy="48" r="9" stroke="#667eea" strokeWidth="1.5" fill="none" />
          <circle cx="74" cy="48" r="9" stroke="#667eea" strokeWidth="1.5" fill="none" />
          <line x1="55" y1="48" x2="65" y2="48" stroke="#667eea" strokeWidth="1.2" />
        </g>

        {/* Collar / Shirt hint */}
        <path d="M35 82 Q60 95 85 82 L92 110 Q60 115 28 110 Z" fill="#667eea" />
        {/* Tie */}
        <polygon points="57,84 63,84 62,100 58,100" fill="#4338ca" />
        <polygon points="56,100 64,100 60,108" fill="#4338ca" />
      </svg>

      {/* Status label */}
      <div
        style={{
          fontSize: "11px",
          fontWeight: "600",
          color: isTalking ? "#c0392b" : isListening ? "#059669" : "#94a3b8",
          textAlign: "center",
          lineHeight: "1.2",
          transition: "color 0.3s ease",
        }}
      >
        {isTalking ? "🗣️ Asking..." : isListening ? "👂 Listening..." : "😊 Ready"}
      </div>
    </div>
  );
};

export default InterviewerAvatar;
