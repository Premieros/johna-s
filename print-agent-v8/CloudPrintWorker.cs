using System.Text;
using System.Text.Json;

namespace PremierSmouhaFormPrintAgentV08;

internal sealed class AgentMetrics
{
    public long ClaimRpcCount { get; set; }
    public long ClaimedJobs { get; set; }
    public long PrintedJobs { get; set; }
    public long FailedJobs { get; set; }
    public long RealtimeWakeCount { get; set; }
    public bool RealtimeConnected { get; set; }
    public DateTime? LastClaimUtc { get; set; }
    public DateTime? LastPrintUtc { get; set; }

    public AgentMetrics Clone() => (AgentMetrics)MemberwiseClone();
}

internal static class PrintJournal
{
    private static readonly object Gate = new();
    private static readonly string Folder = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        BuildConfig.AppId);
    private static readonly string FilePath = Path.Combine(Folder, "printed-journal.json");
    private static Dictionary<string, DateTime> _entries = Load();

    internal static bool Contains(string jobId)
    {
        lock (Gate)
        {
            Prune();
            return _entries.ContainsKey(jobId);
        }
    }

    internal static void Mark(string jobId)
    {
        lock (Gate)
        {
            _entries[jobId] = DateTime.UtcNow;
            Prune();
            Save();
        }
    }

    private static Dictionary<string, DateTime> Load()
    {
        try
        {
            if (!File.Exists(FilePath))
                return new Dictionary<string, DateTime>(StringComparer.OrdinalIgnoreCase);
            return JsonSerializer.Deserialize<Dictionary<string, DateTime>>(
                       File.ReadAllText(FilePath, Encoding.UTF8))
                   ?? new Dictionary<string, DateTime>(StringComparer.OrdinalIgnoreCase);
        }
        catch
        {
            return new Dictionary<string, DateTime>(StringComparer.OrdinalIgnoreCase);
        }
    }

    private static void Prune()
    {
        var cutoff = DateTime.UtcNow.AddDays(-7);
        foreach (var key in _entries
                     .Where(x => x.Value < cutoff)
                     .Select(x => x.Key)
                     .ToList())
            _entries.Remove(key);

        if (_entries.Count <= 1000) return;
        foreach (var key in _entries
                     .OrderBy(x => x.Value)
                     .Take(_entries.Count - 1000)
                     .Select(x => x.Key)
                     .ToList())
            _entries.Remove(key);
    }

    private static void Save()
    {
        try
        {
            Directory.CreateDirectory(Folder);
            File.WriteAllText(
                FilePath,
                JsonSerializer.Serialize(
                    _entries,
                    new JsonSerializerOptions { WriteIndented = true }),
                Encoding.UTF8);
        }
        catch
        {
            // A failed journal write must be visible through status but must not
            // corrupt the remote queue state. Physical print still succeeds.
        }
    }
}

internal sealed class CloudPrintWorker : IDisposable
{
    private readonly SupabaseApi _api;
    private readonly EscPosPrinter _printer;
    private readonly SemaphoreSlim _wake = new(0, 1);
    private readonly object _metricsGate = new();

    private AgentConfig _config;
    private CancellationTokenSource? _cts;
    private Task? _loop;
    private AuthSession? _session;
    private DateTime _lastRefreshUtc = DateTime.MinValue;
    private RealtimeWakeClient? _realtime;
    private string _realtimeToken = "";
    private readonly AgentMetrics _metrics = new();

    internal event Action<string>? StatusChanged;
    internal event Action<AgentMetrics>? MetricsChanged;

    internal CloudPrintWorker(
        SupabaseApi api,
        EscPosPrinter printer,
        AgentConfig config)
    {
        _api = api;
        _printer = printer;
        _config = config;
    }

    internal void UpdateConfig(AgentConfig config)
    {
        _config = config;
        RestartRealtime();
        SignalWake();
    }

    internal void Start()
    {
        if (_loop is { IsCompleted: false }) return;
        _cts = new CancellationTokenSource();
        _loop = Task.Run(() => LoopAsync(_cts.Token));
    }

    internal void Stop()
    {
        try { _cts?.Cancel(); } catch { }
        try { _realtime?.Stop(); } catch { }
    }

