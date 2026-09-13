using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using Microsoft.Win32;

namespace PremierPrintAgentLite
{
    internal sealed class AgentConfig
    {
        public string Email { get; set; }
        public string ProtectedRefreshToken { get; set; }
        public string BranchId { get; set; }
        public string BranchName { get; set; }
        public string AgentId { get; set; }
        public bool Enabled { get; set; }
        public bool AutoStart { get; set; }
        public Dictionary<string, string> Routes { get; set; }

        public AgentConfig()
        {
            Email = "";
            ProtectedRefreshToken = "";
            BranchId = "";
            BranchName = "";
            AgentId = Guid.NewGuid().ToString();
            Enabled = true;
            AutoStart = true;
            Routes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        }
    }

    internal static class ConfigStore
    {
        private static readonly string Folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PremierPrintAgentLite");
        private static readonly string FilePath = Path.Combine(Folder, "config.json");
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

        internal static AgentConfig Load()
        {
            try
            {
                if (!File.Exists(FilePath)) return new AgentConfig();
                var config = Json.Deserialize<AgentConfig>(File.ReadAllText(FilePath, Encoding.UTF8)) ?? new AgentConfig();
                if (config.Routes == null) config.Routes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                if (string.IsNullOrWhiteSpace(config.AgentId)) config.AgentId = Guid.NewGuid().ToString();
                return config;
            }
            catch { return new AgentConfig(); }
        }

        internal static void Save(AgentConfig config)
        {
            Directory.CreateDirectory(Folder);
            File.WriteAllText(FilePath, Json.Serialize(config), Encoding.UTF8);
            SetAutoStart(config.AutoStart);
        }

        internal static string ProtectToken(string token)
        {
            if (string.IsNullOrWhiteSpace(token)) return "";
            var bytes = Encoding.UTF8.GetBytes(token);
            var protectedBytes = ProtectedData.Protect(bytes, null, DataProtectionScope.CurrentUser);
            return Convert.ToBase64String(protectedBytes);
        }

        internal static string UnprotectToken(string encrypted)
        {
            if (string.IsNullOrWhiteSpace(encrypted)) return "";
            try
            {
                var bytes = Convert.FromBase64String(encrypted);
                return Encoding.UTF8.GetString(ProtectedData.Unprotect(bytes, null, DataProtectionScope.CurrentUser));
            }
            catch { return ""; }
        }

        private static void SetAutoStart(bool enabled)
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Run", true))
                {
                    if (key == null) return;
                    const string name = "PremierPrintAgentLite";
                    if (enabled) key.SetValue(name, "\"" + System.Windows.Forms.Application.ExecutablePath + "\"");
                    else key.DeleteValue(name, false);
                }
            }
            catch { }
        }
    }
}
