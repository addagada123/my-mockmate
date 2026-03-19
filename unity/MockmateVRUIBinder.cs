using TMPro;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Binds MockmateVRFlowController events to VR UI elements.
/// Attach to your VRCanvas or UIManager GameObject.
/// Wire the FlowController events to this in the Inspector.
/// </summary>
public class MockmateVRUIBinder : MonoBehaviour
{
    [Header("Question Display")]
    [Tooltip("TextMeshPro text that shows the current interview question.")]
    public TextMeshProUGUI questionText;

    [Header("Status Display")]
    [Tooltip("TextMeshPro text that shows status messages (fetching, listening, etc.)")]
    public TextMeshProUGUI statusText;

    [Header("Score Display")]
    [Tooltip("TextMeshPro text that shows the running score during the interview.")]
    public TextMeshProUGUI runningScoreText;

    [Tooltip("TextMeshPro text that shows the final score on test completion.")]
    public TextMeshProUGUI finalScoreText;

    [Header("Countdown / Prep Timer")]
    [Tooltip("TextMeshPro text that shows the prep countdown (10, 9, 8...).")]
    public TextMeshProUGUI prepTimerText;

    [Header("Answer Prompt")]
    [Tooltip("GameObject shown when it's time to speak (e.g., a 'Speak Now!' panel).")]
    public GameObject answerNowPanel;

    [Header("End Screen")]
    [Tooltip("GameObject shown when the test is fully complete.")]
    public GameObject endScreenPanel;

    // ─── Wired to FlowController events ──────────────────────────────────────

    /// <summary>Wire to: OnQuestionReceived(String)</summary>
    public void OnQuestionReceived(string question)
    {
        if (questionText != null)
            questionText.text = question;

        if (answerNowPanel != null)
            answerNowPanel.SetActive(false);

        SetStatus("Question loaded.");
    }

    /// <summary>Wire to: OnPrepTick(Single)</summary>
    public void OnPrepTick(float secondsRemaining)
    {
        if (prepTimerText != null)
            prepTimerText.text = secondsRemaining > 0
                ? $"Prepare: {Mathf.CeilToInt(secondsRemaining)}s"
                : "Speak now!";
    }

    /// <summary>Wire to: OnAnswerNow()</summary>
    public void OnAnswerNow()
    {
        if (answerNowPanel != null)
            answerNowPanel.SetActive(true);

        if (prepTimerText != null)
            prepTimerText.text = "Speak now!";
    }

    /// <summary>Wire to: OnRunningScoreUpdated(Single)</summary>
    public void ShowRunningScore(float score)
    {
        if (runningScoreText != null)
            runningScoreText.text = $"Score: {score:F1}%";
    }

    /// <summary>Wire to: OnCompleted(Single)</summary>
    public void ShowFinalScore(float score)
    {
        if (finalScoreText != null)
            finalScoreText.text = $"Final Score: {score:F1}%";

        if (endScreenPanel != null)
            endScreenPanel.SetActive(true);

        SetStatus($"Test complete! Score: {score:F1}%");
    }

    /// <summary>Wire to: OnCompletedMessage(String)</summary>
    public void OnCompletedMessage(string message)
    {
        SetStatus(message);
    }

    /// <summary>Wire to: OnStatusMessage(String)</summary>
    public void OnStatusMessage(string message)
    {
        SetStatus(message);
    }

    /// <summary>Wire to: OnError(String)</summary>
    public void OnError(string error)
    {
        SetStatus($"Error: {error}");
        Debug.LogError("[MockmateVR-UI] " + error);
    }

    // ─── Internal helpers ─────────────────────────────────────────────────────

    private void SetStatus(string message)
    {
        if (statusText != null)
            statusText.text = message;

        Debug.Log("[MockmateVR-UI] " + message);
    }
}
