using System.Collections;
using System.Reflection;
using UnityEngine;

/// <summary>
/// Orchestrates the interview flow by connecting the FlowController with TTS and Animation systems.
/// Acting as the central distribution hub, it ensures speech, transcription, and lip-sync
/// stay in perfect sync across different platforms (WebGL, Editor, VR).
/// </summary>
public class VRInterviewGlue : MonoBehaviour
{
    [Header("Core Components")]
    public MockmateVRFlowController flowController;
    public MockmateVRAnimationBridge animationBridge;
    
    [Header("TTS Providers")]
    public MockmateVRBackendTTS backendTTS;
    public MockmateVRBrowserTTS browserTTS;
    public MonoBehaviour openAITTS; // Optional direct OpenAI fallback
    
    [Header("STT / Input")]
    public MockmateVRBrowserSTT browserSTT;
    public MonoBehaviour audioRecorder; // For Editor/Native microphone recording
    public MonoBehaviour sttClient;     // For Editor/Native transcription

    [Header("WebGL Configuration")]
    [Tooltip("If true, allows fallback to direct OpenAI TTS calls in WebGL if backend fails.")]
    public bool allowOpenAIFallbackInWebGL = false;

    private Coroutine _speakCoroutine;
    private string _currentQuestionText;
    private Coroutine _recordingCoroutine;

    private void Awake()
    {
        if (flowController == null) flowController = FindFirstObjectByType<MockmateVRFlowController>();
        if (animationBridge == null) animationBridge = FindFirstObjectByType<MockmateVRAnimationBridge>();
        if (backendTTS == null) backendTTS = FindFirstObjectByType<MockmateVRBackendTTS>();
        if (browserTTS == null) browserTTS = FindFirstObjectByType<MockmateVRBrowserTTS>();
        if (browserSTT == null) browserSTT = FindFirstObjectByType<MockmateVRBrowserSTT>();
        
        // Auto-fill optional components via reflection-safe search if null
        if (openAITTS == null) openAITTS = FindComponentByName("OpenAITTS");
        if (audioRecorder == null) audioRecorder = FindComponentByName("AudioRecorder");
        if (sttClient == null) sttClient = FindComponentByName("WebGLWhisperSTT") ?? FindComponentByName("OpenAIWhisperSTT");

        // --- THE "WIRED PROPERLY" FIX ---
        // Auto-wire events at runtime to prevent manual configuration errors in the Inspector.
        if (flowController != null)
        {
            // We use AddListener so the user doesn't have to drag and drop in the Inspector.
            flowController.OnQuestionReceived.AddListener(OnQuestionArrived);
            flowController.OnQuestionSpeakingStart.AddListener(OnSpeakingStart);
            flowController.OnListeningStart.AddListener(OnStartListening);
            flowController.OnListeningEnd.AddListener(OnStopListening);
        }
    }

    private void OnEnable()
    {
        if (browserSTT != null)
            browserSTT.OnTranscriptChunk.AddListener(OnTranscriptChunk);
    }

    private void OnDisable()
    {
        if (browserSTT != null)
            browserSTT.OnTranscriptChunk.RemoveListener(OnTranscriptChunk);
    }

    private void OnDestroy()
    {
        // Thorough cleanup of auto-wired events to prevent memory leaks/ghost calls
        if (flowController != null)
        {
            flowController.OnQuestionReceived.RemoveListener(OnQuestionArrived);
            flowController.OnQuestionSpeakingStart.RemoveListener(OnSpeakingStart);
            flowController.OnListeningStart.RemoveListener(OnStartListening);
            flowController.OnListeningEnd.RemoveListener(OnStopListening);
        }
    }

    private MonoBehaviour FindComponentByName(string typeName)
    {
        foreach (var mb in FindObjectsByType<MonoBehaviour>(FindObjectsSortMode.None))
        {
            if (mb.GetType().Name == typeName) return mb;
        }
        return null;
    }

    /// <summary>Called by FlowController.OnQuestionReceived</summary>
    public void OnQuestionArrived(string questionText)
    {
        _currentQuestionText = questionText;
        Debug.Log("[MockmateVR-Glue] Question buffering for speech.");
    }

