using System;
using System.Drawing;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace PremierCleopatraPrintAgent
{
    internal sealed class SetupForm : Form
    {
        private readonly SupabaseApi _api;
        private readonly RawEscPosPrinter _printer;
        private AgentConfig _config;
        private readonly TextBox _email = new TextBox();
        private readonly TextBox _password = new TextBox { UseSystemPasswordChar = true };
        private readonly ComboBox _kitchen = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList };
        private readonly ComboBox _bar = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList };
        private readonly ComboBox _cash = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList };
        private readonly Label _status = new Label { AutoSize = true };
        private readonly Button _save = new Button { Text = "حفظ وتشغيل الوكيل", AutoSize = true };

        internal AgentConfig SavedConfig { get; private set; }

        internal SetupForm(SupabaseApi api, RawEscPosPrinter printer, AgentConfig config)
        {
            _api = api;
            _printer = printer;
            _config = config;
            Text = "Cleopatra Headless Print Agent — إعداد";
            Width = 620;
            Height = 470;
            StartPosition = FormStartPosition.CenterScreen;
            RightToLeft = RightToLeft.Yes;
            RightToLeftLayout = true;

            var panel = new TableLayoutPanel {
                Dock = DockStyle.Fill,
                Padding = new Padding(18),
                ColumnCount = 2,
                RowCount = 9,
                AutoScroll = true
            };
            panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 35));
            panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 65));

            AddRow(panel, 0, "الفرع", new Label { Text = BuildConfig.BranchName, AutoSize = true });
            AddRow(panel, 1, "بريد حساب جهاز الطباعة", _email);
            AddRow(panel, 2, "كلمة المرور (تُستخدم مرة واحدة فقط)", _password);
            AddRow(panel, 3, "مطبخ (kit)", _kitchen);
            AddRow(panel, 4, "بار", _bar);
            AddRow(panel, 5, "كاش / إيصالات", _cash);

            var testKitchen = new Button { Text = "اختبار مطبخ", AutoSize = true };
            var testBar = new Button { Text = "اختبار بار", AutoSize = true };
            var testCash = new Button { Text = "اختبار كاش", AutoSize = true };
            var tests = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true };
            tests.Controls.Add(testKitchen); tests.Controls.Add(testBar); tests.Controls.Add(testCash);
            panel.Controls.Add(tests, 1, 6);

            _status.ForeColor = Color.DarkSlateGray;
            panel.Controls.Add(_status, 1, 7);
            panel.Controls.Add(_save, 1, 8);
            Controls.Add(panel);

            Load += delegate { LoadPrinters(); };
            _save.Click += async delegate { await SaveAsync(); };
            testKitchen.Click += async delegate { await TestAsync(_kitchen, "اختبار مطبخ كليوباترا"); };
            testBar.Click += async delegate { await TestAsync(_bar, "اختبار بار كليوباترا"); };
            testCash.Click += async delegate { await TestAsync(_cash, "اختبار كاش كليوباترا"); };
        }

        private static void AddRow(TableLayoutPanel panel, int row, string label, Control control)
        {
            panel.Controls.Add(new Label { Text = label, AutoSize = true, Anchor = AnchorStyles.Right }, 0, row);
            control.Dock = DockStyle.Top;
            panel.Controls.Add(control, 1, row);
        }

        private void LoadPrinters()
        {
            var printers = _printer.GetPrinters();
            foreach (var combo in new[] { _kitchen, _bar, _cash })
            {
                combo.Items.Clear();
                combo.Items.AddRange(printers.Cast<object>().ToArray());
            }
            _email.Text = _config.Email ?? "";
            Select(_kitchen, "kit");
            Select(_bar, "بار");
            Select(_cash, "كاش");
            _status.Text = printers.Count + " طابعة مثبتة في Windows";
        }

        private void Select(ComboBox box, string route)
        {
            if (!_config.Routes.TryGetValue(route, out var selected)) return;
            var index = box.Items.IndexOf(selected);
            if (index >= 0) box.SelectedIndex = index;
        }

        private async Task SaveAsync()
        {
            _save.Enabled = false;
            try
            {
                if (string.IsNullOrWhiteSpace(_email.Text) || string.IsNullOrWhiteSpace(_password.Text))
                    throw new InvalidOperationException("أدخل بريد وكلمة مرور حساب جهاز الطباعة.");
                if (_kitchen.SelectedItem == null || _bar.SelectedItem == null || _cash.SelectedItem == null)
                    throw new InvalidOperationException("عيّن طابعة لكل محطة.");

                _status.Text = "جاري التحقق من الحساب والصلاحيات...";
                using (var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20)))
                {
                    var session = await _api.SignInAsync(_email.Text.Trim(), _password.Text, cts.Token);
                    var kitchenOk = await _api.CanExecuteKindAsync(session.AccessToken, "kitchen", cts.Token);
                    var receiptOk = await _api.CanExecuteKindAsync(session.AccessToken, "receipt", cts.Token);
                    if (!kitchenOk || !receiptOk)
                        throw new InvalidOperationException("الحساب يحتاج pos.print_kitchen و pos.receipt.print فقط.");

                    _config.Email = _email.Text.Trim();
                    _config.ProtectedRefreshToken = ConfigStore.ProtectToken(session.RefreshToken);
                    _config.Routes["kit"] = _kitchen.SelectedItem.ToString();
                    _config.Routes["بار"] = _bar.SelectedItem.ToString();
                    _config.Routes["كاش"] = _cash.SelectedItem.ToString();
                    _config.Enabled = true;
                    _config.AutoStart = true;
                    ConfigStore.Save(_config);
                    SavedConfig = _config;
                    _password.Text = "";
                    DialogResult = DialogResult.OK;
                    Close();
                }
            }
            catch (Exception ex)
            {
                _status.Text = ex.Message;
                MessageBox.Show(this, ex.Message, "فشل الإعداد", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally { _save.Enabled = true; }
        }

        private async Task TestAsync(ComboBox box, string text)
        {
            if (box.SelectedItem == null) { MessageBox.Show("اختر الطابعة أولًا."); return; }
            try
            {
                await _printer.PrintAsync(box.SelectedItem.ToString(), text + "\r\nالعربية تعمل كصورة RAW\r\n", 80);
                MessageBox.Show("تم إرسال الاختبار.");
            }
            catch (Exception ex) { MessageBox.Show(ex.Message, "خطأ طباعة", MessageBoxButtons.OK, MessageBoxIcon.Error); }
        }
    }
}
