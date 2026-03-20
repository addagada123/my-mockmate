using System;
using System.Collections;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

[Serializable]
public class VrQuestion
{
    public int index;
    public string id;
    public string question;
    public string answer;
    public string topic;
    public string difficulty;
    public string type;
}

[Serializable]
public class VrNextResponse
{
    public bool success;
    public bool completed;
    public int current_question_index;
    public int total_questions;
    public VrQuestion current_question;
}

[Serializable]
public class VrSavedAnswer
{
    public int question_index;
    public string question;
    public string user_answer;
    public string correct_answer;
    public int score;
    public string feedback;
    public bool is_correct;
}

[Serializable]
public class VrAnswerResponse
{
    public bool success;
    public bool completed;
    public VrSavedAnswer saved_answer;
    public float running_percentage;
    public int next_question_index;
    public int total_questions;
    public VrQuestion next_question;
}

[Serializable]
public class VrCompleteResponse
{
    public bool success;
    public string mode;
    public int answered;
    public int total_questions;
    public int total_score;
    public int max_score;
    public float percentage;
}

[Serializable]
internal class VrAnswerRequest
{
    public int question_index;
    public string user_answer;
}

[Serializable]
internal class VrCompleteRequest
{
    public int time_spent;
}

public class MockmateVRApiClient : MonoBehaviour
{
    [Header("Backend")]
    [SerializeField] private string apiBase = "https://mockmate-api-gna1.onrender.com";
    [SerializeField] private string bridgeToken;

    public string ApiBase => apiBase;
    public string BridgeToken => bridgeToken;

    public void SetApiBase(string baseUrl)
    {
        apiBase = string.IsNullOrWhiteSpace(baseUrl) ? apiBase : baseUrl.TrimEnd('/');
    }

    public void SetBridgeToken(string token)
    {
        bridgeToken = token ?? string.Empty;
    }

    public IEnumerator FetchNextQuestion(Action<VrNextResponse, string> callback)
    {
        string url = $"{apiBase}/vr-bridge/next?bridge_token={UnityWebRequest.EscapeURL(bridgeToken)}";
        yield return SendGet(url, callback);
    }

    public IEnumerator SubmitAnswer(int questionIndex, string userAnswer, Action<VrAnswerResponse, string> callback)
    {
        string url = $"{apiBase}/vr-bridge/answer?bridge_token={UnityWebRequest.EscapeURL(bridgeToken)}";
        VrAnswerRequest body = new VrAnswerRequest
        {
            question_index = questionIndex,
            user_answer = userAnswer ?? string.Empty
        };
        yield return SendPost(url, body, callback);
    }

    public IEnumerator CompleteTest(int timeSpentSeconds, Action<VrCompleteResponse, string> callback)
    {
        string url = $"{apiBase}/vr-bridge/complete?bridge_token={UnityWebRequest.EscapeURL(bridgeToken)}";
        VrCompleteRequest body = new VrCompleteRequest
        {
            time_spent = Mathf.Max(0, timeSpentSeconds)
        };
        yield return SendPost(url, body, callback);
    }

    private IEnumerator SendGet<T>(string url, Action<T, string> callback)
    {
        using (UnityWebRequest req = UnityWebRequest.Get(url))
        {
            req.SetRequestHeader("Accept", "application/json");
            yield return req.SendWebRequest();

            if (req.result != UnityWebRequest.Result.Success)
            {
                callback?.Invoke(default, req.error);
                yield break;
            }

            string json = req.downloadHandler.text;
            T parsed;
            try
            {
                parsed = JsonUtility.FromJson<T>(json);
            }
            catch (Exception ex)
            {
                callback?.Invoke(default, $"JSON parse error: {ex.Message}");
                yield break;
            }
            callback?.Invoke(parsed, null);
        }
    }

    private IEnumerator SendPost<TReq, TRes>(string url, TReq payload, Action<TRes, string> callback)
    {
        string json = JsonUtility.ToJson(payload);
        byte[] bodyRaw = Encoding.UTF8.GetBytes(json);

        using (UnityWebRequest req = new UnityWebRequest(url, "POST"))
        {
            req.uploadHandler = new UploadHandlerRaw(bodyRaw);
            req.downloadHandler = new DownloadHandlerBuffer();
            req.SetRequestHeader("Content-Type", "application/json");
            req.SetRequestHeader("Accept", "application/json");
            yield return req.SendWebRequest();

            if (req.result != UnityWebRequest.Result.Success)
            {
                callback?.Invoke(default, req.error);
                yield break;
            }

            string responseJson = req.downloadHandler.text;
            TRes parsed;
            try
            {
                parsed = JsonUtility.FromJson<TRes>(responseJson);
            }
            catch (Exception ex)
            {
                callback?.Invoke(default, $"JSON parse error: {ex.Message}");
                yield break;
            }
            callback?.Invoke(parsed, null);
        }
    }
}
