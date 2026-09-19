using System;
using System.Linq;
using System.Net;
using System.Threading;
using System.Windows.Forms;

namespace PremierCleopatraPrintAgent
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            bool created;
            using (var mutex = new Mutex(true, "PremierCleopatraPrintAgent.SingleInstance", out created))
            {
                if (!created) return;
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);

                if (string.IsNullOrWhiteSpace(BuildConfig.AnonKey) || BuildConfig.AnonKey.Contains("__VITE_"))
                {
                    MessageBox.Show("Agent build is missing the Supabase anon key.", "Build error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }

                var startHidden = Environment.GetCommandLineArgs().Any(x =>
                    string.Equals(x, "--background", StringComparison.OrdinalIgnoreCase));
                var config = ConfigStore.Load();
                using (var api = new SupabaseApi())
                {
                    var printer = new RawEscPosPrinter();
                    if (string.IsNullOrWhiteSpace(ConfigStore.UnprotectToken(config.ProtectedRefreshToken)))
                    {
                        using (var setup = new SetupForm(api, printer, config))
                        {
                            if (setup.ShowDialog() != DialogResult.OK || setup.SavedConfig == null) return;
                            config = setup.SavedConfig;
                        }
                    }
                    Application.Run(new TrayHostForm(api, printer, config, startHidden));
                }
            }
        }
    }
}
