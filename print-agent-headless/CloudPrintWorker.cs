using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace PremierCleopatraPrintAgent
{
    internal sealed class CloudPrintWorker : IDisposable
    {
        private readonly SupabaseApi _api;
        private readonly RawEscPosPrinter _printer;
        private AgentConfig _config;
        private CancellationTokenSource _cts;
        private Task _loop;
        private AuthSession _session;
        private DateTime _lastRefreshUtc = DateTime.MinValue;

        internal event Action<string> StatusChanged;

        internal CloudPrintWorker(SupabaseApi api, RawEscPosPrinter printer, AgentConfig config)
        {
            _api = api;
            _printer = printer;
            _config = config;
        }

        internal void UpdateConfig(AgentConfig config) { _config = config; }

        internal void Start()
        {
            if (_loop != null && !_loop.IsCompleted) return;
            _cts = new CancellationTokenSource();
            _loop = Task.Run(() => LoopAsync(_cts.Token));
        }

        internal void Stop()
        {
            try { _cts?.Cancel(); } catch { }
        }

        private async Task LoopAsync(CancellationToken token)
        {
            SetStatus("بدء وكيل الطباعة...");
            while (!token.IsCancellationRequested)
            {
                try
                {
                    if (!_config.Enabled)
                    {
                        SetStatus("الوكيل متوقف من الإعدادات");
                        await Task.Delay(1500, token).ConfigureAwait(false);
                        continue;
                    }

                    await EnsureSessionAsync(token).ConfigureAwait(false);
                    var jobs = await _api.ClaimAsync(_session.AccessToken, _config.AgentId, token).ConfigureAwait(false);
                    if (jobs.Count == 0)
                    {
                        SetStatus("متصل — لا توجد أوامر طباعة معلقة");
                        await Task.Delay(700, token).ConfigureAwait(false);
                        continue;
                    }

                    foreach (var job in jobs)
                    {
                        if (token.IsCancellationRequested) break;
                        await ExecuteJobAsync(job, token).ConfigureAwait(false);
                    }
                }
                catch (OperationCanceledException) when (token.IsCancellationRequested) { break; }
                catch (Exception ex)
                {
                    SetStatus("خطأ: " + ex.Message);
                    await Task.Delay(2500, token).ConfigureAwait(false);
                }
            }
            SetStatus("تم إيقاف الوكيل");
        }

        private async Task EnsureSessionAsync(CancellationToken token)
        {
            if (_session != null && DateTime.UtcNow - _lastRefreshUtc < TimeSpan.FromMinutes(45)) return;
            var refresh = ConfigStore.UnprotectToken(_config.ProtectedRefreshToken);
            if (string.IsNullOrWhiteSpace(refresh)) throw new InvalidOperationException("DEVICE_LOGIN_REQUIRED");
            _session = await _api.RefreshAsync(refresh, _config.Email, token).ConfigureAwait(false);
            _config.ProtectedRefreshToken = ConfigStore.ProtectToken(_session.RefreshToken);
            ConfigStore.Save(_config);
            _lastRefreshUtc = DateTime.UtcNow;
            var kitchen = await _api.CanExecuteKindAsync(_session.AccessToken, "kitchen", token).ConfigureAwait(false);
            var receipt = await _api.CanExecuteKindAsync(_session.AccessToken, "receipt", token).ConfigureAwait(false);
            if (!kitchen || !receipt) throw new InvalidOperationException("DEVICE_PRINT_PERMISSIONS_MISSING");
            SetStatus("متصل بفرع كليوباترا");
        }

        private async Task ExecuteJobAsync(CloudPrintJob job, CancellationToken token)
        {
            var printerName = ResolvePrinter(job.StationCode);
            if (string.IsNullOrWhiteSpace(printerName))
            {
                await _api.CompleteAsync(_session.AccessToken, job.Id, _config.AgentId, false, "PRINTER_ROUTE_MISSING:" + job.StationCode, token).ConfigureAwait(false);
                return;
            }

            if (!await _api.StartAsync(_session.AccessToken, job.Id, _config.AgentId, token).ConfigureAwait(false))
                return;

            try
            {
                var text = ReadPayloadText(job.Payload);
                if (string.IsNullOrWhiteSpace(text)) throw new InvalidOperationException("PRINT_TEXT_MISSING");
                var width = ReadPayloadInt(job.Payload, "paperWidthMm", 80);
                SetStatus("طباعة " + job.Kind + " — " + job.StationCode);
                await _printer.PrintAsync(printerName, text, width).ConfigureAwait(false);
                await _api.CompleteAsync(_session.AccessToken, job.Id, _config.AgentId, true, null, token).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                await _api.CompleteAsync(_session.AccessToken, job.Id, _config.AgentId, false, ex.Message, token).ConfigureAwait(false);
            }
        }

        private string ResolvePrinter(string station)
        {
            station = (station ?? "").Trim();
            if (_config.Routes.TryGetValue(station, out var direct) && !string.IsNullOrWhiteSpace(direct)) return direct;
            if (string.Equals(station, "cashier", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(station, "receipt", StringComparison.OrdinalIgnoreCase))
            {
                if (_config.Routes.TryGetValue("كاش", out var cashier) && !string.IsNullOrWhiteSpace(cashier)) return cashier;
            }
            return "";
        }

        private static string ReadPayloadText(JsonElement payload)
        {
            if (payload.ValueKind != JsonValueKind.Object) return "";
            if (payload.TryGetProperty("text", out var text) && text.ValueKind == JsonValueKind.String) return text.GetString() ?? "";
            return "";
        }

        private static int ReadPayloadInt(JsonElement payload, string name, int fallback)
        {
            if (payload.ValueKind != JsonValueKind.Object || !payload.TryGetProperty(name, out var value)) return fallback;
            if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number)) return number;
            if (value.ValueKind == JsonValueKind.String && int.TryParse(value.GetString(), out number)) return number;
            return fallback;
        }

        private void SetStatus(string value)
        {
            try { StatusChanged?.Invoke(value); } catch { }
        }

        public void Dispose()
        {
            Stop();
            try { _loop?.Wait(1000); } catch { }
            _cts?.Dispose();
        }
    }
}
