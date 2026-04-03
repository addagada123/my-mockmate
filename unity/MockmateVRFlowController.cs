using System.Collections;
using System.Runtime.InteropServices;
using UnityEngine;
using UnityEngine.Events;

public class MockmateVRFlowController : MonoBehaviour
{
    [Header("Dependencies")]
    [SerializeField] private MockmateVRApiClient apiClient;

    [Header("VR Behavior")]
    [SerializeField] private bool autoStartWhenTokenPresent = true;
    [SerializeField] private bool autoSpeakWhenQuestionArrives = true;
    [SerializeField] private float simulatedSpeakCharsPerSecond = 18f;
    [SerializeField] private float prepTimeSeconds = 5f;
    [SerializeField] private float silenceGapSeconds = 3f;
    [SerializeField] private float minListenSeconds = 1f;
    [SerializeField] private int initialFetchRetryCount = 8;
    [SerializeField] private float initialFetchRetryDelaySeconds = 1.2f;
    [SerializeField] private float speechCompletionFallbackSeconds = 20f;
    [SerializeField] private float nextQuestionDelaySeconds = 0.5f;
    [SerializeField] private float listenTimeoutSeconds = 25f;
    [SerializeField] private float speechReadyDelaySeconds = 1.5f;
    [SerializeField] private float speechGracePeriodSeconds = 0.5f;

    [Header("Editor Preview")]
    [SerializeField] private bool correctEditorPreviewHeight = true;
    [SerializeField] private float editorPreviewYOffset = -1.7f;

    [Header("Events")]
    public UnityEvent<string> OnQuestionReceived;
    public UnityEvent OnQuestionSpeakingStart;
    public UnityEvent OnQuestionSpeakingEnd;
    public UnityEvent<float> OnPrepTick;
    public UnityEvent OnAnswerNow;
    public UnityEvent OnListeningStart;
    public UnityEvent OnListeningEnd;
    public UnityEvent<string> OnStatusMessage;
    public UnityEvent<string> OnError;
    public UnityEvent<float> OnRunningScoreUpdated;
    public UnityEvent<float> OnCompleted;
    public UnityEvent<string> OnCompletedMessage;

    /// <summary>True while a VR interview flow is actively running.</summary>
    public bool IsFlowActive => _busy || (_currentQuestion != null && !_completed);

    private VrQuestion _currentQuestion;
    private float _startedAt;
    private bool _busy;
    private bool _isListening;
    private bool _completed;
    private bool _flowStarting;
    private bool _manualSubmitRequested;
    private bool _awaitingQuestionSpeechCompletion;
    private bool _listeningEndedNotified;
    private string _transcript = "";
    private float _lastTranscriptUpdateAt = -1f;
    private int _activeQuestionIndex = 0;
    private bool _editorCameraAdjusted;
    private Vector3 _editorOriginalCameraLocalPosition;

    [DllImport("__Internal")]
    private static extern void NotifyInterviewComplete();

    private void Awake()
    {
        if (apiClient == null)
            apiClient = GetComponent<MockmateVRApiClient>();
    }

    private void Start()
    {
        ApplyEditorPreviewHeightFix();
        _startedAt = Time.time;
        if (autoStartWhenTokenPresent && apiClient != null && !string.IsNullOrWhiteSpace(apiClient.BridgeToken))
            BeginFlow();
    }

    private void OnDestroy()
    {
#if UNITY_EDITOR
        if (_editorCameraAdjusted && Camera.main != null)
            Camera.main.transform.localPosition = _editorOriginalCameraLocalPosition;
#endif
    }

    public void BeginFlow()
    {
        if (_busy || _flowStarting) return;
        if (apiClient == null)
        {
            RaiseError("API client missing");
            return;
        }
        if (string.IsNullOrWhiteSpace(apiClient.BridgeToken))
        {
            RaiseError("Bridge token is required");
            return;
        }
        _completed = false;
        _flowStarting = true;
        _manualSubmitRequested = false;
        _currentQuestion = null;
        _startedAt = Time.time;
        PublishStatus("Fetching first question...");
        StartCoroutine(FetchInitialQuestionWithRetry());
    }

