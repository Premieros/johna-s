using System;
using System.Drawing;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace PremierPrintAgentLite
{
    internal sealed class MainForm : Form
    {
        private const string AppUrl = "https://premieros.github.io/johna-s/";
        private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string RunValueName = "PremierPrintAgentLite";

        private readonly WebView2 _web = new WebView2();
        private readonly NotifyIcon _tray = new NotifyIcon();
        private readonly PrintBridge _bridge = new PrintBridge();
        private readonly Timer _healthTimer = new Timer();
        private readonly bool _startHidden;
        private bool _allowExit;
        private bool _backgroundMode;
        private Rectangle _normalBounds;

        internal MainForm(bool startHidden)
        {
            _startHidden = startHidden;
            Text = "Premier Print Agent Lite";
            Width = 1180;
            Height = 780;
            StartPosition = FormStartPosition.CenterScreen;
            _normalBounds = new Rectangle(100, 100, Width, Height);

            _web.Dock = DockStyle.Fill;
            Controls.Add(_web);

            var menu = new ContextMenuStrip();
            menu.Items.Add("فتح", null, delegate { ShowAgent(); });
            menu.Items.Add("تشغيل مع Windows", null, delegate { ConfigureAutoStart(); });
            menu.Items.Add("خروج", null, delegate { _allowExit = true; Close(); });

            _tray.Icon = SystemIcons.Application;
            _tray.Text = "Premier Print Agent Lite - يعمل في الخلفية";
            _tray.Visible = true;
            _tray.ContextMenuStrip = menu;
            _tray.DoubleClick += delegate { ShowAgent(); };

            _healthTimer.Interval = 30000;
            _healthTimer.Tick += async delegate { await EnsureAgentAliveAsync(); };

            Shown += async delegate
            {
                ConfigureAutoStart();
                await InitAsync();
                _healthTimer.Start();
                if (_startHidden) EnterBackgroundMode();
            };

            Resize += delegate
            {
                if (!_backgroundMode && WindowState == FormWindowState.Normal)
                    _normalBounds = Bounds;
            };

            FormClosing += delegate(object s, FormClosingEventArgs e)
            {
                if (!_allowExit)
                {
                    e.Cancel = true;
                    EnterBackgroundMode();
                }
            };

            FormClosed += delegate
            {
                _healthTimer.Stop();
                _tray.Visible = false;
                _web.Dispose();
                _tray.Dispose();
            };
        }

        private static void ConfigureAutoStart()
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: true)
                    ?? Registry.CurrentUser.CreateSubKey(RunKeyPath);
                if (key == null) return;
                var exe = Application.ExecutablePath;
                key.SetValue(RunValueName, "\"" + exe + "\" --background", RegistryValueKind.String);
            }
            catch
            {
                // Startup registration is best-effort and must never block printing.
            }
        }

        private async Task InitAsync()
        {
            var folder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "PremierPrintAgentLite",
                "WebView2");

            var env = await CoreWebView2Environment.CreateAsync(null, folder);
            await _web.EnsureCoreWebView2Async(env);

            _web.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
            _web.CoreWebView2.NavigationCompleted += delegate(object sender, CoreWebView2NavigationCompletedEventArgs e)
            {
                _tray.Text = e.IsSuccess
                    ? "Premier Print Agent Lite - Cloud Agent متصل"
                    : "Premier Print Agent Lite - إعادة اتصال";
            };
            _web.CoreWebView2.ProcessFailed += async delegate
            {
                _tray.Text = "Premier Print Agent Lite - استعادة الاتصال";
                await Task.Delay(1000);
                try { _web.CoreWebView2.Reload(); } catch { }
            };

            await _web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(@"
(() => {
  const pending = new Map(); let seq = 0;
  window.__premierLiteResolve = (id, result) => { const p=pending.get(id); if(!p)return; pending.delete(id); p.resolve(result); };
  function call(method,args){ return new Promise((resolve,reject)=>{ const id=String(++seq); pending.set(id,{resolve,reject}); chrome.webview.postMessage({id,method,args:args||{}}); setTimeout(()=>{if(pending.has(id)){pending.delete(id);reject(new Error('LITE_AGENT_TIMEOUT'));}},15000); }); }
  window.electronAPI = {
    isElectron: true,
    getPrinters: () => call('getPrinters'),
    printSilent: (o) => call('printSilent', o),
    kickDrawer: (p) => call('kickDrawer', {printerName:p}),
    getSystemInfo: () => Promise.resolve({isElectron:true,platform:'win32',hostname:'Premier-Lite',version:'1.2.0'})
  };
  window.__PREMIER_LITE_BACKGROUND__ = true;
})();");

            _web.Source = new Uri(AppUrl);
        }

        private async Task EnsureAgentAliveAsync()
        {
            try
            {
                if (_web.CoreWebView2 == null) return;
                var current = _web.Source?.AbsoluteUri ?? "";
                if (!current.StartsWith(AppUrl, StringComparison.OrdinalIgnoreCase))
                {
                    _web.Source = new Uri(AppUrl);
                    return;
                }

                await _web.CoreWebView2.ExecuteScriptAsync(@"
(() => {
  window.dispatchEvent(new Event('johns:cloud-print-agent-config'));
  return true;
})()");
            }
            catch
            {
                try { _web.CoreWebView2?.Reload(); } catch { }
            }
        }

        private async void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string id = "";
            object result;
            try
            {
                using var doc = JsonDocument.Parse(e.WebMessageAsJson);
                var root = doc.RootElement;
                id = root.GetProperty("id").GetString() ?? "";
                var method = root.GetProperty("method").GetString() ?? "";
                var args = root.TryGetProperty("args", out var a) ? a : default;

                if (method == "getPrinters")
                {
                    result = _bridge.GetPrinters();
                }
                else if (method == "printSilent")
                {
                    var printer = args.TryGetProperty("printerName", out var p) ? p.GetString() : "";
                    var text = args.TryGetProperty("text", out var t) ? t.GetString() : "";
                    var html = args.TryGetProperty("html", out var h) ? h.GetString() : "";
                    var copies = args.TryGetProperty("copies", out var c) && c.TryGetInt32(out var n) ? n : 1;
                    result = await _bridge.PrintAsync(printer, text, html, copies);
                }
                else if (method == "kickDrawer")
                {
                    var printer = args.TryGetProperty("printerName", out var p) ? p.GetString() : "";
                    result = await _bridge.KickDrawerAsync(printer);
                }
                else
                {
                    result = new { success = false, error = "UNKNOWN_METHOD" };
                }
            }
            catch (Exception ex)
            {
                result = new { success = false, error = ex.GetType().Name + ":" + ex.Message };
            }

            if (string.IsNullOrWhiteSpace(id)) return;
            var json = JsonSerializer.Serialize(result);
            await _web.CoreWebView2.ExecuteScriptAsync(
                $"window.__premierLiteResolve({JsonSerializer.Serialize(id)}, {json})");
        }

        private void EnterBackgroundMode()
        {
            if (!_backgroundMode && WindowState == FormWindowState.Normal)
                _normalBounds = Bounds;

            _backgroundMode = true;
            ShowInTaskbar = false;
            WindowState = FormWindowState.Normal;
            FormBorderStyle = FormBorderStyle.None;
            Opacity = 0.01;
            Bounds = new Rectangle(-32000, -32000, 2, 2);

            if (!Visible) Show();
            _tray.Text = "Premier Print Agent Lite - يعمل في الخلفية";
        }

        private void ShowAgent()
        {
            _backgroundMode = false;
            FormBorderStyle = FormBorderStyle.Sizable;
            Opacity = 1.0;
            ShowInTaskbar = true;
            Bounds = _normalBounds.Width > 200 && _normalBounds.Height > 200
                ? _normalBounds
                : new Rectangle(100, 100, 1180, 780);
            WindowState = FormWindowState.Normal;
            Show();
            Activate();
            BringToFront();
        }
    }
}