    /// <summary>Called by FlowController.OnQuestionSpeakingStart</summary>
    public void OnSpeakingStart()
    {
        if (_speakCoroutine != null)
            StopCoroutine(_speakCoroutine);
        _speakCoroutine = StartCoroutine(SpeakQuestion());
    }

    /// <summary>Called by FlowController.OnListeningStart</summary>
    public void OnStartListening()
    {
        bool isWebGL = Application.platform == RuntimePlatform.WebGLPlayer;

        if (isWebGL && browserSTT != null)
        {
            browserSTT.StartSpeechToText();
        }
        else if (audioRecorder != null)
        {
            // Editor/Native path: use AudioRecorder
            if (_recordingCoroutine != null) StopCoroutine(_recordingCoroutine);
            IEnumerator recordRoutine = InvokeEnumeratorIfPresent(audioRecorder, "RecordOnce");
            if (recordRoutine != null) _recordingCoroutine = StartCoroutine(recordRoutine);
        }
        
        if (animationBridge != null)
        {
            animationBridge.StartTyping();
        }
    }

    /// <summary>Called by FlowController.OnListeningEnd</summary>
    public void OnStopListening()
    {
        if (browserSTT != null)
            browserSTT.StopSpeechToText();
        
        if (_recordingCoroutine != null)
        {
            StopCoroutine(_recordingCoroutine);
            _recordingCoroutine = null;
        }

        if (animationBridge != null)
            animationBridge.StopTyping();
    }

    private void OnTranscriptChunk(string chunk)
    {
        if (flowController != null && !string.IsNullOrWhiteSpace(chunk))
            flowController.AppendTranscriptChunk(chunk);
    }

    private IEnumerator SpeakQuestion()
    {
        if (string.IsNullOrWhiteSpace(_currentQuestionText))
        {
            flowController?.NotifyQuestionSpeechCompleted();
            yield break;
        }

        bool isWebGL = Application.platform == RuntimePlatform.WebGLPlayer;

        // --- 1. Primary: Backend TTS (Handles Animation Sync Internally) ---
        if (backendTTS != null)
        {
            Debug.Log("[MockmateVR-Glue] Attempting Backend TTS...");
            yield return backendTTS.Speak(_currentQuestionText);
            
            if (backendTTS.LastSpeakSucceeded)
            {
                flowController?.NotifyQuestionSpeechCompleted();
                yield break;
            }
        }

        // --- 2. Secondary: Browser Native TTS (WebGL only) ---
        if (isWebGL && browserTTS != null)
        {
            Debug.Log("[MockmateVR-Glue] Falling back to Browser TTS...");
            yield return browserTTS.Speak(_currentQuestionText);
            
            if (browserTTS.LastSpeakSucceeded)
            {
                flowController?.NotifyQuestionSpeechCompleted();
                yield break;
            }
        }

        // --- 3. Tertiary: Direct OpenAI Fallback (Editor/Direct) ---
        if (openAITTS != null && (!isWebGL || allowOpenAIFallbackInWebGL))
        {
            Debug.Log("[MockmateVR-Glue] Falling back to direct OpenAI TTS...");
            IEnumerator openAiSpeak = InvokeEnumeratorIfPresent(openAITTS, "Speak", _currentQuestionText);
            if (openAiSpeak != null)
            {
                yield return openAiSpeak;
                if (ReadBoolMember(openAITTS, "LastSpeakSucceeded"))
                {
                    flowController?.NotifyQuestionSpeechCompleted();
                    yield break;
                }
            }
        }

        // --- 4. Final Fallback: Skip Audio but don't hang the flow ---
        Debug.LogWarning("[MockmateVR-Glue] All TTS providers failed. Advancing logic only.");
        flowController?.NotifyQuestionSpeechCompleted();
    }

    private static IEnumerator InvokeEnumeratorIfPresent(object target, string methodName, params object[] args)
    {
        if (target == null) return null;
        MethodInfo method = target.GetType().GetMethod(methodName, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
        return method?.Invoke(target, args) as IEnumerator;
    }

    private static bool ReadBoolMember(object target, string memberName)
    {
        if (target == null) return false;
        PropertyInfo pi = target.GetType().GetProperty(memberName, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
        if (pi != null) return (bool)pi.GetValue(target);
        FieldInfo fi = target.GetType().GetField(memberName, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
        if (fi != null) return (bool)fi.GetValue(target);
        return false;
    }
}
