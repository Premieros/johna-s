using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace PremierSmouhaFormPrintAgentV08;

internal sealed class RealtimeWakeClient : IDisposable
{
    private readonly string _accessToken;
    private readonly Action _onWake;
    private readonly Action<bool, string> _onConnectionChanged;
    private CancellationTokenSource? _cts;
    private Task? _loop;
    private long _refCounter;
    private string _joinRef = "";

    internal bool Connected { get; private set; }

    internal RealtimeWakeClient(
        string accessToken,
        Action onWake,
        Action<bool, string> onConnectionChanged)
    {
        _accessToken = accessToken;
        _onWake = onWake;
        _onConnectionChanged = onConnectionChanged;
    }

    internal void Start()
    {
        if (_loop is { IsCompleted: false }) return;
        _cts = new CancellationTokenSource();
        _loop = Task.Run(() => RunAsync(_cts.Token));
    }

    internal void Stop()
    {
        try { _cts?.Cancel(); } catch { }
    }

    private async Task RunAsync(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            using var socket = new ClientWebSocket();
            try
            {
                socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);
                socket.Options.SetRequestHeader("apikey", BuildConfig.PublishableKey);
                socket.Options.SetRequestHeader("Authorization", "Bearer " + _accessToken);

                SetConnected(false, "Realtime جاري الاتصال...");

                await socket.ConnectAsync(
                    new Uri(BuildConfig.RealtimeUrl),
                    token).ConfigureAwait(false);

                _joinRef = await SendJoinAsync(socket, token).ConfigureAwait(false);
                var joinDeadlineUtc = DateTime.UtcNow.AddSeconds(12);
                var receiveTask = ReceiveMessageAsync(socket, token);

                while (!token.IsCancellationRequested &&
                       socket.State == WebSocketState.Open)
                {
                    var waitSeconds = Connected ? 20 : 4;
                    var timer = Task.Delay(TimeSpan.FromSeconds(waitSeconds), token);
                    var completed = await Task.WhenAny(receiveTask, timer)
                        .ConfigureAwait(false);

                    if (completed == timer)
                    {
                        if (!Connected && DateTime.UtcNow >= joinDeadlineUtc)
                            throw new TimeoutException(
                                "Realtime join timeout — postgres_changes غير مؤكد");

                        await SendHeartbeatAsync(socket, token).ConfigureAwait(false);
                        continue;
                    }

                    var message = await receiveTask.ConfigureAwait(false);
                    if (message is null) break;

                    HandleMessage(message);
                    receiveTask = ReceiveMessageAsync(socket, token);
                }
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                SetConnected(false, "Realtime غير متاح: " + ex.Message);
            }
            finally
            {
                _joinRef = "";
                SetConnected(false, "Realtime مفصول — استخدام polling احتياطي");
            }

