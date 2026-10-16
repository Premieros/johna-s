using System.Drawing;
using System.Reflection;
using PremierSmouhaFormPrintAgentV08;

static void Require(bool value, string message)
{
    if (!value) throw new Exception(message);
}
// No Print(), SendRaw(), test job, physical printer, or network call in this test.
var render = typeof(EscPosPrinter).GetMethod("RenderLegacyText", BindingFlags.NonPublic | BindingFlags.Static)!;
foreach (var width in new[] { 384, 576 })
{
    var text = string.Join("\r\n", Enumerable.Range(0, 527).Select(i => $"الخامة رقم {i}: 1.2345 kg | 120 EGP"));
    using var image = (Bitmap)render.Invoke(null, new object[] { text, width, true })!;
    Require(image.Width == width && image.Height > 10000, "Long Arabic report rendered fully");
    var ink = false;
    for (var y = image.Height - 200; y < image.Height - 54; y++)
        for (var x = 16; x < width - 16; x++)
            ink |= image.GetPixel(x, y).R < 180;
    Require(ink, "Last material still rendered, no vertical truncation");
    foreach (var maxRows in new[] { 1, 20, 100, 1179, 1500, 4000 })
    {
        var seen = new bool[image.Height];
        var y = 0;
        while (y < image.Height)
        {
            var rows = EscPosPrinter.ReportRowsToPrint(image.Height, y, maxRows, width == 384 ? 24 : 29);
            Require(rows > 0 && rows <= maxRows && y + rows <= image.Height, "Page bounds");
            for (var i = y; i < y + rows; i++) { Require(!seen[i], "No duplicate row"); seen[i] = true; }
            y += rows;
        }
        Require(seen.All(v => v), "No dropped source rows");
    }
}
using (var image = (Bitmap)render.Invoke(null, new object[] { "Z-REPORT\nالنقدية: 250 EGP\nالفارق: -5 EGP", 576, true })!)
{
    Require(image.Height < 250, "Compact report font and line spacing");
}
Console.WriteLine("PASS: long Arabic 58/80mm reports, last-row ink, exact page coverage, compact rendering. No physical printing.");
