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

                await socket.ConnectAsync(
                    new Uri(BuildConfig.RealtimeUrl),
                    token).ConfigureAwait(false);

                await SendJoinAsync(socket, token).ConfigureAwait(false);
                var receiveTask = ReceiveMessageAsync(socket, token);

                while (!token.IsCancellationRequested &&
                       socket.State == WebSocketState.Open)
                {
                    var heartbeat = Task.Delay(TimeSpan.FromSeconds(20), token);
                    var completed = await Task.WhenAny(receiveTask, heartbeat)
                        .ConfigureAwait(false);

                    if (completed == heartbeat)
                    {
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

    private async Task SendJoinAsync(
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
                    broadcast = new { ack = false, self = false },
                    presence = new { key = "" },
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
            @ref = reference
        };
        await SendJsonAsync(socket, message, token).ConfigureAwait(false);
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
            var eventName = root.TryGetProperty("event", out var ev)
                ? ev.GetString() ?? ""
                : "";

            if (eventName == "phx_reply" &&
                root.TryGetProperty("payload", out var payload))
            {
                var status = payload.TryGetProperty("status", out var statusNode)
                    ? statusNode.GetString() ?? ""
                    : "";
                if (string.Equals(status, "ok", StringComparison.OrdinalIgnoreCase))
                    SetConnected(true, "Realtime متصل — انتظار Jobs بدون polling سريع");
                else
                    SetConnected(false, "Realtime join لم ينجح — fallback فعال");
                return;
            }

            if (eventName == "postgres_changes" ||
                json.Contains(BuildConfig.WakeTable, StringComparison.OrdinalIgnoreCase))
            {
                try { _onWake(); } catch { }
            }
        }
        catch
        {
            // Ignore protocol noise; the reconciliation timer is the safety net.
        }
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
