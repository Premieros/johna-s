using System.Diagnostics;
using System.ServiceProcess;
using System.Windows;
using PremierPrintStation.Core;

namespace PremierPrintStation.Desktop;

public partial class MainWindow : Window
{
    private readonly ConfigStore _configStore = new();
    private readonly AuthTokenStore _tokenStore = new();
    private readonly LocalQueueDb _queue = new();
    private readonly WindowsPrinterDispatcher _printer = new();
    private readonly SupabaseQueueClient _cloud;
    private PrintStationConfig _config;
    private readonly System.Windows.Threading.DispatcherTimer _timer;

    public MainWindow()
    {
        InitializeComponent();
        _cloud = new SupabaseQueueClient(_tokenStore);
        _config = _configStore.Load();
        LoadSettingsToUi();
        LoadPrinters();
        RefreshDashboard();
        _timer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
        _timer.Tick += (_, _) => RefreshDashboard();
        _timer.Start();
    }

    private void LoadSettingsToUi()
    {
        SupabaseUrlBox.Text = _config.SupabaseUrl;
        AnonKeyBox.Password = _config.AnonKey;
        BranchIdBox.Text = _config.BranchId;
        BranchSummary.Text = string.IsNullOrWhiteSpace(_config.BranchId) ? "غير محدد" : _config.BranchId;
        CustomMappingsBox.Text = string.Join(Environment.NewLine,
            _config.StationPrinters
                .Where(kv => !new[] { "kitchen", "bar", "cashier", "receipt" }.Contains(kv.Key, StringComparer.OrdinalIgnoreCase))
                .OrderBy(kv => kv.Key)
                .Select(kv => $"{kv.Key}={kv.Value}"));
    }

    private void LoadPrinters()
    {
        var printers = _printer.InstalledPrinters();
        foreach (var combo in new[] { KitchenPrinterBox, BarPrinterBox, CashierPrinterBox, ReceiptPrinterBox }) combo.ItemsSource = printers;
        KitchenPrinterBox.SelectedItem = GetMapped("kitchen");
        BarPrinterBox.SelectedItem = GetMapped("bar");
        CashierPrinterBox.SelectedItem = GetMapped("cashier");
        ReceiptPrinterBox.SelectedItem = GetMapped("receipt");
    }

    private string? GetMapped(string station) => _config.StationPrinters.TryGetValue(station, out var p) ? p : null;

    private void RefreshDashboard()
    {
        try
        {
            var recent = _queue.GetRecent(200).OrderByDescending(x => x.CreatedAt).ToList();
            JobsGrid.ItemsSource = recent.Take(100).ToList();
            QueueGrid.ItemsSource = recent.Where(x => x.State != JobStates.Completed).ToList();
            PendingCount.Text = recent.Count(x => x.State is JobStates.Received or JobStates.Printing or JobStates.PrintedPendingAck).ToString();
            ReviewCount.Text = recent.Count(x => x.State == JobStates.NeedsReview).ToString();
            var hb = HeartbeatStore.Read();
            if (hb is null)
            {
                StatusText.Text = "الخدمة لم تعمل بعد";
                LastHeartbeat.Text = "—";
                return;
            }
            LastHeartbeat.Text = hb.UpdatedAt.LocalDateTime.ToString("yyyy-MM-dd HH:mm:ss");
            var stale = DateTimeOffset.UtcNow - hb.UpdatedAt > TimeSpan.FromSeconds(15);
            StatusText.Text = stale ? "الخدمة غير مستجيبة" : hb.Status == "online" ? "متصل" : $"خطأ: {hb.Error}";
        }
        catch (Exception ex) { StatusText.Text = ex.Message; }
    }

    private void Refresh_Click(object sender, RoutedEventArgs e) => RefreshDashboard();

