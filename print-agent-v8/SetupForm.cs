using System.Drawing;
using System.Text.Json;

namespace PremierSmouhaFormPrintAgentV08;

internal sealed class SetupForm : Form
{
    private readonly SupabaseApi _api;
    private readonly EscPosPrinter _printer;
    private AgentConfig _config;

    private readonly TextBox _email = new();
    private readonly TextBox _password = new() { UseSystemPasswordChar = true };
    private readonly ComboBox _kitchen = new() { DropDownStyle = ComboBoxStyle.DropDownList };
    private readonly ComboBox _bar = new() { DropDownStyle = ComboBoxStyle.DropDownList };
    private readonly ComboBox _cash = new() { DropDownStyle = ComboBoxStyle.DropDownList };
    private readonly CheckBox _queueEnabled = new()
    {
        Text = "تفعيل استهلاك طابور Production (أوقف V7 أولاً)",
        AutoSize = true
    };
    private readonly CheckBox _realtime = new()
    {
        Text = "Realtime wake + polling احتياطي منخفض",
        Checked = true,
        AutoSize = true
    };
    private readonly Label _status = new() { AutoSize = true };
    private readonly Button _save = new()
    {
        Text = "حفظ الإعدادات",
        AutoSize = true
    };

    internal AgentConfig? SavedConfig { get; private set; }

