using System;
using UnityEngine;

/// <summary>
/// Receives the bridge token from the WebGL page via SendMessage.
/// Attach to a GameObject named exactly "MockmateVRBootstrap" in your scene.
/// </summary>
public class MockmateVRWebGLBootstrap : MonoBehaviour
{
    [SerializeField] private MockmateVRFlowController flowController;
    private string _lastBridgeToken = "";
    private string _lastApiBase = "";
    private bool _flowStartedForCurrentToken;

    private void Awake()
    {
        if (flowController == null)
            flowController = FindFirstObjectByType<MockmateVRFlowController>();
            
        if (flowController != null)
        {
            flowController.OnCompleted.AddListener(OnInterviewEnded);
        }
    }

    [System.Runtime.InteropServices.DllImport("__Internal")]
    private static extern void NotifyInterviewComplete();

    private void OnInterviewEnded(float score)
    {
        Debug.Log("[MockmateVR-WebGL] Interview Completed. Notifying browser...");
#if UNITY_WEBGL && !UNITY_EDITOR
        try {
            NotifyInterviewComplete();
        } catch (Exception e) {
            Debug.LogError("Failed to call NotifyInterviewComplete: " + e.Message);
        }
#endif
    }

    /// <summary>
    /// Called by the WebGL page: unityInstance.SendMessage("MockmateVRBootstrap", "SetBridgeToken", json)
    /// json format: { "bridge_token": "...", "api_base": "...", "session_id": "..." }
    /// </summary>
    public void SetBridgeToken(string json)
    {
        if (flowController == null)
        {
            Debug.LogError("[MockmateVR-WebGL] FlowController not found!");
            return;
        }

        try
        {
            TokenPayload payload = JsonUtility.FromJson<TokenPayload>(json);
            string decodedApiBase = string.IsNullOrWhiteSpace(payload.api_base)
                ? ""
                : Uri.UnescapeDataString(payload.api_base);
            string decodedBridgeToken = string.IsNullOrWhiteSpace(payload.bridge_token)
                ? ""
                : Uri.UnescapeDataString(payload.bridge_token);

            bool samePayload =
                string.Equals(_lastApiBase, decodedApiBase, StringComparison.Ordinal) &&
                string.Equals(_lastBridgeToken, decodedBridgeToken, StringComparison.Ordinal);

            if (samePayload && _flowStartedForCurrentToken)
            {
                Debug.Log("[MockmateVR-WebGL] Duplicate bootstrap payload ignored.");
                return;
            }

            if (!string.IsNullOrWhiteSpace(decodedApiBase))
                flowController.SetApiBase(decodedApiBase);

            if (!string.IsNullOrWhiteSpace(decodedBridgeToken))
            {
                _lastApiBase = decodedApiBase;
                _lastBridgeToken = decodedBridgeToken;

                flowController.SetBridgeToken(decodedBridgeToken);
                flowController.BeginFlow();
                _flowStartedForCurrentToken = true;
                Debug.Log($"[MockmateVR-WebGL] Bridge token received. Session: {payload.session_id}. Flow started.");
            }
            else
            {
                Debug.LogWarning("[MockmateVR-WebGL] Received empty bridge token.");
            }
        }
        catch (Exception ex)
        {
            Debug.LogError("[MockmateVR-WebGL] Failed to parse token JSON: " + ex.Message);
        }
    }

    [Serializable]
    private class TokenPayload
    {
        public string bridge_token;
        public string api_base;
        public string session_id;
    }
}