    private void SaveSettings_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            _config.SupabaseUrl = SupabaseUrlBox.Text.Trim();
            _config.AnonKey = AnonKeyBox.Password.Trim();
            _config.BranchId = BranchIdBox.Text.Trim();
            SetMapping("kitchen", KitchenPrinterBox.SelectedItem as string);
            SetMapping("bar", BarPrinterBox.SelectedItem as string);
            SetMapping("cashier", CashierPrinterBox.SelectedItem as string);
            SetMapping("receipt", ReceiptPrinterBox.SelectedItem as string);
            ApplyCustomMappings();
            _configStore.Save(_config);
            BranchSummary.Text = string.IsNullOrWhiteSpace(_config.BranchId) ? "غير محدد" : _config.BranchId;
            MessageBox.Show("تم حفظ الإعدادات. الخدمة ستقرأها تلقائيًا في الدورة التالية.", "Premier Print Station", MessageBoxButton.OK, MessageBoxImage.Information);
        }
        catch (Exception ex) { MessageBox.Show(ex.Message, "خطأ", MessageBoxButton.OK, MessageBoxImage.Error); }
    }

    private void SetMapping(string station, string? printer)
    {
        if (string.IsNullOrWhiteSpace(printer)) _config.StationPrinters.Remove(station);
        else _config.StationPrinters[station] = printer;
    }

    private void ApplyCustomMappings()
    {
        var fixedStations = new HashSet<string>(new[] { "kitchen", "bar", "cashier", "receipt" }, StringComparer.OrdinalIgnoreCase);
        foreach (var key in _config.StationPrinters.Keys.Where(k => !fixedStations.Contains(k)).ToList())
            _config.StationPrinters.Remove(key);

        foreach (var rawLine in CustomMappingsBox.Text.Split(new[] { "\r\n", "\n" }, StringSplitOptions.RemoveEmptyEntries))
        {
            var line = rawLine.Trim();
            if (line.Length == 0) continue;
            var separator = line.IndexOf('=');
            if (separator <= 0 || separator == line.Length - 1)
                throw new InvalidOperationException($"صيغة ربط المحطة غير صحيحة: {line}");
            var station = line[..separator].Trim();
            var printer = line[(separator + 1)..].Trim();
            if (fixedStations.Contains(station))
                throw new InvalidOperationException($"استخدم القائمة المخصصة للمحطة القياسية: {station}");
            if (!_printer.InstalledPrinters().Any(p => string.Equals(p, printer, StringComparison.OrdinalIgnoreCase)))
                throw new InvalidOperationException($"الطابعة غير مثبتة: {printer}");
            _config.StationPrinters[station] = printer;
        }
    }

    private async void SignIn_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            SaveSettingsSilently();
            AuthStatus.Text = "جارٍ تسجيل الدخول...";
            var result = await _cloud.SignInAsync(_config, EmailBox.Text.Trim(), PasswordBox.Password);
            PasswordBox.Clear();
            AuthStatus.Text = result.Success ? "تم تسجيل الدخول وحفظ الجلسة بأمان" : $"فشل: {result.Error}";
        }
        catch (Exception ex) { AuthStatus.Text = $"فشل: {ex.Message}"; }
    }

    private void SaveSettingsSilently()
    {
        _config.SupabaseUrl = SupabaseUrlBox.Text.Trim();
        _config.AnonKey = AnonKeyBox.Password.Trim();
        _config.BranchId = BranchIdBox.Text.Trim();
        SetMapping("kitchen", KitchenPrinterBox.SelectedItem as string);
        SetMapping("bar", BarPrinterBox.SelectedItem as string);
        SetMapping("cashier", CashierPrinterBox.SelectedItem as string);
        SetMapping("receipt", ReceiptPrinterBox.SelectedItem as string);
        ApplyCustomMappings();
        _configStore.Save(_config);
    }

    private void RetrySelected_Click(object sender, RoutedEventArgs e)
    {
        if (QueueGrid.SelectedItem is not LocalPrintJob job) return;
        if (job.State == JobStates.PrintedPendingAck)
        {
            MessageBox.Show("هذه الورقة مطبوعة بالفعل وتنتظر تأكيد السحابة؛ لن نعيد طباعتها.", "حماية من التكرار", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }
        var ok = MessageBox.Show(
            job.State == JobStates.NeedsReview
                ? "هذه المهمة كانت في حالة طباعة وقت توقف البرنامج. إعادة المحاولة قد تطبع نسخة ثانية. هل أنت متأكد؟"
                : "إعادة محاولة هذه المهمة؟",
            "تأكيد إعادة المحاولة", MessageBoxButton.YesNo, MessageBoxImage.Warning);
        if (ok != MessageBoxResult.Yes) return;
        _queue.ApproveCloudRetry(job.Id);
        MessageBox.Show("تم اعتماد إعادة المحاولة. ستنتظر المهمة Claim جديدًا من السحابة قبل الطباعة لحماية النظام من التكرار.", "Premier Print Station", MessageBoxButton.OK, MessageBoxImage.Information);
        RefreshDashboard();
    }

    private async void TestPrint_Click(object sender, RoutedEventArgs e)
    {
        var printer = KitchenPrinterBox.SelectedItem as string ?? CashierPrinterBox.SelectedItem as string ?? ReceiptPrinterBox.SelectedItem as string;
        if (string.IsNullOrWhiteSpace(printer))
        {
            MessageBox.Show("اختر طابعة أولاً من الإعدادات.");
            return;
        }
        var text = $"Premier Print Station\nTEST PRINT\n{DateTime.Now:yyyy-MM-dd HH:mm:ss}\nPrinter: {printer}\n";
        var result = await _printer.PrintAsync(printer, new CloudPrintPayload(text, null, 80, 1));
        MessageBox.Show(result.Accepted ? "تم إرسال Test Print إلى Windows Spooler." : $"فشل: {result.Error}");
    }

    private void OpenDataFolder_Click(object sender, RoutedEventArgs e)
    {
        StationPaths.Ensure();
        Process.Start(new ProcessStartInfo("explorer.exe", StationPaths.Root) { UseShellExecute = true });
    }
}
