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
    public bool animateListeningState = false;

    [Header("Procedural Jaw (Optional)")]
    public Transform jawBone;
    public float jawOpenAmount = 20f;
    public float talkSpeed = 10f;

    [Header("Blend Shape Lip Sync (Optional)")]
    public SkinnedMeshRenderer faceRenderer;
    [Tooltip("Common names include OpenMouth, MouthOpen, JawOpen, viseme_aa.")]
    public string[] mouthBlendShapeNames = { "OpenMouth", "MouthOpen", "JawOpen", "viseme_aa" };
    [Range(0f, 100f)] public float mouthBlendShapeMaxWeight = 100f;
    [Range(0f, 100f)] public float mouthBlendShapeRestWeight = 0f;
    [Range(0f, 1f)] public float mouthBlendShapeSmoothing = 0.2f;

    private bool _isSpeaking = false;
    private Quaternion _jawStartRot;
    private int[] _mouthBlendShapeIndices;
    private float _currentMouthWeight;

    void Start()
    {
        if (animator == null) animator = GetComponent<Animator>();
        if (jawBone != null) _jawStartRot = jawBone.localRotation;
        CacheMouthBlendShapes();
        ApplyMouthWeight(mouthBlendShapeRestWeight, true);
    }

    [ContextMenu("Start Talking")]
    public void StartTalking()
    {
        StopTyping();
        _isSpeaking = true;
        if (animator != null) animator.SetBool(talkBoolParam, true);
    }

    [ContextMenu("Stop Talking")]
    public void StopTalking()
    {
        _isSpeaking = false;
        if (animator != null) animator.SetBool(talkBoolParam, false);
        if (jawBone != null) jawBone.localRotation = _jawStartRot;
        ApplyMouthWeight(mouthBlendShapeRestWeight, true);
    }

    [ContextMenu("Start Typing")]
    public void StartTyping()
    {
        StopTalking();
        if (animateListeningState && animator != null && !string.IsNullOrWhiteSpace(typeBoolParam))
            animator.SetBool(typeBoolParam, true);
    }

    [ContextMenu("Stop Typing")]
    public void StopTyping()
    {
        if (animator != null && !string.IsNullOrWhiteSpace(typeBoolParam))
            animator.SetBool(typeBoolParam, false);
    }

    void Update()
    {
        bool updatedSpeakingPose = false;

        if (_isSpeaking && jawBone != null)
        {
            float angle = Mathf.Abs(Mathf.Sin(Time.time * talkSpeed)) * jawOpenAmount;
            jawBone.localRotation = _jawStartRot * Quaternion.Euler(angle, 0, 0);
            updatedSpeakingPose = true;
        }

        if (_isSpeaking && HasMouthBlendShapes())
        {
            float targetWeight = Mathf.Abs(Mathf.Sin(Time.time * talkSpeed)) * mouthBlendShapeMaxWeight;
            ApplyMouthWeight(targetWeight, false);
            updatedSpeakingPose = true;
        }

        if (!updatedSpeakingPose && HasMouthBlendShapes())
        {
            ApplyMouthWeight(mouthBlendShapeRestWeight, false);
        }
    }

    private void CacheMouthBlendShapes()
    {
        if (faceRenderer == null)
            faceRenderer = GetComponentInChildren<SkinnedMeshRenderer>();

        Mesh sharedMesh = faceRenderer != null ? faceRenderer.sharedMesh : null;
        if (sharedMesh == null || sharedMesh.blendShapeCount == 0)
        {
            _mouthBlendShapeIndices = null;
            return;
        }

        System.Collections.Generic.List<int> indices = new System.Collections.Generic.List<int>();
        foreach (string shapeName in mouthBlendShapeNames)
        {
            if (string.IsNullOrWhiteSpace(shapeName))
                continue;

            int index = sharedMesh.GetBlendShapeIndex(shapeName);
            if (index >= 0 && !indices.Contains(index))
                indices.Add(index);
        }

        _mouthBlendShapeIndices = indices.Count > 0 ? indices.ToArray() : null;
    }

    private bool HasMouthBlendShapes()
    {
        return faceRenderer != null && _mouthBlendShapeIndices != null && _mouthBlendShapeIndices.Length > 0;
    }

    private void ApplyMouthWeight(float targetWeight, bool immediate)
    {
        if (!HasMouthBlendShapes())
            return;

        float clampedTarget = Mathf.Clamp(targetWeight, 0f, 100f);
        _currentMouthWeight = immediate
            ? clampedTarget
            : Mathf.Lerp(_currentMouthWeight, clampedTarget, 1f - Mathf.Pow(1f - mouthBlendShapeSmoothing, Time.deltaTime * 60f));

        for (int i = 0; i < _mouthBlendShapeIndices.Length; i++)
            faceRenderer.SetBlendShapeWeight(_mouthBlendShapeIndices[i], _currentMouthWeight);
    }
}
