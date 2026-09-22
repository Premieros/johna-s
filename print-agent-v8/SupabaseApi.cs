using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace PremierSmouhaFormPrintAgentV08;

internal sealed class AuthSession
{
    public string AccessToken { get; init; } = "";
    public string RefreshToken { get; init; } = "";
    public string Email { get; init; } = "";
}

internal sealed class CloudPrintJob
{
    public string Id { get; init; } = "";
    public string Kind { get; init; } = "";
    public string StationCode { get; init; } = "";
    public JsonElement Payload { get; init; }
    public int Attempts { get; init; }
}

internal sealed class SupabaseApi : IDisposable
{
    private readonly HttpClient _http = new()
    {
        Timeout = TimeSpan.FromSeconds(15)
    };

    internal async Task<AuthSession> SignInAsync(
        string email,
        string password,
        CancellationToken cancellationToken)
    {
        var body = JsonSerializer.Serialize(new { email, password });
        using var request = CreateRequest(
            HttpMethod.Post,
            "/auth/v1/token?grant_type=password",
            null,
            body);
        using var response = await _http.SendAsync(request, cancellationToken)
            .ConfigureAwait(false);
        var json = await response.Content.ReadAsStringAsync(cancellationToken)
            .ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException("LOGIN_FAILED:" + ExtractError(json));
        return ParseAuth(json, email);
    }

    internal async Task<AuthSession> RefreshAsync(
        string refreshToken,
        string email,
        CancellationToken cancellationToken)
    {
        var body = JsonSerializer.Serialize(new { refresh_token = refreshToken });
        using var request = CreateRequest(
            HttpMethod.Post,
            "/auth/v1/token?grant_type=refresh_token",
            null,
            body);
        using var response = await _http.SendAsync(request, cancellationToken)
            .ConfigureAwait(false);
        var json = await response.Content.ReadAsStringAsync(cancellationToken)
            .ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException("REFRESH_FAILED:" + ExtractError(json));
        return ParseAuth(json, email);
    }

    internal async Task<bool> CanExecuteKindAsync(
        string accessToken,
        string kind,
        CancellationToken cancellationToken)
    {
        using var doc = await RpcAsync(
            "can_execute_cloud_print_kind",
            accessToken,
            new { p_kind = kind },
            cancellationToken).ConfigureAwait(false);
        return doc.RootElement.ValueKind == JsonValueKind.True;
    }

    internal async Task<List<CloudPrintJob>> ClaimAsync(
        string accessToken,
        string agentId,
        CancellationToken cancellationToken)
    {
        using var doc = await RpcAsync(
            "claim_cloud_print_jobs",
            accessToken,
            new
            {
                p_branch_id = BuildConfig.BranchId,
                p_agent_id = agentId,
                p_limit = BuildConfig.ClaimBatchSize
            },
            cancellationToken).ConfigureAwait(false);

        var root = doc.RootElement;
        if (!root.TryGetProperty("success", out var success) || !success.GetBoolean())
            throw new InvalidOperationException(
                "CLAIM_FAILED:" + ReadProperty(root, "error"));

        var result = new List<CloudPrintJob>();
        if (!root.TryGetProperty("jobs", out var jobs) ||
            jobs.ValueKind != JsonValueKind.Array)
            return result;

        foreach (var job in jobs.EnumerateArray())
        {
            result.Add(new CloudPrintJob
            {
                Id = ReadProperty(job, "id"),
                Kind = ReadProperty(job, "kind"),
                StationCode = ReadProperty(job, "station_code"),
                Attempts = ReadInt(job, "attempts", 0),
                Payload = job.TryGetProperty("payload", out var payload)
                    ? payload.Clone()
                    : default
            });
        }

        return result;
    }

    internal async Task<bool> StartAsync(
        string accessToken,
        string jobId,
        string agentId,
        CancellationToken cancellationToken)
    {
        using var doc = await RpcAsync(
            "start_cloud_print_job",
            accessToken,
            new { p_job_id = jobId, p_agent_id = agentId },
            cancellationToken).ConfigureAwait(false);
        var root = doc.RootElement;
        return root.TryGetProperty("success", out var success) && success.GetBoolean();
    }

    internal async Task CompleteAsync(
        string accessToken,
        string jobId,
        string agentId,
        bool success,
        string? error,
        CancellationToken cancellationToken)
    {
        using var doc = await RpcAsync(
            "complete_cloud_print_job",
            accessToken,
            new
            {
                p_job_id = jobId,
                p_agent_id = agentId,
                p_success = success,
                p_error = string.IsNullOrWhiteSpace(error) ? null : error
            },
            cancellationToken).ConfigureAwait(false);
        var root = doc.RootElement;
        if (!root.TryGetProperty("success", out var ok) || !ok.GetBoolean())
            throw new InvalidOperationException(
                "COMPLETE_FAILED:" + ReadProperty(root, "error"));
    }

    private async Task<JsonDocument> RpcAsync(
        string name,
        string accessToken,
        object payload,
        CancellationToken cancellationToken)
    {
        var body = JsonSerializer.Serialize(payload);
        using var request = CreateRequest(
            HttpMethod.Post,
            "/rest/v1/rpc/" + name,
            accessToken,
            body);
        using var response = await _http.SendAsync(request, cancellationToken)
            .ConfigureAwait(false);
        var json = await response.Content.ReadAsStringAsync(cancellationToken)
            .ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException(
                "RPC_" + name.ToUpperInvariant() + "_FAILED:" + ExtractError(json));
        return JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "null" : json);
    }

    private static HttpRequestMessage CreateRequest(
        HttpMethod method,
        string path,
        string? accessToken,
        string body)
    {
        var request = new HttpRequestMessage(
            method,
            BuildConfig.SupabaseUrl.TrimEnd('/') + path);
        request.Headers.TryAddWithoutValidation("apikey", BuildConfig.PublishableKey);
        if (!string.IsNullOrWhiteSpace(accessToken))
            request.Headers.Authorization =
                new AuthenticationHeaderValue("Bearer", accessToken);
        request.Content = new StringContent(
            body ?? "{}",
            Encoding.UTF8,
            "application/json");
        return request;
    }

    private static AuthSession ParseAuth(string json, string fallbackEmail)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        var access = ReadProperty(root, "access_token");
        var refresh = ReadProperty(root, "refresh_token");
        if (string.IsNullOrWhiteSpace(access) ||
            string.IsNullOrWhiteSpace(refresh))
            throw new InvalidOperationException("AUTH_TOKEN_MISSING");

        return new AuthSession
        {
            AccessToken = access,
            RefreshToken = refresh,
            Email = fallbackEmail ?? ""
        };
    }

    private static string ExtractError(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            foreach (var key in new[] { "msg", "message", "error_description", "error" })
            {
                var value = ReadProperty(root, key);
                if (!string.IsNullOrWhiteSpace(value)) return value;
            }
            return "UNKNOWN";
        }
        catch
        {
            return "UNKNOWN";
        }
    }

    internal static string ReadProperty(JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.Object ||
            !element.TryGetProperty(name, out var value))
            return "";
        return value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? ""
            : value.ToString();
    }

    internal static int ReadInt(JsonElement element, string name, int fallback)
    {
        if (element.ValueKind != JsonValueKind.Object ||
            !element.TryGetProperty(name, out var value))
            return fallback;
        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number))
            return number;
        if (value.ValueKind == JsonValueKind.String &&
            int.TryParse(value.GetString(), out number))
            return number;
        return fallback;
    }

    public void Dispose() => _http.Dispose();
}
