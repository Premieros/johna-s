using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using PremierPrintStation.Core;

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddWindowsService(options => options.ServiceName = "Premier Print Station");
builder.Services.AddSingleton<ConfigStore>();
builder.Services.AddSingleton<AuthTokenStore>();
builder.Services.AddSingleton<SupabaseQueueClient>();
builder.Services.AddSingleton<LocalQueueDb>();
builder.Services.AddSingleton<WindowsPrinterDispatcher>();
builder.Services.AddHostedService<PrintStationWorker>();
await builder.Build().RunAsync();

public sealed class PrintStationWorker : BackgroundService
{
    private readonly ILogger<PrintStationWorker> _log;
    private readonly ConfigStore _configStore;
    private readonly SupabaseQueueClient _cloud;
    private readonly LocalQueueDb _queue;
    private readonly WindowsPrinterDispatcher _printer;

    public PrintStationWorker(ILogger<PrintStationWorker> log, ConfigStore configStore, SupabaseQueueClient cloud, LocalQueueDb queue, WindowsPrinterDispatcher printer)
    {
        _log = log; _configStore = configStore; _cloud = cloud; _queue = queue; _printer = printer;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _log.LogInformation("Premier Print Station service started");
        var recovered = _queue.RecoverInterruptedPrints();
        if (recovered > 0)
            _log.LogWarning("Moved {RecoveredCount} interrupted printing job(s) to needs_review", recovered);

        while (!stoppingToken.IsCancellationRequested)
        {
            var cfg = _configStore.Load();
            try
            {
                ValidateConfig(cfg);
                var claimed = await _cloud.ClaimAsync(cfg, 12, stoppingToken);
                if (claimed.Count > 0) _queue.UpsertClaimed(claimed);
                foreach (var job in _queue.GetRunnable(25))
                {
                    stoppingToken.ThrowIfCancellationRequested();
                    await ProcessJobAsync(cfg, job, stoppingToken);
                }
                WriteHeartbeat("online", null);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                _log.LogError(ex, "Print station cycle failed");
                WriteHeartbeat("error", ex.Message);
            }
            var seconds = Math.Clamp(cfg.PollIntervalSeconds, 1, 30);
            try { await Task.Delay(TimeSpan.FromSeconds(seconds), stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }

    private async Task ProcessJobAsync(PrintStationConfig cfg, LocalPrintJob job, CancellationToken ct)
    {
        if (job.State == JobStates.PrintedPendingAck)
        {
            if (await _cloud.CompleteAsync(cfg, job.Id, true, null, ct)) _queue.SetState(job.Id, JobStates.Completed);
            return;
        }

        if (!cfg.StationPrinters.TryGetValue(job.StationCode, out var printerName) || string.IsNullOrWhiteSpace(printerName))
        {
            var message = $"No Windows printer mapped for station '{job.StationCode}'";
            _queue.SetState(job.Id, JobStates.Failed, message, true);
            await _cloud.CompleteAsync(cfg, job.Id, false, message, ct);
            return;
        }

        var started = await _cloud.StartAsync(cfg, job.Id, ct);
        if (!started)
        {
            _queue.SetState(job.Id, JobStates.Failed, "Cloud queue refused start", true);
            return;
        }

        // Persist the ambiguous boundary before touching the Windows spooler.
        // If the process dies after this point, startup moves the job to NeedsReview.
        _queue.SetState(job.Id, JobStates.Printing, null, true);
        var result = await _printer.PrintAsync(printerName, job.Payload, ct);
        if (!result.Accepted)
        {
            _queue.SetState(job.Id, JobStates.Failed, result.Error);
            await _cloud.CompleteAsync(cfg, job.Id, false, result.Error, ct);
            return;
        }

        // Once Windows accepts the document, never automatically print it again.
        // A failed cloud acknowledgement is retried as acknowledgement-only.
        _queue.SetState(job.Id, JobStates.PrintedPendingAck);
        if (await _cloud.CompleteAsync(cfg, job.Id, true, null, ct)) _queue.SetState(job.Id, JobStates.Completed);
    }

    private static void ValidateConfig(PrintStationConfig cfg)
    {
        if (string.IsNullOrWhiteSpace(cfg.SupabaseUrl)) throw new InvalidOperationException("Supabase URL is not configured");
        if (string.IsNullOrWhiteSpace(cfg.AnonKey)) throw new InvalidOperationException("Supabase anon key is not configured");
        if (!Guid.TryParse(cfg.BranchId, out _)) throw new InvalidOperationException("Branch ID is not configured");
        if (!Guid.TryParse(cfg.AgentId, out _)) throw new InvalidOperationException("Agent ID is invalid");
    }

    private void WriteHeartbeat(string status, string? error)
    {
        var recent = _queue.GetRecent(500);
        HeartbeatStore.Write(new Heartbeat(
            status,
            error,
            DateTimeOffset.UtcNow,
            recent.Count(x => x.State is JobStates.Received or JobStates.Printing or JobStates.PrintedPendingAck),
            recent.Count(x => x.State == JobStates.NeedsReview)));
    }
}
