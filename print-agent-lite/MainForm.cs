using System;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace PremierPrintAgentLite
{
    internal sealed class MainForm : Form
    {
        private const string AppUrl = "https://premieros.github.io/johna-s/";
        private readonly WebView2 _web = new WebView2();
        private readonly NotifyIcon _tray = new NotifyIcon();
        private readonly PrintBridge _bridge = new PrintBridge();
        private readonly bool _startHidden;
        private bool _allowExit;

        internal MainForm(bool startHidden)
        {
            _startHidden = startHidden;
            Text = "Premier Print Agent Lite";
            Width = 1180;
            Height = 780;
            _web.Dock = DockStyle.Fill;
            Controls.Add(_web);
            var menu = new ContextMenuStrip();
            menu.Items.Add("فتح", null, delegate { ShowAgent(); });
            menu.Items.Add("خروج", null, delegate { _allowExit = true; Close(); });
            _tray.Icon = System.Drawing.SystemIcons.Application;
            _tray.Text = "Premier Print Agent Lite";
            _tray.Visible = true;
            _tray.ContextMenuStrip = menu;
            _tray.DoubleClick += delegate { ShowAgent(); };
            Shown += async delegate { await InitAsync(); if (_startHidden) Hide(); };
            FormClosing += delegate(object s, FormClosingEventArgs e) { if (!_allowExit) { e.Cancel = true; Hide(); } };
        }

        private async Task InitAsync()
        {
            var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PremierPrintAgentLite", "WebView2");
            var env = await CoreWebView2Environment.CreateAsync(null, folder);
            await _web.EnsureCoreWebView2Async(env);
            _web.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
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
    getSystemInfo: () => Promise.resolve({isElectron:true,platform:'win32',hostname:'Premier-Lite',version:'1.0.1'})
  };
})();");
            _web.Source = new Uri(AppUrl);
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
                if (method == "getPrinters") result = _bridge.GetPrinters();
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
                else result = new { success = false, error = "UNKNOWN_METHOD" };
            }
            catch (Exception ex) { result = new { success = false, error = ex.GetType().Name + ":" + ex.Message }; }
            if (string.IsNullOrWhiteSpace(id)) return;
            var json = JsonSerializer.Serialize(result);
            await _web.CoreWebView2.ExecuteScriptAsync($"window.__premierLiteResolve({JsonSerializer.Serialize(id)}, {json})");
        }

        private void ShowAgent() { Show(); WindowState = FormWindowState.Normal; Activate(); }
    }
}
