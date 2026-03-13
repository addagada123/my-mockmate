import React, { useState, useEffect } from "react";
import InterviewerAvatar from "./InterviewerAvatar";

/**
 * Implementation snippet for making the Interviewer Avatar mimic speaking.
 * 
 * 1. Triggered by useEffect when question changes.
 * 2. Uses window.speechSynthesis (TTS).
 * 3. Updates 'isTalking' state which drives the SVG animation.
 */

const InterviewerSpeakingLogic = ({ questionText, active }) => {
  const [isTalking, setIsTalking] = useState(false);

  const speak = (text) => {
    if (!("speechSynthesis" in window)) return;
    
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 1.0;

    // Hook into animation states
    utterance.onstart = () => setIsTalking(true);
    utterance.onend = () => setIsTalking(false);
    utterance.onerror = () => setIsTalking(false);

    window.speechSynthesis.speak(utterance);
    
    // OPTIONAL: Also trigger Unity animation if the bridge is running
    // window.location.href = `mockmate://talk?text=${encodeURIComponent(text)}`;
  };

  const stop = () => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      setIsTalking(false);
    }
  };

  useEffect(() => {
    if (active && questionText) {
      speak(questionText);
    }
    return () => stop();
  }, [questionText, active]);

  return (
    <div style={{ padding: "20px", textAlign: "center" }}>
      <InterviewerAvatar isTalking={isTalking} size={150} />
      <p style={{ marginTop: "10px", fontWeight: "600", color: "#1e293b" }}>
        {isTalking ? "🗣️ Interviewer is speaking..." : "😊 Interviewer is listening"}
      </p>
    </div>
  );
};

export default InterviewerSpeakingLogic;