    internal SetupForm(
        SupabaseApi api,
        EscPosPrinter printer,
        AgentConfig config)
    {
        _api = api;
        _printer = printer;
        _config = config;

        Text = "Smouha Form Print Agent V8.1 Lite — إعداد";
        Width = 760;
        Height = 610;
        StartPosition = FormStartPosition.CenterScreen;
        RightToLeft = RightToLeft.Yes;
        RightToLeftLayout = true;
        Font = new Font("Tahoma", 10f);

        var panel = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(18),
            ColumnCount = 2,
            RowCount = 12,
            AutoScroll = true
        };
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 34));
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 66));

        AddRow(panel, 0, "البرنامج", new Label
        {
            Text = BuildConfig.AppName,
            AutoSize = true,
            Font = new Font("Tahoma", 11f, FontStyle.Bold)
        });
        AddRow(panel, 1, "الفرع", new Label
        {
            Text = BuildConfig.BranchName,
            AutoSize = true
        });
        AddRow(panel, 2, "حساب جهاز الطباعة", _email);
        AddRow(panel, 3, "كلمة المرور", _password);
        AddRow(panel, 4, "مطبخ / main / kit", _kitchen);
        AddRow(panel, 5, "بار", _bar);
        AddRow(panel, 6, "كاش / receipt", _cash);

        var tests = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            AutoSize = true,
            FlowDirection = FlowDirection.RightToLeft
        };
        var testKitchen = new Button { Text = "اختبار فورمة مطبخ", AutoSize = true };
        var testCash = new Button { Text = "اختبار فورمة كاش", AutoSize = true };
        tests.Controls.Add(testKitchen);
        tests.Controls.Add(testCash);
        panel.Controls.Add(new Label { Text = "اختبار محلي", AutoSize = true }, 0, 7);
        panel.Controls.Add(tests, 1, 7);

        panel.Controls.Add(new Label { Text = "وضع التشغيل", AutoSize = true }, 0, 8);
        var modes = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            AutoSize = true,
            FlowDirection = FlowDirection.TopDown,
            WrapContents = false
        };
        modes.Controls.Add(_queueEnabled);
        modes.Controls.Add(_realtime);
        modes.Controls.Add(new Label
        {
            AutoSize = true,
            ForeColor = Color.DarkSlateGray,
            Text = "الافتراضي: اختبار فقط. عند Realtime: reconciliation كل 5 دقائق.\r\n" +
                   "عند فشل Realtime: polling احتياطي كل 15 ثانية."
        });
        panel.Controls.Add(modes, 1, 8);

        _status.ForeColor = Color.DarkSlateGray;
        panel.Controls.Add(new Label { Text = "الحالة", AutoSize = true }, 0, 9);
        panel.Controls.Add(_status, 1, 9);
        panel.Controls.Add(_save, 1, 10);

        Controls.Add(panel);

        Load += (_, _) => LoadPrinters();
        _save.Click += async (_, _) => await SaveAsync();
        testKitchen.Click += async (_, _) =>
            await TestTemplateAsync(_kitchen, KitchenSample());
        testCash.Click += async (_, _) =>
            await TestTemplateAsync(_cash, CustomerSample());
    }

    private static void AddRow(
        TableLayoutPanel panel,
        int row,
        string label,
        Control control)
    {
        panel.Controls.Add(new Label
        {
            Text = label,
            AutoSize = true,
            Anchor = AnchorStyles.Right
        }, 0, row);
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
        _queueEnabled.Checked = _config.QueueEnabled;
        _realtime.Checked = _config.UseRealtimeWake;

        SelectRoute(_kitchen, "kit", "main", "مطبخ");
        SelectRoute(_bar, "بار", "bar");
        SelectRoute(_cash, "كاش", "cashier", "receipt");

        _status.Text =
            $"{printers.Count} طابعة مثبتة في Windows — الطابور " +
            (_config.QueueEnabled ? "مفعل" : "مغلق (اختبار آمن)");
    }

    private void SelectRoute(ComboBox box, params string[] aliases)
    {
        foreach (var alias in aliases)
        {
            if (!_config.Routes.TryGetValue(alias, out var selected))
                continue;
            var index = box.Items.IndexOf(selected);
            if (index >= 0)
            {
                box.SelectedIndex = index;
                return;
            }
        }
    }

    private async Task SaveAsync()
    {
        _save.Enabled = false;
        try
        {
            if (string.IsNullOrWhiteSpace(_email.Text))
                throw new InvalidOperationException("أدخل بريد حساب جهاز الطباعة.");

            if (_kitchen.SelectedItem is null ||
                _bar.SelectedItem is null ||
                _cash.SelectedItem is null)
                throw new InvalidOperationException("عيّن طابعة لكل محطة.");

            AuthSession session;
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
            var password = _password.Text;
            if (!string.IsNullOrWhiteSpace(password))
            {
                _status.Text = "التحقق من الحساب والصلاحيات...";
                session = await _api.SignInAsync(
                    _email.Text.Trim(),
                    password,
                    cts.Token);
            }
            else
            {
                var refresh = ConfigStore.UnprotectToken(
                    _config.ProtectedRefreshToken);
                if (string.IsNullOrWhiteSpace(refresh))
                    throw new InvalidOperationException(
                        "أدخل كلمة المرور في أول إعداد.");

                session = await _api.RefreshAsync(
                    refresh,
                    _email.Text.Trim(),
                    cts.Token);
            }

            var kitchenOk = await _api.CanExecuteKindAsync(
                session.AccessToken,
                "kitchen",
                cts.Token);
            var receiptOk = await _api.CanExecuteKindAsync(
                session.AccessToken,
                "receipt",
                cts.Token);
            if (!kitchenOk || !receiptOk)
                throw new InvalidOperationException(
                    "الحساب يحتاج pos.print_kitchen + pos.receipt.print.");

            if (_queueEnabled.Checked && !_config.QueueEnabled)
            {
                var answer = MessageBox.Show(
                    this,
                    "سيبدأ V8 في Claim لطابور Production.\r\n" +
                    "يجب إيقاف V7 أولاً حتى لا يتنافس البرنامجان.\r\n\r\n" +
                    "هل تريد تفعيل الطابور؟",
                    "تفعيل Production queue",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Warning);
                if (answer != DialogResult.Yes)
                    _queueEnabled.Checked = false;
            }

            _config.Email = _email.Text.Trim();
            _config.ProtectedRefreshToken =
                ConfigStore.ProtectToken(session.RefreshToken);
            _config.Routes["kit"] = _kitchen.SelectedItem.ToString()!;
            _config.Routes["main"] = _kitchen.SelectedItem.ToString()!;
            _config.Routes["بار"] = _bar.SelectedItem.ToString()!;
            _config.Routes["bar"] = _bar.SelectedItem.ToString()!;
            _config.Routes["كاش"] = _cash.SelectedItem.ToString()!;
            _config.Routes["cashier"] = _cash.SelectedItem.ToString()!;
            _config.Routes["receipt"] = _cash.SelectedItem.ToString()!;
            _config.QueueEnabled = _queueEnabled.Checked;
            _config.UseRealtimeWake = _realtime.Checked;
            _config.ReconcileSeconds = 300;
            _config.DisconnectedPollSeconds = 15;
            _config.AutoStart = true;

            ConfigStore.Save(_config);
            SavedConfig = _config;
            _password.Text = "";
            _status.Text = _config.QueueEnabled
                ? "تم الحفظ — Production queue مفعل"
                : "تم الحفظ — وضع الاختبار المحلي";
            DialogResult = DialogResult.OK;
            Close();
        }
        catch (Exception ex)
        {
            _status.Text = ex.Message;
            MessageBox.Show(
                this,
                ex.Message,
                "فشل الإعداد",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
        finally
        {
            _save.Enabled = true;
        }
    }

    private async Task TestTemplateAsync(
        ComboBox box,
        JsonElement template)
    {
        if (box.SelectedItem is null)
        {
            MessageBox.Show("اختر الطابعة أولاً.");
            return;
        }

        try
        {
            await _printer.PrintTemplateAsync(
                box.SelectedItem.ToString()!,
                template,
                80);
            MessageBox.Show("تم إرسال فورمة V8.1 التجريبية.");
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                ex.Message,
                "خطأ طباعة",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    private static JsonElement KitchenSample() =>
        JsonSerializer.SerializeToElement(new
        {
            version = 1,
            kind = "kitchen",
            isAr = true,
            paperWidthMm = 80,
            storeName = "JOHNA'S",
            storeSubtitle = "RESTAURANT",
            title = "تذكرة المطبخ",
            subtitle = "نسخة المطبخ",
            station = "Main Kitchen",
            meta = new object[]
            {
                new { label = "رقم الطلب", value = "TEST-V8-001", emphasis = true },
                new { label = "الطاولة", value = "Table 04", emphasis = true },
                new { label = "النوع", value = "داخل الصالة", emphasis = false }
            },
            itemsHeading = "الأصناف",
            items = new object[]
            {
                new
                {
                    qty = "2",
                    name = "Chicken Burger",
                    modifiers = new[] { "Extra Cheese", "No Onion" },
                    notes = "بدون ملح"
                },
                new
                {
                    qty = "1",
                    name = "Water",
                    modifiers = Array.Empty<string>(),
                    notes = ""
                }
            },
            footerLines = new[] { "نهاية الطلب" }
        });

    private static JsonElement CustomerSample() =>
        JsonSerializer.SerializeToElement(new
        {
            version = 1,
            kind = "customer",
            isAr = true,
            paperWidthMm = 80,
            storeName = "JOHNA'S",
            storeSubtitle = "RESTAURANT",
            title = "إيصال العميل",
            subtitle = "نسخة العميل",
            slogan = "Good Food Brings People Together",
            branchName = BuildConfig.BranchName,
            meta = new object[]
            {
                new { label = "رقم الفاتورة", value = "TEST-V8-001", emphasis = true },
                new { label = "الطاولة", value = "Table 04", emphasis = true },
                new { label = "المستخدم", value = "cashier", emphasis = false }
            },
            itemsHeading = "الأصناف",
            items = new object[]
            {
                new { qty = "2", name = "Chicken Burger", price = "120 EGP", total = "240 EGP" },
                new { qty = "1", name = "Water", price = "10 EGP", total = "10 EGP" }
            },
            totals = new object[]
            {
                new { label = "المجموع الفرعي", value = "250 EGP", emphasis = false },
                new { label = "CASH", value = "250 EGP", emphasis = false },
                new { label = "الإجمالي", value = "250 EGP", emphasis = true }
            },
            footerLines = new[] { "شكراً لزيارتكم" }
        });
}
