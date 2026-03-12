using System.Collections;
using UnityEngine;

/// <summary>
/// Connects coroutine-based scripts (OpenAITTS, AudioRecorder, STTClient)
/// to the MockmateVRFlowController events.
///
/// Animations (InterviewerTalk, ListeningNod, AudioLipSync) should be wired
/// DIRECTLY on the FlowController events in the Inspector — NOT handled here.
/// This keeps all behavior visible in one place.
///
/// Attach to MockmateVRManager.
/// </summary>
public class VRInterviewGlue : MonoBehaviour
{
    [Header("Drag from Hierarchy")]
    public OpenAITTS openAITTS;
    public AvatarTTS avatarTTS;
    public AudioRecorder audioRecorder;
    public STTClient sttClient;

    [Header("Auto-wire")]
    public MockmateVRFlowController flowController;

    private Coroutine _recordingCoroutine;
    private Coroutine _speakCoroutine;
    private string _currentQuestionText;

    void Awake()
    {
        if (flowController == null)
            flowController = GetComponent<MockmateVRFlowController>();
    }

    void OnEnable()
    {
        // Auto-pipe STT transcript chunks → FlowController
        if (sttClient != null)
            sttClient.OnTranscriptChunk.AddListener(OnTranscriptChunk);
    }

    void OnDisable()
    {
        if (sttClient != null)
            sttClient.OnTranscriptChunk.RemoveListener(OnTranscriptChunk);
    }

    // ─── Wire these to FlowController events ───

    /// <summary>Wire to: OnQuestionReceived(String)</summary>
    public void OnQuestionArrived(string questionText)
    {
        _currentQuestionText = questionText;
    }

    /// <summary>Wire to: OnQuestionSpeakingStart()</summary>
    public void OnSpeakingStart()
    {
        if (_speakCoroutine != null)
            StopCoroutine(_speakCoroutine);
        _speakCoroutine = StartCoroutine(SpeakQuestion());
    }

    /// <summary>Wire to: OnListeningStart()</summary>
    public void OnStartListening()
    {
        if (sttClient != null)
            sttClient.ClearTranscript();

        if (audioRecorder != null)
        {
            if (_recordingCoroutine != null)
                StopCoroutine(_recordingCoroutine);
            _recordingCoroutine = StartCoroutine(audioRecorder.RecordOnce());
        }
    }

    /// <summary>Wire to: OnListeningEnd()</summary>
    public void OnStopListening()
    {
        if (_recordingCoroutine != null)
        {
            StopCoroutine(_recordingCoroutine);
            _recordingCoroutine = null;
        }
    }

    // ─── Internal ───

    private void OnTranscriptChunk(string chunk)
    {
        if (flowController != null && !string.IsNullOrWhiteSpace(chunk))
            flowController.AppendTranscriptChunk(chunk);
    }

    private IEnumerator SpeakQuestion()
    {
        if (string.IsNullOrWhiteSpace(_currentQuestionText))
            yield break;

        if (openAITTS != null)
        {
            yield return openAITTS.Speak(_currentQuestionText);
            if (openAITTS.LastSpeakSucceeded)
                yield break;
        }

        if (avatarTTS != null)
            yield return avatarTTS.Speak(_currentQuestionText);
    }
}
