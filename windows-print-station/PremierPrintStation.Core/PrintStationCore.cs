using System.Collections.Concurrent;
using System.Drawing;
using System.Drawing.Printing;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace PremierPrintStation.Core;

public sealed class PrintStationConfig
{
    public string SupabaseUrl { get; set; } = "https://azzdesuowpdcoflmyezn.supabase.co";
    public string AnonKey { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string AgentId { get; set; } = Guid.NewGuid().ToString();
    public int PollIntervalSeconds { get; set; } = 3;
    public Dictionary<string, string> StationPrinters { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}

public static class StationPaths
{
    public static readonly string Root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Premier", "PrintStation");
    public static readonly string ConfigFile = Path.Combine(Root, "config.json");
    public static readonly string AuthFile = Path.Combine(Root, "auth.bin");
    public static readonly string QueueFile = Path.Combine(Root, "queue.db");
    public static readonly string HeartbeatFile = Path.Combine(Root, "heartbeat.json");
    public static void Ensure() => Directory.CreateDirectory(Root);
}

public sealed class ConfigStore
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true, PropertyNameCaseInsensitive = true };
    public PrintStationConfig Load()
    {
        StationPaths.Ensure();
        if (!File.Exists(StationPaths.ConfigFile))
        {
            var fresh = new PrintStationConfig();
            Save(fresh);
            return fresh;
        }
        return JsonSerializer.Deserialize<PrintStationConfig>(File.ReadAllText(StationPaths.ConfigFile), JsonOptions) ?? new PrintStationConfig();
    }
    public void Save(PrintStationConfig config)
    {
        StationPaths.Ensure();
        if (string.IsNullOrWhiteSpace(config.AgentId)) config.AgentId = Guid.NewGuid().ToString();
        File.WriteAllText(StationPaths.ConfigFile, JsonSerializer.Serialize(config, JsonOptions));
    }
}

public sealed class AuthTokenStore
{
    public void SaveRefreshToken(string refreshToken)
    {
        StationPaths.Ensure();
        var protectedBytes = ProtectedData.Protect(Encoding.UTF8.GetBytes(refreshToken), null, DataProtectionScope.LocalMachine);
        File.WriteAllBytes(StationPaths.AuthFile, protectedBytes);
    }
    public string? LoadRefreshToken()
    {
        if (!File.Exists(StationPaths.AuthFile)) return null;
        try
        {
            var plain = ProtectedData.Unprotect(File.ReadAllBytes(StationPaths.AuthFile), null, DataProtectionScope.LocalMachine);
            return Encoding.UTF8.GetString(plain);
        }
        catch { return null; }
    }
    public void Clear() { if (File.Exists(StationPaths.AuthFile)) File.Delete(StationPaths.AuthFile); }
}

public sealed record CloudPrintPayload(string? text, string? html, int? paperWidthMm, int? copies);
public sealed record CloudPrintJob(string id, string branch_id, string kind, string station_code, CloudPrintPayload payload, int attempts, string created_at);
public sealed record AuthResult(bool Success, string? Error = null);