            try
            {
                await Task.Delay(TimeSpan.FromSeconds(5), token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task<string> SendJoinAsync(
        ClientWebSocket socket,
        CancellationToken token)
    {
        var reference = NextRef();
        var message = new
        {
            topic = $"realtime:public:{BuildConfig.WakeTable}",
            @event = "phx_join",
            payload = new
            {
                config = new
                {
                    broadcast = new { ack = false, self = false, replication_ready = true },
                    presence = new { enabled = false, key = "" },
                    postgres_changes = new[]
                    {
                        new
                        {
                            @event = "*",
                            schema = "public",
                            table = BuildConfig.WakeTable,
                            filter = $"branch_id=eq.{BuildConfig.BranchId}"
                        }
                    },
                    @private = false
                },
                access_token = _accessToken
            },
            @ref = reference,
            join_ref = reference
        };

        await SendJsonAsync(socket, message, token).ConfigureAwait(false);
        SetConnected(false, "Realtime WebSocket مفتوح — انتظار تأكيد postgres_changes");
        return reference;
    }

    private async Task SendHeartbeatAsync(
        ClientWebSocket socket,
        CancellationToken token)
    {
        await SendJsonAsync(
            socket,
            new
            {
                topic = "phoenix",
                @event = "heartbeat",
                payload = new { },
                @ref = NextRef()
            },
            token).ConfigureAwait(false);
    }

    private static async Task SendJsonAsync(
        ClientWebSocket socket,
        object value,
        CancellationToken token)
    {
        var json = JsonSerializer.Serialize(value);
        var bytes = Encoding.UTF8.GetBytes(json);
        await socket.SendAsync(
            new ArraySegment<byte>(bytes),
            WebSocketMessageType.Text,
            endOfMessage: true,
            cancellationToken: token).ConfigureAwait(false);
    }

    private static async Task<string?> ReceiveMessageAsync(
        ClientWebSocket socket,
        CancellationToken token)
    {
        var buffer = new byte[8192];
        using var stream = new MemoryStream();

        while (true)
        {
            var result = await socket.ReceiveAsync(
                new ArraySegment<byte>(buffer),
                token).ConfigureAwait(false);

            if (result.MessageType == WebSocketMessageType.Close)
                return null;

            if (result.MessageType == WebSocketMessageType.Text)
                stream.Write(buffer, 0, result.Count);

            if (result.EndOfMessage)
                break;
        }

        return Encoding.UTF8.GetString(stream.ToArray());
    }

    private void HandleMessage(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            var eventName = ReadString(root, "event");
            var topic = ReadString(root, "topic");
            var reference = ReadString(root, "ref");

            if (eventName == "phx_reply")
            {
                // Heartbeat replies are also phx_reply. Only the reply carrying
                // the exact phx_join ref may establish subscription readiness.
                if (string.IsNullOrWhiteSpace(_joinRef) ||
                    !string.Equals(reference, _joinRef, StringComparison.Ordinal))
                    return;

                if (!root.TryGetProperty("payload", out var payload))
                {
                    SetConnected(false, "Realtime join بلا payload — fallback فعال");
                    return;
                }

                var status = ReadString(payload, "status");
                if (!string.Equals(status, "ok", StringComparison.OrdinalIgnoreCase))
                {
                    var reason = ReadNestedReason(payload);
                    SetConnected(
                        false,
                        string.IsNullOrWhiteSpace(reason)
                            ? "Realtime join لم ينجح — fallback فعال"
                            : "Realtime join فشل: " + reason);
                    return;
                }

                if (!HasPostgresSubscriptionConfirmation(payload))
                {
                    SetConnected(
                        false,
                        "Realtime WebSocket متصل لكن postgres_changes غير مؤكد — fallback فعال");
                    return;
                }

                SetConnected(
                    true,
                    "Realtime متصل — postgres_changes مؤكد لسموحة");
                return;
            }

            if (eventName == "system")
            {
                HandleSystemEvent(root, topic);
                return;
            }

            if (eventName == "phx_error" || eventName == "phx_close")
            {
                SetConnected(
                    false,
                    eventName == "phx_error"
                        ? "Realtime channel error — fallback فعال"
                        : "Realtime channel closed — fallback فعال");
                return;
            }

            if (eventName == "postgres_changes" &&
                string.Equals(
                    topic,
                    $"realtime:public:{BuildConfig.WakeTable}",
                    StringComparison.Ordinal))
            {
                // Receiving a real database change is definitive proof that the
                // branch-filtered subscription is live.
                SetConnected(
                    true,
                    "Realtime متصل — تم استقبال Wake من سموحة");
                try { _onWake(); } catch { }
            }
        }
        catch
        {
            // Ignore protocol noise; reconciliation/fallback polling is the
            // safety net and remains active until a verified subscription exists.
        }
    }

    private void HandleSystemEvent(JsonElement root, string topic)
    {
        if (!string.Equals(
                topic,
                $"realtime:public:{BuildConfig.WakeTable}",
                StringComparison.Ordinal))
            return;

        if (!root.TryGetProperty("payload", out var payload) ||
            payload.ValueKind != JsonValueKind.Object)
            return;

        var extension = ReadString(payload, "extension");
        var status = ReadString(payload, "status");
        var message = ReadString(payload, "message");

        if (string.Equals(extension, "postgres_changes", StringComparison.OrdinalIgnoreCase))
        {
            if (string.Equals(status, "ok", StringComparison.OrdinalIgnoreCase))
            {
                SetConnected(
                    true,
                    string.IsNullOrWhiteSpace(message)
                        ? "Realtime متصل — PostgreSQL subscription جاهز"
                        : "Realtime متصل — " + message);
                return;
            }

            SetConnected(
                false,
                string.IsNullOrWhiteSpace(message)
                    ? "Realtime postgres_changes غير جاهز — fallback فعال"
                    : "Realtime postgres_changes: " + message);
            return;
        }

        if (string.Equals(extension, "system", StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(status, "ok", StringComparison.OrdinalIgnoreCase))
        {
            SetConnected(
                false,
                string.IsNullOrWhiteSpace(message)
                    ? "Realtime system error — fallback فعال"
                    : "Realtime system: " + message);
        }
    }

    private static string ReadNestedReason(JsonElement payload)
    {
        if (!payload.TryGetProperty("response", out var response))
            return "";

        if (response.ValueKind == JsonValueKind.Object)
        {
            var reason = ReadString(response, "reason");
            if (!string.IsNullOrWhiteSpace(reason)) return reason;

            var error = ReadString(response, "error");
            if (!string.IsNullOrWhiteSpace(error)) return error;
        }

        return response.ValueKind == JsonValueKind.String
            ? response.GetString() ?? ""
            : "";
    }

    private static bool HasPostgresSubscriptionConfirmation(JsonElement payload)
    {
        if (!payload.TryGetProperty("response", out var response) ||
            response.ValueKind != JsonValueKind.Object)
            return false;

        if (!response.TryGetProperty("postgres_changes", out var changes) ||
            changes.ValueKind != JsonValueKind.Array)
            return false;

        // One postgres_changes entry was requested in phx_join, so an empty
        // confirmation must not be treated as an active database subscription.
        return changes.GetArrayLength() > 0;
    }

    private static string ReadString(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var value))
            return "";

        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString() ?? "",
            JsonValueKind.Number => value.ToString(),
            _ => ""
        };
    }

    private string NextRef() =>
        Interlocked.Increment(ref _refCounter).ToString();

    private void SetConnected(bool connected, string status)
    {
        if (Connected == connected && connected) return;
        Connected = connected;
        try { _onConnectionChanged(connected, status); } catch { }
    }

    public void Dispose()
    {
        Stop();
        try { _loop?.Wait(500); } catch { }
        _cts?.Dispose();
    }
}
