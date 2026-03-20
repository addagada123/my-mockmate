using UnityEngine;

public class AvatarMicroIdle : MonoBehaviour
{
    public Transform chest;
    public Transform head;

    public float breathingSpeed = 1.5f;
    public float breathingAmount = 0.01f;

    public float headMovementSpeed = 0.6f;
    public float headMovementAmount = 2f;

    Vector3 chestStart;
    Quaternion headStartRotation;

    void Start()
    {
        if (chest != null)
            chestStart = chest.localPosition;
        if (head != null)
            headStartRotation = head.localRotation;
    }

    // LateUpdate runs AFTER the Animator, so breathing and head
    // micro-movement layer on top of other animations.
    void LateUpdate()
    {
        // Breathing motion
        if (chest != null)
        {
            float breathe = Mathf.Sin(Time.time * breathingSpeed) * breathingAmount;
            chest.localPosition = chestStart + new Vector3(0, breathe, 0);
        }

        // Small head micro movement (applied on top of current head rotation)
        if (head != null)
        {
            float tilt = Mathf.Sin(Time.time * headMovementSpeed) * headMovementAmount;
            head.localRotation = headStartRotation * Quaternion.Euler(tilt, 0, 0);
        }
    }
}
