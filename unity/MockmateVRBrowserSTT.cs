using System;
using System.Runtime.InteropServices;
using UnityEngine;
using UnityEngine.Events;

/// <summary>
/// Free alternative to OpenAI Whisper using the browser's native webkitSpeechRecognition.
/// Direct alternative to VRBackendSTT / OpenAIWhisperSTT for WebGL builds.
/// </summary>
public class MockmateVRBrowserSTT : MonoBehaviour
{
    [DllImport("__Internal")]
    private static extern void StartNativeSTT(string objectName);

    /// <summary>Invoked every time a full sentence/phrase is recognized locally by the browser.</summary>
    public UnityEvent<string> OnTranscriptChunk;

    /// <summary>Starts the browser's speech recognition session.</summary>
    public void StartSpeechToText()
    {
        if (Application.platform != RuntimePlatform.WebGLPlayer)
        {
            Debug.LogWarning("[BrowserSTT] Native WebGL STT is only supported in browser builds.");
            return;
        }

        Debug.Log("[BrowserSTT] Activating browser speech recognition...");
        StartNativeSTT(gameObject.name);
    }

    /// <summary>Stops the browser's speech recognition session.</summary>
    public void StopSpeechToText()
    {
        // Recognition typically auto-stops on silence, but adding stop logic to the jslib if needed.
    }

    /// <summary>
    /// Callback from JavaScript: SendMessage("MySTTObject", "OnTranscriptChunkReceived", text)
    /// </summary>
    public void OnTranscriptChunkReceived(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return;
        
        Debug.Log($"[BrowserSTT] Recognized: {text}");
        OnTranscriptChunk?.Invoke(text.Trim());
        
        // Manual fallback if not wired in Inspector
        if (OnTranscriptChunk.GetPersistentEventCount() == 0)
        {
            var flow = FindFirstObjectByType<MockmateVRFlowController>();
            if (flow != null)
                flow.AppendTranscriptChunk(text.Trim());
        }
    }

    /// <summary>Compatibility alias for legacy Inspector events and older JS versions.</summary>
    public void OnTranscriptionReceived(string text) => OnTranscriptChunkReceived(text);
}
