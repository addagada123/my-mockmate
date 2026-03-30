using System;
using UnityEngine;

/// <summary>
/// Handles both WebGL SendMessage (SetBridgeToken) and Native Deep Linking (mockmate://)
/// to synchronize the VR interview session.
/// </summary>
public class MockmateVRDeepLinkBootstrap : MonoBehaviour
{
    [SerializeField] private MockmateVRFlowController flowController;
    [SerializeField] private string defaultApiBase = "https://mockmate-api-6dvm.onrender.com";
    [SerializeField] private bool autoBeginOnDeepLink = true;

    private void Awake()
    {
        if (flowController == null)
            flowController = FindFirstObjectByType<MockmateVRFlowController>();
    }

    private void OnEnable()
    {
        Application.deepLinkActivated += OnDeepLinkActivated;
    }

    private void OnDisable()
    {
        Application.deepLinkActivated -= OnDeepLinkActivated;
    }

    private void Start()
    {
        // 1. Check for cold-start deep links via Application.absoluteURL
        if (!string.IsNullOrWhiteSpace(Application.absoluteURL))
        {
            OnDeepLinkActivated(Application.absoluteURL);
            return;
        }

        // 2. Fallback for Windows: Check Environment command line args 
        string[] args = System.Environment.GetCommandLineArgs();
        foreach (string arg in args)
        {
            if (arg.StartsWith("mockmate://", StringComparison.OrdinalIgnoreCase))
            {
                OnDeepLinkActivated(arg);
                break;
            }
        }
    }

    /// <summary>
    /// Handles native deep links (mockmate://?bridge_token=...&api_base=...)
    /// </summary>
    private void OnDeepLinkActivated(string url)
    {
        if (flowController == null)
            flowController = FindFirstObjectByType<MockmateVRFlowController>();
        if (flowController == null) return;

        string token = GetQueryParam(url, "bridge_token");
        string apiBase = GetQueryParam(url, "api_base");

        if (string.IsNullOrWhiteSpace(apiBase))
            apiBase = defaultApiBase;

        flowController.SetApiBase(Uri.UnescapeDataString(apiBase));
        flowController.SetBridgeToken(Uri.UnescapeDataString(token ?? string.Empty));

        if (autoBeginOnDeepLink && !string.IsNullOrWhiteSpace(token))
            flowController.BeginFlow();
    }

    /// <summary>
    /// Called via SendMessage from index.html in WebGL builds.
    /// Expects a JSON string: { "bridge_token": "...", "api_base": "...", "session_id": "..." }
    /// </summary>
    public void SetBridgeToken(string jsonPayload)
    {
        Debug.Log($"[MockmateVR] Received bridge token from browser: {jsonPayload}");
        try
        {
            var data = JsonUtility.FromJson<BridgeData>(jsonPayload);
            if (data == null || string.IsNullOrWhiteSpace(data.bridge_token)) return;

            if (flowController == null)
                flowController = FindFirstObjectByType<MockmateVRFlowController>();

            if (flowController != null)
            {
                if (!string.IsNullOrWhiteSpace(data.api_base))
                    flowController.SetApiBase(data.api_base);

                flowController.SetBridgeToken(data.bridge_token);
                
                if (autoBeginOnDeepLink)
                    flowController.BeginFlow();
            }
        }
        catch (Exception ex)
        {
            Debug.LogError($"[MockmateVR] Error parsing bridge token: {ex.Message}");
        }
    }

    private static string GetQueryParam(string url, string key)
    {
        if (string.IsNullOrWhiteSpace(url)) return string.Empty;
        int q = url.IndexOf('?');
        if (q < 0 || q >= url.Length - 1) return string.Empty;
        string query = url.Substring(q + 1);
        string[] pairs = query.Split('&', StringSplitOptions.RemoveEmptyEntries);
        foreach (string p in pairs)
        {
            int eq = p.IndexOf('=');
            if (eq <= 0) continue;
            string k = p.Substring(0, eq);
            if (!string.Equals(k, key, StringComparison.OrdinalIgnoreCase)) continue;
            return p.Substring(eq + 1);
        }
        return string.Empty;
    }

    [Serializable]
    private class BridgeData
    {
        public string bridge_token;
        public string api_base;
        public string session_id;
    }
}