    public void SetApiBase(string apiBase)
    {
        if (apiClient == null) return;
        apiClient.SetApiBase(apiBase);
        PublishStatus("API base updated");
    }

    public void SetBridgeToken(string bridgeToken)
    {
        if (apiClient == null) return;
        apiClient.SetBridgeToken(bridgeToken);
        PublishStatus("Bridge token updated");
    }

    private void OnNextQuestionFetched(VrNextResponse response, string error)
    {
        _flowStarting = false;
        if (!string.IsNullOrEmpty(error))
        {
            _busy = false;
            RaiseError($"Fetch question failed: {error}");
            return;
        }

        if (response == null || response.completed || response.current_question == null)
        {
            CompleteFlow();
            return;
        }

        _currentQuestion = response.current_question;
        _activeQuestionIndex = response.current_question_index;
        _transcript = "";
        _lastTranscriptUpdateAt = -1f;

        OnQuestionReceived?.Invoke(_currentQuestion.question);
        PublishStatus($"Question {_activeQuestionIndex + 1}/{Mathf.Max(1, response.total_questions)} loaded");

        StopAllCoroutines();
        StartCoroutine(RunQuestionLifecycle(_currentQuestion.question));
    }

    private IEnumerator RunQuestionLifecycle(string questionText)
    {
        _busy = true;
        _manualSubmitRequested = false;

        // Delay to ensure the UI displays the question text before the interviewer starts speaking
        yield return new WaitForSeconds(speechReadyDelaySeconds);

        if (autoSpeakWhenQuestionArrives)
        {
            OnQuestionSpeakingStart?.Invoke();
            PublishStatus("Interviewer speaking...");
            float speakDuration = Mathf.Clamp((questionText ?? string.Empty).Length / Mathf.Max(5f, simulatedSpeakCharsPerSecond), 1f, 12f);
            float maxWait = Mathf.Max(speakDuration, speechCompletionFallbackSeconds);
            _awaitingQuestionSpeechCompletion = HasExternalSpeechHandler();
            if (_awaitingQuestionSpeechCompletion)
            {
                float waited = 0f;
                while (_awaitingQuestionSpeechCompletion && waited < maxWait)
                {
                    waited += Time.deltaTime;
                    yield return null;
                }

                if (_awaitingQuestionSpeechCompletion)
                {
                    PublishStatus("Speech completion timeout reached. Continuing interview flow...");
                    _awaitingQuestionSpeechCompletion = false;
                }
            }
            else
            {
                yield return new WaitForSeconds(speakDuration);
            }
            OnQuestionSpeakingEnd?.Invoke();
            
            // Safety grace period so the transition to the user's turn isn't instant
            if (speechGracePeriodSeconds > 0)
                yield return new WaitForSeconds(speechGracePeriodSeconds);
        }

        yield return PrepCountdownCoroutine();
        OnAnswerNow?.Invoke();
        PublishStatus("Answer now");

        _isListening = true;
        _listeningEndedNotified = false;
        _lastTranscriptUpdateAt = Time.time;
        OnListeningStart?.Invoke();
        PublishStatus("Listening for answer...");

        float listenStart = Time.time;
        while (_isListening && !_completed)
        {
            float now = Time.time;
            bool minListenDone = (now - listenStart) >= minListenSeconds;
            bool silenceExceeded = _lastTranscriptUpdateAt > 0 && (now - _lastTranscriptUpdateAt) >= silenceGapSeconds;
            bool hasTranscript = !string.IsNullOrWhiteSpace(_transcript);
            bool timeoutReached = (now - listenStart) >= listenTimeoutSeconds;

            if (minListenDone && (silenceExceeded || timeoutReached))
            {
                if (!hasTranscript)
                    PublishStatus("No speech detected. Advancing question...");
                _isListening = false;
                break;
            }
            yield return null;
        }

        EndListeningSession();
        _busy = false;

        if (!_completed && !_manualSubmitRequested)
            SubmitCurrentAnswer(_transcript.Trim());

        _manualSubmitRequested = false;
    }

