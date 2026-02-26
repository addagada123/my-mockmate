import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import InterviewerAvatar from "./InterviewerAvatar";

const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

const Test = () => {
  const { topic } = useParams();
  const navigate = useNavigate();
  const [difficulty, setDifficulty] = useState(null);
  const [testStarted, setTestStarted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [questions, setQuestions] = useState([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [questionResults, setQuestionResults] = useState({}); // per-question score/feedback
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

  // Text-to-Speech function
  const stopSpeech = () => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      setIsTalking(false);
    }
  };

  const speakQuestion = (text) => {
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
  };

  // Trigger TTS when question changes
  useEffect(() => {
    if (testStarted && questions.length > 0 && questions[currentQuestionIndex]) {
      // Small delay to ensure smooth transition
      const timer = setTimeout(() => {
        speakQuestion(questions[currentQuestionIndex].question);
      }, 500);
      return () => {
        clearTimeout(timer);
        stopSpeech();
      };
    }
  }, [currentQuestionIndex, questions, testStarted]);

  // Clean up speech on unmount
  useEffect(() => {
    return () => {
      stopSpeech();
    };
  }, []);

  // Initialize speech recognition
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.language = "en-US";

      recognitionRef.current.onstart = () => {
        setIsListening(true);
      };

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
        let interimTranscript = "";
        let finalTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript + " ";
          } else {
            interimTranscript += transcript;
          }
        }

        // Append final transcript to answer
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
        showWarning(`🎙️ Error: ${event.error}`);
      };
    }
  }, [currentQuestionIndex]);

  // Fetch questions for the topic when difficulty is selected
  useEffect(() => {
    const fetchQuestions = async () => {
      try {
        const token = localStorage.getItem("mockmate_token");
        
        // First, try to get resume-based questions for this specific topic
        try {
          const resumeResponse = await axios.get(
            `${API_BASE}/resume-questions?topic=${encodeURIComponent(decodeURIComponent(topic))}&difficulty=${encodeURIComponent(difficulty || "")}`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            }
          );
          
          console.log("Resume questions response:", resumeResponse.data);
          
          if (resumeResponse.data.session_id) {
            setSessionId(resumeResponse.data.session_id);
          }

          if (resumeResponse.data.questions && resumeResponse.data.questions.length > 0) {
            // Filter by difficulty if specified
            let filteredQuestions = resumeResponse.data.questions;
            if (difficulty) {
              const difficultyFiltered = filteredQuestions.filter(
                q => q.difficulty && q.difficulty.toLowerCase() === difficulty.toLowerCase()
              );
              // Use difficulty-filtered if available, otherwise use all topic questions
              if (difficultyFiltered.length > 0) {
                filteredQuestions = difficultyFiltered;
              }
            }
            
            if (filteredQuestions.length > 0) {
              console.log("Using resume questions:", filteredQuestions);
              setQuestions(filteredQuestions);
              return; // Exit early, we found resume questions
            }
          }
        } catch (resumeError) {
          console.log("Resume questions error:", resumeError.response?.data || resumeError.message);
        }
        
        // Fallback: Use general question generation endpoint
        console.log("Fetching general questions for topic:", decodeURIComponent(topic), "difficulty:", difficulty);
        const response = await axios.post(
          `${API_BASE}/generate-test-questions`,
          {
            topic: decodeURIComponent(topic),
            difficulty: difficulty,
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          }
        );
        
        console.log("General questions response:", response.data);
        
        if (response.data.session_id) {
          setSessionId(response.data.session_id);
        }

        if (response.data.questions && response.data.questions.length > 0) {
          console.log("Using general questions:", response.data.questions);
          setQuestions(response.data.questions);
        } else {
          console.log("No questions in response, using fallback");
          // Last resort: Default sample questions
          setQuestions([
            {
              question: `Explain the key concepts of ${decodeURIComponent(topic)}`,
              answer: "This is a comprehensive question about the topic.",
              difficulty: difficulty || "medium",
            },
            {
              question: `How would you approach a real-world ${decodeURIComponent(topic)} problem?`,
              answer: "When dealing with this topic, consider the fundamentals and edge cases.",
              difficulty: difficulty || "medium",
            },
            {
              question: `What are common pitfalls when working with ${decodeURIComponent(topic)}?`,
              answer: "Common mistakes include not considering edge cases and performance implications.",
              difficulty: difficulty || "medium",
            },
          ]);
        }
      } catch (error) {
        console.error("Error fetching questions:", error);
        setQuestions([
          {
            question: `Sample ${decodeURIComponent(topic)} Question 1?`,
            answer: "Sample answer 1",
            difficulty: difficulty || "medium",
          },
        ]);
      }
    };

    if (testStarted && difficulty) {
      fetchQuestions();
    }
  }, [testStarted, difficulty, topic]);

  // Set timer when questions are loaded
  useEffect(() => {
    if (questions.length > 0 && timeLeft === null) {
      // Set timer: 1 min per question
      setTimeLeft(questions.length * 60);
      setQuestionResults({});
      setCurrentScore(0);
    }
  }, [questions, timeLeft]);

  // Timer countdown
  useEffect(() => {
    if (testStarted && timeLeft !== null && timeLeft > 0) {
      const timer = setTimeout(() => {
        setTimeLeft(timeLeft - 1);
      }, 1000);

      if (timeLeft === 60 || timeLeft === 300) {
        showWarning(`⏰ ${timeLeft} seconds remaining!`);
      }

      if (timeLeft === 0) {
        submitTest();
      }

      return () => clearTimeout(timer);
    }
  }, [testStarted, timeLeft]);

  // Detect tab/window switch
  useEffect(() => {
    if (!testStarted) return;

    const handleVisibilityChange = () => {
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
    };

    const handleFocusChange = (e) => {
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
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleFocusChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleFocusChange);
    };
  }, [testStarted, isFullscreen]);

  // Fullscreen must be triggered from a user gesture; no auto-request here.

  // Request fullscreen
  const requestFullscreen = async () => {
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
  };

  // Exit fullscreen handler
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setIsFullscreen(false);
        if (testStarted) {
          showWarning("Please enter full screen or you will be suspended from test");
        }
      } else {
        setIsFullscreen(true);
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  const showWarning = (message) => {
    if (tabSwitchWarningRef.current) {
      tabSwitchWarningRef.current.textContent = message;
      tabSwitchWarningRef.current.style.display = "block";
      setTimeout(() => {
        if (tabSwitchWarningRef.current) {
          tabSwitchWarningRef.current.style.display = "none";
        }
      }, 3000);
    }
  };

  const handleAnswerChange = (value) => {
    const currentQuestion = questions[currentQuestionIndex];
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
  };

  const calculateAverageScore = (results, questionsList = questions) => {
    // Calculate average across ALL questions: graded get their score, ungraded default to 0
    if (!questionsList || questionsList.length === 0) return 0;
    let totalScore = 0;
    for (let i = 0; i < questionsList.length; i++) {
      totalScore += results[i]?.score || 0;
    }
    return Math.round(totalScore / questionsList.length);
  };

  const gradeAnswer = (question, answerText) => {
    const student = (answerText || "").toLowerCase();
    const reference = (question.answer || "").toLowerCase();

    if (!reference) {
      return { score: 0, correct: false, feedback: "No reference answer available; cannot auto-grade." };
    }

    // Simple similarity: ratio of overlapping words to reference words
    const refWords = reference.split(/\W+/).filter(Boolean);
    const studentWords = student.split(/\W+/).filter(Boolean);
    if (!refWords.length || !studentWords.length) {
      return { score: 0, correct: false, feedback: "Answer too short to evaluate." };
    }

    const refSet = new Set(refWords);
    let overlap = 0;
    studentWords.forEach((w) => {
      if (refSet.has(w)) overlap += 1;
    });

    const similarity = overlap / refWords.length;
    const score = Math.round(Math.min(1, similarity) * 100);
    const correct = score >= 70;
    const feedback = correct
      ? "Looks correct based on reference keywords."
      : "Key concepts are missing; compare against the reference.";

    return { score, correct, feedback };
  };

  const submitAnswer = () => {
    const question = questions[currentQuestionIndex];
    const answerText = answers[currentQuestionIndex] || "";
    const result = gradeAnswer(question, answerText);

    const updated = {
      ...questionResults,
      [currentQuestionIndex]: result,
    };
    setQuestionResults(updated);
    setCurrentScore(calculateAverageScore(updated));
    showWarning(result.correct ? "✅ Answer marked correct" : "❌ Answer marked incorrect");
  };

  const toggleMicrophone = () => {
    if (!recognitionRef.current) {
      showWarning("🎙️ Speech recognition not supported in your browser");
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
  };

  const submitTest = async () => {
    console.log("submitTest called with questionResults:", questionResults);
    console.log("submitTest called with questions count:", questions.length);
    
    // Calculate score from current state
    let localScore = 0;
    if (questions.length > 0) {
      let totalScore = 0;
      for (let i = 0; i < questions.length; i++) {
        const score = questionResults[i]?.score || 0;
        totalScore += score;
        console.log(`Question ${i}: score = ${score}`);
      }
      localScore = Math.round(totalScore / questions.length);
    }
    console.log("Final local score calculated:", localScore);
    
    setTestSubmitted(true);
    let testResultId = null;
    
    try {
      const token = localStorage.getItem("mockmate_token");
      
      // Step 1: Submit the test answers
      if (!sessionId) {
        console.error("No sessionId available for submit-test");
        return;
      }

      const answersPayload = questions.map((q, idx) => ({
        question: q.question,
        user_answer: answers[idx] || "",
        correct_answer: q.answer || "",
      }));

      const submitResponse = await axios.post(
        `${API_BASE}/submit-test`,
        {
          session_id: sessionId,
          answers: answersPayload,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (submitResponse.data && submitResponse.data.percentage !== undefined) {
        localStorage.setItem("lastTestScore", submitResponse.data.percentage);
      } else {
        localStorage.setItem("lastTestScore", localScore);
      }
    } catch (error) {
      console.error("Error submitting test:", error);
    }

    if (document.fullscreenElement) {
      document.exitFullscreen();
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  if (!difficulty) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px",
        }}
      >
        <div
          style={{
            backgroundColor: "white",
            borderRadius: "12px",
            padding: "40px",
            maxWidth: "500px",
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: "32px", margin: "0 0 16px 0", color: "#1e293b" }}>
            📚 Select Difficulty
          </h1>
          <p style={{ color: "#666", marginBottom: "32px", lineHeight: "1.6" }}>
            Choose your difficulty level for the <strong>{decodeURIComponent(topic)}</strong> test.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {["Easy", "Medium", "Hard"].map((level) => (
              <button
                key={level}
                 onClick={async () => {
                  setDifficulty(level.toLowerCase());
                  await requestFullscreen();
                  setTestStarted(true);
                }}
                style={{
                  padding: "16px",
                  backgroundColor: "#667eea",
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontSize: "16px",
                  fontWeight: "600",
                  transition: "all 0.3s ease",
                }}
                onMouseEnter={(e) => (e.target.style.backgroundColor = "#764ba2")}
                onMouseLeave={(e) => (e.target.style.backgroundColor = "#667eea")}
              >
                {level === "Easy" && "🟢"}
                {level === "Medium" && "🟡"}
                {level === "Hard" && "🔴"} {level}
              </button>
            ))}
          </div>

          <button
            onClick={() => navigate("/dashboard")}
            style={{
              marginTop: "20px",
              padding: "12px 24px",
              backgroundColor: "transparent",
              color: "#667eea",
              border: "2px solid #667eea",
              borderRadius: "8px",
              cursor: "pointer",
              fontSize: "14px",
              fontWeight: "600",
              transition: "all 0.3s ease",
            }}
            onMouseEnter={(e) => {
              e.target.backgroundColor = "#667eea";
              e.target.color = "white";
            }}
            onMouseLeave={(e) => {
              e.target.backgroundColor = "transparent";
              e.target.color = "#667eea";
            }}
          >
            ← Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (testSubmitted) {
    const testScore = localStorage.getItem("lastTestScore");
    
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px",
        }}
      >
        <div
          style={{
            backgroundColor: "white",
            borderRadius: "12px",
            padding: "40px",
            maxWidth: "500px",
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: "40px", margin: "0 0 16px 0" }}>✅</h1>
          <h2 style={{ fontSize: "28px", margin: "0 0 16px 0", color: "#1e293b" }}>
            Test Submitted!
          </h2>
          <p style={{ color: "#666", marginBottom: "24px" }}>
            Great job! Your test has been submitted and evaluated.
          </p>

          {testScore && (
            <div
              style={{
                backgroundColor: testScore >= 80 ? "#d1fae5" : testScore >= 70 ? "#fef3c7" : "#fee2e2",
                borderRadius: "8px",
                padding: "20px",
                marginBottom: "24px",
                textAlign: "center",
                border: `2px solid ${testScore >= 80 ? "#6ee7b7" : testScore >= 70 ? "#fcd34d" : "#fca5a5"}`,
              }}
            >
              <p style={{ margin: "0 0 8px 0", color: "#666", fontSize: "13px", fontWeight: "500" }}>
                Your Score
              </p>
              <p
                style={{
                  margin: 0,
                  fontSize: "48px",
                  fontWeight: "700",
                  color: testScore >= 80 ? "#065f46" : testScore >= 70 ? "#92400e" : "#991b1b",
                }}
              >
                {testScore}%
              </p>
              <p style={{ margin: "8px 0 0 0", color: "#666", fontSize: "13px" }}>
                {testScore >= 80 ? "🎉 Excellent Performance!" : testScore >= 70 ? "👍 Good Job!" : "💪 Keep Practicing!"}
              </p>
            </div>
          )}

          <div
            style={{
              backgroundColor: "#f0f4ff",
              borderRadius: "8px",
              padding: "16px",
              marginBottom: "24px",
              textAlign: "left",
            }}
          >
            <p style={{ margin: "8px 0", color: "#1e293b" }}>
              <strong>Topic:</strong> {decodeURIComponent(topic)}
            </p>
            <p style={{ margin: "8px 0", color: "#1e293b" }}>
              <strong>Difficulty:</strong> {difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}
            </p>
            <p style={{ margin: "8px 0", color: "#1e293b" }}>
              <strong>Questions:</strong> {questions.length}
            </p>
            <p style={{ margin: "8px 0", color: tabSwitchCount > 0 ? "#dc2626" : "#1e293b" }}>
              <strong>Tab Switches:</strong> {tabSwitchCount}/5
            </p>
          </div>

          <button
            onClick={() => navigate("/dashboard")}
            style={{
              width: "100%",
              padding: "12px",
              backgroundColor: "#667eea",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
              fontSize: "16px",
              fontWeight: "600",
              transition: "all 0.3s ease",
            }}
            onMouseEnter={(e) => (e.target.style.backgroundColor = "#764ba2")}
            onMouseLeave={(e) => (e.target.style.backgroundColor = "#667eea")}
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px",
        }}
      >
        <div style={{ color: "white", textAlign: "center" }}>
          <p style={{ fontSize: "18px" }}>⏳ Loading test questions...</p>
        </div>
      </div>
    );
  }

  const currentQuestion = questions[currentQuestionIndex];
  const progress = ((currentQuestionIndex + 1) / questions.length) * 100;
  const currentResult = questionResults[currentQuestionIndex];

  return (
    <div
      ref={testContainerRef}
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        padding: "20px",
      }}
    >
      {/* Warning Banner */}
      <div
        ref={tabSwitchWarningRef}
        style={{
          position: "fixed",
          top: "20px",
          right: "20px",
          backgroundColor: "#dc2626",
          color: "white",
          padding: "12px 16px",
          borderRadius: "8px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          zIndex: 1000,
          display: "none",
          fontSize: "14px",
          fontWeight: "600",
        }}
      />

      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "20px",
          backgroundColor: "rgba(255,255,255,0.95)",
          padding: "16px 20px",
          borderRadius: "8px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
        }}
      >
        <div>
          <h1 style={{ margin: 0, color: "#1e293b", fontSize: "20px" }}>
            {decodeURIComponent(topic)} - {difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}
          </h1>
          <p style={{ margin: "4px 0 0 0", color: "#666", fontSize: "13px" }}>
            Question {currentQuestionIndex + 1} of {questions.length}
          </p>
        </div>
        <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
          <div style={{ fontSize: "24px", fontWeight: "700", color: "#667eea" }}>
            ⏱️ {formatTime(timeLeft || 0)}
          </div>
          <button
            onClick={requestFullscreen}
            disabled={isFullscreen}
            style={{
              padding: "6px 10px",
              backgroundColor: isFullscreen ? "#22c55e" : "#667eea",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: isFullscreen ? "default" : "pointer",
              fontWeight: "600",
              fontSize: "12px",
              opacity: isFullscreen ? 0.9 : 1,
            }}
          >
            {isFullscreen ? "Fullscreen on" : "Enter Fullscreen"}
          </button>
          <p style={{ margin: 0, color: "#666", fontSize: "12px" }}>
            {isFullscreen ? "✅ Fullscreen" : "⚠️ Not in fullscreen"}
          </p>
          <p style={{ margin: 0, color: "#666", fontSize: "12px" }}>
            Tab switches: {tabSwitchCount}/5
          </p>
          <p style={{ margin: 0, color: "#666", fontSize: "12px" }}>
            Score: {currentScore}%
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div
        style={{
          backgroundColor: "white",
          borderRadius: "12px",
          padding: "32px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
          maxWidth: "900px",
          margin: "0 auto",
        }}
      >
        {/* Progress Bar */}
        <div style={{ marginBottom: "24px" }}>
          <div
            style={{
              height: "6px",
              backgroundColor: "#e0e7ff",
              borderRadius: "3px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                backgroundColor: "#667eea",
                width: `${progress}%`,
                transition: "width 0.3s ease",
              }}
            />
          </div>
        </div>

        {/* Question */}
        <div style={{ marginBottom: "32px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", marginBottom: "16px" }}>
            <h2 style={{ fontSize: "20px", color: "#1e293b", margin: 0, lineHeight: "1.6", flex: 1 }}>
              {currentQuestion.question}
            </h2>
            <button
              onClick={() => speakQuestion(currentQuestion.question)}
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "50%",
                backgroundColor: "#e0e7ff",
                color: "#4f46e5",
                border: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                flexShrink: 0
              }}
              title="Read Question"
              aria-label="Read Question"
            >
              🔊
            </button>
          </div>

          {currentQuestion.difficulty && (
            <div style={{ marginBottom: "16px" }}>
              <span
                style={{
                  display: "inline-block",
                  padding: "4px 12px",
                  backgroundColor:
                    currentQuestion.difficulty === "easy"
                      ? "#dcfce7"
                      : currentQuestion.difficulty === "medium"
                        ? "#fef3c7"
                        : "#fee2e2",
                  color:
                    currentQuestion.difficulty === "easy"
                      ? "#166534"
                      : currentQuestion.difficulty === "medium"
                        ? "#92400e"
                        : "#991b1b",
                  borderRadius: "4px",
                  fontSize: "12px",
                  fontWeight: "600",
                }}
              >
                {currentQuestion.difficulty === "easy"
                  ? "🟢 Easy"
                  : currentQuestion.difficulty === "medium"
                    ? "🟡 Medium"
                    : "🔴 Hard"}
              </span>
            </div>
          )}
        </div>

        {/* Avatar + Answer Input */}
        <div style={{ display: "flex", gap: "20px", marginBottom: "32px", alignItems: "flex-start" }}>
          {/* Interviewer Avatar */}
          <div style={{
            flexShrink: 0,
            backgroundColor: "#f8fafc",
            borderRadius: "12px",
            padding: "12px",
            border: "1px solid #e0e7ff",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}>
            <InterviewerAvatar isTalking={isTalking} isListening={isListening} size={110} />
          </div>

          {/* Answer area */}
          <div style={{ flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <label
              style={{
                fontWeight: "600",
                color: "#1e293b",
              }}
            >
              Your Answer:
            </label>
            <button
              onClick={toggleMicrophone}
              title={isListening ? "Click to stop recording" : "Click to start microphone"}
              style={{
                padding: "8px 12px",
                backgroundColor: isListening ? "#dc2626" : "#667eea",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontWeight: "600",
                fontSize: "12px",
                transition: "all 0.3s ease",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
              onMouseEnter={(e) => {
                e.target.style.opacity = "0.9";
              }}
              onMouseLeave={(e) => {
                e.target.style.opacity = "1";
              }}
            >
              {isListening ? (
                <>🛑 Stop Recording</>
              ) : (
                <>🎙️ Speak Answer</>
              )}
            </button>
          </div>
          <textarea
            value={answers[currentQuestionIndex] || ""}
            onChange={(e) => handleAnswerChange(e.target.value)}
            placeholder="Type your answer here... or click 'Speak Answer' to use microphone"
            style={{
              width: "100%",
              height: "200px",
              padding: "12px",
              border: isListening ? "2px solid #dc2626" : "1px solid #e0e7ff",
              borderRadius: "8px",
              fontSize: "14px",
              fontFamily: "monospace",
              resize: "none",
              boxSizing: "border-box",
              backgroundColor: isListening ? "#fff5f5" : "white",
            }}
          />
          {isListening && (
            <div style={{ marginTop: "8px", padding: "8px 12px", backgroundColor: "#fee2e2", borderRadius: "6px", color: "#991b1b", fontSize: "12px", fontWeight: "600" }}>
              🎙️ Listening... Speak now!
            </div>
          )}
          </div>
        </div>

        {/* Per-Question Result */}
        {currentResult && (
          <div
            style={{
              marginBottom: "24px",
              padding: "12px",
              borderRadius: "8px",
              backgroundColor: currentResult.correct ? "#d1fae5" : "#fee2e2",
              color: currentResult.correct ? "#065f46" : "#991b1b",
              border: `2px solid ${currentResult.correct ? "#6ee7b7" : "#fca5a5"}`,
            }}
          >
            <strong>{currentResult.correct ? "✅ Correct" : "❌ Incorrect"}</strong>
            <div style={{ marginTop: "6px", color: "#1e293b" }}>
              Score for this question: {currentResult.score}%
            </div>
            <div style={{ marginTop: "4px", color: "#374151" }}>{currentResult.feedback}</div>
          </div>
        )}

        {/* Reference Answer (Optional) */}
        {currentQuestion.answer && (
          <div
            style={{
              marginBottom: "32px",
              padding: "16px",
              backgroundColor: "#f0f4ff",
              borderRadius: "8px",
              borderLeft: "4px solid #667eea",
            }}
          >
            <p style={{ margin: "0 0 8px 0", fontWeight: "600", color: "#667eea" }}>
              📚 Reference Answer:
            </p>
            <p style={{ margin: 0, color: "#1e293b", lineHeight: "1.6" }}>
              {currentQuestion.answer}
            </p>
          </div>
        )}

        {/* Navigation Buttons */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "12px",
          }}
        >
          <button
            onClick={() => setCurrentQuestionIndex(Math.max(0, currentQuestionIndex - 1))}
            disabled={currentQuestionIndex === 0}
            style={{
              padding: "12px 20px",
              backgroundColor: currentQuestionIndex === 0 ? "#e0e7ff" : "#667eea",
              color: currentQuestionIndex === 0 ? "#999" : "white",
              border: "none",
              borderRadius: "8px",
              cursor: currentQuestionIndex === 0 ? "not-allowed" : "pointer",
              fontWeight: "600",
              transition: "all 0.3s ease",
            }}
            onMouseEnter={(e) => {
              if (currentQuestionIndex > 0) {
                e.target.style.backgroundColor = "#764ba2";
              }
            }}
            onMouseLeave={(e) => {
              if (currentQuestionIndex > 0) {
                e.target.style.backgroundColor = "#667eea";
              }
            }}
          >
            ← Previous
          </button>

          <button
            onClick={() =>
              setCurrentQuestionIndex(Math.min(questions.length - 1, currentQuestionIndex + 1))
            }
            disabled={currentQuestionIndex === questions.length - 1}
            style={{
              padding: "12px 20px",
              backgroundColor: currentQuestionIndex === questions.length - 1 ? "#e0e7ff" : "#667eea",
              color: currentQuestionIndex === questions.length - 1 ? "#999" : "white",
              border: "none",
              borderRadius: "8px",
              cursor: currentQuestionIndex === questions.length - 1 ? "not-allowed" : "pointer",
              fontWeight: "600",
              transition: "all 0.3s ease",
            }}
            onMouseEnter={(e) => {
              if (currentQuestionIndex < questions.length - 1) {
                e.target.style.backgroundColor = "#764ba2";
              }
            }}
            onMouseLeave={(e) => {
              if (currentQuestionIndex < questions.length - 1) {
                e.target.style.backgroundColor = "#667eea";
              }
            }}
          >
            Next →
          </button>

          <button
            onClick={submitAnswer}
            style={{
              padding: "12px 20px",
              backgroundColor: "#0ea5e9",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
              fontWeight: "600",
              transition: "all 0.3s ease",
            }}
            onMouseEnter={(e) => (e.target.style.backgroundColor = "#0284c7")}
            onMouseLeave={(e) => (e.target.style.backgroundColor = "#0ea5e9")}
          >
            Submit Answer
          </button>

          <button
            onClick={submitTest}
            style={{
              padding: "12px 20px",
              backgroundColor: "#059669",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
              fontWeight: "600",
              transition: "all 0.3s ease",
            }}
            onMouseEnter={(e) => (e.target.style.backgroundColor = "#047857")}
            onMouseLeave={(e) => (e.target.style.backgroundColor = "#059669")}
          >
            ✅ Submit Test
          </button>
        </div>

        {/* Proctoring Info */}
        <div
          style={{
            marginTop: "24px",
            padding: "12px",
            backgroundColor: "#fef3c7",
            borderRadius: "8px",
            fontSize: "12px",
            color: "#92400e",
            borderLeft: "4px solid #f59e0b",
          }}
        >
          <strong>🔒 Proctoring Status:</strong> {isFullscreen ? "✅ Fullscreen Active" : "⚠️ Not in Fullscreen"} •
          Tab Switches: {tabSwitchCount}/5 {tabSwitchCount >= 5 && "⛔"}
        </div>
      </div>
    </div>
  );
};

export default Test;
