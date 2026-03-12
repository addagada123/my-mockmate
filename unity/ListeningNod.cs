using UnityEngine;

public class ListeningNod : MonoBehaviour
{
    public Transform head;
    public float speed = 1.5f;
    public float amount = 4f;

    private bool nodding = false;
    private Quaternion originalRotation;

    void Start()
    {
        if (head != null)
            originalRotation = head.localRotation;
    }

    public void StartNod()
    {
        nodding = true;

        if (head != null)
            originalRotation = head.localRotation;
    }

    public void StopNod()
    {
        nodding = false;

        if (head != null)
            head.localRotation = originalRotation;
    }

    // LateUpdate runs AFTER the Animator, so nod rotation
    // is applied ON TOP of typing animation — both work together.
    void LateUpdate()
    {
        if (!nodding || head == null)
            return;

        float angle = Mathf.Sin(Time.time * speed) * amount;

        Quaternion nodRotation =
            Quaternion.Euler(angle, 0, 0);

        head.localRotation = head.localRotation * nodRotation;
    }
}
