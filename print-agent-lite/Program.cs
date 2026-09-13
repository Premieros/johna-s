using System;
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
                Application.Run(new MainForm());
            }
        }
    }
}
