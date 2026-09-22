using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Win32;

namespace PremierSmouhaFormPrintAgentV08;

internal sealed class AgentConfig
{
    public string Email { get; set; } = "";
    public string ProtectedRefreshToken { get; set; } = "";
    public string AgentId { get; set; } = Guid.NewGuid().ToString();
    public bool QueueEnabled { get; set; } = false;
    public bool AutoStart { get; set; } = true;
    public bool UseRealtimeWake { get; set; } = true;
    public int ReconcileSeconds { get; set; } = 300;
    public int DisconnectedPollSeconds { get; set; } = 15;
    public Dictionary<string, string> Routes { get; set; } =
        new(StringComparer.OrdinalIgnoreCase);
}

internal static class ConfigStore
{
    private static readonly string Folder = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        BuildConfig.AppId);
    private static readonly string FilePath = Path.Combine(Folder, "config.json");

    internal static AgentConfig Load()
    {
        try
        {
            if (!File.Exists(FilePath)) return new AgentConfig();
            var cfg = JsonSerializer.Deserialize<AgentConfig>(
                File.ReadAllText(FilePath, Encoding.UTF8)) ?? new AgentConfig();
            cfg.Routes ??= new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (string.IsNullOrWhiteSpace(cfg.AgentId)) cfg.AgentId = Guid.NewGuid().ToString();
            cfg.ReconcileSeconds = Math.Clamp(cfg.ReconcileSeconds, 60, 900);
            cfg.DisconnectedPollSeconds = Math.Clamp(cfg.DisconnectedPollSeconds, 5, 60);
            return cfg;
        }
        catch
        {
            return new AgentConfig();
        }
    }

    internal static void Save(AgentConfig config)
    {
        Directory.CreateDirectory(Folder);
        File.WriteAllText(
            FilePath,
            JsonSerializer.Serialize(config, new JsonSerializerOptions { WriteIndented = true }),
            Encoding.UTF8);
        SetAutoStart(config.AutoStart);
    }

    internal static string ProtectToken(string token)
    {
        if (string.IsNullOrWhiteSpace(token)) return "";
        var raw = Encoding.UTF8.GetBytes(token);
        return Convert.ToBase64String(
            ProtectedData.Protect(raw, null, DataProtectionScope.CurrentUser));
    }

    internal static string UnprotectToken(string encrypted)
    {
        if (string.IsNullOrWhiteSpace(encrypted)) return "";
        try
        {
            var raw = Convert.FromBase64String(encrypted);
            return Encoding.UTF8.GetString(
                ProtectedData.Unprotect(raw, null, DataProtectionScope.CurrentUser));
        }
        catch
        {
            return "";
        }
    }

    private static void SetAutoStart(bool enabled)
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Run", writable: true);
            if (key is null) return;
            if (enabled)
                key.SetValue(
                    BuildConfig.AppId,
                    $"\"{Application.ExecutablePath}\" --background");
            else
                key.DeleteValue(BuildConfig.AppId, throwOnMissingValue: false);
        }
        catch
        {
            // Auto-start failure must never block printing.
        }
    }
}