    private async Task LoopAsync(CancellationToken token)
    {
        SetStatus("بدء V8...");
        while (!token.IsCancellationRequested)
        {
            try
            {
                if (!_config.QueueEnabled)
                {
                    SetStatus("وضع اختبار محلي — V8 لا يطالب طابور Production");
                    StopRealtimeOnly();
                    await Task.Delay(1500, token).ConfigureAwait(false);
                    continue;
                }

                await EnsureSessionAsync(token).ConfigureAwait(false);
                EnsureRealtime();
                await DrainQueueAsync(token).ConfigureAwait(false);

                var connected = _realtime?.Connected == true;
                var seconds = connected
                    ? Math.Clamp(_config.ReconcileSeconds, 60, 900)
                    : Math.Clamp(_config.DisconnectedPollSeconds, 5, 60);

                SetStatus(connected
                    ? $"متصل Realtime — reconciliation كل {seconds} ثانية"
                    : $"Fallback polling منخفض — كل {seconds} ثانية");

                await _wake.WaitAsync(
                        TimeSpan.FromSeconds(seconds),
                        token)
                    .ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                SetStatus("خطأ V8: " + ex.Message);
                try
                {
                    await Task.Delay(3000, token).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
            }
        }

        SetStatus("تم إيقاف V8");
    }

    private async Task EnsureSessionAsync(CancellationToken token)
    {
        if (_session is not null &&
            DateTime.UtcNow - _lastRefreshUtc < TimeSpan.FromMinutes(45))
            return;

        var refresh = ConfigStore.UnprotectToken(_config.ProtectedRefreshToken);
        if (string.IsNullOrWhiteSpace(refresh))
            throw new InvalidOperationException("DEVICE_LOGIN_REQUIRED");

        _session = await _api.RefreshAsync(
            refresh,
            _config.Email,
            token).ConfigureAwait(false);

        var kitchen = await _api.CanExecuteKindAsync(
            _session.AccessToken,
            "kitchen",
            token).ConfigureAwait(false);
        var receipt = await _api.CanExecuteKindAsync(
            _session.AccessToken,
            "receipt",
            token).ConfigureAwait(false);

        if (!kitchen || !receipt)
            throw new InvalidOperationException("DEVICE_PRINT_PERMISSIONS_MISSING");

        _config.ProtectedRefreshToken =
            ConfigStore.ProtectToken(_session.RefreshToken);
        ConfigStore.Save(_config);
        _lastRefreshUtc = DateTime.UtcNow;

        if (!string.Equals(
                _realtimeToken,
                _session.AccessToken,
                StringComparison.Ordinal))
            RestartRealtime();

        SetStatus("مصادقة V8 ناجحة — " + BuildConfig.BranchName);
    }

    private void EnsureRealtime()
    {
        if (!_config.UseRealtimeWake || _session is null)
        {
            StopRealtimeOnly();
            return;
        }

        if (_realtime is not null &&
            string.Equals(
                _realtimeToken,
                _session.AccessToken,
                StringComparison.Ordinal))
            return;

        RestartRealtime();
        _realtimeToken = _session.AccessToken;
        _realtime = new RealtimeWakeClient(
            _session.AccessToken,
            () =>
            {
                lock (_metricsGate)
                    _metrics.RealtimeWakeCount++;
                PublishMetrics();
                SignalWake();
            },
            (connected, status) =>
            {
                lock (_metricsGate)
                    _metrics.RealtimeConnected = connected;
                PublishMetrics();
                SetStatus(status);
            });
        _realtime.Start();
    }

    private void RestartRealtime()
    {
        StopRealtimeOnly();
        _realtimeToken = "";
    }

    private void StopRealtimeOnly()
    {
        try { _realtime?.Dispose(); } catch { }
        _realtime = null;
        lock (_metricsGate)
            _metrics.RealtimeConnected = false;
        PublishMetrics();
    }

    private async Task DrainQueueAsync(CancellationToken token)
    {
        if (_session is null) return;

        while (!token.IsCancellationRequested && _config.QueueEnabled)
        {
            List<CloudPrintJob> jobs;
            lock (_metricsGate)
            {
                _metrics.ClaimRpcCount++;
                _metrics.LastClaimUtc = DateTime.UtcNow;
            }
            PublishMetrics();

            jobs = await _api.ClaimAsync(
                _session.AccessToken,
                _config.AgentId,
                token).ConfigureAwait(false);

            if (jobs.Count == 0) return;

            lock (_metricsGate)
                _metrics.ClaimedJobs += jobs.Count;
            PublishMetrics();

            foreach (var job in jobs)
            {
                if (token.IsCancellationRequested) return;
                await ExecuteJobAsync(job, token).ConfigureAwait(false);
            }
        }
    }

    private async Task ExecuteJobAsync(
        CloudPrintJob job,
        CancellationToken token)
    {
        if (_session is null) return;

        var printerName = ResolvePrinter(job.StationCode);
        if (string.IsNullOrWhiteSpace(printerName))
        {
            await _api.CompleteAsync(
                _session.AccessToken,
                job.Id,
                _config.AgentId,
                false,
                "PRINTER_ROUTE_MISSING:" + job.StationCode,
                token).ConfigureAwait(false);
            CountFailure();
            return;
        }

        if (!await _api.StartAsync(
                _session.AccessToken,
                job.Id,
                _config.AgentId,
                token).ConfigureAwait(false))
            return;

        try
        {
            if (!PrintJournal.Contains(job.Id))
            {
                var width = ReadPayloadInt(job.Payload, "paperWidthMm", 80);
                var copies = Math.Clamp(
                    ReadPayloadInt(job.Payload, "copies", 1),
                    1,
                    5);

                SetStatus(
                    $"طباعة فورمة {job.Kind} — {job.StationCode} — {printerName}");

                for (var copy = 0; copy < copies; copy++)
                {
                    if (FixedTemplateRenderer.TryGetTemplate(
                            job.Payload,
                            out var template))
                    {
                        await _printer.PrintTemplateAsync(
                            printerName,
                            template,
                            width).ConfigureAwait(false);
                    }
                    else
                    {
                        var text = ReadPayloadText(job.Payload);
                        if (string.IsNullOrWhiteSpace(text))
                            throw new InvalidOperationException("PRINT_TEMPLATE_AND_TEXT_MISSING");

                        await _printer.PrintTextAsync(
                            printerName,
                            text,
                            width).ConfigureAwait(false);
                    }
                }

                // Persist locally BEFORE remote acknowledgement. If the network
                // dies after Windows accepted the RAW job, a later reclaim only
                // retries the callback and does not physically print again.
                PrintJournal.Mark(job.Id);
            }

            await _api.CompleteAsync(
                _session.AccessToken,
                job.Id,
                _config.AgentId,
                true,
                null,
                token).ConfigureAwait(false);

            lock (_metricsGate)
            {
                _metrics.PrintedJobs++;
                _metrics.LastPrintUtc = DateTime.UtcNow;
            }
            PublishMetrics();
        }
        catch (Exception ex)
        {
            try
            {
                await _api.CompleteAsync(
                    _session.AccessToken,
                    job.Id,
                    _config.AgentId,
                    false,
                    ex.Message,
                    token).ConfigureAwait(false);
            }
            catch
            {
                // The local journal prevents a duplicate physical print if this
                // callback failed after the spooler already accepted the job.
            }

            CountFailure();

            // Current queue retry backoff tops out at 30 seconds. Wake once
            // locally instead of switching back to high-frequency polling.
            _ = Task.Run(async () =>
            {
                try
                {
                    await Task.Delay(TimeSpan.FromSeconds(35)).ConfigureAwait(false);
                    SignalWake();
                }
                catch { }
            });
        }
    }

    private void CountFailure()
    {
        lock (_metricsGate)
            _metrics.FailedJobs++;
        PublishMetrics();
    }

    private string ResolvePrinter(string station)
    {
        station = (station ?? "").Trim();

        if (_config.Routes.TryGetValue(station, out var direct) &&
            !string.IsNullOrWhiteSpace(direct))
            return direct;

        if (station.Equals("cashier", StringComparison.OrdinalIgnoreCase) ||
            station.Equals("receipt", StringComparison.OrdinalIgnoreCase))
        {
            foreach (var alias in new[] { "كاش", "cashier", "receipt" })
                if (_config.Routes.TryGetValue(alias, out var cashier) &&
                    !string.IsNullOrWhiteSpace(cashier))
                    return cashier;
        }

        if (station.Equals("main", StringComparison.OrdinalIgnoreCase) ||
            station.Equals("kit", StringComparison.OrdinalIgnoreCase))
        {
            foreach (var alias in new[] { "kit", "main", "مطبخ" })
                if (_config.Routes.TryGetValue(alias, out var kitchen) &&
                    !string.IsNullOrWhiteSpace(kitchen))
                    return kitchen;
        }

        return "";
    }

    private static string ReadPayloadText(JsonElement payload)
    {
        if (payload.ValueKind != JsonValueKind.Object ||
            !payload.TryGetProperty("text", out var text) ||
            text.ValueKind != JsonValueKind.String)
            return "";
        return text.GetString() ?? "";
    }

    private static int ReadPayloadInt(
        JsonElement payload,
        string name,
        int fallback)
    {
        if (payload.ValueKind != JsonValueKind.Object ||
            !payload.TryGetProperty(name, out var value))
            return fallback;

        if (value.ValueKind == JsonValueKind.Number &&
            value.TryGetInt32(out var number))
            return number;

        if (value.ValueKind == JsonValueKind.String &&
            int.TryParse(value.GetString(), out number))
            return number;

        return fallback;
    }

    private void SignalWake()
    {
        try
        {
            if (_wake.CurrentCount == 0)
                _wake.Release();
        }
        catch { }
    }

    private void SetStatus(string value)
    {
        try { StatusChanged?.Invoke(value); } catch { }
    }

    private void PublishMetrics()
    {
        AgentMetrics snapshot;
        lock (_metricsGate)
            snapshot = _metrics.Clone();
        try { MetricsChanged?.Invoke(snapshot); } catch { }
    }

    public void Dispose()
    {
        Stop();
        try { _loop?.Wait(1000); } catch { }
        try { _realtime?.Dispose(); } catch { }
        _cts?.Dispose();
        _wake.Dispose();
    }
}
