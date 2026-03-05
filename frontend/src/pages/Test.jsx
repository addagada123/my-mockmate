import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import axios from "axios";
import InterviewerAvatar from "./InterviewerAvatar";
import CodingQuestion from "./CodingQuestion";

const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

const isSqlTopic = (topicText) => {
  const t = (topicText || "").toLowerCase();
  return t.includes("sql") || t.includes("mysql") || t.includes("postgres") || t.includes("database") || t.includes("sequel");
};

const Test = () => {
  const { topic } = useParams();
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
    if (testMode === "normal" && testStarted && questions.length > 0 && questions[currentQuestionIndex]) {
      // Small delay to ensure smooth transition
      const timer = setTimeout(() => {
        speakQuestion(questions[currentQuestionIndex].question);
      }, 500);
      return () => {
        clearTimeout(timer);
        stopSpeech();
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuestionIndex, questions, testStarted, testMode]);

  // Clean up speech on unmount
  useEffect(() => {
    return () => {
      stopSpeech();
    };
  }, []);

  // Initialize speech recognition
  useEffect(() => {
    if (testMode !== "normal") return;
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
        let finalTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript + " ";
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
        showWarning(`🎙 Error: ${event.error}`);
      };
    }
  }, [currentQuestionIndex, testMode]);

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
            let filteredQuestions = resumeResponse.data.questions;

            if (difficulty === "coding") {
              const codingOnly = filteredQuestions.filter(
                (q) => (q.type || "").toLowerCase() === "coding"
              );
              filteredQuestions = codingOnly;
            } else if (difficulty) {
              const difficultyFiltered = filteredQuestions.filter(
                (q) => q.difficulty && q.difficulty.toLowerCase() === difficulty.toLowerCase()
              );
              if (difficultyFiltered.length > 0) {
                filteredQuestions = difficultyFiltered;
              }
            }

            if (filteredQuestions.length > 0) {
              console.log("Using resume questions:", filteredQuestions);
              setQuestions(filteredQuestions);
              return;
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
          let fetched = response.data.questions;
          if (difficulty === "coding") {
            const codingOnly = fetched.filter(
              (q) => (q.type || "").toLowerCase() === "coding"
            );
            fetched = codingOnly;
          }
          console.log("Using general questions:", fetched);
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
                starter_code: sqlMode
                  ? "-- Write SQL query\\nSELECT 1;"
                  : "def solve(input_data):\\n    arr = list(map(int, input_data.strip().split()))\\n    # write code\\n    return \\\"\\\"",
                test_cases: sqlMode
                  ? [
                      {
                        setup_sql: "CREATE TABLE departments(id INTEGER PRIMARY KEY, name TEXT);CREATE TABLE employees(id INTEGER PRIMARY KEY, name TEXT, department_id INTEGER);INSERT INTO departments(id,name) VALUES (1,'Engineering'),(2,'HR');INSERT INTO employees(id,name,department_id) VALUES (1,'A',1),(2,'B',1),(3,'C',2);",
                        expected_output: "Engineering|2\\nHR|1"
                      }
                    ]
                  : [
                      { input: "1 -2 3 4 -1", expected_output: "7" },
                      { input: "-5 -2 -1", expected_output: "-1" },
                      { input: "2 3 -2 5", expected_output: "8" }
                    ]
              }
            ]);
          } else {
            setQuestions(fetched);
          }
        } else {
          console.log("No questions in response, using fallback");
          if (difficulty === "coding") {
            const sqlMode = isSqlTopic(decodeURIComponent(topic));
            setQuestions([
              {
                question: sqlMode
                  ? `Write an SQL query for ${decodeURIComponent(topic)}: find customers who placed more than 2 orders.`
                  : `Write code to merge two sorted arrays for ${decodeURIComponent(topic)}. Input: two lines of space-separated ints.`,
                answer: sqlMode ? "GROUP BY customer and filter count > 2." : "Two-pointer merge.",
                difficulty: "medium",
                topic: decodeURIComponent(topic),
                type: "coding",
                language: sqlMode ? "sql" : "python",
                starter_code: sqlMode
                  ? "-- Write SQL query\\nSELECT 1;"
                  : "def solve(input_data):\\n    lines = [ln.strip() for ln in input_data.strip().splitlines() if ln.strip()]\\n    a = list(map(int, lines[0].split())) if lines else []\\n    b = list(map(int, lines[1].split())) if len(lines)>1 else []\\n    # write code\\n    return \\\"\\\"",
                test_cases: sqlMode
                  ? [
                      {
                        setup_sql: "CREATE TABLE customers(id INTEGER PRIMARY KEY, name TEXT);CREATE TABLE orders(id INTEGER PRIMARY KEY, customer_id INTEGER);INSERT INTO customers VALUES (1,'A'),(2,'B'),(3,'C');INSERT INTO orders VALUES (1,1),(2,1),(3,1),(4,2);",
                        expected_output: "A"
                      }
                    ]
                  : [
                      { input: "1 3 5\\n2 4 6", expected_output: "1 2 3 4 5 6" },
                      { input: "1 2 3\\n", expected_output: "1 2 3" },
                      { input: "\\n4 5", expected_output: "4 5" }
                    ]
              }
            ]);
          } else {
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
        }
      } catch (error) {
        console.error("Error fetching questions:", error);
        if (difficulty === "coding") {
          const sqlMode = isSqlTopic(decodeURIComponent(topic));
          setQuestions([
            {
              question: sqlMode
                ? `Write an SQL query for ${decodeURIComponent(topic)}: return second highest salary from Employees table.`
                : `Write code to print all prime numbers <= N for ${decodeURIComponent(topic)}.`,
              answer: sqlMode ? "Use DISTINCT with ORDER BY and LIMIT/OFFSET." : "Sieve or optimized primality checks.",
              difficulty: "medium",
              topic: decodeURIComponent(topic),
              type: "coding",
              language: sqlMode ? "sql" : "python",
              starter_code: sqlMode
                ? "-- Write SQL query\\nSELECT 1;"
                : "def solve(input_data):\\n    n = int(input_data.strip())\\n    # write code\\n    return \\\"\\\"",
              test_cases: sqlMode
                ? [
                    {
                      setup_sql: "CREATE TABLE employees(id INTEGER PRIMARY KEY, salary INTEGER);INSERT INTO employees VALUES (1,100),(2,300),(3,200),(4,300);",
                      expected_output: "200"
                    }
                  ]
                : [
                    { input: "10", expected_output: "2 3 5 7" },
                    { input: "2", expected_output: "2" },
                    { input: "1", expected_output: "" }
                  ]
            }
          ]);
        } else {
          setQuestions([
            {
              question: `Sample ${decodeURIComponent(topic)} Question 1?`,
              answer: "Sample answer 1",
              difficulty: difficulty || "medium",
            },
          ]);
        }
      }
    };

    if (difficulty) {
      fetchQuestions();
    }
  }, [difficulty, topic]);

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
    if (testMode === "normal" && testStarted && timeLeft !== null && timeLeft > 0) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testStarted, timeLeft, testMode]);

  // Detect tab/window switch
  useEffect(() => {
    if (!testStarted || testMode !== "normal") return;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testStarted, isFullscreen, testMode]);

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
        if (testStarted && testMode === "normal") {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testStarted, testMode]);

  const showWarning = (message) => {
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
  };

  const handleAnswerChange = (value) => {
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

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const qDifficulty = (params.get("difficulty") || "").toLowerCase();
    const allowed = new Set(["easy", "medium", "hard", "coding"]);
    if (allowed.has(qDifficulty)) {
      setDifficulty(qDifficulty);
    }
  }, [location.search]);

  // Track visited questions when navigating
  useEffect(() => {
    setVisitedQuestions((prev) => {
      const next = new Set(prev);
      next.add(currentQuestionIndex);
      return next;
    });
  }, [currentQuestionIndex]);

  const toggleMarkForReview = () => {
    setMarkedForReview((prev) => {
      const next = new Set(prev);
      if (next.has(currentQuestionIndex)) {
        next.delete(currentQuestionIndex);
      } else {
        next.add(currentQuestionIndex);
      }
      return next;
    });
  };

  // Get question status for the navigation panel
  const getQuestionStatus = (index) => {
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
  };

  const statusConfig = {
    current: { bg: "#6366f1", border: "#6366f1", color: "#fff", shadow: "0 0 0 3px rgba(99,102,241,0.3)" },
    answered: { bg: "#10b981", border: "#10b981", color: "#fff", shadow: "none" },
    "not-answered": { bg: "#f59e0b", border: "#f59e0b", color: "#fff", shadow: "none" },
    marked: { bg: "#8b5cf6", border: "#8b5cf6", color: "#fff", shadow: "none" },
    "answered-marked": { bg: "linear-gradient(135deg, #10b981, #8b5cf6)", border: "#8b5cf6", color: "#fff", shadow: "none" },
    "not-visited": { bg: "#e2e8f0", border: "#cbd5e1", color: "#64748b", shadow: "none" },
  };

  const submitAnswer = async () => {
    const question = questions[currentQuestionIndex];

    // For coding questions, use the coding run result if available
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
      showWarning(correct ? "✅ All test cases passed!" : `⚠️ ${codeResult.passed}/${codeResult.total} test cases passed`);
      return;
    }

    const answerText = answers[currentQuestionIndex] || "";
    if (!answerText.trim()) {
      showWarning("⚠️ Please provide an answer before submitting");
      return;
    }

    // Call backend /evaluate for accurate TF-IDF scoring
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
      showWarning(result.correct ? `✅ Score: ${result.score}%` : `❌ Score: ${result.score}% — ${result.feedback.split(".")[0]}`);
    } catch (evalErr) {
      console.error("Backend evaluation error, using fallback:", evalErr);
      // Fallback: lightweight client-side TF-IDF approximation
      const stopWords = new Set(["a","an","the","is","are","was","were","be","been","have","has","had","do","does","did","will","would","shall","should","may","might","can","could","and","but","or","not","if","then","else","when","of","at","by","for","with","about","to","from","in","into","what","which","who","this","that","it","how","why","where","your","you"]);
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
  };

  // Callback when coding question run completes
  const handleCodingRunResult = (runResult) => {
    setCodingResults((prev) => ({
      ...prev,
      [currentQuestionIndex]: runResult,
    }));
  };

  const toggleMicrophone = () => {
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
  };

  const regenerateCurrentQuestion = async () => {
    if (!sessionId) {
      showWarning("⚠️ No session available");
      return;
    }

    try {
      const token = localStorage.getItem("mockmate_token");
      
      showWarning("🔄 Regenerating question...");
      
      const response = await axios.post(
        `${API_BASE}/regenerate-question?session_id=${encodeURIComponent(sessionId)}&question_index=${currentQuestionIndex}`,
        {},
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.data.success && response.data.new_question) {
        // Update questions array with new question
        const updatedQuestions = [...questions];
        updatedQuestions[currentQuestionIndex] = response.data.new_question;
        setQuestions(updatedQuestions);

        // Clear the answer for this question
        const updatedAnswers = { ...answers };
        delete updatedAnswers[currentQuestionIndex];
        setAnswers(updatedAnswers);

        // Clear any previous result for this question
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
      showWarning("❌ Error regenerating question: " + (error.response?.data?.detail || error.message));
    }
  };

  const startVRTest = async () => {
    if (!sessionId) {
      showWarning("No session available for VR mode");
      return;
    }

    try {
      setVrBusy(true);
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
      setVrBridgeToken(response.data.bridge_token || "");
      setVrBridgeExpiresAt(response.data.bridge_expires_at || "");
      vrStartedAtRef.current = Date.now();
      showWarning("VR mode initialized. Unity can now fetch the current question.");
    } catch (error) {
      showWarning(`VR start failed: ${error.response?.data?.detail || error.message}`);
    } finally {
      setVrBusy(false);
    }
  };

  const refreshVRQuestion = async () => {
    if (!sessionId) return;
    try {
      const token = localStorage.getItem("mockmate_token");
      const response = await axios.get(
        `${API_BASE}/vr-test/next?session_id=${encodeURIComponent(sessionId)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      setVrCompleted(!!response.data.completed);
      setVrCurrentQuestion(response.data.current_question || null);
      setVrCurrentIndex(response.data.current_question_index || 0);
    } catch (error) {
      showWarning(`VR sync failed: ${error.response?.data?.detail || error.message}`);
    }
  };

  const submitVRAnswer = async () => {
    if (!sessionId || !vrCurrentQuestion) return;
    if (!vrTranscript.trim()) {
      showWarning("Please paste or type the transcript from Unity");
      return;
    }

    try {
      setVrBusy(true);
      const token = localStorage.getItem("mockmate_token");
      const response = await axios.post(
        `${API_BASE}/vr-test/answer?session_id=${encodeURIComponent(sessionId)}`,
        {
          question_index: vrCurrentIndex,
          user_answer: vrTranscript.trim(),
        },
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
      showWarning(`VR answer save failed: ${error.response?.data?.detail || error.message}`);
    } finally {
      setVrBusy(false);
    }
  };

  const completeVRTest = async () => {
    if (!sessionId) return;
    try {
      setVrBusy(true);
      const token = localStorage.getItem("mockmate_token");
      const elapsedSecs = vrStartedAtRef.current
        ? Math.max(1, Math.floor((Date.now() - vrStartedAtRef.current) / 1000))
        : null;
      const response = await axios.post(
        `${API_BASE}/vr-test/complete`,
        {
          session_id: sessionId,
          time_spent: elapsedSecs,
        },
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
      showWarning(`VR completion failed: ${error.response?.data?.detail || error.message}`);
    } finally {
      setVrBusy(false);
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
          mode: "normal",
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
          background: "#f5f3ff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px",
        }}
      >
        <div
          style={{
            backgroundColor: "white",
            borderRadius: "20px",
            padding: "40px",
            maxWidth: "500px",
            boxShadow: "0 20px 60px rgba(99,102,241,0.12)",
            textAlign: "center",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "4px", background: "linear-gradient(135deg, #6366f1, #8b5cf6, #06b6d4)" }} />
          <h1 style={{ fontSize: "32px", margin: "0 0 16px 0", color: "#1e1b4b" }}>
            📝 Select Difficulty
          </h1>
          <p style={{ color: "#666", marginBottom: "32px", lineHeight: "1.6" }}>
            Choose your difficulty level for the <strong>{decodeURIComponent(topic)}</strong> test.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {["Easy", "Medium", "Hard", "Coding"].map((level) => (
              <button
                key={level}
                 onClick={async () => {
                  setQuestions([]);
                  setCurrentQuestionIndex(0);
                  setAnswers({});
                  setQuestionResults({});
                  setCodingResults({});
                  setCurrentScore(0);
                  setTimeLeft(null);
                  setTestSubmitted(false);
                  setTestMode(null);
                  setVrCurrentQuestion(null);
                  setVrCurrentIndex(0);
                  setVrRunningScore(0);
                  setVrTranscript("");
                  setVrCompleted(false);
                  setVrBridgeToken("");
                  setVrBridgeExpiresAt("");
                  setDifficulty(level.toLowerCase());
                }}
                style={{
                  padding: "16px",
                  background:
                    level === "Easy"
                      ? "linear-gradient(135deg, #22c55e, #16a34a)"
                      : level === "Medium"
                        ? "linear-gradient(135deg, #f59e0b, #d97706)"
                        : level === "Hard"
                          ? "linear-gradient(135deg, #ef4444, #dc2626)"
                          : "linear-gradient(135deg, #8b5cf6, #7c3aed)",
                  color: "white",
                  border: "none",
                  borderRadius: "12px",
                  cursor: "pointer",
                  fontSize: "16px",
                  fontWeight: "600",
                  transition: "all 0.3s ease",
                  boxShadow: "0 4px 12px rgba(99,102,241,0.3)",
                }}
                onMouseEnter={(e) => { e.target.style.transform = "translateY(-2px)"; e.target.style.boxShadow = "0 6px 20px rgba(99,102,241,0.4)"; }}
                onMouseLeave={(e) => { e.target.style.transform = "translateY(0)"; e.target.style.boxShadow = "0 4px 12px rgba(99,102,241,0.3)"; }}
              >
                {level === "Easy" && "🟢"}
                {level === "Medium" && "🟡"}
                {level === "Hard" && "🔴"} {level}
              </button>
            ))}
          </div>

          <button
            onClick={() => navigate("/communication-test")}
            style={{
              marginTop: "14px",
              padding: "12px 24px",
              backgroundColor: "#06b6d4",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
              fontSize: "14px",
              fontWeight: "600",
              transition: "all 0.3s ease",
            }}
          >
            Go to Communication Test
          </button>

          <button
            onClick={() => navigate("/dashboard")}
            style={{
              marginTop: "20px",
              padding: "12px 24px",
              backgroundColor: "transparent",
              color: "#6366f1",
              border: "2px solid #6366f1",
              borderRadius: "8px",
              cursor: "pointer",
              fontSize: "14px",
              fontWeight: "600",
              transition: "all 0.3s ease",
            }}
            onMouseEnter={(e) => {
              e.target.backgroundColor = "#6366f1";
              e.target.color = "white";
            }}
            onMouseLeave={(e) => {
              e.target.backgroundColor = "transparent";
              e.target.color = "#6366f1";
            }}
          >
            ← Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (difficulty && !testMode) {
    if (questions.length === 0) {
      return (
        <div
          style={{
            minHeight: "100vh",
            background: "#f5f3ff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
          }}
        >
          <div style={{ color: "#334155", textAlign: "center" }}>
            <p style={{ fontSize: "18px" }}>Loading generated questions...</p>
          </div>
        </div>
      );
    }

    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#f5f3ff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px",
        }}
      >
        <div
          style={{
            backgroundColor: "white",
            borderRadius: "20px",
            padding: "40px",
            maxWidth: "560px",
            boxShadow: "0 20px 60px rgba(99,102,241,0.12)",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: "30px", margin: "0 0 14px 0", color: "#1e1b4b" }}>
            Questions Ready
          </h1>
          <p style={{ color: "#666", marginBottom: "24px", lineHeight: "1.6" }}>
            {questions.length} questions were generated for <strong>{decodeURIComponent(topic)}</strong> ({difficulty}).
          </p>
          <p style={{ color: "#475569", fontSize: "14px", marginBottom: "20px" }}>
            Choose how you want to take the test:
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <button
              onClick={async () => {
                setTestMode("normal");
                await requestFullscreen();
                setTestStarted(true);
              }}
              style={{
                padding: "14px",
                background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                color: "white",
                border: "none",
                borderRadius: "10px",
                cursor: "pointer",
                fontSize: "16px",
                fontWeight: "600",
              }}
            >
              Take Test
            </button>
            <button
              onClick={startVRTest}
              disabled={vrBusy}
              style={{
                padding: "14px",
                background: vrBusy ? "#94a3b8" : "#0f766e",
                color: "white",
                border: "none",
                borderRadius: "10px",
                cursor: vrBusy ? "not-allowed" : "pointer",
                fontSize: "16px",
                fontWeight: "600",
              }}
            >
              {vrBusy ? "Starting VR..." : "Take Test in VR"}
            </button>
          </div>
          <button
            onClick={() => {
              setDifficulty(null);
              setTestMode(null);
            }}
            style={{
              marginTop: "18px",
              padding: "10px 16px",
              backgroundColor: "transparent",
              color: "#6366f1",
              border: "1px solid #6366f1",
              borderRadius: "8px",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: "600",
            }}
          >
            Back
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
          background: "#f5f3ff",
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
            boxShadow: "0 4px 24px rgba(99,102,241,0.08)",
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
            <p style={{ margin: "8px 0", color: "#334155" }}>
              <strong>Topic:</strong> {decodeURIComponent(topic)}
            </p>
            <p style={{ margin: "8px 0", color: "#334155" }}>
              <strong>Difficulty:</strong> {difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}
            </p>
            <p style={{ margin: "8px 0", color: "#334155" }}>
              <strong>Questions:</strong> {questions.length}
            </p>
            <p style={{ margin: "8px 0", color: tabSwitchCount > 0 ? "#dc2626" : "#334155" }}>
              <strong>Tab Switches:</strong> {tabSwitchCount}/5
            </p>
          </div>

          <button
            onClick={() => navigate("/dashboard")}
            style={{
              width: "100%",
              padding: "12px",
              backgroundColor: "#6366f1",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
              fontSize: "16px",
              fontWeight: "600",
              transition: "all 0.3s ease",
            }}
            onMouseEnter={(e) => (e.target.style.backgroundColor = "#4f46e5")}
            onMouseLeave={(e) => (e.target.style.backgroundColor = "#6366f1")}
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (testMode === "vr") {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#f5f3ff",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: "900px", margin: "0 auto" }}>
          <div
            style={{
              backgroundColor: "white",
              borderRadius: "14px",
              boxShadow: "0 8px 30px rgba(15,23,42,0.08)",
              padding: "24px",
              marginBottom: "16px",
            }}
          >
            <h1 style={{ margin: "0 0 8px 0", color: "#0f172a", fontSize: "28px" }}>
              VR Test Control
            </h1>
            <p style={{ margin: 0, color: "#475569" }}>
              Unity flow: fetch question from backend, run TTS/avatar/audio/STT in Unity, then submit transcript here or directly to API.
            </p>
            <p style={{ margin: "10px 0 0 0", color: "#64748b", fontSize: "14px" }}>
              Session: <strong>{sessionId}</strong> | Running score: <strong>{vrRunningScore}%</strong>
            </p>
            {vrBridgeToken && (
              <div style={{ marginTop: "12px", padding: "10px", borderRadius: "8px", backgroundColor: "#eef2ff", color: "#1e293b", fontSize: "13px" }}>
                <div><strong>Unity bridge_token:</strong> <code>{vrBridgeToken}</code></div>
                <div style={{ marginTop: "4px" }}><strong>Expires:</strong> {vrBridgeExpiresAt || "N/A"}</div>
              </div>
            )}
          </div>

          <div
            style={{
              backgroundColor: "white",
              borderRadius: "14px",
              boxShadow: "0 8px 30px rgba(15,23,42,0.08)",
              padding: "24px",
              marginBottom: "16px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <h2 style={{ margin: 0, color: "#1e293b", fontSize: "20px" }}>
                Current Question ({vrCurrentIndex + 1}/{questions.length})
              </h2>
              <button
                onClick={refreshVRQuestion}
                style={{
                  padding: "8px 12px",
                  border: "none",
                  borderRadius: "8px",
                  backgroundColor: "#6366f1",
                  color: "white",
                  cursor: "pointer",
                  fontWeight: "600",
                }}
              >
                Sync with Backend
              </button>
            </div>
            <div style={{ padding: "14px", borderRadius: "10px", backgroundColor: "#f8fafc", border: "1px solid #e2e8f0" }}>
              {vrCompleted ? (
                <p style={{ margin: 0, color: "#0f766e", fontWeight: "700" }}>
                  All questions answered in VR.
                </p>
              ) : (
                <p style={{ margin: 0, color: "#334155", lineHeight: "1.7" }}>
                  {vrCurrentQuestion?.question || "No active question. Click Sync with Backend."}
                </p>
                )}
              </div>
            {vrBridgeToken && (
              <div style={{ marginTop: "12px", padding: "12px", borderRadius: "8px", backgroundColor: "#f8fafc", border: "1px dashed #94a3b8", fontSize: "12px", color: "#334155" }}>
                <div><strong>Unity endpoints:</strong></div>
                <div><code>GET {API_BASE}/vr-bridge/next?bridge_token=...</code></div>
                <div><code>POST {API_BASE}/vr-bridge/answer?bridge_token=...</code></div>
                <div><code>POST {API_BASE}/vr-bridge/complete?bridge_token=...</code></div>
              </div>
            )}
          </div>

          {!vrCompleted && (
            <div
              style={{
                backgroundColor: "white",
                borderRadius: "14px",
                boxShadow: "0 8px 30px rgba(15,23,42,0.08)",
                padding: "24px",
                marginBottom: "16px",
              }}
            >
              <h3 style={{ marginTop: 0, color: "#1e293b" }}>Transcript from Unity STT</h3>
              <textarea
                value={vrTranscript}
                onChange={(e) => setVrTranscript(e.target.value)}
                placeholder="Paste STT output for the current question"
                style={{
                  width: "100%",
                  minHeight: "140px",
                  borderRadius: "8px",
                  border: "1px solid #cbd5e1",
                  padding: "12px",
                  resize: "vertical",
                  fontSize: "14px",
                  boxSizing: "border-box",
                }}
              />
              <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
                <button
                  onClick={submitVRAnswer}
                  disabled={vrBusy}
                  style={{
                    padding: "10px 14px",
                    border: "none",
                    borderRadius: "8px",
                    backgroundColor: vrBusy ? "#94a3b8" : "#0f766e",
                    color: "white",
                    cursor: vrBusy ? "not-allowed" : "pointer",
                    fontWeight: "600",
                  }}
                >
                  {vrBusy ? "Saving..." : "Save Answer and Move Next"}
                </button>
                <button
                  onClick={completeVRTest}
                  style={{
                    padding: "10px 14px",
                    border: "none",
                    borderRadius: "8px",
                    backgroundColor: "#059669",
                    color: "white",
                    cursor: "pointer",
                    fontWeight: "600",
                  }}
                >
                  Complete VR Test
                </button>
              </div>
            </div>
          )}

          {vrCompleted && (
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={completeVRTest}
                style={{
                  padding: "12px 16px",
                  border: "none",
                  borderRadius: "8px",
                  backgroundColor: "#059669",
                  color: "white",
                  cursor: "pointer",
                  fontWeight: "700",
                }}
              >
                Save to Performance Tab
              </button>
              <button
                onClick={() => navigate("/performance")}
                style={{
                  padding: "12px 16px",
                  border: "1px solid #64748b",
                  borderRadius: "8px",
                  backgroundColor: "white",
                  color: "#334155",
                  cursor: "pointer",
                  fontWeight: "600",
                }}
              >
                Open Performance
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#f5f3ff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px",
        }}
      >
        <div style={{ color: "#334155", textAlign: "center" }}>
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
        background: "#f5f3ff",
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
          background: "linear-gradient(135deg, rgba(255,255,255,0.95), rgba(238,242,255,0.95))",
          backdropFilter: "blur(8px)",
          padding: "16px 20px",
          borderRadius: "12px",
          boxShadow: "0 4px 16px rgba(99,102,241,0.08)",
          border: "1px solid rgba(99,102,241,0.1)",
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
          <div style={{ fontSize: "24px", fontWeight: "700", color: "#1e293b" }}>
            ⏱️ {formatTime(timeLeft || 0)}
          </div>
          <button
            onClick={requestFullscreen}
            disabled={isFullscreen}
            style={{
              padding: "6px 10px",
              backgroundColor: isFullscreen ? "#22c55e" : "#6366f1",
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

      {/* Layout: Main Content + Question Navigation Panel */}
      <div style={{ display: "flex", gap: "20px", maxWidth: "1280px", margin: "0 auto", alignItems: "flex-start" }}>

      {/* Main Content */}
      <div
        style={{
          backgroundColor: "white",
          borderRadius: "16px",
          padding: "32px",
          boxShadow: "0 20px 60px rgba(99,102,241,0.1)",
          flex: 1,
          minWidth: 0,
          border: "1px solid rgba(99,102,241,0.08)",
        }}
      >
        {/* Progress Bar */}
        <div style={{ marginBottom: "24px" }}>
          <div
            style={{
              height: "6px",
              backgroundColor: "#eef2ff",
              borderRadius: "3px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                backgroundColor: "#6366f1",
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
                backgroundColor: "#eef2ff",
                color: "#6366f1",
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
            <button
              onClick={() => regenerateCurrentQuestion()}
              title="Regenerate this question"
              aria-label="Regenerate Question"
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "50%",
                backgroundColor: "#f3e8ff",
                color: "#9333ea",
                border: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                flexShrink: 0,
                fontSize: "18px",
                fontWeight: "bold",
                transition: "all 0.3s ease",
              }}
              onMouseEnter={(e) => {
                e.target.style.backgroundColor = "#e9d5ff";
                e.target.style.transform = "scale(1.1)";
              }}
              onMouseLeave={(e) => {
                e.target.style.backgroundColor = "#f3e8ff";
                e.target.style.transform = "scale(1)";
              }}
            >
              🔄
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
              {currentQuestion.type === "coding" && (
                <span
                  style={{
                    display: "inline-block",
                    padding: "4px 12px",
                    backgroundColor: "#e0f2fe",
                    color: "#0369a1",
                    borderRadius: "4px",
                    fontSize: "12px",
                    fontWeight: "600",
                    marginLeft: "8px",
                  }}
                >
                  💻 Coding Problem
                </span>
              )}
            </div>
          )}
        </div>

        {/* Interviewer Avatar */}
        <div style={{
          display: "flex",
          justifyContent: "center",
          marginBottom: "24px",
        }}>
          <div style={{
            backgroundColor: "#f5f3ff",
            borderRadius: "16px",
            padding: "20px 32px",
            border: "1px solid #e0e7ff",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            boxShadow: "0 2px 8px rgba(0,115,230,0.08)",
          }}>
            <InterviewerAvatar isTalking={isTalking} isListening={isListening} size={150} />
          </div>
        </div>

        {/* Answer Input */}
        <div style={{ marginBottom: "32px" }}>
          {currentQuestion.type === "coding" ? (
            /* ---- Coding Question: Monaco Editor + Test Runner ---- */
            <>
              <label
                style={{
                  fontWeight: "600",
                  color: "#334155",
                  display: "block",
                  marginBottom: "12px",
                }}
              >
                💻 Write Your Code:
              </label>
              <CodingQuestion
                question={currentQuestion}
                initialCode={answers[currentQuestionIndex] || currentQuestion.starter_code || ""}
                onCodeChange={(code) => handleAnswerChange(code)}
                onRunResult={handleCodingRunResult}
              />
            </>
          ) : (
            /* ---- Regular Question: Textarea + Mic ---- */
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <label
                  style={{
                    fontWeight: "600",
                    color: "#334155",
                  }}
                >
                  Your Answer:
                </label>
                <button
                  onClick={toggleMicrophone}
                  title={isListening ? "Click to stop recording" : "Click to start microphone"}
                  style={{
                    padding: "8px 12px",
                    backgroundColor: isListening ? "#dc2626" : "#6366f1",
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
                    <>🎙 Speak Answer</>
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
                  🎙 Listening... Speak now!
                </div>
              )}
            </>
          )}
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
            <div style={{ marginTop: "6px", color: "#334155" }}>
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
              borderLeft: "4px solid #6366f1",
            }}
          >
            <p style={{ margin: "0 0 8px 0", fontWeight: "600", color: "#1e293b" }}>
              📚 Reference Answer:
            </p>
            <p style={{ margin: 0, color: "#334155", lineHeight: "1.6" }}>
              {currentQuestion.answer}
            </p>
          </div>
        )}

        {/* Navigation Buttons */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "10px",
          }}
        >
          <button
            onClick={() => setCurrentQuestionIndex(Math.max(0, currentQuestionIndex - 1))}
            disabled={currentQuestionIndex === 0}
            style={{
              padding: "10px 18px",
              backgroundColor: currentQuestionIndex === 0 ? "#eef2ff" : "#6366f1",
              color: currentQuestionIndex === 0 ? "#999" : "white",
              border: "none",
              borderRadius: "8px",
              cursor: currentQuestionIndex === 0 ? "not-allowed" : "pointer",
              fontWeight: "600",
              fontSize: "13px",
              transition: "all 0.3s ease",
            }}
            onMouseEnter={(e) => {
              if (currentQuestionIndex > 0) e.target.style.backgroundColor = "#4f46e5";
            }}
            onMouseLeave={(e) => {
              if (currentQuestionIndex > 0) e.target.style.backgroundColor = "#6366f1";
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
              padding: "10px 18px",
              backgroundColor: currentQuestionIndex === questions.length - 1 ? "#eef2ff" : "#6366f1",
              color: currentQuestionIndex === questions.length - 1 ? "#999" : "white",
              border: "none",
              borderRadius: "8px",
              cursor: currentQuestionIndex === questions.length - 1 ? "not-allowed" : "pointer",
              fontWeight: "600",
              fontSize: "13px",
              transition: "all 0.3s ease",
            }}
            onMouseEnter={(e) => {
              if (currentQuestionIndex < questions.length - 1) e.target.style.backgroundColor = "#4f46e5";
            }}
            onMouseLeave={(e) => {
              if (currentQuestionIndex < questions.length - 1) e.target.style.backgroundColor = "#6366f1";
            }}
          >
            Next →
          </button>

          <button
            onClick={toggleMarkForReview}
            style={{
              padding: "10px 18px",
              backgroundColor: markedForReview.has(currentQuestionIndex) ? "#8b5cf6" : "transparent",
              color: markedForReview.has(currentQuestionIndex) ? "#fff" : "#8b5cf6",
              border: "2px solid #8b5cf6",
              borderRadius: "8px",
              cursor: "pointer",
              fontWeight: "600",
              fontSize: "13px",
              transition: "all 0.3s ease",
            }}
            onMouseEnter={(e) => {
              if (!markedForReview.has(currentQuestionIndex)) { e.target.style.backgroundColor = "#f5f3ff"; }
            }}
            onMouseLeave={(e) => {
              if (!markedForReview.has(currentQuestionIndex)) { e.target.style.backgroundColor = "transparent"; }
            }}
          >
            {markedForReview.has(currentQuestionIndex) ? "🔖 Marked" : "🔖 Mark for Review"}
          </button>

          <button
            onClick={submitAnswer}
            disabled={gradingInProgress}
            style={{
              padding: "10px 18px",
              backgroundColor: gradingInProgress ? "#94a3b8" : "#0ea5e9",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: gradingInProgress ? "not-allowed" : "pointer",
              fontWeight: "600",
              fontSize: "13px",
              transition: "all 0.3s ease",
            }}
            onMouseEnter={(e) => { if (!gradingInProgress) e.target.style.backgroundColor = "#0284c7"; }}
            onMouseLeave={(e) => { if (!gradingInProgress) e.target.style.backgroundColor = "#0ea5e9"; }}
          >
            {gradingInProgress ? "Evaluating..." : "Submit Answer"}
          </button>

          <button
            onClick={submitTest}
            style={{
              padding: "10px 18px",
              backgroundColor: "#059669",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
              fontWeight: "600",
              fontSize: "13px",
              transition: "all 0.3s ease",
            }}
            onMouseEnter={(e) => (e.target.style.backgroundColor = "#047857")}
            onMouseLeave={(e) => (e.target.style.backgroundColor = "#059669")}
          >
            ✅ Submit Test
          </button>

          {!showQuestionPanel && (
            <button
              onClick={() => setShowQuestionPanel(true)}
              style={{
                padding: "10px 18px",
                backgroundColor: "#f5f3ff",
                color: "#6366f1",
                border: "1px solid #e0e7ff",
                borderRadius: "8px",
                cursor: "pointer",
                fontWeight: "600",
                fontSize: "13px",
                transition: "all 0.3s ease",
                marginLeft: "auto",
              }}
              onMouseEnter={(e) => { e.target.style.backgroundColor = "#eef2ff"; }}
              onMouseLeave={(e) => { e.target.style.backgroundColor = "#f5f3ff"; }}
            >
              📋 Show Questions
            </button>
          )}
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
          <strong>🛡️ Proctoring Status:</strong> {isFullscreen ? "✅ Fullscreen Active" : "⚠️ Not in Fullscreen"} •
          Tab Switches: {tabSwitchCount}/5 {tabSwitchCount >= 5 && "⛔"}
        </div>
      </div>

      {/* Question Navigation Sidebar */}
      {showQuestionPanel && (
        <div
          style={{
            width: "280px",
            flexShrink: 0,
            position: "sticky",
            top: "20px",
            maxHeight: "calc(100vh - 40px)",
            overflowY: "auto",
          }}
        >
          <div
            style={{
              background: "linear-gradient(135deg, rgba(255,255,255,0.97), rgba(238,242,255,0.97))",
              backdropFilter: "blur(12px)",
              borderRadius: "16px",
              boxShadow: "0 8px 32px rgba(99,102,241,0.10)",
              border: "1px solid rgba(99,102,241,0.12)",
              overflow: "hidden",
            }}
          >
            {/* Panel Header */}
            <div
              style={{
                background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                padding: "14px 16px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ color: "#fff", fontWeight: "700", fontSize: "14px" }}>📋 Questions</span>
              <button
                onClick={() => setShowQuestionPanel(false)}
                style={{ background: "none", border: "none", color: "rgba(255,255,255,0.8)", cursor: "pointer", fontSize: "18px", lineHeight: 1, padding: "0 2px" }}
                title="Hide panel"
              >
                ✕
              </button>
            </div>

            {/* Status Legend */}
            <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(99,102,241,0.08)", display: "flex", flexWrap: "wrap", gap: "8px 14px" }}>
              {[
                { label: "Answered", color: "#10b981" },
                { label: "Not Answered", color: "#f59e0b" },
                { label: "Not Visited", color: "#e2e8f0" },
                { label: "Review", color: "#8b5cf6" },
                { label: "Current", color: "#6366f1" },
              ].map((item) => (
                <div key={item.label} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                  <div
                    style={{
                      width: "12px",
                      height: "12px",
                      borderRadius: "3px",
                      backgroundColor: item.color,
                      border: item.color === "#e2e8f0" ? "1px solid #cbd5e1" : "none",
                      boxShadow: item.color === "#6366f1" ? "0 0 0 2px rgba(99,102,241,0.3)" : "none",
                    }}
                  />
                  <span style={{ fontSize: "11px", color: "#64748b", fontWeight: "500" }}>{item.label}</span>
                </div>
              ))}
            </div>

            {/* Question Summary */}
            <div style={{ padding: "10px 16px", borderBottom: "1px solid rgba(99,102,241,0.08)", display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#475569" }}>
              <span>✅ {Object.keys(answers).filter(k => answers[k] && answers[k].toString().trim()).length}</span>
              <span>🔖 {markedForReview.size}</span>
              <span>📝 {questions.length - Object.keys(answers).filter(k => answers[k] && answers[k].toString().trim()).length} left</span>
            </div>

            {/* Question Grid */}
            <div style={{ padding: "14px 16px", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
              {questions.map((_, index) => {
                const status = getQuestionStatus(index);
                const config = statusConfig[status];
                const isGradient = status === "answered-marked";
                return (
                  <button
                    key={index}
                    onClick={() => setCurrentQuestionIndex(index)}
                    style={{
                      width: "100%",
                      aspectRatio: "1",
                      background: isGradient ? config.bg : config.bg,
                      backgroundColor: isGradient ? undefined : config.bg,
                      color: config.color,
                      border: status === "current" ? "2px solid #6366f1" : `1px solid ${config.border}`,
                      borderRadius: "10px",
                      cursor: "pointer",
                      fontWeight: "700",
                      fontSize: "14px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "all 0.2s ease",
                      boxShadow: config.shadow,
                      position: "relative",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.08)"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(99,102,241,0.25)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = config.shadow; }}
                    title={`Q${index + 1} — ${status.replace("-", " ")}`}
                  >
                    {index + 1}
                    {markedForReview.has(index) && (
                      <span style={{ position: "absolute", top: "-2px", right: "-2px", fontSize: "10px" }}>🔖</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      </div>{/* end flex layout */}
    </div>
  );
};

export default Test;
