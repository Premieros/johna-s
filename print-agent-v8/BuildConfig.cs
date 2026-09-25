namespace PremierSmouhaFormPrintAgentV08;

internal static class BuildConfig
{
    internal const string AppName = "Premier Cleopatra Form Print Agent V8.1.1 Lite";
    internal const string AppId = "PremierCleopatraFormPrintAgentV0811";
    internal const string SupabaseUrl = "https://azzdesuowpdcoflmyezn.supabase.co";
    internal const string PublishableKey = "sb_publishable_Vnv7uRZCJ-Oq5mA1fKG7LA_oWShi3xe";
    internal const string BranchId = "279e6662-e901-40b2-9170-7dda0b471ba7";
    internal const string BranchName = "Johna's Cleopatra Branch";
    internal const string WakeTable = "cloud_print_wake_state";
    internal const int ClaimBatchSize = 25;

    internal static string RealtimeUrl =>
        SupabaseUrl.Replace("https://", "wss://", StringComparison.OrdinalIgnoreCase)
            .TrimEnd('/') + "/realtime/v1/websocket?apikey=" +
        Uri.EscapeDataString(PublishableKey) + "&vsn=1.0.0";
}