public sealed class SupabaseQueueClient
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(15) };
    private readonly AuthTokenStore _tokenStore;
    private string? _accessToken;
    private DateTimeOffset _accessExpiresAt = DateTimeOffset.MinValue;

    public SupabaseQueueClient(AuthTokenStore tokenStore) => _tokenStore = tokenStore;

    public async Task<AuthResult> SignInAsync(PrintStationConfig cfg, string email, string password, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(cfg.SupabaseUrl) || string.IsNullOrWhiteSpace(cfg.AnonKey)) return new(false, "Supabase URL / anon key missing");
        using var req = NewRequest(cfg, HttpMethod.Post, "/auth/v1/token?grant_type=password", bearer: null);
        req.Content = JsonContent.Create(new { email, password });
        using var res = await _http.SendAsync(req, ct);
        var raw = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode) return new(false, ParseError(raw));
        using var doc = JsonDocument.Parse(raw);
        var root = doc.RootElement;
        var access = root.GetProperty("access_token").GetString();
        var refresh = root.GetProperty("refresh_token").GetString();
        if (string.IsNullOrWhiteSpace(access) || string.IsNullOrWhiteSpace(refresh)) return new(false, "Supabase did not return a session");
        _tokenStore.SaveRefreshToken(refresh);
        _accessToken = access;
        _accessExpiresAt = DateTimeOffset.UtcNow.AddMinutes(45);
        return new(true);
    }

    public async Task<string> GetAccessTokenAsync(PrintStationConfig cfg, CancellationToken ct = default)
    {
        if (!string.IsNullOrWhiteSpace(_accessToken) && _accessExpiresAt > DateTimeOffset.UtcNow.AddMinutes(2)) return _accessToken;
        var refresh = _tokenStore.LoadRefreshToken();
        if (string.IsNullOrWhiteSpace(refresh)) throw new InvalidOperationException("Station is not signed in");
        using var req = NewRequest(cfg, HttpMethod.Post, "/auth/v1/token?grant_type=refresh_token", bearer: null);
        req.Content = JsonContent.Create(new { refresh_token = refresh });
        using var res = await _http.SendAsync(req, ct);
        var raw = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException(ParseError(raw));
        using var doc = JsonDocument.Parse(raw);
        _accessToken = doc.RootElement.GetProperty("access_token").GetString() ?? throw new InvalidOperationException("Missing access token");
        var rotated = doc.RootElement.TryGetProperty("refresh_token", out var rt) ? rt.GetString() : null;
        if (!string.IsNullOrWhiteSpace(rotated)) _tokenStore.SaveRefreshToken(rotated);
        var expires = doc.RootElement.TryGetProperty("expires_in", out var exp) ? exp.GetInt32() : 3600;
        _accessExpiresAt = DateTimeOffset.UtcNow.AddSeconds(Math.Max(300, expires - 60));
        return _accessToken;
    }

    public async Task<IReadOnlyList<CloudPrintJob>> ClaimAsync(PrintStationConfig cfg, int limit = 12, CancellationToken ct = default)
    {
        var token = await GetAccessTokenAsync(cfg, ct);
        var root = await RpcAsync(cfg, token, "claim_cloud_print_jobs", new { p_branch_id = cfg.BranchId, p_agent_id = cfg.AgentId, p_limit = limit }, ct);
        if (!root.TryGetProperty("success", out var ok) || !ok.GetBoolean()) throw new InvalidOperationException(ReadRpcError(root));
        if (!root.TryGetProperty("jobs", out var jobs) || jobs.ValueKind != JsonValueKind.Array) return [];
        return JsonSerializer.Deserialize<List<CloudPrintJob>>(jobs.GetRawText(), new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? [];
    }

    public async Task<bool> StartAsync(PrintStationConfig cfg, string jobId, CancellationToken ct = default)
    {
        var token = await GetAccessTokenAsync(cfg, ct);
        var root = await RpcAsync(cfg, token, "start_cloud_print_job", new { p_job_id = jobId, p_agent_id = cfg.AgentId }, ct);
        return root.TryGetProperty("success", out var ok) && ok.GetBoolean();
    }

    public async Task<bool> CompleteAsync(PrintStationConfig cfg, string jobId, bool success, string? error, CancellationToken ct = default)
    {
        var token = await GetAccessTokenAsync(cfg, ct);
        var root = await RpcAsync(cfg, token, "complete_cloud_print_job", new { p_job_id = jobId, p_agent_id = cfg.AgentId, p_success = success, p_error = error }, ct);
        return root.TryGetProperty("success", out var ok) && ok.GetBoolean();
    }

    private async Task<JsonElement> RpcAsync(PrintStationConfig cfg, string token, string name, object payload, CancellationToken ct)
    {
        using var req = NewRequest(cfg, HttpMethod.Post, $"/rest/v1/rpc/{name}", token);
        req.Content = JsonContent.Create(payload);
        using var res = await _http.SendAsync(req, ct);
        var raw = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException(ParseError(raw));
        return JsonDocument.Parse(raw).RootElement.Clone();
    }

    private static HttpRequestMessage NewRequest(PrintStationConfig cfg, HttpMethod method, string relative, string? bearer)
    {
        var req = new HttpRequestMessage(method, cfg.SupabaseUrl.TrimEnd('/') + relative);
        req.Headers.TryAddWithoutValidation("apikey", cfg.AnonKey);
        if (!string.IsNullOrWhiteSpace(bearer)) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        return req;
    }
    private static string ParseError(string raw)
    {
        try
        {
            using var doc = JsonDocument.Parse(raw);
            foreach (var key in new[] { "msg", "message", "error_description", "error" }) if (doc.RootElement.TryGetProperty(key, out var v)) return v.ToString();
        }
        catch { }
        return raw.Length > 300 ? raw[..300] : raw;
    }
    private static string ReadRpcError(JsonElement root)
    {
        foreach (var key in new[] { "detail", "error" }) if (root.TryGetProperty(key, out var v)) return v.ToString();
        return "RPC failed";
    }
}

public static class JobStates
{
    public const string Received = "received";
    public const string Printing = "printing";
    public const string PrintedPendingAck = "printed_pending_ack";
    public const string Completed = "completed";
    public const string Failed = "failed";
    public const string NeedsReview = "needs_review";
}

