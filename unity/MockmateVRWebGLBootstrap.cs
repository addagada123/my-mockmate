using System;
using UnityEngine;

/// <summary>
/// Receives the bridge token from the WebGL page via SendMessage.
/// Attach to a GameObject named exactly "MockmateVRBootstrap" in your scene.
/// </summary>
public class MockmateVRWebGLBootstrap : MonoBehaviour
{
    [SerializeField] private MockmateVRFlowController flowController;

    private void Awake()
    {
        if (flowController == null)
            flowController = FindFirstObjectByType<MockmateVRFlowController>();
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

            if (!string.IsNullOrWhiteSpace(payload.api_base))
                flowController.SetApiBase(Uri.UnescapeDataString(payload.api_base));

            if (!string.IsNullOrWhiteSpace(payload.bridge_token))
            {
                flowController.SetBridgeToken(Uri.UnescapeDataString(payload.bridge_token));
                flowController.BeginFlow();
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
