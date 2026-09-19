using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Win32;

namespace PremierCleopatraPrintAgent
{
    internal sealed class AgentConfig
    {
        public string Email { get; set; } = "";
        public string ProtectedRefreshToken { get; set; } = "";
        public string AgentId { get; set; } = Guid.NewGuid().ToString();
        public bool Enabled { get; set; } = true;
        public bool AutoStart { get; set; } = true;
        public Dictionary<string, string> Routes { get; set; } = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    }

    internal static class ConfigStore
    {
        private static readonly string Folder = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "PremierCleopatraPrintAgent");
        private static readonly string FilePath = Path.Combine(Folder, "config.json");

        internal static AgentConfig Load()
        {
            try
            {
                if (!File.Exists(FilePath)) return new AgentConfig();
                var config = JsonSerializer.Deserialize<AgentConfig>(File.ReadAllText(FilePath, Encoding.UTF8)) ?? new AgentConfig();
                if (config.Routes == null) config.Routes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                if (string.IsNullOrWhiteSpace(config.AgentId)) config.AgentId = Guid.NewGuid().ToString();
                return config;
            }
            catch { return new AgentConfig(); }
        }

        internal static void Save(AgentConfig config)
        {
            Directory.CreateDirectory(Folder);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(config, new JsonSerializerOptions { WriteIndented = true }), Encoding.UTF8);
            SetAutoStart(config.AutoStart);
        }

        internal static string ProtectToken(string token)
        {
            if (string.IsNullOrWhiteSpace(token)) return "";
            var bytes = Encoding.UTF8.GetBytes(token);
            return Convert.ToBase64String(ProtectedData.Protect(bytes, null, DataProtectionScope.CurrentUser));
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
                    const string name = "PremierCleopatraPrintAgent";
                    if (enabled) key.SetValue(name, "\"" + System.Windows.Forms.Application.ExecutablePath + "\" --background");
                    else key.DeleteValue(name, false);
                }
            }
            catch { }
        }
    }
}
