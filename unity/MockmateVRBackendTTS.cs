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

    [Header("Voice")]
    [SerializeField] private string voice = "alloy";
    [SerializeField] private string model = "gpt-4o-mini-tts";
    [SerializeField] private string instructions = "";
    [SerializeField] private string responseFormat = "wav";

    [Header("Behavior")]
    [SerializeField] private bool interruptCurrentPlayback = true;
    [SerializeField] private float requestTimeoutSeconds = 60f;

    public bool LastSpeakSucceeded { get; private set; }

    private void Awake()
    {
        if (apiClient == null)
            apiClient = GetComponent<MockmateVRApiClient>();
        if (audioSource == null)
            audioSource = GetComponent<AudioSource>();
    }

        Debug.Log($"[MockmateVR-TTS] Speak called with text: {text}");
        if (string.IsNullOrWhiteSpace(text))
        {
            Debug.LogWarning("[MockmateVR-TTS] Speak text is null or whitespace.");
            yield break;
        }

        if (apiClient == null)
        {
            Debug.LogWarning("[MockmateVR-TTS] API client missing.");
            yield break;
        }

        if (audioSource == null)
        {
            Debug.LogWarning("[MockmateVR-TTS] AudioSource missing.");
            yield break;
        }

        if (string.IsNullOrWhiteSpace(apiClient.ApiBase) || string.IsNullOrWhiteSpace(apiClient.BridgeToken))
        {
            Debug.LogWarning("[MockmateVR-TTS] API base or bridge token missing.");
            yield break;
        }

        if (interruptCurrentPlayback && audioSource.isPlaying)
            audioSource.Stop();

        string url = $"{apiClient.ApiBase.TrimEnd('/')}/vr-bridge/tts";
        Debug.Log($"[MockmateVR-TTS] Sending request to {url} with bridge token: {apiClient.BridgeToken.Substring(0, Math.Min(8, apiClient.BridgeToken.Length))}...");
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
                Debug.LogWarning($"[MockmateVR-TTS] Request failed: {req.responseCode} {req.error}. Response: {req.downloadHandler.text}");
                yield break;
            }

            Debug.Log($"[MockmateVR-TTS] Request success. Status Code: {req.responseCode}. Data length: {req.downloadHandler.data.Length} bytes.");

            AudioClip clip = null;
            try
            {
                clip = DownloadHandlerAudioClip.GetContent(req);
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[MockmateVR-TTS] Audio decode failed: {ex.Message}");
                yield break;
            }

            if (clip == null)
            {
                Debug.LogWarning("[MockmateVR-TTS] Backend returned no audio clip.");
                yield break;
            }

            audioSource.clip = clip;
            Debug.Log("[MockmateVR-TTS] Starting audio playback.");
            audioSource.Play();
            LastSpeakSucceeded = true;

            while (audioSource != null && audioSource.isPlaying)
                yield return null;
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
