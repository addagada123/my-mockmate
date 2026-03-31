using System;
using System.Collections;
using System.Runtime.InteropServices;
using UnityEngine;

/// <summary>
/// Free alternative to OpenAI TTS using the browser's native window.speechSynthesis.
/// Calls AnimationBridge.StartTalking/StopTalking in sync with speech events from JS.
/// </summary>
public class MockmateVRBrowserTTS : MonoBehaviour
{
    [DllImport("__Internal")]
    private static extern void SpeakNative(string text, string objectName);

    public bool LastSpeakSucceeded { get; private set; }
    private bool _isSpeaking = false;
    private MockmateVRAnimationBridge _animBridge;

    private void Awake()
    {
        // Cache at startup — avoids expensive FindFirstObjectByType on every speech event
        _animBridge = FindFirstObjectByType<MockmateVRAnimationBridge>();
        if (_animBridge == null)
            Debug.LogWarning("[BrowserTTS] MockmateVRAnimationBridge not found. Lip sync will not work.");
    }

    public IEnumerator Speak(string text)
    {
        LastSpeakSucceeded = false;
        
        if (Application.platform != RuntimePlatform.WebGLPlayer)
        {
            Debug.LogWarning("[BrowserTTS] Only supported in WebGL.");
            yield break;
        }

        Debug.Log($"[BrowserTTS] Requesting native speech for: {text}");
        _isSpeaking = true;
        SpeakNative(text, gameObject.name);

        // Wait for the end event from JS (with 30s safety timeout)
        float startWait = Time.time;
        while (_isSpeaking && (Time.time - startWait) < 30f)
        {
            yield return null;
        }

        if (_isSpeaking)
        {
            Debug.LogWarning("[BrowserTTS] Speech timed out. Forcing completion.");
            OnSpeakEnd();
        }

        LastSpeakSucceeded = true;
    }

    public void OnSpeakStart()
    {
        _isSpeaking = true;
        if (_animBridge != null)
            _animBridge.StartTalking();
    }

    public void OnSpeakEnd()
    {
        // Add a tiny 0.2s tail so the jaw doesn't snap shut instantly
        StartCoroutine(DelayedStopTalking(0.2f));
    }

    private IEnumerator DelayedStopTalking(float delay)
    {
        yield return new WaitForSeconds(delay);
        _isSpeaking = false;
        if (_animBridge != null)
            _animBridge.StopTalking();
    }
}