    private IEnumerator PrepCountdownCoroutine()
    {
        float remaining = Mathf.Max(0f, prepTimeSeconds);
        while (remaining > 0f)
        {
            OnPrepTick?.Invoke(remaining);
            PublishStatus($"Prepare your answer: {Mathf.CeilToInt(remaining)}s");
            yield return new WaitForSeconds(1f);
            remaining -= 1f;
        }
        OnPrepTick?.Invoke(0f);
    }

    // Hook this from your STT stream callback while user is speaking.
    public void AppendTranscriptChunk(string textChunk)
    {
        if (!_isListening) return;
        
        if (string.IsNullOrWhiteSpace(textChunk)) return;

        string normalizedChunk = textChunk.Trim();
        if (normalizedChunk.Length == 0)
            return;

        // Some STT integrations repeatedly emit the full transcript-so-far or duplicate
        // chunks while the speaker is silent. Ignore no-op updates so silence detection
        // can advance to the next question.
        if (string.Equals(_transcript, normalizedChunk, StringComparison.OrdinalIgnoreCase) ||
            _transcript.EndsWith(normalizedChunk, StringComparison.OrdinalIgnoreCase))
            return;

        if (_transcript.Length > 0) _transcript += " ";
        _transcript += normalizedChunk;
        
        // ONLY refresh silence timer if we actually got NEW content.
        _lastTranscriptUpdateAt = Time.time;
    }

    /// <summary>Alias for AppendTranscriptChunk to maintain compatibility with legacy Inspector events.</summary>
    public void OnTranscriptionReceived(string text) => AppendTranscriptChunk(text);

    public void ForceSubmitCurrentAnswer()
    {
        if (_currentQuestion == null) return;
        if (!_isListening) return;
        _manualSubmitRequested = true;
        _isListening = false;
        EndListeningSession();
        _busy = false;
        SubmitCurrentAnswer(_transcript.Trim());
    }

    public void NotifyQuestionSpeechCompleted()
    {
        if (_awaitingQuestionSpeechCompletion)
            _awaitingQuestionSpeechCompletion = false;
    }

    public void SubmitCurrentAnswer(string transcript)
    {
        if (_currentQuestion == null)
        {
            RaiseError("No current question loaded");
            return;
        }
        if (string.IsNullOrWhiteSpace(transcript))
        {
            // Allow empty answers to advance the question
            transcript = "[No answer detected]";
        }

        _busy = true;
        StartCoroutine(apiClient.SubmitAnswer(_activeQuestionIndex, transcript, OnAnswerSubmitted));
    }

    private void OnAnswerSubmitted(VrAnswerResponse response, string error)
    {
        if (!string.IsNullOrEmpty(error))
        {
            _busy = false;
            RaiseError($"Submit answer failed: {error}");
            return;
        }

        if (response == null)
        {
            _busy = false;
            RaiseError("Empty answer response");
            return;
        }

        OnRunningScoreUpdated?.Invoke(response.running_percentage);

        if (response.completed)
        {
            CompleteFlow();
            return;
        }

        if (response.next_question != null)
        {
            _currentQuestion = response.next_question;
            _activeQuestionIndex = response.next_question_index;
            _transcript = "";
            _lastTranscriptUpdateAt = -1f;
            OnQuestionReceived?.Invoke(_currentQuestion.question);
            StopAllCoroutines();
            StartCoroutine(WaitAndStartNextQuestion(_currentQuestion.question));
            return;
        }

        StartCoroutine(apiClient.FetchNextQuestion(OnNextQuestionFetched));
    }

    private IEnumerator WaitAndStartNextQuestion(string questionText)
    {
        _busy = true;
        if (nextQuestionDelaySeconds > 0)
        {
            PublishStatus($"Next question in {nextQuestionDelaySeconds}s...");
            yield return new WaitForSeconds(nextQuestionDelaySeconds);
        }
        StartCoroutine(RunQuestionLifecycle(questionText));
    }

    public void CompleteFlow()
    {
        if (_completed) return;
        _completed = true;
        _flowStarting = false;
        _isListening = false;
        EndListeningSession();
        int elapsed = Mathf.RoundToInt(Time.time - _startedAt);
        _busy = true;
        StartCoroutine(apiClient.CompleteTest(elapsed, OnCompletePosted));
    }

