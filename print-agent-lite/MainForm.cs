using System;
using System.IO;
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
            _web.Source = new Uri(AppUrl);
        }

        private void ShowAgent() { Show(); WindowState = FormWindowState.Normal; Activate(); }
    }
}
