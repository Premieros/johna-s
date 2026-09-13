using System;
using System.Linq;
using System.Net;
using System.Threading;
using System.Windows.Forms;

namespace PremierPrintAgentLite
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            bool created;
            using (var mutex = new Mutex(true, "PremierPrintAgentLite.SingleInstance", out created))
            {
                if (!created) return;
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                var startHidden = Environment.GetCommandLineArgs().Any(x => string.Equals(x, "--background", StringComparison.OrdinalIgnoreCase));
                Application.Run(new MainForm(startHidden));
            }
        }
    }
}
