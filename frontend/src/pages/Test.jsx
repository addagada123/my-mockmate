import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import axios from "axios";
import InterviewerAvatar from "./InterviewerAvatar";
import CodingQuestion from "./CodingQuestion";
import { API_BASE, VR_STREAMING_ASSETS_URL } from "../config/runtime";
const VR_DEVICE_ID = `mm-vr-${Math.random().toString(36).substring(2, 9)}`;

function isSqlTopic(topicText) {
  const t = (topicText || "").toLowerCase();
  return (
    t.includes("sql") ||
    t.includes("mysql") ||
    t.includes("postgres") ||
    t.includes("database") ||
    t.includes("sequel")
  );
}

const statusConfig = {
  current: { bg: "#6366f1", border: "#6366f1", color: "#fff", shadow: "0 0 0 3px rgba(99,102,241,0.3)" },
  answered: { bg: "#10b981", border: "#10b981", color: "#fff", shadow: "none" },
  "not-answered": { bg: "#f59e0b", border: "#f59e0b", color: "#fff", shadow: "none" },
  marked: { bg: "#8b5cf6", border: "#8b5cf6", color: "#fff", shadow: "none" },
  "answered-marked": { bg: "linear-gradient(135deg, #10b981, #8b5cf6)", border: "#8b5cf6", color: "#fff", shadow: "none" },
  "not-visited": { bg: "#e2e8f0", border: "#cbd5e1", color: "#64748b", shadow: "none" },
};

