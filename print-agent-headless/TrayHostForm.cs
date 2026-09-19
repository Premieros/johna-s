using System;
using System.Drawing;
using System.Windows.Forms;

namespace PremierCleopatraPrintAgent
{
    internal sealed class TrayHostForm : Form
    {
        private readonly SupabaseApi _api;
        private readonly RawEscPosPrinter _printer;
        private AgentConfig _config;
        private readonly CloudPrintWorker _worker;
        private readonly NotifyIcon _tray = new NotifyIcon();
        private bool _allowExit;

        internal TrayHostForm(SupabaseApi api, RawEscPosPrinter printer, AgentConfig config, bool startHidden)
        {
            _api = api;
            _printer = printer;
            _config = config;
            Text = "Cleopatra Headless Print Agent";
            Width = 520;
            Height = 220;
            StartPosition = FormStartPosition.CenterScreen;
            RightToLeft = RightToLeft.Yes;
            RightToLeftLayout = true;

            var status = new Label {
                Text = "جاري التشغيل...",
                Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.MiddleCenter,
                Font = new Font("Tahoma", 11f)
            };
            Controls.Add(status);

            var menu = new ContextMenuStrip();
            menu.Items.Add("الحالة", null, delegate { ShowAgent(); });
            menu.Items.Add("الإعدادات", null, delegate { OpenSettings(); });
            menu.Items.Add("خروج", null, delegate { _allowExit = true; Close(); });
            _tray.Icon = SystemIcons.Application;
            _tray.Text = "Cleopatra Print Agent";
            _tray.Visible = true;
            _tray.ContextMenuStrip = menu;
            _tray.DoubleClick += delegate { ShowAgent(); };

            _worker = new CloudPrintWorker(_api, _printer, _config);
            _worker.StatusChanged += value => BeginInvoke((Action)(() => {
                status.Text = value;
                _tray.Text = value.Length > 63 ? value.Substring(0, 63) : value;
            }));

            Shown += delegate {
                _worker.Start();
                if (startHidden) Hide();
            };
            FormClosing += delegate(object s, FormClosingEventArgs e) {
                if (!_allowExit) { e.Cancel = true; Hide(); }
            };
            FormClosed += delegate { _worker.Dispose(); _tray.Visible = false; };
        }

        private void OpenSettings()
        {
            using (var form = new SetupForm(_api, _printer, _config))
            {
                if (form.ShowDialog(this) == DialogResult.OK && form.SavedConfig != null)
                {
                    _config = form.SavedConfig;
                    _worker.UpdateConfig(_config);
                }
            }
        }

        private void ShowAgent()
        {
            Show();
            WindowState = FormWindowState.Normal;
            Activate();
        }
    }
}
