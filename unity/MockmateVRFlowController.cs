using System;
using System.Collections;
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
    [SerializeField] private float prepTimeSeconds = 10f;
    [SerializeField] private float silenceGapSeconds = 3f;
    [SerializeField] private float minListenSeconds = 1f;

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
    private string _transcript = "";
    private float _lastTranscriptUpdateAt = -1f;
    private int _activeQuestionIndex = 0;

    private void Awake()
    {
        if (apiClient == null)
            apiClient = GetComponent<MockmateVRApiClient>();
    }

    private void Start()
    {
        _startedAt = Time.time;
        if (autoStartWhenTokenPresent && apiClient != null && !string.IsNullOrWhiteSpace(apiClient.BridgeToken))
            BeginFlow();
    }

    public void BeginFlow()
    {
        if (_busy) return;
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
        _startedAt = Time.time;
        PublishStatus("Fetching first question...");
        StartCoroutine(apiClient.FetchNextQuestion(OnNextQuestionFetched));
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
        if (!string.IsNullOrEmpty(error))
        {
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

        if (autoSpeakWhenQuestionArrives)
        {
            OnQuestionSpeakingStart?.Invoke();
            PublishStatus("Interviewer speaking...");
            float speakDuration = Mathf.Clamp((questionText ?? string.Empty).Length / Mathf.Max(5f, simulatedSpeakCharsPerSecond), 1f, 12f);
            yield return new WaitForSeconds(speakDuration);
            OnQuestionSpeakingEnd?.Invoke();
        }

        yield return PrepCountdownCoroutine();
        OnAnswerNow?.Invoke();
        PublishStatus("Answer now");

        _isListening = true;
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

            if (minListenDone && hasTranscript && silenceExceeded)
            {
                _isListening = false;
                break;
            }
            yield return null;
        }

        OnListeningEnd?.Invoke();
        _busy = false;

        if (!_completed)
            SubmitCurrentAnswer(_transcript.Trim());
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
        if (_transcript.Length > 0) _transcript += " ";
        _transcript += textChunk.Trim();
        _lastTranscriptUpdateAt = Time.time;
    }

    public void ForceSubmitCurrentAnswer()
    {
        if (_currentQuestion == null) return;
        if (_busy) return;
        _isListening = false;
        OnListeningEnd?.Invoke();
        SubmitCurrentAnswer(_transcript.Trim());
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
            RaiseError("Transcript is empty");
            return;
        }

        StartCoroutine(apiClient.SubmitAnswer(_activeQuestionIndex, transcript, OnAnswerSubmitted));
    }

    private void OnAnswerSubmitted(VrAnswerResponse response, string error)
    {
        if (!string.IsNullOrEmpty(error))
        {
            RaiseError($"Submit answer failed: {error}");
            return;
        }

        if (response == null)
        {
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
            StartCoroutine(RunQuestionLifecycle(_currentQuestion.question));
            return;
        }

        StartCoroutine(apiClient.FetchNextQuestion(OnNextQuestionFetched));
    }

    public void CompleteFlow()
    {
        if (_completed) return;
        _completed = true;
        _isListening = false;
        OnListeningEnd?.Invoke();
        int elapsed = Mathf.RoundToInt(Time.time - _startedAt);
        StartCoroutine(apiClient.CompleteTest(elapsed, OnCompletePosted));
    }

    private void OnCompletePosted(VrCompleteResponse response, string error)
    {
        if (!string.IsNullOrEmpty(error))
        {
            RaiseError($"Complete test failed: {error}");
            return;
        }
        if (response == null)
        {
            RaiseError("Empty complete response");
            return;
        }
        string msg = $"Test completed. Score: {response.percentage:F1}%";
        PublishStatus(msg);
        OnCompletedMessage?.Invoke(msg);
        OnCompleted?.Invoke(response.percentage);
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
}