    private void OnCompletePosted(VrCompleteResponse response, string error)
    {
        if (!string.IsNullOrEmpty(error))
        {
            _busy = false;
            RaiseError($"Complete test failed: {error}");
            return;
        }
        if (response == null)
        {
            _busy = false;
            RaiseError("Empty complete response");
            return;
        }
        string msg = $"Test completed. Score: {response.percentage:F1}%";
        _busy = false;
        PublishStatus(msg);
        OnCompletedMessage?.Invoke(msg);
        OnCompleted?.Invoke(response.percentage);

#if !UNITY_EDITOR && UNITY_WEBGL
        try { NotifyInterviewComplete(); } catch (System.Exception e) { Debug.LogWarning("Bridge NotifyInterviewComplete failed: " + e.Message); }
#endif
    }

    private void PublishStatus(string message)
    {
        Debug.Log("[MockmateVR] " + message);
        OnStatusMessage?.Invoke(message);
    }

    private void RaiseError(string message)
    {
        Debug.LogError("[MockmateVR] " + message);
        OnError?.Invoke(message);
        PublishStatus("Error: " + message);
    }

    private bool IsInitializationRaceError(string error)
    {
        if (string.IsNullOrWhiteSpace(error))
            return false;

        string normalized = error.ToLowerInvariant();
        return normalized.Contains("vr test not initialized");
    }

    private bool HasExternalSpeechHandler()
    {
        if (OnQuestionSpeakingStart != null && OnQuestionSpeakingStart.GetPersistentEventCount() > 0)
            return true;

        // VRInterviewGlue auto-subscribes at runtime, so relying on persistent
        // Inspector listeners alone can incorrectly skip speech completion waits.
        return FindFirstObjectByType<VRInterviewGlue>() != null;
    }

    private void EndListeningSession()
    {
        if (_listeningEndedNotified)
            return;

        _listeningEndedNotified = true;
        OnListeningEnd?.Invoke();
    }

    private void ApplyEditorPreviewHeightFix()
    {
#if UNITY_EDITOR
        if (!Application.isPlaying || !correctEditorPreviewHeight || Mathf.Approximately(editorPreviewYOffset, 0f))
            return;

        Camera mainCamera = Camera.main;
        if (mainCamera == null)
        {
            PublishStatus("Editor preview height fix skipped: Main Camera not found.");
            return;
        }

        _editorOriginalCameraLocalPosition = mainCamera.transform.localPosition;
        mainCamera.transform.localPosition = _editorOriginalCameraLocalPosition + new Vector3(0f, editorPreviewYOffset, 0f);
        _editorCameraAdjusted = true;
        PublishStatus($"Editor preview camera Y adjusted by {editorPreviewYOffset:0.##}.");
#endif
    }

    private IEnumerator FetchInitialQuestionWithRetry()
    {
        int maxAttempts = Mathf.Max(1, initialFetchRetryCount + 1);
        for (int attempt = 1; attempt <= maxAttempts; attempt++)
        {
            bool completed = false;
            VrNextResponse response = null;
            string error = null;

            yield return apiClient.FetchNextQuestion((res, err) =>
            {
                response = res;
                error = err;
                completed = true;
            });

            if (!completed)
                yield break;

            if (string.IsNullOrEmpty(error))
            {
                OnNextQuestionFetched(response, null);
                yield break;
            }

            bool shouldRetry =
                attempt < maxAttempts &&
                IsInitializationRaceError(error);

            if (!shouldRetry)
            {
                OnNextQuestionFetched(response, error);
                yield break;
            }

            // During initial sync, we use status instead of RaiseError to avoid scary red error logs 
            // if the backend is just lazily initializing the VR state (common race condition).
            PublishStatus($"VR session still syncing, retrying question fetch ({attempt}/{maxAttempts - 1})...");
            yield return new WaitForSeconds(Mathf.Max(0.5f, initialFetchRetryDelaySeconds));
        }
    }
}
