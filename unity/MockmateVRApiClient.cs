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
    [SerializeField] private string apiBase = "https://mockmate-api-production.up.railway.app";
    [SerializeField] private string bridgeToken;

    public string ApiBase => apiBase;
    public string BridgeToken => bridgeToken;

    private void Awake()
    {
        apiBase = SanitizeApiBase(apiBase);
        bridgeToken = (bridgeToken ?? string.Empty).Trim();
    }

    public void SetApiBase(string baseUrl)
    {
        if (!string.IsNullOrWhiteSpace(baseUrl))
            apiBase = SanitizeApiBase(baseUrl);
    }

    public void SetBridgeToken(string token)
    {
        bridgeToken = (token ?? string.Empty).Trim();
    }

    public IEnumerator FetchNextQuestion(Action<VrNextResponse, string> callback)
    {
        if (!TryBuildBridgeUrl("/vr-bridge/next", out string url, out string error))
        {
            callback?.Invoke(default, error);
            yield break;
        }
        yield return SendGet(url, callback);
    }

    public IEnumerator SubmitAnswer(int questionIndex, string userAnswer, Action<VrAnswerResponse, string> callback)
    {
        if (!TryBuildBridgeUrl("/vr-bridge/answer", out string url, out string error))
        {
            callback?.Invoke(default, error);
            yield break;
        }
        VrAnswerRequest body = new VrAnswerRequest
        {
            question_index = questionIndex,
            user_answer = userAnswer ?? string.Empty
        };
        yield return SendPost(url, body, callback);
    }

    public IEnumerator CompleteTest(int timeSpentSeconds, Action<VrCompleteResponse, string> callback)
    {
        if (!TryBuildBridgeUrl("/vr-bridge/complete", out string url, out string error))
        {
            callback?.Invoke(default, error);
            yield break;
        }
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
                callback?.Invoke(default, FormatRequestError(req));
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
                callback?.Invoke(default, FormatRequestError(req));
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

    private bool TryBuildBridgeUrl(string route, out string url, out string error)
    {
        url = null;
        error = null;

        if (string.IsNullOrWhiteSpace(apiBase))
        {
            error = "API base URL is missing";
            return false;
        }

        if (string.IsNullOrWhiteSpace(bridgeToken))
        {
            error = "Bridge token is required";
            return false;
        }

        url = $"{SanitizeApiBase(apiBase)}{route}?bridge_token={UnityWebRequest.EscapeURL(bridgeToken)}";
        return true;
    }

    private string SanitizeApiBase(string baseUrl)
    {
        return string.IsNullOrWhiteSpace(baseUrl) ? string.Empty : baseUrl.Trim().TrimEnd('/');
    }

    private string FormatRequestError(UnityWebRequest req)
    {
        string detail = TryExtractErrorDetail(req.downloadHandler?.text);
        long statusCode = req.responseCode;
        if (!string.IsNullOrWhiteSpace(detail))
            return $"HTTP {statusCode}: {detail}";
        if (statusCode > 0)
            return $"HTTP {statusCode}: {req.error}";
        return req.error;
    }

    private string TryExtractErrorDetail(string json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return null;

        try
        {
            VrErrorResponse parsed = JsonUtility.FromJson<VrErrorResponse>(json);
            if (!string.IsNullOrWhiteSpace(parsed?.detail))
                return parsed.detail;
        }
        catch
        {
            // Ignore parse failures and fall back to the raw body.
        }

        return json.Trim();
    }

    [Serializable]
    private class VrErrorResponse
    {
        public string detail;
    }
}
