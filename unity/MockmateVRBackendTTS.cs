using System;
using System.Collections;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

/// <summary>
/// Server-side TTS client for WebGL/VR that proxies speech generation through the Mockmate backend.
/// Compatible with VRInterviewGlue via the Speak(string) coroutine + LastSpeakSucceeded property.
/// </summary>
[AddComponentMenu("Mockmate/VR Backend TTS")]
public class MockmateVRBackendTTS : MonoBehaviour
{
    [Header("Dependencies")]
    [SerializeField] private MockmateVRApiClient apiClient;
    [SerializeField] private AudioSource audioSource;
    [SerializeField] private MockmateVRAnimationBridge animationBridge;
    [SerializeField] private MockmateVRFlowController flowController;

    [Header("Voice")]
    [SerializeField] private string voice = "alloy";
    [SerializeField] private string model = "tts-1";
    [SerializeField] private string instructions = "";
    [SerializeField] private string responseFormat = "wav";

    [Header("Behavior")]
    [SerializeField] private bool interruptCurrentPlayback = true;
    [SerializeField] private float requestTimeoutSeconds = 60f;

    public bool LastSpeakSucceeded { get; private set; }

    private void Awake()
    {
        if (apiClient == null) apiClient = GetComponent<MockmateVRApiClient>();
        if (apiClient == null) apiClient = FindFirstObjectByType<MockmateVRApiClient>();

        if (audioSource == null) audioSource = GetComponent<AudioSource>();
        if (audioSource == null) audioSource = FindFirstObjectByType<AudioSource>();

        if (animationBridge == null) animationBridge = FindFirstObjectByType<MockmateVRAnimationBridge>();
        if (flowController == null) flowController = FindFirstObjectByType<MockmateVRFlowController>();
    }

    public IEnumerator Speak(string text)
    {
        LastSpeakSucceeded = false;
        Debug.Log($"[MockmateVR-TTS] Speak called: {text}");
        
        if (string.IsNullOrWhiteSpace(text) || apiClient == null || audioSource == null)
        {
            Debug.LogWarning("[MockmateVR-TTS] Missing dependencies or empty text.");
            yield break;
        }

        if (interruptCurrentPlayback && audioSource.isPlaying)
            audioSource.Stop();

        string url = $"{apiClient.ApiBase.TrimEnd('/')}/vr-bridge/tts";
        TTSRequest payload = new TTSRequest
        {
            bridge_token = apiClient.BridgeToken,
            text = text,
            voice = voice,
            model = model,
            instructions = instructions,
            response_format = responseFormat,
        };

        byte[] body = Encoding.UTF8.GetBytes(JsonUtility.ToJson(payload));
        AudioType audioType = ResolveAudioType(responseFormat);

        using (UnityWebRequest req = new UnityWebRequest(url, UnityWebRequest.kHttpVerbPOST))
        {
            req.uploadHandler = new UploadHandlerRaw(body);
            req.downloadHandler = new DownloadHandlerAudioClip(url, audioType);
            req.timeout = Mathf.CeilToInt(Mathf.Max(1f, requestTimeoutSeconds));
            req.SetRequestHeader("Content-Type", "application/json");
            req.SetRequestHeader("Accept", ResolveAcceptHeader(responseFormat));

            yield return req.SendWebRequest();

            if (req.result != UnityWebRequest.Result.Success)
            {
                Debug.LogWarning($"[MockmateVR-TTS] Request failed: {req.responseCode} {req.error}");
                yield break;
            }

            AudioClip clip = null;
            try
            {
                clip = DownloadHandlerAudioClip.GetContent(req);
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[MockmateVR-TTS] Decode failed: {ex.Message}");
                yield break;
            }

            if (clip == null)
            {
                Debug.LogWarning("[MockmateVR-TTS] No clip returned.");
                yield break;
            }

            audioSource.clip = clip;
            
            // Sync animation StartTalking EXACTLY with Play()
            if (animationBridge != null) 
                animationBridge.StartTalking();
                
            audioSource.Play();
            LastSpeakSucceeded = true;

            // Wait for playback to finish
            while (audioSource != null && audioSource.isPlaying)
                yield return null;

            // Sync animation StopTalking with playback completion
            if (animationBridge != null) 
                animationBridge.StopTalking();
        }
    }

    private static AudioType ResolveAudioType(string format)
    {
        string normalized = (format ?? "wav").Trim().ToLowerInvariant();
        switch (normalized)
        {
            case "mp3":
                return AudioType.MPEG;
            case "ogg":
            case "opus":
                return AudioType.OGGVORBIS;
            case "aac":
                return AudioType.AUDIOQUEUE;
            default:
                return AudioType.WAV;
        }
    }

    private static string ResolveAcceptHeader(string format)
    {
        string normalized = (format ?? "wav").Trim().ToLowerInvariant();
        switch (normalized)
        {
            case "mp3":
                return "audio/mpeg";
            case "ogg":
            case "opus":
                return "audio/ogg";
            case "aac":
                return "audio/aac";
            case "flac":
                return "audio/flac";
            default:
                return "audio/wav";
        }
    }

    [Serializable]
    private class TTSRequest
    {
        public string bridge_token;
        public string text;
        public string voice;
        public string model;
        public string instructions;
        public string response_format;
    }
}