public sealed record LocalPrintJob(string Id, string Kind, string StationCode, string PayloadJson, string State, int Attempts, string? LastError, DateTime CreatedAt, DateTime UpdatedAt)
{
    public CloudPrintPayload Payload => JsonSerializer.Deserialize<CloudPrintPayload>(PayloadJson, new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new(null, null, 80, 1);
}

public sealed class LocalQueueDb
{
    private readonly string _cs;
    public LocalQueueDb(string? path = null)
    {
        StationPaths.Ensure();
        _cs = new SqliteConnectionStringBuilder { DataSource = path ?? StationPaths.QueueFile }.ToString();
        Initialize();
    }
    private void Initialize()
    {
        using var c = new SqliteConnection(_cs); c.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = """
        CREATE TABLE IF NOT EXISTS jobs(
          id TEXT PRIMARY KEY, kind TEXT NOT NULL, station_code TEXT NOT NULL, payload_json TEXT NOT NULL,
          state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT NULL,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_jobs_state_created ON jobs(state, created_at);
        """;
        cmd.ExecuteNonQuery();
    }
    public void UpsertClaimed(IEnumerable<CloudPrintJob> jobs)
    {
        using var c = new SqliteConnection(_cs); c.Open();
        using var tx = c.BeginTransaction();
        foreach (var job in jobs)
        {
            using var cmd = c.CreateCommand(); cmd.Transaction = tx;
            cmd.CommandText = """
            INSERT INTO jobs(id,kind,station_code,payload_json,state,attempts,created_at,updated_at)
            VALUES($id,$kind,$station,$payload,$state,$attempts,$created,$updated)
            ON CONFLICT(id) DO UPDATE SET
              kind=excluded.kind,
              station_code=excluded.station_code,
              payload_json=excluded.payload_json,
              attempts=MAX(jobs.attempts, excluded.attempts),
              state=CASE
                WHEN jobs.state IN ('completed','printed_pending_ack','printing','needs_review') THEN jobs.state
                ELSE 'received'
              END,
              last_error=CASE
                WHEN jobs.state IN ('completed','printed_pending_ack','printing','needs_review') THEN jobs.last_error
                ELSE NULL
              END,
              updated_at=excluded.updated_at;
            """;
            cmd.Parameters.AddWithValue("$id", job.id); cmd.Parameters.AddWithValue("$kind", job.kind); cmd.Parameters.AddWithValue("$station", job.station_code);
            cmd.Parameters.AddWithValue("$payload", JsonSerializer.Serialize(job.payload)); cmd.Parameters.AddWithValue("$state", JobStates.Received); cmd.Parameters.AddWithValue("$attempts", job.attempts);
            cmd.Parameters.AddWithValue("$created", job.created_at); cmd.Parameters.AddWithValue("$updated", DateTime.UtcNow.ToString("O")); cmd.ExecuteNonQuery();
        }
        tx.Commit();
    }
    public int RecoverInterruptedPrints()
    {
        using var c = new SqliteConnection(_cs); c.Open(); using var cmd = c.CreateCommand();
        cmd.CommandText = """
        UPDATE jobs
        SET state='needs_review',
            last_error=COALESCE(last_error,'Print Station service restarted during print; physical outcome is unknown'),
            updated_at=$updated
        WHERE state='printing';
        """;
        cmd.Parameters.AddWithValue("$updated", DateTime.UtcNow.ToString("O"));
        return cmd.ExecuteNonQuery();
    }

