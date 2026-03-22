using System;
using System.Collections;
using System.IO;
using UnityEngine;
using UnityEngine.Networking;

/// <summary>
/// Polls for a bridge token from the Mockmate backend (and optionally a local JSON file).
/// When a NEW token is detected, it automatically configures the flow controller and starts the VR interview.
/// Attach to the same GameObject as MockmateVRFlowController & MockmateVRApiClient.
/// </summary>
public class MockmateVRTokenPoller : MonoBehaviour
{
    [Header("Dependencies")]
    [SerializeField] private MockmateVRFlowController flowController;
    [SerializeField] private MockmateVRApiClient apiClient;

    [Header("Polling Settings")]
    [Tooltip("How often (seconds) to check for a new token.")]
    [SerializeField] private float pollIntervalSeconds = 2.5f;

    [Tooltip("Your unique device ID — must match what the web app sends. Default: 'mockmate-vr-default'.")]
    [SerializeField] private string deviceId = "mockmate-vr-default";

    [Tooltip("API base URL of the Mockmate backend.")]
    [SerializeField] private string apiBase = "https://mockmate-api-production.up.railway.app";

    [Header("Local File Polling (optional)")]
    [Tooltip("Also poll a local JSON file for the bridge token (written by the web app).")]
    [SerializeField] private bool pollLocalFile = true;

    [Tooltip("Folder name inside %APPDATA% (Windows) or Application.persistentDataPath (Android/Quest).")]
    [SerializeField] private string localFolderName = "MockmateVR";

    [Tooltip("File name to look for.")]
    [SerializeField] private string localFileName = "bridge_token.json";

    [Header("Status")]
    public UnityEngine.Events.UnityEvent<string> OnStatusMessage;

    // Track the last token we consumed to avoid re-triggering.
    private string _lastConsumedToken = "";
    private bool _polling = false;

    [Serializable]
    private class TokenFilePayload
    {
        public string bridge_token;
        public string api_base;
    }

    [Serializable]
    private class TokenPollResponse
    {
        public bool success;
        public string bridge_token;
        public string api_base;
        public string created_at;
    }

    private void Awake()
    {
        if (flowController == null)
            flowController = GetComponent<MockmateVRFlowController>();
        if (apiClient == null)
            apiClient = GetComponent<MockmateVRApiClient>();
        apiBase = SanitizeApiBase(apiBase);
    }

    private void OnEnable()
    {
        StartPolling();
    }

    private void OnDisable()
    {
        StopPolling();
    }

    public void StartPolling()
    {
        if (_polling) return;
        _polling = true;
        PublishStatus("Waiting for bridge token from web app...");
        StartCoroutine(PollLoop());
    }

    public void StopPolling()
    {
        _polling = false;
        StopAllCoroutines();
    }

    /// <summary>
    /// Override the device ID at runtime (e.g., from a UI input field).
    /// </summary>
    public void SetDeviceId(string id)
    {
        if (!string.IsNullOrWhiteSpace(id))
            deviceId = id.Trim();
    }

    private IEnumerator PollLoop()
    {
        while (_polling)
        {
            // 1. Try local file first (fastest path, no network needed).
            if (pollLocalFile)
            {
                string token = TryReadLocalFile();
                if (!string.IsNullOrWhiteSpace(token) && token != _lastConsumedToken)
                {
                    PublishStatus("Token received from local file!");
                    ConsumeToken(token, null);
                    yield break;
                }
            }

            // 2. Poll backend API.
            yield return PollBackendOnce();

            // 3. Wait before next iteration.
            yield return new WaitForSeconds(pollIntervalSeconds);
        }
    }

    private string TryReadLocalFile()
    {
        try
        {
            string folder;
#if UNITY_ANDROID && !UNITY_EDITOR
            folder = Path.Combine(Application.persistentDataPath, localFolderName);
#else
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            folder = Path.Combine(appData, localFolderName);
#endif
            string filePath = Path.Combine(folder, localFileName);
            if (!File.Exists(filePath)) return null;

            string json = File.ReadAllText(filePath);
            TokenFilePayload payload = JsonUtility.FromJson<TokenFilePayload>(json);

            // Update api_base if present.
            if (!string.IsNullOrWhiteSpace(payload.api_base) && apiClient != null)
            {
                apiBase = SanitizeApiBase(payload.api_base);
                apiClient.SetApiBase(payload.api_base);
            }

            return payload?.bridge_token;
        }
        catch (Exception ex)
        {
            Debug.LogWarning($"[MockmateVR] Local file read error: {ex.Message}");
            return null;
        }
    }

    private IEnumerator PollBackendOnce()
    {
        string url = $"{SanitizeApiBase(apiBase)}/vr-bridge/token-poll?device_id={UnityWebRequest.EscapeURL(deviceId)}";

        using (UnityWebRequest req = UnityWebRequest.Get(url))
        {
            req.SetRequestHeader("Accept", "application/json");
            req.timeout = 5;
            yield return req.SendWebRequest();

            if (req.result != UnityWebRequest.Result.Success)
            {
                // Silently ignore network errors during polling.
                yield break;
            }

            string json = req.downloadHandler.text;
            TokenPollResponse resp;
            try
            {
                resp = JsonUtility.FromJson<TokenPollResponse>(json);
            }
            catch
            {
                yield break;
            }

            if (resp == null || !resp.success || string.IsNullOrWhiteSpace(resp.bridge_token))
                yield break;

            if (resp.bridge_token == _lastConsumedToken)
                yield break;

            // Update api_base if provided.
            if (!string.IsNullOrWhiteSpace(resp.api_base) && apiClient != null)
            {
                apiBase = SanitizeApiBase(resp.api_base);
                apiClient.SetApiBase(resp.api_base);
            }

            PublishStatus("Token received from backend!");
            ConsumeToken(resp.bridge_token, resp.api_base);
        }
    }

    private void ConsumeToken(string bridgeToken, string overrideApiBase)
    {
        _lastConsumedToken = bridgeToken;
        _polling = false;

        if (flowController == null)
        {
            Debug.LogError("[MockmateVR] FlowController is null, cannot consume token.");
            return;
        }

        if (!string.IsNullOrWhiteSpace(overrideApiBase))
        {
            apiBase = SanitizeApiBase(overrideApiBase);
            flowController.SetApiBase(overrideApiBase);
        }

        flowController.SetBridgeToken(bridgeToken);
        PublishStatus("Starting VR interview...");
        flowController.BeginFlow();
    }

    private void PublishStatus(string message)
    {
        Debug.Log("[MockmateVR-Poller] " + message);
        OnStatusMessage?.Invoke(message);
    }

    private string SanitizeApiBase(string baseUrl)
    {
        return string.IsNullOrWhiteSpace(baseUrl) ? string.Empty : baseUrl.Trim().TrimEnd('/');
    }
}
