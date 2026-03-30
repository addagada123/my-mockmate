using System.Collections;
using System.Reflection;
using UnityEngine;
using UnityEngine.Events;

/// <summary>
/// Connects optional TTS/STT/recording components to the MockmateVRFlowController events.
/// Uses reflection so this script can compile even when those concrete components live only
/// in the user's Unity project and are not part of this repo.
/// Attach to MockmateVRManager.
/// </summary>
public class VRInterviewGlue : MonoBehaviour
{
    [Header("Optional Components")]
    public MonoBehaviour openAITTS;
    public MockmateVRBackendTTS backendTTS;
    public MockmateVRBrowserTTS browserTTS;
    public MockmateVRAnimationBridge animationBridge;
    public MonoBehaviour avatarTTS;
    public MonoBehaviour audioRecorder;
    public MonoBehaviour sttClient;
    public MockmateVRBrowserSTT browserSTT;

    [Header("WebGL Safety")]
    [Tooltip("Disable direct OpenAI TTS calls inside WebGL/browser builds to avoid CORS/auth failures.")]
    public bool allowOpenAITTSInWebGL = false;
    [Tooltip("Disable direct OpenAI Whisper STT inside WebGL builds. Use WebGL/browser STT instead.")]
    public bool allowOpenAISTTInWebGL = false;

    [Header("Auto-wire")]
    public MockmateVRFlowController flowController;

    private Coroutine _recordingCoroutine;
    private Coroutine _speakCoroutine;
    private string _currentQuestionText;

    private void Awake()
    {
        if (flowController == null)
            flowController = FindFirstObjectByType<MockmateVRFlowController>();

        // Auto-wire other components if they are not assigned (search wider hierarchy if needed)
        if (openAITTS == null) openAITTS = FindFirstObjectByType<OpenAITTS>() as MonoBehaviour;
        if (avatarTTS == null) avatarTTS = GetComponentInChildren<Animator>()?.GetComponent<MonoBehaviour>(); // Placeholder for specialized TTS scripts
        if (audioRecorder == null) audioRecorder = FindFirstObjectByType<AudioRecorder>() as MonoBehaviour;
        if (sttClient == null) sttClient = FindFirstObjectByType<WebGLWhisperSTT>() as MonoBehaviour;
        if (backendTTS == null) backendTTS = FindFirstObjectByType<MockmateVRBackendTTS>();
        if (browserTTS == null) browserTTS = FindFirstObjectByType<MockmateVRBrowserTTS>();
        if (browserSTT == null) browserSTT = FindFirstObjectByType<MockmateVRBrowserSTT>();
        
        // If still no sttClient, check if browserSTT is our only STT option
        if (sttClient == null && browserSTT != null) sttClient = browserSTT;
        if (animationBridge == null) animationBridge = FindFirstObjectByType<MockmateVRAnimationBridge>();

        Debug.Log($"[MockmateVR-Glue] Awake complete. FlowController: {flowController != null}, AnimationBridge: {animationBridge != null}");
    }

    private void OnEnable()
    {
        AddTranscriptListener();
    }

    private void OnDisable()
    {
        RemoveTranscriptListener();
    }

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
        InvokeIfPresent(sttClient, "ClearTranscript");

        bool isWebGL = Application.platform == RuntimePlatform.WebGLPlayer;

        // ── WebGL path: use WebGL/browser STT directly, skip AudioRecorder + OpenAIWhisperSTT ──
        if (isWebGL && !allowOpenAISTTInWebGL)
        {
            // Prefer WebGLWhisperSTT (backend-proxied Whisper), fall back to BrowserSTT (native SpeechRecognition)
            if (sttClient != null)
            {
                Debug.Log("[MockmateVR-Glue] WebGL: Starting STT via " + sttClient.GetType().Name);
                InvokeIfPresent(sttClient, "StartSpeechToText");
            }
            else if (browserSTT != null)
            {
                Debug.Log("[MockmateVR-Glue] WebGL: Starting BrowserSTT fallback.");
                browserSTT.StartSpeechToText();
            }
            else
            {
                Debug.LogWarning("[MockmateVR-Glue] WebGL: No STT client found!");
            }
            return;
        }

