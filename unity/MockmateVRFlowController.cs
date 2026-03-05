using System;
using System.Collections;
using UnityEngine;
using UnityEngine.Events;

public class MockmateVRFlowController : MonoBehaviour
{
    [Header("Dependencies")]
    [SerializeField] private MockmateVRApiClient apiClient;

    [Header("Events")]
    public UnityEvent<string> OnQuestionReceived;
    public UnityEvent OnQuestionSpeakingStart;
    public UnityEvent OnQuestionSpeakingEnd;
    public UnityEvent OnListeningStart;
    public UnityEvent OnListeningEnd;
    public UnityEvent<string> OnError;
    public UnityEvent<float> OnRunningScoreUpdated;
    public UnityEvent<float> OnCompleted;

    private VrQuestion _currentQuestion;
    private float _startedAt;

    private void Start()
    {
        _startedAt = Time.time;
    }

    public void BeginFlow()
    {
        if (apiClient == null)
        {
            RaiseError("API client missing");
            return;
        }
        StartCoroutine(apiClient.FetchNextQuestion(OnNextQuestionFetched));
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
        OnQuestionReceived?.Invoke(_currentQuestion.question);

        // Hook your TTS/avatar pipeline here:
        // 1) call your TTS with _currentQuestion.question
        // 2) animate avatar speaking
        // 3) when speech completes, call NotifyQuestionSpeechCompleted()
        OnQuestionSpeakingStart?.Invoke();
    }

    public void NotifyQuestionSpeechCompleted()
    {
        OnQuestionSpeakingEnd?.Invoke();

        // Start recording/listening in your voice subsystem.
        // After STT is done, call SubmitCurrentAnswer(transcript).
        OnListeningStart?.Invoke();
    }

    public void SubmitCurrentAnswer(string transcript)
    {
        if (_currentQuestion == null)
        {
            RaiseError("No current question loaded");
            return;
        }

        OnListeningEnd?.Invoke();
        StartCoroutine(apiClient.SubmitAnswer(_currentQuestion.index, transcript ?? string.Empty, OnAnswerSubmitted));
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
            OnQuestionReceived?.Invoke(_currentQuestion.question);
            OnQuestionSpeakingStart?.Invoke();
            return;
        }

        StartCoroutine(apiClient.FetchNextQuestion(OnNextQuestionFetched));
    }

    public void CompleteFlow()
    {
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
        OnCompleted?.Invoke(response.percentage);
    }

    private void RaiseError(string message)
    {
        Debug.LogError(message);
        OnError?.Invoke(message);
    }
}