    public List<LocalPrintJob> GetRunnable(int limit = 25) => Query("state IN ('received','printed_pending_ack')", limit);
    public List<LocalPrintJob> GetRecent(int limit = 200) => Query("1=1", limit);
    private List<LocalPrintJob> Query(string where, int limit)
    {
        var list = new List<LocalPrintJob>(); using var c = new SqliteConnection(_cs); c.Open(); using var cmd = c.CreateCommand();
        cmd.CommandText = $"SELECT id,kind,station_code,payload_json,state,attempts,last_error,created_at,updated_at FROM jobs WHERE {where} ORDER BY created_at ASC LIMIT $limit";
        cmd.Parameters.AddWithValue("$limit", limit);
        using var r = cmd.ExecuteReader();
        while (r.Read()) list.Add(new(r.GetString(0), r.GetString(1), r.GetString(2), r.GetString(3), r.GetString(4), r.GetInt32(5), r.IsDBNull(6)?null:r.GetString(6), DateTime.Parse(r.GetString(7)), DateTime.Parse(r.GetString(8))));
        return list;
    }
    public void SetState(string id, string state, string? error = null, bool incrementAttempt = false)
    {
        using var c = new SqliteConnection(_cs); c.Open(); using var cmd = c.CreateCommand();
        cmd.CommandText = "UPDATE jobs SET state=$state,last_error=$error,attempts=attempts+$inc,updated_at=$updated WHERE id=$id";
        cmd.Parameters.AddWithValue("$state", state); cmd.Parameters.AddWithValue("$error", (object?)error ?? DBNull.Value); cmd.Parameters.AddWithValue("$inc", incrementAttempt?1:0); cmd.Parameters.AddWithValue("$updated", DateTime.UtcNow.ToString("O")); cmd.Parameters.AddWithValue("$id", id); cmd.ExecuteNonQuery();
    }
    public void ApproveCloudRetry(string id) => SetState(id, JobStates.Failed, "Manual retry approved; waiting for a fresh cloud claim", false);
}

public sealed record PrintDispatchResult(bool Accepted, string? Error = null);

public sealed class WindowsPrinterDispatcher
{
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _locks = new(StringComparer.OrdinalIgnoreCase);
    public IReadOnlyList<string> InstalledPrinters() => PrinterSettings.InstalledPrinters.Cast<string>().OrderBy(x => x).ToList();

    public async Task<PrintDispatchResult> PrintAsync(string printerName, CloudPrintPayload payload, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(printerName)) return new(false, "No printer is mapped for this station");
        if (!PrinterSettings.InstalledPrinters.Cast<string>().Any(x => string.Equals(x, printerName, StringComparison.OrdinalIgnoreCase))) return new(false, $"Printer not installed: {printerName}");
        var gate = _locks.GetOrAdd(printerName, _ => new SemaphoreSlim(1,1));
        await gate.WaitAsync(ct);
        try
        {
            var text = payload.text;
            if (string.IsNullOrWhiteSpace(text) && !string.IsNullOrWhiteSpace(payload.html)) text = HtmlToText(payload.html!);
            if (string.IsNullOrWhiteSpace(text)) return new(false, "Print payload is empty");
            var copies = Math.Clamp(payload.copies ?? 1, 1, 5);
            for (var i=0; i<copies; i++) PrintDocumentOnce(printerName, text!);
            await Task.Delay(120, ct);
            return new(true);
        }
        catch (Exception ex) { return new(false, ex.Message); }
        finally { gate.Release(); }
    }

    private static void PrintDocumentOnce(string printerName, string text)
    {
        using var doc = new PrintDocument();
        doc.PrintController = new StandardPrintController();
        doc.PrinterSettings.PrinterName = printerName;
        if (!doc.PrinterSettings.IsValid) throw new InvalidOperationException($"Printer is not valid: {printerName}");
        doc.DefaultPageSettings.Margins = new Margins(0,0,0,0);
        var remaining = text;
        doc.PrintPage += (_, e) =>
        {
            using var font = new Font("Tahoma", 9f, FontStyle.Regular, GraphicsUnit.Point);
            var rect = new RectangleF(3, 3, Math.Max(100, e.MarginBounds.Width - 6), Math.Max(100, e.MarginBounds.Height - 6));
            using var format = new StringFormat(StringFormatFlags.DirectionRightToLeft) { Alignment = StringAlignment.Far, LineAlignment = StringAlignment.Near };
            var chars = 0; var lines = 0;
            e.Graphics.MeasureString(remaining, font, rect.Size, format, out chars, out lines);
            e.Graphics.DrawString(remaining[..Math.Max(0, Math.Min(chars, remaining.Length))], font, Brushes.Black, rect, format);
            remaining = chars >= remaining.Length ? "" : remaining[chars..];
            e.HasMorePages = remaining.Length > 0;
        };
        doc.Print();
    }

    private static string HtmlToText(string html)
    {
        var noTags = System.Text.RegularExpressions.Regex.Replace(html, "<[^>]+>", " ");
        return System.Net.WebUtility.HtmlDecode(System.Text.RegularExpressions.Regex.Replace(noTags, "\\s+", " ")).Trim();
    }
}

public sealed record Heartbeat(string Status, string? Error, DateTimeOffset UpdatedAt, int Pending, int NeedsReview);
public static class HeartbeatStore
{
    public static void Write(Heartbeat hb)
    {
        StationPaths.Ensure();
        File.WriteAllText(StationPaths.HeartbeatFile, JsonSerializer.Serialize(hb));
    }
    public static Heartbeat? Read()
    {
        try { return File.Exists(StationPaths.HeartbeatFile) ? JsonSerializer.Deserialize<Heartbeat>(File.ReadAllText(StationPaths.HeartbeatFile)) : null; }
        catch { return null; }
    }
}
