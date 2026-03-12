using UnityEngine;

/// <summary>
/// Unified bridge for VR animations. 
/// Handles Talking (with procedural jaw wiggle), Typing, and Animator parameters.
/// </summary>
public class MockmateVRAnimationBridge : MonoBehaviour
{
    [Header("Animator Control")]
    public Animator animator;
    public string talkBoolParam = "isTalking";
    public string typeBoolParam = "isTyping";

    [Header("Procedural Jaw (Optional)")]
    public Transform jawBone;
    public float jawOpenAmount = 20f;
    public float talkSpeed = 10f;

    private bool _isSpeaking = false;
    private Quaternion _jawStartRot;

    void Start()
    {
        if (animator == null) animator = GetComponent<Animator>();
        if (jawBone != null) _jawStartRot = jawBone.localRotation;
    }

    [ContextMenu("Start Talking")]
    public void StartTalking()
    {
        _isSpeaking = true;
        if (animator != null) animator.SetBool(talkBoolParam, true);
    }

    [ContextMenu("Stop Talking")]
    public void StopTalking()
    {
        _isSpeaking = false;
        if (animator != null) animator.SetBool(talkBoolParam, false);
        if (jawBone != null) jawBone.localRotation = _jawStartRot;
    }

    [ContextMenu("Start Typing")]
    public void StartTyping()
    {
        if (animator != null) animator.SetBool(typeBoolParam, true);
    }

    [ContextMenu("Stop Typing")]
    public void StopTyping()
    {
        if (animator != null) animator.SetBool(typeBoolParam, false);
    }

    void Update()
    {
        if (_isSpeaking && jawBone != null)
        {
            float angle = Mathf.Abs(Mathf.Sin(Time.time * talkSpeed)) * jawOpenAmount;
            jawBone.localRotation = _jawStartRot * Quaternion.Euler(angle, 0, 0);
        }
    }
}
