using System.Drawing;

namespace PremierSmouhaFormPrintAgentV08;

internal sealed class TrayHostForm : Form
{
    private readonly SupabaseApi _api;
    private readonly EscPosPrinter _printer;
    private AgentConfig _config;
    private readonly CloudPrintWorker _worker;
    private readonly NotifyIcon _tray = new();
    private readonly Label _status = new();
    private readonly Label _metrics = new();
    private bool _allowExit;

    internal TrayHostForm(
        SupabaseApi api,
        EscPosPrinter printer,
        AgentConfig config,
        bool startHidden)
    {
        _api = api;
        _printer = printer;
        _config = config;

        Text = BuildConfig.AppName;
        Width = 700;
        Height = 360;
        StartPosition = FormStartPosition.CenterScreen;
        RightToLeft = RightToLeft.Yes;
        RightToLeftLayout = true;
        Font = new Font("Tahoma", 10f);

        var panel = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(20),
            RowCount = 5,
            ColumnCount = 1
        };
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        panel.RowStyles.Add(new RowStyle(SizeType.Percent, 35));
        panel.RowStyles.Add(new RowStyle(SizeType.Percent, 45));
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        panel.Controls.Add(new Label
        {
            Text = BuildConfig.AppName + " — " + BuildConfig.BranchName,
            AutoSize = true,
            Font = new Font("Tahoma", 13f, FontStyle.Bold),
            Dock = DockStyle.Top,
            TextAlign = ContentAlignment.MiddleCenter
        });

        _status.Text = "جاري التشغيل...";
        _status.Dock = DockStyle.Fill;
        _status.TextAlign = ContentAlignment.MiddleCenter;
        _status.Font = new Font("Tahoma", 11f, FontStyle.Bold);
        panel.Controls.Add(_status);

        _metrics.Dock = DockStyle.Fill;
        _metrics.TextAlign = ContentAlignment.TopRight;
        _metrics.Font = new Font("Consolas", 10f);
        panel.Controls.Add(_metrics);

        var buttons = new FlowLayoutPanel
        {
            AutoSize = true,
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.RightToLeft
        };
        var settings = new Button { Text = "الإعدادات", AutoSize = true };
        var testOnly = new Button { Text = "إيقاف Production Queue", AutoSize = true };
        var wake = new Button { Text = "فحص الطابور الآن", AutoSize = true };
        buttons.Controls.Add(settings);
        buttons.Controls.Add(testOnly);
        buttons.Controls.Add(wake);
        panel.Controls.Add(buttons);

        panel.Controls.Add(new Label
        {
            AutoSize = true,
            ForeColor = Color.DarkSlateGray,
            Text = "V7 baseline: claim كل 700ms ≈ 123,429 طلب/يوم/جهاز.\r\n" +
                   "V8 Realtime: claim عند الحدث + reconciliation كل 5 دقائق ≈ 288 طلب idle/يوم."
        });

        Controls.Add(panel);

        var menu = new ContextMenuStrip();
        menu.Items.Add("الحالة", null, (_, _) => ShowAgent());
        menu.Items.Add("الإعدادات", null, (_, _) => OpenSettings());
        menu.Items.Add("إيقاف Production Queue", null, (_, _) => DisableQueue());
        menu.Items.Add("خروج", null, (_, _) =>
        {
            _allowExit = true;
            Close();
        });

        _tray.Icon = SystemIcons.Application;
        _tray.Text = "Smouha Form Print Agent V8";
        _tray.Visible = true;
        _tray.ContextMenuStrip = menu;
        _tray.DoubleClick += (_, _) => ShowAgent();

        _worker = new CloudPrintWorker(_api, _printer, _config);
        _worker.StatusChanged += value =>
        {
            try
            {
                BeginInvoke(() =>
                {
                    _status.Text = value;
                    _tray.Text = value.Length > 63
                        ? value[..63]
                        : value;
                });
            }
            catch { }
        };
        _worker.MetricsChanged += value =>
        {
            try
            {
                BeginInvoke(() => RenderMetrics(value));
            }
            catch { }
        };

        settings.Click += (_, _) => OpenSettings();
        testOnly.Click += (_, _) => DisableQueue();
        wake.Click += (_, _) =>
            MessageBox.Show(
                "V8 يعمل Event-Driven. عند تفعيل Production سيعمل reconciliation تلقائياً.\r\n" +
                "افتح الإعدادات لتفعيل/إيقاف الطابور.",
                BuildConfig.AppName);

        Shown += (_, _) =>
        {
            _worker.Start();
            if (startHidden) Hide();
        };

        FormClosing += (_, e) =>
        {
            if (_allowExit) return;
            e.Cancel = true;
            Hide();
        };

        FormClosed += (_, _) =>
        {
            _worker.Dispose();
            _tray.Visible = false;
        };

        RenderMetrics(new AgentMetrics());
    }

    private void RenderMetrics(AgentMetrics m)
    {
        var baseline = 86400d / 0.7d;
        var idleClaims = m.RealtimeConnected
            ? 86400d / Math.Max(60, _config.ReconcileSeconds)
            : 86400d / Math.Max(5, _config.DisconnectedPollSeconds);
        var reduction = Math.Max(0, 100d * (1d - idleClaims / baseline));

        _metrics.Text =
            $"Mode: {(_config.QueueEnabled ? "PRODUCTION" : "TEST ONLY")}\r\n" +
            $"Realtime: {(m.RealtimeConnected ? "CONNECTED" : "FALLBACK")}\r\n" +
            $"Claim RPCs (runtime): {m.ClaimRpcCount:N0}\r\n" +
            $"Realtime wakes: {m.RealtimeWakeCount:N0}\r\n" +
            $"Claimed jobs: {m.ClaimedJobs:N0}\r\n" +
            $"Printed: {m.PrintedJobs:N0}   Failed: {m.FailedJobs:N0}\r\n" +
            $"Estimated idle claim reduction vs V7: {reduction:0.0}%";
    }

    private void OpenSettings()
    {
        using var form = new SetupForm(_api, _printer, _config);
        if (form.ShowDialog(this) != DialogResult.OK ||
            form.SavedConfig is null)
            return;

        _config = form.SavedConfig;
        _worker.UpdateConfig(_config);
    }

    private void DisableQueue()
    {
        if (!_config.QueueEnabled)
        {
            MessageBox.Show("Production Queue متوقف بالفعل.");
            return;
        }

        _config.QueueEnabled = false;
        ConfigStore.Save(_config);
        _worker.UpdateConfig(_config);
        _status.Text = "وضع اختبار محلي — Production Queue متوقف";
    }

    private void ShowAgent()
    {
        Show();
        WindowState = FormWindowState.Normal;
        Activate();
    }
}