function Test() {
  const { topic: topicParam } = useParams();
  const topic = topicParam || "General";
  const location = useLocation();
  const navigate = useNavigate();
  const [difficulty, setDifficulty] = useState(null);
  const [testStarted, setTestStarted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [questions, setQuestions] = useState([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [testMode, setTestMode] = useState(null); // "normal" | "vr"
  const [questionResults, setQuestionResults] = useState({}); // per-question score/feedback
  const [codingResults, setCodingResults] = useState({}); // per-question coding run results
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);
  const keepListeningRef = useRef(false);
  const pendingStopRef = useRef(false);
  const silenceTimeoutRef = useRef(null);
  const [currentScore, setCurrentScore] = useState(0); // running average
  const [timeLeft, setTimeLeft] = useState(null);
  const [testSubmitted, setTestSubmitted] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [isTalking, setIsTalking] = useState(false);
  const testContainerRef = useRef(null);
  const tabSwitchWarningRef = useRef(null);
  const [gradingInProgress, setGradingInProgress] = useState(false);
  const [visitedQuestions, setVisitedQuestions] = useState(new Set([0]));
  const [markedForReview, setMarkedForReview] = useState(new Set());
  const [showQuestionPanel, setShowQuestionPanel] = useState(true);
  const [vrCurrentQuestion, setVrCurrentQuestion] = useState(null);
  const [vrCurrentIndex, setVrCurrentIndex] = useState(0);
  const [vrRunningScore, setVrRunningScore] = useState(0);
  const [vrTranscript, setVrTranscript] = useState("");
  const [vrBusy, setVrBusy] = useState(false);
  const [vrCompleted, setVrCompleted] = useState(false);
  const [vrBridgeToken, setVrBridgeToken] = useState("");
  const [vrBridgeExpiresAt, setVrBridgeExpiresAt] = useState("");
  const vrStartedAtRef = useRef(null);
  const vrIframeInitializedRef = useRef(false);
  const [vrLaunching, setVrLaunching] = useState(false);
  const [vrLoadMessage, setVrLoadMessage] = useState("Preparing VR environment...");
  const [vrLoadError, setVrLoadError] = useState("");
  const [vrShowManual, setVrShowManual] = useState(false); // show fallback manual panel
  const [vrLaunchMode, setVrLaunchMode] = useState(null); // 'browser' or 'desktop'

  // --- Function Declarations (Hoisted) ---

  function stopSpeech() {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      setIsTalking(false);
    }
  }

  function speakQuestion(text) {
    if ("speechSynthesis" in window) {
      stopSpeech(); // Stop previous speech
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      utterance.rate = 1.0;
      utterance.onstart = () => setIsTalking(true);
      utterance.onend = () => setIsTalking(false);
      utterance.onerror = () => setIsTalking(false);

      window.speechSynthesis.speak(utterance);
    }
  }

  function showWarning(message) {
    if (tabSwitchWarningRef.current) {
      tabSwitchWarningRef.current.textContent = message;
      tabSwitchWarningRef.current.style.display = "block";
      setTimeout(() => {
        if (tabSwitchWarningRef.current) {
          tabSwitchWarningRef.current.style.display = "none";
        }
      }, 3000);
      return;
    }
    if (testMode !== "normal") {
      window.alert(message);
    }
  }

  function handleAnswerChange(value) {
    setAnswers({
      ...answers,
      [currentQuestionIndex]: value,
    });
    // Clear previous result when editing to encourage resubmit
    if (questionResults[currentQuestionIndex]) {
      const updated = { ...questionResults };
      delete updated[currentQuestionIndex];
      setQuestionResults(updated);
      setCurrentScore(calculateAverageScore(updated));
    }
  }

  function calculateAverageScore(results, questionsList = questions) {
    if (!questionsList || questionsList.length === 0) return 0;
    let totalScore = 0;
    for (let i = 0; i < questionsList.length; i++) {
      totalScore += results[i]?.score || 0;
    }
    return Math.round(totalScore / questionsList.length);
  }

  async function submitAnswer() {
    const question = questions[currentQuestionIndex];
    if (!question) {
      showWarning("⚠️ Question data not found. Please try refreshing.");
      return;
    }
    if (question.type === "coding") {
      const codeResult = codingResults[currentQuestionIndex];
      if (!codeResult) {
        showWarning("▶ Run your code first to submit this answer");
        return;
      }
      const score = codeResult.score || 0;
      const correct = codeResult.all_passed || false;
      const result = {
        score,
        correct,
        feedback: correct
          ? `All ${codeResult.total} test cases passed!`
          : `${codeResult.passed}/${codeResult.total} test cases passed.`,
      };
      const updated = {
        ...questionResults,
        [currentQuestionIndex]: result,
      };
      setQuestionResults(updated);
      setCurrentScore(calculateAverageScore(updated));
      showWarning(
        correct
          ? "✅ All test cases passed!"
          : `⚠️ ${codeResult.passed}/${codeResult.total} test cases passed`
      );
      return;
    }
    const answerText = answers[currentQuestionIndex] || "";
    if (!answerText.trim()) {
      showWarning("⚠️ Please provide an answer before submitting");
      return;
    }
    setGradingInProgress(true);
    showWarning("⏳ Evaluating your answer...");
    try {
      const token = localStorage.getItem("mockmate_token");
      const evalResponse = await axios.post(
        `${API_BASE}/evaluate`,
        {
          question: question.question,
          user_answer: answerText,
          correct_answer: question.answer || "",
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );
      const result = {
        score: evalResponse.data.score || 0,
        correct: evalResponse.data.is_correct || false,
        feedback: evalResponse.data.feedback || "Evaluated.",
      };
      const updated = {
        ...questionResults,
        [currentQuestionIndex]: result,
      };
      setQuestionResults(updated);
      setCurrentScore(calculateAverageScore(updated));
      showWarning(
        result.correct
          ? `✅ Score: ${result.score}%`
          : `❌ Score: ${result.score}% — ${result.feedback.split(".")[0]}`
      );
    } catch (evalErr) {
      console.error("Backend evaluation error, using fallback:", evalErr);
      const stopWords = new Set(["a", "an", "the", "is", "are", "was", "were", "be", "been", "have", "has", "had", "do", "does", "did", "will", "would", "shall", "should", "may", "might", "can", "could", "and", "but", "or", "not", "if", "then", "else", "when", "of", "at", "by", "for", "with", "about", "to", "from", "in", "into", "what", "which", "who", "this", "that", "it", "how", "why", "where", "your", "you"]);
      const tokenize = (t) => (t || "").toLowerCase().match(/[a-z0-9#+.-]+/g)?.filter(w => !stopWords.has(w) && w.length > 1) || [];
      const ansTokens = tokenize(answerText);
      const refTokens = tokenize(question.answer || "");
      const qTokens = tokenize(question.question);
      let score = 0;
      if (refTokens.length > 0 && ansTokens.length > 0) {
        const refSet = new Set(refTokens);
        const ansSet = new Set(ansTokens);
        const overlap = [...refSet].filter(w => ansSet.has(w)).length;
        const cosine = overlap / Math.sqrt(refSet.size * ansSet.size) || 0;
        score = Math.round(Math.min(100, cosine * 100 + Math.min(20, ansTokens.length / 6)));
      } else if (qTokens.length > 0 && ansTokens.length > 0) {
        const qSet = new Set(qTokens);
        const ansSet = new Set(ansTokens);
        const overlap = [...qSet].filter(w => ansSet.has(w)).length;
        score = Math.round(Math.min(80, (overlap / qSet.size) * 80 + Math.min(15, ansTokens.length / 8)));
      }
      const result = {
        score,
        correct: score >= 55,
        feedback: score >= 55 ? "Acceptable answer (offline evaluation)." : "Needs improvement (offline evaluation).",
      };
      const updated = { ...questionResults, [currentQuestionIndex]: result };
      setQuestionResults(updated);
      setCurrentScore(calculateAverageScore(updated));
      showWarning(result.correct ? `✅ Score: ${result.score}%` : `❌ Score: ${result.score}%`);
    } finally {
      setGradingInProgress(false);
    }
  }

  function handleCodingRunResult(runResult) {
    setCodingResults((prev) => ({
      ...prev,
      [currentQuestionIndex]: runResult,
    }));
  }

  function toggleMicrophone() {
    if (!recognitionRef.current) {
      showWarning("🎙 Speech recognition not supported in your browser");
      return;
    }
    if (isListening) {
      keepListeningRef.current = false;
      pendingStopRef.current = true;
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
        silenceTimeoutRef.current = null;
      }
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      keepListeningRef.current = true;
      pendingStopRef.current = false;
      recognitionRef.current.start();
    }
  }

  async function regenerateCurrentQuestion() {
    if (!sessionId) {
      showWarning("⚠️ No session available");
      return;
    }
    try {
      const token = localStorage.getItem("mockmate_token");
      showWarning("🔄 Regenerating question...");
      const response = await axios.post(
        `${API_BASE}/regenerate-question?session_id=${encodeURIComponent(
          sessionId
        )}&question_index=${currentQuestionIndex}`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (response.data.success && response.data.new_question) {
        const updatedQuestions = [...questions];
        updatedQuestions[currentQuestionIndex] = response.data.new_question;
        setQuestions(updatedQuestions);
        const updatedAnswers = { ...answers };
        delete updatedAnswers[currentQuestionIndex];
        setAnswers(updatedAnswers);
        const updatedResults = { ...questionResults };
        delete updatedResults[currentQuestionIndex];
        setQuestionResults(updatedResults);
        setCurrentScore(calculateAverageScore(updatedResults));
        showWarning("✅ Question regenerated! You have a fresh question to try.");
      } else {
        showWarning("❌ Failed to regenerate question");
      }
    } catch (error) {
      console.error("Error regenerating question:", error);
      showWarning(
        "❌ Error regenerating question: " +
        (error.response?.data?.detail || error.message)
      );
    }
  }

  async function startVRTest(mode) {
    if (vrBusy || vrLaunching || vrBridgeToken) {
      console.log("[VR-Parent] Bridge initialization already in progress or completed. Skipping duplicate start.");
      return;
    }
    if (!sessionId) {
      showWarning("No session available for VR mode");
      return;
    }
    try {
      setVrBusy(true);
      setVrLaunchMode(mode);
      const token = localStorage.getItem("mockmate_token");
      const response = await axios.post(
        `${API_BASE}/vr-test/start`,
        {
          session_id: sessionId,
          topic: decodeURIComponent(topic),
          difficulty: difficulty || "medium",
          questions,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );
      setTestMode("vr");
      setVrCurrentQuestion(response.data.current_question || null);
      setVrCurrentIndex(0);
      setVrRunningScore(0);
      setVrTranscript("");
      setVrCompleted(false);
      setVrLoadError("");
      setVrLoadMessage("Preparing VR environment...");
      setVrBridgeToken(response.data.bridge_token || "");
      setVrBridgeExpiresAt(response.data.bridge_expires_at || "");
      vrStartedAtRef.current = Date.now();

      if (response.data.bridge_token) {
        try {
          await axios.post(
            `${API_BASE}/vr-bridge/register-token`,
            {
              device_id: VR_DEVICE_ID,
              bridge_token: response.data.bridge_token,
              api_base: API_BASE,
            },
            {
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
            }
          );
        } catch (registerError) {
          console.error("VR bridge token registration failed:", registerError);
        }
      }

      if (vrLaunchMode === "desktop" || mode === "desktop") {
        const desktopUrl = `mockmate://start-vr?bridge_token=${encodeURIComponent(response.data.bridge_token)}&api_base=${encodeURIComponent(API_BASE)}`;
        window.location.href = desktopUrl;
        showWarning("Attempting to launch Desktop VR App. If it doesn't open, ensure you've registered the handle or use Browser VR.");
      }
      
      if (!response.data.bridge_token) {
        throw new Error("No bridge token received from server");
      }
      setVrLaunching(true);
      setVrShowManual(false);
    } catch (error) {
      showWarning(
        `VR start failed: ${error.response?.data?.detail || error.message}`
      );
    } finally {
      setVrBusy(false);
    }
  }

  async function refreshVRQuestion() {
    if (!sessionId && !vrBridgeToken) return;
    try {
      const token = localStorage.getItem("mockmate_token");
      const response = vrBridgeToken
        ? await axios.get(
            `${API_BASE}/vr-bridge/next?bridge_token=${encodeURIComponent(vrBridgeToken)}`
          )
        : await axios.get(
            `${API_BASE}/vr-test/web-next?session_id=${encodeURIComponent(sessionId)}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
      setVrCompleted(!!response.data.completed);
      setVrCurrentQuestion(response.data.current_question || null);
      setVrCurrentIndex(response.data.current_question_index || 0);
    } catch (error) {
      const errorDetail = error.response?.data?.detail || error.message;
      const isBenignBridgeRace =
        vrBridgeToken &&
        error.response?.status === 404 &&
        typeof errorDetail === "string" &&
        errorDetail.toLowerCase().includes("vr test not initialized");
      if (!isBenignBridgeRace) {
        showWarning(`VR sync failed: ${errorDetail}`);
      }
    }
  }

  async function submitVRAnswer() {
    if ((!sessionId && !vrBridgeToken) || !vrCurrentQuestion) return;
    if (!vrTranscript.trim()) {
      showWarning("Please paste or type the transcript from Unity");
      return;
    }
    try {
      setVrBusy(true);
      const token = localStorage.getItem("mockmate_token");
      const payload = {
        question_index: vrCurrentIndex,
        user_answer: vrTranscript.trim(),
      };
      const response = vrBridgeToken
        ? await axios.post(
            `${API_BASE}/vr-bridge/answer?bridge_token=${encodeURIComponent(vrBridgeToken)}`,
            payload,
            {
              headers: {
                "Content-Type": "application/json",
              },
            }
          )
        : await axios.post(
            `${API_BASE}/vr-test/answer?session_id=${encodeURIComponent(sessionId)}`,
            payload,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
            }
          );
      setVrRunningScore(response.data.running_percentage || 0);
      setVrCurrentQuestion(response.data.next_question || null);
      setVrCurrentIndex(response.data.next_question_index || vrCurrentIndex);
      setVrTranscript("");
      setVrCompleted(!!response.data.completed);
      showWarning("VR answer saved.");
    } catch (error) {
      showWarning(
        `VR answer save failed: ${error.response?.data?.detail || error.message}`
      );
    } finally {
      setVrBusy(false);
    }
  }

  async function completeVRTest() {
    if (!sessionId && !vrBridgeToken) return;
    try {
      setVrBusy(true);
      const token = localStorage.getItem("mockmate_token");
      const elapsedSecs = vrStartedAtRef.current
        ? Math.max(1, Math.floor((Date.now() - vrStartedAtRef.current) / 1000))
        : null;
      const payload = vrBridgeToken
        ? { time_spent: elapsedSecs }
        : { session_id: sessionId, time_spent: elapsedSecs };
      const response = vrBridgeToken
        ? await axios.post(
            `${API_BASE}/vr-bridge/complete?bridge_token=${encodeURIComponent(vrBridgeToken)}`,
            payload,
            {
              headers: {
                "Content-Type": "application/json",
              },
            }
          )
        : await axios.post(
            `${API_BASE}/vr-test/complete`,
            payload,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
            }
          );
      localStorage.setItem("lastTestScore", response.data.percentage ?? 0);
      setTestSubmitted(true);
    } catch (error) {
      showWarning(
        `VR completion failed: ${error.response?.data?.detail || error.message}`
      );
    } finally {
      setVrBusy(false);
    }
  }

  async function submitTest() {
    setTestSubmitted(true);
    try {
      const token = localStorage.getItem("mockmate_token");
      if (!sessionId) {
        console.error("No sessionId available for submit-test");
        return;
      }
      const answersPayload = questions.map((q, idx) => ({
        question: q.question,
        user_answer: answers[idx] || "",
        correct_answer: q.answer || "",
      }));
      const totalTimeSecs = questions.length * 60;
      const elapsed = timeLeft !== null ? totalTimeSecs - timeLeft : null;
      const submitResponse = await axios.post(
        `${API_BASE}/submit-test`,
        {
          session_id: sessionId,
          answers: answersPayload,
          topic: decodeURIComponent(topic),
          difficulty: difficulty || "medium",
          time_spent: elapsed,
          tab_switches: tabSwitchCount,
          mode: testMode === "vr" ? "vr" : "normal",
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (submitResponse.data && submitResponse.data.percentage !== undefined) {
        localStorage.setItem("lastTestScore", submitResponse.data.percentage);
      }
    } catch (error) {
      console.error("Error submitting test:", error);
    }
    if (document.fullscreenElement) {
      document.exitFullscreen();
    }
  }

  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  }

  async function requestFullscreen() {
    try {
      const targetEl = testContainerRef.current || document.documentElement;
      if (targetEl.requestFullscreen) {
        await targetEl.requestFullscreen();
        setIsFullscreen(true);
      } else if (targetEl.webkitRequestFullscreen) {
        await targetEl.webkitRequestFullscreen();
        setIsFullscreen(true);
      } else if (targetEl.msRequestFullscreen) {
        await targetEl.msRequestFullscreen();
        setIsFullscreen(true);
      } else {
        showWarning("Please enter full screen or you will be suspended from test");
      }
    } catch (error) {
      console.error("Fullscreen request failed:", error);
      showWarning("Please enter full screen or you will be suspended from test");
    }
  }

  function handleStartVR(mode) {
    startVRTest(mode);
  }

  function toggleMarkForReview() {
    setMarkedForReview((prev) => {
      const next = new Set(prev);
      if (next.has(currentQuestionIndex)) next.delete(currentQuestionIndex);
      else next.add(currentQuestionIndex);
      return next;
    });
  }

  function getQuestionStatus(index) {
    const isCurrent = index === currentQuestionIndex;
    const isAnswered = answers[index] && answers[index].toString().trim() !== "";
    const isMarked = markedForReview.has(index);
    const isVisited = visitedQuestions.has(index);
    if (isCurrent) return "current";
    if (isAnswered && isMarked) return "answered-marked";
    if (isAnswered) return "answered";
    if (isMarked) return "marked";
    if (isVisited) return "not-answered";
    return "not-visited";
  }

  // --- Effects ---

  useEffect(() => {
    if (testMode === "normal" && testStarted && questions.length > 0 && questions[currentQuestionIndex]) {
      const timer = setTimeout(() => {
        speakQuestion(questions[currentQuestionIndex].question);
      }, 500);
      return () => {
        clearTimeout(timer);
        stopSpeech();
      };
    }
  }, [currentQuestionIndex, questions, testStarted, testMode]);

  useEffect(() => {
    return () => {
      stopSpeech();
    };
  }, []);

  useEffect(() => {
    if (testMode !== "normal") return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.language = "en-US";
      recognitionRef.current.onstart = () => setIsListening(true);
      recognitionRef.current.onend = () => {
        if (pendingStopRef.current) {
          pendingStopRef.current = false;
          setIsListening(false);
          return;
        }
        if (keepListeningRef.current) {
          try {
            recognitionRef.current.start();
          } catch (error) {
            console.error("Speech recognition restart error:", error);
          }
        } else {
          setIsListening(false);
        }
      };
      recognitionRef.current.onresult = (event) => {
        let finalTranscript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript + " ";
          }
        }
        if (finalTranscript) {
          setAnswers((prev) => ({
            ...prev,
            [currentQuestionIndex]: (prev[currentQuestionIndex] || "") + finalTranscript,
          }));
        }
        if (silenceTimeoutRef.current) {
          clearTimeout(silenceTimeoutRef.current);
        }
        silenceTimeoutRef.current = setTimeout(() => {
          if (!keepListeningRef.current || !recognitionRef.current) return;
          keepListeningRef.current = false;
          pendingStopRef.current = true;
          try {
            recognitionRef.current.stop();
          } catch (error) {
            console.error("Speech recognition stop error:", error);
          }
        }, 2500);
      };
      recognitionRef.current.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        showWarning(`🎙 Error: ${event.error}`);
      };
    }
  }, [currentQuestionIndex, testMode, topic]);

  useEffect(() => {
    async function fetchQuestions() {
      try {
        const token = localStorage.getItem("mockmate_token");
        const activeSessionId = sessionId || new URLSearchParams(location.search).get("session_id");
        const resumeParams = new URLSearchParams({
          topic: decodeURIComponent(topic),
          difficulty: difficulty || "",
        });
        if (activeSessionId) {
          resumeParams.set("session_id", activeSessionId);
        }
        try {
          const resumeResponse = await axios.get(
            `${API_BASE}/resume-questions?${resumeParams.toString()}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (resumeResponse.data.session_id) setSessionId(resumeResponse.data.session_id);
          if (resumeResponse.data.questions && resumeResponse.data.questions.length > 0) {
            let filteredQuestions = resumeResponse.data.questions;
            if (difficulty === "coding") {
              filteredQuestions = filteredQuestions.filter((q) => (q.type || "").toLowerCase() === "coding");
            } else if (difficulty) {
              const diffFilt = filteredQuestions.filter((q) => q.difficulty && q.difficulty.toLowerCase() === difficulty.toLowerCase());
              if (diffFilt.length > 0) filteredQuestions = diffFilt;
            }
            if (filteredQuestions.length > 0) {
              setQuestions(filteredQuestions);
              return;
            }
          }
        } catch (resumeError) {
          console.log("Resume questions error:", resumeError.response?.data || resumeError.message);
        }

        const response = await axios.post(
          `${API_BASE}/generate-test-questions`,
          { session_id: activeSessionId || undefined, topic: decodeURIComponent(topic), difficulty: difficulty },
          { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
        );
        if (response.data.session_id) setSessionId(response.data.session_id);
        if (response.data.questions && response.data.questions.length > 0) {
          let fetched = response.data.questions;
          if (difficulty === "coding") {
            fetched = fetched.filter((q) => (q.type || "").toLowerCase() === "coding");
          }
          if (difficulty === "coding" && fetched.length === 0) {
            const sqlMode = isSqlTopic(decodeURIComponent(topic));
            setQuestions([
              {
                question: sqlMode
                  ? `Write an SQL query for ${decodeURIComponent(topic)}: return each department name with employee count, ordered by count desc.`
                  : `Write a function to compute the maximum subarray sum for ${decodeURIComponent(topic)}. Input is space-separated integers.`,
                answer: sqlMode ? "Use GROUP BY and ORDER BY." : "Use Kadane's algorithm.",
                difficulty: "medium",
                topic: decodeURIComponent(topic),
                type: "coding",
                language: sqlMode ? "sql" : "python",
                starter_code: sqlMode ? "-- Write SQL query\\nSELECT 1;" : "def solve(input_data):\\n    arr = list(map(int, input_data.strip().split()))\\n    # write code\\n    return \\\"\\\"",
                test_cases: sqlMode ? [{ setup_sql: "CREATE TABLE departments(id INTEGER PRIMARY KEY, name TEXT);CREATE TABLE employees(id INTEGER PRIMARY KEY, name TEXT, department_id INTEGER);INSERT INTO departments(id,name) VALUES (1,'Engineering'),(2,'HR');INSERT INTO employees(id,name,department_id) VALUES (1,'A',1),(2,'B',1),(3,'C',2);", expected_output: "Engineering|2\\nHR|1" }] : [{ input: "1 -2 3 4 -1", expected_output: "7" }, { input: "-5 -2 -1", expected_output: "-1" }, { input: "2 3 -2 5", expected_output: "8" }]
              }
            ]);
          } else {
            setQuestions(fetched);
          }
        } else {
          if (difficulty === "coding") {
            const sqlMode = isSqlTopic(decodeURIComponent(topic));
            setQuestions([{ question: sqlMode ? `Write an SQL query for ${decodeURIComponent(topic)}: find customers who placed more than 2 orders.` : `Write code to merge two sorted arrays for ${decodeURIComponent(topic)}. Input: two lines of space-separated ints.`, answer: sqlMode ? "GROUP BY customer and filter count > 2." : "Two-pointer merge.", difficulty: "medium", topic: decodeURIComponent(topic), type: "coding", language: sqlMode ? "sql" : "python", starter_code: sqlMode ? "-- Write SQL query\\nSELECT 1;" : "def solve(input_data):\\n    lines = [ln.strip() for ln in input_data.strip().splitlines() if ln.strip()]\\n    a = list(map(int, lines[0].split())) if lines else []\\n    b = list(map(int, lines[1].split())) if len(lines)>1 else []\\n    # write code\\n    return \\\"\\\"", test_cases: sqlMode ? [{ setup_sql: "CREATE TABLE customers(id INTEGER PRIMARY KEY, name TEXT);CREATE TABLE orders(id INTEGER PRIMARY KEY, customer_id INTEGER);INSERT INTO customers VALUES (1,'A'),(2,'B'),(3,'C');INSERT INTO orders VALUES (1,1),(2,1),(3,1),(4,2);", expected_output: "A" }] : [{ input: "1 3 5\\n2 4 6", expected_output: "1 2 3 4 5 6" }, { input: "1 2 3\\n", expected_output: "1 2 3" }, { input: "\\n4 5", expected_output: "4 5" }] }]);
          } else {
            setQuestions([{ question: `Explain the key concepts of ${decodeURIComponent(topic)}`, answer: "This is a comprehensive question about the topic.", difficulty: difficulty || "medium" }, { question: `How would you approach a real-world ${decodeURIComponent(topic)} problem?`, answer: "When dealing with this topic, consider the fundamentals and edge cases.", difficulty: difficulty || "medium" }, { question: `What are common pitfalls when working with ${decodeURIComponent(topic)}?`, answer: "Common mistakes include not considering edge cases and performance implications.", difficulty: difficulty || "medium" }]);
          }
        }
      } catch (error) {
        console.error("Error fetching questions:", error);
        if (difficulty === "coding") {
          const sqlMode = isSqlTopic(decodeURIComponent(topic));
          setQuestions([{ question: sqlMode ? `Write an SQL query for ${decodeURIComponent(topic)}: return second highest salary from Employees table.` : `Write code to print all prime numbers <= N for ${decodeURIComponent(topic)}.`, answer: sqlMode ? "Use DISTINCT with ORDER BY and LIMIT/OFFSET." : "Sieve or optimized primality checks.", difficulty: "medium", topic: decodeURIComponent(topic), type: "coding", language: sqlMode ? "sql" : "python", starter_code: sqlMode ? "-- Write SQL query\\nSELECT 1;" : "def solve(input_data):\\n    n = int(input_data.strip())\\n    # write code\\n    return \\\"\\\"", test_cases: sqlMode ? [{ setup_sql: "CREATE TABLE employees(id INTEGER PRIMARY KEY, salary INTEGER);INSERT INTO employees VALUES (1,100),(2,300),(3,200),(4,300);", expected_output: "200" }] : [{ input: "10", expected_output: "2 3 5 7" }, { input: "2", expected_output: "2" }, { input: "1", expected_output: "" }] }]);
        } else {
          setQuestions([{ question: `Sample ${decodeURIComponent(topic)} Question 1?`, answer: "Sample answer 1", difficulty: difficulty || "medium" }]);
        }
      }
    }
    if (difficulty) fetchQuestions();
  }, [difficulty, topic, sessionId, location.search]);

  useEffect(() => {
    if (questions.length > 0 && testMode === "vr" && !vrBridgeToken && !vrBusy) {
      handleStartVR("browser");
    }
  }, [questions.length, testMode, vrBridgeToken, vrBusy]);

  useEffect(() => {
    if (questions.length > 0 && timeLeft === null) {
      setTimeLeft(questions.length * 60);
      setQuestionResults({});
      setCurrentScore(0);
    }
  }, [questions, timeLeft]);

  useEffect(() => {
    if (testMode === "normal" && testStarted && timeLeft !== null && timeLeft > 0) {
      const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
      if (timeLeft === 60 || timeLeft === 300) showWarning(`⏰ ${timeLeft} seconds remaining!`);
      if (timeLeft === 0) submitTest();
      return () => clearTimeout(timer);
    }
  }, [testStarted, timeLeft, testMode]);

  useEffect(() => {
    if (!testStarted || testMode !== "normal") return;
    function handleVisibilityChange() {
      if (document.hidden) {
        setTabSwitchCount((prev) => {
          const next = prev + 1;
          showWarning(`⚠️ Tab switch detected! (${next}/5)`);
          if (next >= 5) {
            showWarning("❌ Test submitted due to excessive tab switches!");
            setTimeout(() => submitTest(), 500);
          }
          return next;
        });
      }
    }
    function handleFocusChange(e) {
      if (e.type === "blur") {
        setTabSwitchCount((prev) => {
          const next = prev + 1;
          showWarning(`⚠️ Window switch detected! (${next}/5)`);
          if (next >= 5) {
            showWarning("❌ Test submitted due to excessive tab switches!");
            setTimeout(() => submitTest(), 500);
          }
          return next;
        });
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleFocusChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleFocusChange);
    };
  }, [testStarted, testMode]);

  useEffect(() => {
    function handleFullscreenChange() {
      if (!document.fullscreenElement) {
        setIsFullscreen(false);
        if (testStarted && testMode === "normal") {
          showWarning("Please enter full screen or you will be suspended from test");
        }
      } else {
        setIsFullscreen(true);
      }
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [testStarted, testMode]);

  useEffect(() => {
    function handleVRFrameMessage(event) {
      if (event.origin !== window.location.origin) return;
      const payload = event.data;
      if (!payload || payload.source !== "mockmate-vr") return;

      if (payload.status === "loading") {
        if (!vrIframeInitializedRef.current && !vrCurrentQuestion && !vrCompleted) {
          setVrLaunching(true);
        }
        setVrLoadError("");
        setVrLoadMessage(payload.detail || "Loading VR environment...");
      } else if (payload.status === "ready") {
        vrIframeInitializedRef.current = true;
        setVrLaunching(false);
        setVrLoadError("");
        setVrLoadMessage(payload.detail || "VR environment ready.");
      } else if (payload.status === "error") {
        setVrLaunching(false);
        setVrLoadError(payload.detail || "VR environment failed to load.");
        setVrShowManual(true);
      } else if (payload.status === "complete") {
        console.log("[VR-Parent] Interview complete signaled. Exiting VR...");
        setVrCompleted(true);
        setVrLaunched(false);
        setVrLaunching(false);
      }
    }

    window.addEventListener("message", handleVRFrameMessage);
    return () => window.removeEventListener("message", handleVRFrameMessage);
  }, [vrCurrentQuestion, vrCompleted]);

  useEffect(() => {
    if (testMode !== "vr" || !vrLaunching || vrLoadError || vrCurrentQuestion || vrCompleted) return;

    const timeout = setTimeout(() => {
      if (vrCurrentQuestion || vrCompleted) return;
      setVrLaunching(false);
      setVrLoadError("VR launch timed out before Unity reported ready. Check that /vr/index.html loads, the Build7 files exist, and the browser console inside the VR frame does not show WebGL or asset errors.");
      setVrShowManual(true);
    }, 90000);

    return () => clearTimeout(timeout);
  }, [testMode, vrLaunching, vrLoadError, vrCurrentQuestion, vrCompleted]);

  useEffect(() => {
    if (testMode !== "vr") return;
    if (!vrCurrentQuestion) return;

    vrIframeInitializedRef.current = true;
    setVrLaunching(false);
    setVrLoadError("");
    setVrLoadMessage("VR environment ready.");
  }, [testMode, vrCurrentQuestion]);

  useEffect(() => {
    if (testMode !== "vr") return;
    if (!vrCompleted) return;

    setVrLaunching(false);
    setVrLoadError("");
    setVrLoadMessage("VR test completed.");
  }, [testMode, vrCompleted]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const qDiff = (params.get("difficulty") || "").toLowerCase();
    const qMode = (params.get("mode") || "").toLowerCase();
    const qSessionId = params.get("session_id");
    if (qSessionId) setSessionId(qSessionId);
    const allowed = new Set(["easy", "medium", "hard", "coding"]);
    if (allowed.has(qDiff)) {
      setDifficulty(qDiff);
      if (qDiff === "coding") {
        setTestMode("normal");
        setTestStarted(true);
      } else if (qMode === "normal" || qMode === "vr") {
        setTestMode(qMode);
        setTestStarted(true);
      }
    }
  }, [location.search]);

  useEffect(() => {
    if (difficulty === "coding" && questions.length > 0 && !testMode) {
      setTestMode("normal");
      setTestStarted(true);
    }
  }, [difficulty, questions.length, testMode]);

  useEffect(() => {
    setVisitedQuestions((prev) => {
      const next = new Set(prev);
      next.add(currentQuestionIndex);
      return next;
    });
  }, [currentQuestionIndex]);

  // Poll for VR question state every 3 seconds when in VR mode
  useEffect(() => {
    if (testMode !== "vr" || vrCompleted || testSubmitted) return;
    if (vrCurrentQuestion) return;
    
    const interval = setInterval(() => {
      refreshVRQuestion();
    }, 3000);
    
    return () => clearInterval(interval);
  }, [testMode, vrCompleted, testSubmitted, vrCurrentQuestion]);

  // --- Rendering ---

  if (!difficulty) {
    return (
      <div style={{ minHeight: "100vh", background: "#f5f3ff", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
        <div style={{ backgroundColor: "white", borderRadius: "20px", padding: "40px", maxWidth: "500px", boxShadow: "0 20px 60px rgba(99,102,241,0.12)", textAlign: "center", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "4px", background: "linear-gradient(135deg, #6366f1, #8b5cf6, #06b6d4)" }} />
          <h1 style={{ fontSize: "32px", margin: "0 0 16px 0", color: "#1e1b4b" }}>📝 Select Difficulty</h1>
          <p style={{ color: "#666", marginBottom: "32px", lineHeight: "1.6" }}>Choose your difficulty level for the <strong>{decodeURIComponent(topic)}</strong> test.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {["Easy", "Medium", "Hard", "Coding"].map((level) => (
              <button key={level} onClick={() => setDifficulty(level.toLowerCase())} style={{ padding: "16px", background: level === "Easy" ? "linear-gradient(135deg, #22c55e, #16a34a)" : level === "Medium" ? "linear-gradient(135deg, #f59e0b, #d97706)" : level === "Hard" ? "linear-gradient(135deg, #ef4444, #dc2626)" : "linear-gradient(135deg, #8b5cf6, #7c3aed)", color: "white", border: "none", borderRadius: "12px", cursor: "pointer", fontSize: "16px", fontWeight: "600", boxShadow: "0 4px 12px rgba(99,102,241,0.3)" }}>
                {level === "Easy" ? "🟢 Easy" : level === "Medium" ? "🟡 Medium" : level === "Hard" ? "🔴 Hard" : "💻 Coding"}
              </button>
            ))}
          </div>
          <button onClick={() => navigate("/dashboard")} style={{ marginTop: "20px", padding: "12px 24px", background: "transparent", color: "#6366f1", border: "2px solid #6366f1", borderRadius: "8px", cursor: "pointer", fontSize: "14px", fontWeight: "600" }}>← Back to Dashboard</button>
        </div>
      </div>
    );
  }

  if (difficulty && !testMode && questions.length === 0) {
    return <div style={{ minHeight: "100vh", background: "#f5f3ff", display: "flex", alignItems: "center", justifyContent: "center" }}><p>Generating questions...</p></div>;
  }

  if (difficulty && !testMode) {
    return (
      <div style={{ minHeight: "100vh", background: "#f5f3ff", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
        <div style={{ backgroundColor: "white", borderRadius: "20px", padding: "40px", maxWidth: "560px", boxShadow: "0 20px 60px rgba(99,102,241,0.12)", textAlign: "center" }}>
          <h1 style={{ color: "#1e1b4b", marginBottom: "16px" }}>Questions Ready</h1>
          <p style={{ color: "#666", marginBottom: "32px" }}>{questions.length} questions generated for <strong>{decodeURIComponent(topic)}</strong>.</p>
          
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <button onClick={async () => { setTestMode("normal"); await requestFullscreen(); setTestStarted(true); }} 
                    style={{ padding: "16px", background: "linear-gradient(135deg, #6366f1, #4f46e5)", color: "white", borderRadius: "12px", border: "none", cursor: "pointer", fontWeight: "600", fontSize: "16px", boxShadow: "0 4px 12px rgba(99,102,241,0.3)" }}>
              💻 Start Standard Test
            </button>
            
            {difficulty !== "coding" && (
              <div style={{ marginTop: "12px", padding: "24px", background: "#f8fafc", borderRadius: "16px", border: "1px solid #e2e8f0" }}>
                <h3 style={{ fontSize: "16px", color: "#334155", marginBottom: "12px" }}>Experience in VR</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <button onClick={() => handleStartVR("browser")}
                          style={{ padding: "12px", background: "#0f766e", color: "white", borderRadius: "10px", border: "none", cursor: "pointer", fontWeight: "600", fontSize: "14px" }}>
                    🌐 Browser VR
                  </button>
                  <button onClick={() => handleStartVR("desktop")}
                          style={{ padding: "12px", background: "#0e7490", color: "white", borderRadius: "10px", border: "none", cursor: "pointer", fontWeight: "600", fontSize: "14px" }}>
                    🖥️ Desktop App
                  </button>
                </div>
                <p style={{ fontSize: "12px", color: "#64748b", marginTop: "12px" }}>
                  Browser mode works instantly. Desktop version requires installation but offers higher fidelity.
                </p>
              </div>
            )}
          </div>
          
          <button onClick={() => navigate("/dashboard")} 
                  style={{ marginTop: "32px", padding: "12px 24px", background: "transparent", color: "#6366f1", border: "2px solid #6366f1", borderRadius: "8px", cursor: "pointer", fontSize: "14px", fontWeight: "600" }}>
            ← Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (testSubmitted) {
    const score = localStorage.getItem("lastTestScore");
    return (
      <div style={{ minHeight: "100vh", background: "#f5f3ff", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
        <div style={{ backgroundColor: "white", borderRadius: "12px", padding: "40px", maxWidth: "500px", boxShadow: "0 4px 24px rgba(99,102,241,0.08)", textAlign: "center" }}>
          <h1>✅ Test Submitted!</h1>
          <div style={{ fontSize: "48px", fontWeight: "700", color: "#6366f1", margin: "20px 0" }}>{score}%</div>
          <button onClick={() => navigate("/dashboard")} style={{ width: "100%", padding: "12px", backgroundColor: "#6366f1", color: "white", borderRadius: "8px", border: "none", cursor: "pointer", fontWeight: "600" }}>Back to Dashboard</button>
        </div>
      </div>
    );
  }

  // ── VR MODE: Unity WebGL embedded in an iframe ──────────────────────────────
  if (testMode === "vr") {
    const unityParams = new URLSearchParams({
      bridge_token: (vrBridgeToken || "").trim(),
      api_base: (API_BASE || "").trim(),
      session_id: (sessionId || "").trim(),
    });
    if (VR_STREAMING_ASSETS_URL) {
      unityParams.set("streaming_assets_url", VR_STREAMING_ASSETS_URL.replace(/\/+$/, ""));
    }
    const unityUrl = `/vr/index.html?${unityParams.toString()}`;
    const totalQ = questions.length;
    const progress = totalQ > 0 ? Math.round(((vrCurrentIndex) / totalQ) * 100) : 0;

    return (
      <div style={{ minHeight: "100vh", background: "#080c14", display: "flex", flexDirection: "column" }}>

        {/* ── Top bar ── */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 20px", background: "rgba(255,255,255,0.04)",
          borderBottom: "1px solid rgba(255,255,255,0.08)", gap: "12px"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "22px" }}>🥽</span>
            <span style={{ color: "white", fontWeight: "700", fontSize: "16px" }}>MockMate VR</span>
            <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "13px" }}>· {decodeURIComponent(topic)}</span>
          </div>
          <div style={{ flex: 1, maxWidth: "320px" }}>
            <div style={{ height: "6px", background: "rgba(255,255,255,0.1)", borderRadius: "3px", overflow: "hidden" }}>
              <div style={{ width: `${progress}%`, height: "100%", background: "linear-gradient(90deg, #0ea5e9, #8b5cf6)", transition: "width 0.4s", borderRadius: "3px" }} />
            </div>
            <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "11px", margin: "4px 0 0", textAlign: "center" }}>
              Question {vrCurrentIndex + 1} of {totalQ} · Score: {vrRunningScore}%
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={() => setVrShowManual(v => !v)} style={{
              padding: "6px 14px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.2)",
              background: vrShowManual ? "rgba(139,92,246,0.3)" : "transparent",
              color: "rgba(255,255,255,0.7)", cursor: "pointer", fontSize: "13px"
            }}>🎛 Manual</button>
            <button onClick={() => navigate("/dashboard")} style={{
              padding: "6px 14px", borderRadius: "8px", border: "1px solid rgba(239,68,68,0.4)",
              background: "transparent", color: "rgba(239,68,68,0.8)", cursor: "pointer", fontSize: "13px"
            }}>✕ Exit</button>
          </div>
        </div>

        {/* ── Main area ── */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

          {/* Unity WebGL iframe */}
          <div style={{ flex: 1, position: "relative" }}>
            {vrLaunching && (
              <div style={{
                position: "absolute", inset: 0, background: "#080c14",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                zIndex: 10, gap: "16px"
              }}>
                <div style={{ width: "48px", height: "48px", border: "4px solid rgba(255,255,255,0.1)", borderTop: "4px solid #0ea5e9", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                <style>{`@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}`}</style>
                <p style={{ color: "rgba(255,255,255,0.7)", fontSize: "13px", maxWidth: "440px", textAlign: "center", margin: 0 }}>{vrLoadMessage}</p>
                <p style={{ color: "rgba(255,255,255,0.6)", fontSize: "14px" }}>Loading VR environment…</p>
              </div>
            )}
            {vrLoadError && (
              <div style={{
                position: "absolute", top: "18px", left: "18px", right: "18px",
                padding: "14px 16px", borderRadius: "12px", zIndex: 11,
                border: "1px solid rgba(248,113,113,0.45)",
                background: "rgba(127,29,29,0.88)", color: "#fecaca",
                fontSize: "13px", lineHeight: "1.5", whiteSpace: "pre-wrap"
              }}>
                {vrLoadError}
              </div>
            )}
            <iframe
              key="vr-unity-iframe"
              src={unityUrl}
              title="MockMate VR"
              onLoad={() => {
                vrIframeInitializedRef.current = true;
                setVrLaunching(false);
                setVrLoadMessage("VR page loaded. Waiting for Unity runtime...");
              }}
              style={{ width: "100%", height: "100%", border: "none", display: "block", background: "#080c14" }}
              allow="microphone; fullscreen"
              allowFullScreen
            />
          </div>

          {/* Manual control panel (slide in from right) */}
          {vrShowManual && (
            <div style={{
              width: "320px", background: "#0f172a", borderLeft: "1px solid rgba(255,255,255,0.08)",
              padding: "20px", display: "flex", flexDirection: "column", gap: "16px", overflowY: "auto"
            }}>
              <h3 style={{ color: "white", margin: 0, fontSize: "15px" }}>Manual Control</h3>
              <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "12px", margin: 0 }}>
                Use this panel if the VR view isn't responding.
              </p>

              {vrCurrentQuestion ? (
                <>
                  <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: "10px", padding: "14px" }}>
                    <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "11px", margin: "0 0 6px" }}>CURRENT QUESTION</p>
                    <p style={{ color: "white", fontSize: "14px", margin: 0, lineHeight: "1.5" }}>{vrCurrentQuestion.question}</p>
                  </div>
                  <textarea
                    value={vrTranscript}
                    onChange={e => setVrTranscript(e.target.value)}
                    placeholder="Type or paste your answer here…"
                    style={{
                      width: "100%", minHeight: "110px", background: "rgba(255,255,255,0.06)",
                      border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px",
                      color: "white", padding: "10px", fontSize: "13px", resize: "vertical",
                      boxSizing: "border-box"
                    }}
                  />
                  <button onClick={submitVRAnswer} disabled={vrBusy} style={{
                    padding: "10px", background: "linear-gradient(135deg,#0ea5e9,#0f766e)",
                    color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: "600"
                  }}>Save & Next →</button>
                </>
              ) : vrCompleted ? (
                <p style={{ color: "#10b981", fontSize: "14px" }}>✅ All questions answered!</p>
              ) : (
                <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "13px" }}>Syncing question…</p>
              )}

              {vrCompleted && (
                <button onClick={completeVRTest} disabled={vrBusy} style={{
                  padding: "12px", background: "linear-gradient(135deg,#059669,#0f766e)",
                  color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: "700", fontSize: "15px"
                }}>🏁 Complete Test</button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (difficulty && testMode && questions.length === 0) {
    return (
      <div style={{ minHeight: "100vh", background: "#f5f3ff", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "20px" }}>
        <div style={{ width: "50px", height: "50px", border: "5px solid #eef2ff", borderTop: "5px solid #6366f1", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
        <p style={{ color: "#6366f1", fontWeight: "600" }}>Loading your questions...</p>
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const currentQuestion = questions[currentQuestionIndex];
  
  // Final safety check to prevent components from crashing if an index is out of bounds
  if (!currentQuestion && questions.length > 0) {
    return (
       <div style={{ minHeight: "100vh", background: "#f5f3ff", display: "flex", alignItems: "center", justifyContent: "center" }}>
         <p>Preparing the next question...</p>
       </div>
    );
  }

  const progress = questions.length > 0 ? ((currentQuestionIndex + 1) / questions.length) * 100 : 0;

  return (
    <div ref={testContainerRef} style={{ minHeight: "100vh", background: "#f5f3ff", padding: "20px" }}>
      <div ref={tabSwitchWarningRef} style={{ position: "fixed", top: "20px", right: "20px", backgroundColor: "#dc2626", color: "white", padding: "12px 16px", borderRadius: "8px", zIndex: 1000, display: "none" }} />
      
      <div style={{ display: "flex", justifyContent: "space-between", background: "white", padding: "16px 20px", borderRadius: "12px", boxShadow: "0 4px 12px rgba(0,0,0,0.05)", marginBottom: "20px" }}>
        <div>
          <h2 style={{ margin: 0 }}>{decodeURIComponent(topic)}</h2>
          <p style={{ margin: 0, color: "#666" }}>Question {currentQuestionIndex + 1} of {questions.length}</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "24px", fontWeight: "700" }}>⏱️ {formatTime(timeLeft || 0)}</div>
          <p style={{ margin: 0, fontSize: "12px" }}>Tab switches: {tabSwitchCount}/5 | Score: {currentScore}%</p>
        </div>
      </div>

      <div style={{ display: "flex", gap: "20px", maxWidth: "1200px", margin: "0 auto" }}>
        <div style={{ flex: 1, background: "white", padding: "32px", borderRadius: "16px", boxShadow: "0 10px 30px rgba(0,0,0,0.05)" }}>
          <div style={{ height: "6px", background: "#eee", borderRadius: "3px", marginBottom: "24px" }}>
            <div style={{ width: `${progress}%`, height: "100%", background: "#6366f1", transition: "width 0.3s" }} />
          </div>
          
          <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
            <h2 style={{ flex: 1, margin: 0 }}>{currentQuestion?.question || "Loading question..."}</h2>
            <button onClick={() => speakQuestion(currentQuestion?.question || "")} style={{ background: "#eef2ff", border: "none", borderRadius: "50%", width: "40px", height: "40px", cursor: "pointer" }}>🔊</button>
            <button onClick={regenerateCurrentQuestion} style={{ background: "#f3e8ff", border: "none", borderRadius: "50%", width: "40px", height: "40px", cursor: "pointer" }}>🔄</button>
          </div>

          <div style={{ display: "flex", justifyContent: "center", margin: "24px 0" }}>
             <InterviewerAvatar isTalking={isTalking} isListening={isListening} size={150} />
          </div>

          {currentQuestion.type === "coding" ? (
             <CodingQuestion question={currentQuestion} initialCode={answers[currentQuestionIndex] || currentQuestion.starter_code || ""} onCodeChange={handleAnswerChange} onRunResult={handleCodingRunResult} />
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                <label>Your Answer:</label>
                <button onClick={toggleMicrophone} style={{ background: isListening ? "#dc2626" : "#6366f1", color: "white", border: "none", padding: "6px 12px", borderRadius: "6px", cursor: "pointer" }}>
                  {isListening ? "🛑 Stop" : "🎙 Speak"}
                </button>
              </div>
              <textarea value={answers[currentQuestionIndex] || ""} onChange={(e) => handleAnswerChange(e.target.value)} style={{ width: "100%", height: "150px", padding: "12px", borderRadius: "8px", border: "1px solid #ddd" }} />
            </>
          )}

          <div style={{ display: "flex", gap: "10px", marginTop: "24px" }}>
            <button onClick={() => setCurrentQuestionIndex(Math.max(0, currentQuestionIndex - 1))} disabled={currentQuestionIndex === 0} style={{ padding: "10px 20px", borderRadius: "8px", border: "1px solid #ddd", cursor: "pointer" }}>Previous</button>
            <button onClick={() => setCurrentQuestionIndex(Math.min(questions.length - 1, currentQuestionIndex + 1))} disabled={currentQuestionIndex === questions.length - 1} style={{ padding: "10px 20px", borderRadius: "8px", border: "1px solid #ddd", cursor: "pointer" }}>Next</button>
            <button onClick={toggleMarkForReview} style={{ padding: "10px 20px", borderRadius: "8px", border: "1px solid #8b5cf6", background: markedForReview.has(currentQuestionIndex) ? "#8b5cf6" : "white", color: markedForReview.has(currentQuestionIndex) ? "white" : "#8b5cf6", cursor: "pointer" }}>Mark</button>
            <button onClick={submitAnswer} disabled={gradingInProgress} style={{ padding: "10px 20px", borderRadius: "8px", border: "none", background: "#0ea5e9", color: "white", cursor: "pointer" }}>Submit Question</button>
            <button onClick={submitTest} style={{ padding: "10px 20px", borderRadius: "8px", border: "none", background: "#059669", color: "white", cursor: "pointer", marginLeft: "auto" }}>Finish Test</button>
          </div>
        </div>

        {showQuestionPanel && (
          <div style={{ width: "250px", background: "white", borderRadius: "16px", padding: "20px", boxShadow: "0 10px 30px rgba(0,0,0,0.05)", height: "fit-content" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "16px" }}>
              <h4 style={{ margin: 0 }}>Questions</h4>
              <button onClick={() => setShowQuestionPanel(false)} style={{ background: "none", border: "none", cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
              {questions.map((_, idx) => {
                const status = getQuestionStatus(idx);
                const config = statusConfig[status];
                return (
                  <button key={idx} onClick={() => setCurrentQuestionIndex(idx)} style={{ aspectRatio: "1", background: config.bg, color: config.color, border: "none", borderRadius: "8px", padding: "8px", cursor: "pointer", fontWeight: "bold" }}>{idx + 1}</button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Test;
