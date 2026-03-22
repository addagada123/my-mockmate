using System;
using System.Collections;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

[AddComponentMenu("Mockmate/VR Backend TTS")]
public class MockmateVRBackendTTS : MonoBehaviour
{
    [Header("Dependencies")]
    [SerializeField] private MockmateVRApiClient apiClient;
    [SerializeField] private AudioSource audioSource;

    [Header("Voice Settings")]
    [SerializeField] private string voice = "nova";
    [SerializeField] private string model = "tts-1";
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

    public IEnumerator Speak(string text)
    {
        LastSpeakSucceeded = false;

        if (string.IsNullOrWhiteSpace(text))
            yield break;

        if (apiClient == null || string.IsNullOrWhiteSpace(apiClient.ApiBase) || string.IsNullOrWhiteSpace(apiClient.BridgeToken))
        {
            Debug.LogWarning("[Mockmate-TTS] API Client is not configured. Cannot speak.");
            yield break;
        }

        if (audioSource == null)
        {
            Debug.LogWarning("[Mockmate-TTS] No AudioSource assigned.");
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
            response_format = responseFormat
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
                Debug.LogWarning($"[Mockmate-TTS] Request failed: {req.responseCode} {req.error}");
                yield break;
            }

            AudioClip clip = null;
            try
            {
                clip = DownloadHandlerAudioClip.GetContent(req);
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[Mockmate-TTS] Audio decode failed: {ex.Message}");
                yield break;
            }

            if (clip != null)
            {
                audioSource.clip = clip;
                audioSource.Play();
                LastSpeakSucceeded = true;

                while (audioSource != null && audioSource.isPlaying)
                    yield return null;
            }
        }
    }

    private static AudioType ResolveAudioType(string format)
    {
        string norm = (format ?? "wav").ToLowerInvariant();
        if (norm.Contains("mp3")) return AudioType.MPEG;
        if (norm.Contains("ogg") || norm.Contains("opus")) return AudioType.OGGVORBIS;
        return AudioType.WAV;
    }

    private static string ResolveAcceptHeader(string format)
    {
        string norm = (format ?? "wav").ToLowerInvariant();
        if (norm.Contains("mp3")) return "audio/mpeg";
        if (norm.Contains("ogg")) return "audio/ogg";
        return "audio/wav";
    }

    [Serializable]
    private class TTSRequest
    {
        public string bridge_token;
        public string text;
        public string voice;
        public string model;
        public string response_format;
    }
}