        // ── Editor/Native path: use AudioRecorder → OpenAIWhisperSTT (uses Microphone API) ──
        if (audioRecorder != null)
        {
            if (_recordingCoroutine != null)
                StopCoroutine(_recordingCoroutine);

            IEnumerator recordRoutine = InvokeEnumeratorIfPresent(audioRecorder, "RecordOnce");
            if (recordRoutine != null)
                _recordingCoroutine = StartCoroutine(recordRoutine);
        }
    }

    /// <summary>Wire to: OnListeningEnd()</summary>
    public void OnStopListening()
    {
        bool isWebGL = Application.platform == RuntimePlatform.WebGLPlayer;

        // ── WebGL path: stop the WebGL/browser STT directly ──
        if (isWebGL && !allowOpenAISTTInWebGL)
        {
            if (sttClient != null)
                InvokeIfPresent(sttClient, "StopSpeechToText");
            else if (browserSTT != null)
                browserSTT.StopSpeechToText();
            return;
        }

        // ── Editor/Native path: stop AudioRecorder coroutine ──
        if (_recordingCoroutine != null)
        {
            StopCoroutine(_recordingCoroutine);
            _recordingCoroutine = null;
        }
    }

    private void OnTranscriptChunk(string chunk)
    {
        if (flowController != null && !string.IsNullOrWhiteSpace(chunk))
            flowController.AppendTranscriptChunk(chunk);
    }

    private IEnumerator SpeakQuestion()
    {
        Debug.Log($"[MockmateVR-Glue] SpeakQuestion starting. Text: {(_currentQuestionText != null ? _currentQuestionText.Substring(0, Mathf.Min(20, _currentQuestionText.Length)) : "null")}...");
        if (string.IsNullOrWhiteSpace(_currentQuestionText))
        {
            Debug.Log("[MockmateVR-Glue] No question text to speak.");
            flowController?.NotifyQuestionSpeechCompleted();
            yield break;
        }

        bool isWebGL = Application.platform.Equals(RuntimePlatform.WebGLPlayer);
        bool canUseBackendTTS = backendTTS != null;
        bool canUseOpenAITTS = openAITTS != null && (allowOpenAITTSInWebGL || !isWebGL);

        // Prioritize backend TTS in WebGL (to avoid CORS/Auth issues) or if OpenAI TTS is explicitly disabled
        if (canUseBackendTTS && (isWebGL || !canUseOpenAITTS))
        {
            Debug.Log("[MockmateVR-Glue] Using Backend TTS.");
            IEnumerator backendSpeak = InvokeEnumeratorIfPresent(backendTTS, "Speak", _currentQuestionText);
            if (backendSpeak != null)
            {
                yield return backendSpeak;
                // Animation Stop is now handled by backendTTS.Speak() internally for better sync

                if (ReadBoolMember(backendTTS, "LastSpeakSucceeded"))
                {
                    Debug.Log("[MockmateVR-Glue] Backend TTS success.");
                    flowController?.NotifyQuestionSpeechCompleted();
                    yield break;
                }
                else
                {
                    Debug.LogWarning("[MockmateVR-Glue] Backend TTS reported failure.");
                }
            }
            else
            {
                // No need for stop here if it wasn't started
            }
        }

        // --- NEW Browser TTS Fallback ---
        if (browserTTS == null)
        {
            browserTTS = FindFirstObjectByType<MockmateVRBrowserTTS>();
        }

        if (browserTTS != null && isWebGL)
        {
            Debug.Log("[MockmateVR-Glue] Proceeding with Browser-Native TTS fallback.");
            yield return browserTTS.Speak(_currentQuestionText);
            
            if (browserTTS.LastSpeakSucceeded)
            {
                Debug.Log("[MockmateVR-Glue] Browser-Native TTS success.");
                flowController?.NotifyQuestionSpeechCompleted();
                yield break;
            }
        }

        // Fallback to direct OpenAI TTS if available and permitted
        if (canUseOpenAITTS)
        {
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

        if (avatarTTS != null)
        {
            IEnumerator avatarSpeak = InvokeEnumeratorIfPresent(avatarTTS, "Speak", _currentQuestionText);
            if (avatarSpeak != null)
            {
                yield return avatarSpeak;
                flowController?.NotifyQuestionSpeechCompleted();
                yield break;
            }
        }

        // Final fallback: just notify and finish if everything else failed
        Debug.LogWarning("[MockmateVR-Glue] All TTS attempts failed. Advancing manually.");
        flowController?.NotifyQuestionSpeechCompleted();
    }

    private void AddTranscriptListener()
    {
        UnityEvent<string> transcriptEvent = GetTranscriptEvent();
        transcriptEvent?.AddListener(OnTranscriptChunk);
    }

    private void RemoveTranscriptListener()
    {
        UnityEvent<string> transcriptEvent = GetTranscriptEvent();
        transcriptEvent?.RemoveListener(OnTranscriptChunk);
    }

    private UnityEvent<string> GetTranscriptEvent()
    {
        if (sttClient == null)
            return null;

        const BindingFlags flags = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
        FieldInfo field = sttClient.GetType().GetField("OnTranscriptChunk", flags);
        if (field != null && field.GetValue(sttClient) is UnityEvent<string> fieldEvent)
            return fieldEvent;

        PropertyInfo property = sttClient.GetType().GetProperty("OnTranscriptChunk", flags);
        if (property != null && property.GetValue(sttClient, null) is UnityEvent<string> propertyEvent)
            return propertyEvent;

        return null;
    }

    private static void InvokeIfPresent(object target, string methodName, params object[] args)
    {
        if (target == null)
            return;

        const BindingFlags flags = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
        MethodInfo method = target.GetType().GetMethod(methodName, flags);
        method?.Invoke(target, args);
    }

    private static IEnumerator InvokeEnumeratorIfPresent(object target, string methodName, params object[] args)
    {
        if (target == null)
            return null;

        const BindingFlags flags = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
        MethodInfo method = target.GetType().GetMethod(methodName, flags);
        if (method == null)
            return null;

        return method.Invoke(target, args) as IEnumerator;
    }

    private static bool ReadBoolMember(object target, string memberName)
    {
        if (target == null)
            return false;

        const BindingFlags flags = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
        PropertyInfo property = target.GetType().GetProperty(memberName, flags);
        if (property != null && property.PropertyType == typeof(bool))
            return (bool)property.GetValue(target, null);

        FieldInfo field = target.GetType().GetField(memberName, flags);
        if (field != null && field.FieldType == typeof(bool))
            return (bool)field.GetValue(target);

        return false;
    }
}
