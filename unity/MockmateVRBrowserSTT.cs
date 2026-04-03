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
    private MockmateVRFlowController _flowController;
    private VRInterviewGlue _glue;

    private void Awake()
    {
        if (OnTranscriptChunk == null)
            OnTranscriptChunk = new UnityEvent<string>();
        _flowController = FindFirstObjectByType<MockmateVRFlowController>();
        _glue = FindFirstObjectByType<VRInterviewGlue>();
    }

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
        string processedText = (text ?? "").Trim();
        if (string.IsNullOrEmpty(processedText))
            return;
        
        Debug.Log($"[BrowserSTT] Signal received: \"{processedText}\"");
        OnTranscriptChunk?.Invoke(processedText);
        
        // Manual fallback only when no runtime glue is present and no Inspector listeners exist.
        // VRInterviewGlue adds a runtime listener, which does not count as a persistent event.
        if (_glue == null)
            _glue = FindFirstObjectByType<VRInterviewGlue>();

        if (_glue == null && OnTranscriptChunk.GetPersistentEventCount() == 0)
        {
            if (_flowController == null)
                _flowController = FindFirstObjectByType<MockmateVRFlowController>();
            if (_flowController != null)
                _flowController.AppendTranscriptChunk(processedText);
        }
    }

    /// <summary>
    /// Callback from JavaScript for interim/non-final speech activity so short pauses
    /// do not count as silence.
    /// </summary>
    public void OnSpeechActivity(string _ignored)
    {
        if (_flowController == null)
            _flowController = FindFirstObjectByType<MockmateVRFlowController>();
        _flowController?.MarkSpeechActivity();
    }

    /// <summary>Compatibility alias for legacy Inspector events and older JS versions.</summary>
    public void OnTranscriptionReceived(string text) => OnTranscriptChunkReceived(text);
}
