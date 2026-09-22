using System.Net;
using System.Threading;

namespace PremierSmouhaFormPrintAgentV08;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        using var mutex = new Mutex(
            initiallyOwned: true,
            name: BuildConfig.AppId + ".SingleInstance",
            createdNew: out var created);

        if (!created) return;

        ApplicationConfiguration.Initialize();

        var startHidden = Environment.GetCommandLineArgs().Any(x =>
            string.Equals(
                x,
                "--background",
                StringComparison.OrdinalIgnoreCase));

        var config = ConfigStore.Load();
        using var api = new SupabaseApi();
        var printer = new EscPosPrinter();

        if (string.IsNullOrWhiteSpace(
                ConfigStore.UnprotectToken(config.ProtectedRefreshToken)))
        {
            using var setup = new SetupForm(api, printer, config);
            if (setup.ShowDialog() != DialogResult.OK ||
                setup.SavedConfig is null)
                return;
            config = setup.SavedConfig;
        }

        Application.Run(
            new TrayHostForm(
                api,
                printer,
                config,
                startHidden));
    }
}
