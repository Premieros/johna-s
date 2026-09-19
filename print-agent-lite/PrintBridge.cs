using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Printing;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Linq;
using System.Net;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace PremierPrintAgentLite
{
    internal sealed class PrintBridge
    {
        private readonly ConcurrentDictionary<string, SemaphoreSlim> _lanes = new ConcurrentDictionary<string, SemaphoreSlim>(StringComparer.OrdinalIgnoreCase);

        internal List<Dictionary<string, object>> GetPrinters()
        {
            var defaultName = new PrinterSettings().PrinterName;
            var result = new List<Dictionary<string, object>>();
            foreach (string printer in PrinterSettings.InstalledPrinters)
            {
                result.Add(new Dictionary<string, object> {
                    { "name", printer },
                    { "displayName", printer },
                    { "isDefault", string.Equals(printer, defaultName, StringComparison.OrdinalIgnoreCase) },
                    { "status", 0 }
                });
            }
            return result;
        }

        internal async Task<Dictionary<string, object>> PrintAsync(string printerName, string text, string html, int copies)
        {
            printerName = (printerName ?? "").Trim();
            if (printerName.Length == 0) return Fail("PRINTER_NAME_REQUIRED");
            if (!PrinterSettings.InstalledPrinters.Cast<string>().Any(x => string.Equals(x, printerName, StringComparison.OrdinalIgnoreCase))) return Fail("PRINTER_NOT_FOUND:" + printerName);
            var printable = !string.IsNullOrWhiteSpace(text) ? text : HtmlToText(html);
            if (string.IsNullOrWhiteSpace(printable)) return Fail("NO_CONTENT_TO_PRINT");

            var lane = _lanes.GetOrAdd(printerName, _ => new SemaphoreSlim(1, 1));
            await lane.WaitAsync().ConfigureAwait(false);
            try
            {
                return await Task.Run(() => PrintText(printerName, printable, Math.Max(1, Math.Min(5, copies)))).ConfigureAwait(false);
            }
            finally { lane.Release(); }
        }

        internal async Task<Dictionary<string, object>> KickDrawerAsync(string printerName)
        {
            printerName = (printerName ?? "").Trim();
            if (printerName.Length == 0) return Fail("PRINTER_NAME_REQUIRED");
            return await Task.Run(() => RawPrinter.Send(printerName, new byte[] { 0x1B, 0x70, 0x00, 0x19, 0xFA }) ? Ok() : Fail("DRAWER_WRITE_FAILED")).ConfigureAwait(false);
        }

        private static Dictionary<string, object> PrintText(string printerName, string text, int copies)
        {
            try
            {
                for (var copy = 0; copy < copies; copy++)
                {
                    using (var document = new PrintDocument())
                    using (var font = new Font("Tahoma", 9f, FontStyle.Regular, GraphicsUnit.Point))
                    {
                        document.DocumentName = "Premier Print Agent Lite";
                        document.PrintController = new StandardPrintController();
                        document.PrinterSettings.PrinterName = printerName;
                        if (!document.PrinterSettings.IsValid) return Fail("INVALID_PRINTER:" + printerName);
                        document.DefaultPageSettings.Margins = new Margins(0, 0, 0, 0);
                        var lines = NormalizeLines(text);
                        var index = 0;
                        document.PrintPage += delegate(object sender, PrintPageEventArgs e)
                        {
                            var left = e.MarginBounds.Left + 3f;
                            var right = e.MarginBounds.Right - 3f;
                            var y = e.MarginBounds.Top + 3f;
                            var height = font.GetHeight(e.Graphics) + 2f;
                            while (index < lines.Length)
                            {
                                var line = lines[index++];
                                if (line == "\f") { e.HasMorePages = index < lines.Length; return; }
                                using (var format = new StringFormat())
                                {
                                    if (ContainsArabic(line)) { format.FormatFlags |= StringFormatFlags.DirectionRightToLeft; format.Alignment = StringAlignment.Far; }
                                    DrawRasterizedLine(
                                        e.Graphics,
                                        line,
                                        font,
                                        format,
                                        new RectangleF(left, y, Math.Max(1, right - left), height * 2f));
                                }
                                y += height;
                                if (y + height > e.MarginBounds.Bottom) { e.HasMorePages = index < lines.Length; return; }
                            }
                            e.HasMorePages = false;
                        };
                        document.Print();
                        // Preserve the proven 1.0 PrintDocument path, but give thermal drivers a brief moment
                        // to enqueue the document before the next job in this printer's lane starts.
                        Thread.Sleep(150);
                    }
                }
                return Ok();
            }
            catch (Exception ex) { return Fail(ex.GetType().Name + ":" + ex.Message); }
        }

        private static void DrawRasterizedLine(Graphics printerGraphics, string line, Font font, StringFormat format, RectangleF destination)
        {
            // Rasterize text before it reaches the thermal printer driver.
            // This keeps Arabic/Unicode shaping inside Windows GDI+ and prevents
            // printers/code pages from reinterpreting UTF text as ESC/POS bytes.
            var dpiX = Math.Max(96f, printerGraphics.DpiX);
            var dpiY = Math.Max(96f, printerGraphics.DpiY);
            var pixelWidth = Math.Max(1, (int)Math.Ceiling((destination.Width / 100f) * dpiX));
            var pixelHeight = Math.Max(1, (int)Math.Ceiling((destination.Height / 100f) * dpiY));

            using (var bitmap = new Bitmap(pixelWidth, pixelHeight, PixelFormat.Format32bppArgb))
            {
                bitmap.SetResolution(dpiX, dpiY);
                using (var graphics = Graphics.FromImage(bitmap))
                using (var bitmapFormat = (StringFormat)format.Clone())
                {
                    graphics.Clear(Color.White);
                    graphics.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
                    graphics.DrawString(
                        line ?? "",
                        font,
                        Brushes.Black,
                        new RectangleF(0f, 0f, pixelWidth, pixelHeight),
                        bitmapFormat);
                }
                printerGraphics.DrawImage(bitmap, destination);
            }
        }

        private static string[] NormalizeLines(string text)
        {
            return (text ?? "").Replace("\r\n", "\n").Replace('\r', '\n').Replace("\f", "\n\f\n").Split(new[] { '\n' }, StringSplitOptions.None);
        }

        private static bool ContainsArabic(string value)
        {
            return Regex.IsMatch(value ?? "", "[\\u0600-\\u06FF]");
        }

        private static string HtmlToText(string html)
        {
            if (string.IsNullOrWhiteSpace(html)) return "";
            var normalized = Regex.Replace(html, "(?i)<br\\s*/?>|</p>|</div>|</tr>|</li>", "\n");
            normalized = Regex.Replace(normalized, "<[^>]+>", " ");
            normalized = WebUtility.HtmlDecode(normalized);
            normalized = Regex.Replace(normalized, "[ \\t]+", " ");
            normalized = Regex.Replace(normalized, "\\n\\s*\\n+", "\n");
            return normalized.Trim();
        }

        private static Dictionary<string, object> Ok() { return new Dictionary<string, object> { { "success", true } }; }
        private static Dictionary<string, object> Fail(string error) { return new Dictionary<string, object> { { "success", false }, { "error", error } }; }
    }

    internal static class RawPrinter
    {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)] private class DOCINFOA { [MarshalAs(UnmanagedType.LPStr)] public string pDocName; [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPStr)] public string pDataType; }
        [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi)] private static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
        [DllImport("winspool.Drv", SetLastError = true)] private static extern bool ClosePrinter(IntPtr handle);
        [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi)] private static extern bool StartDocPrinter(IntPtr handle, int level, [In] DOCINFOA di);
        [DllImport("winspool.Drv", SetLastError = true)] private static extern bool EndDocPrinter(IntPtr handle);
        [DllImport("winspool.Drv", SetLastError = true)] private static extern bool StartPagePrinter(IntPtr handle);
        [DllImport("winspool.Drv", SetLastError = true)] private static extern bool EndPagePrinter(IntPtr handle);
        [DllImport("winspool.Drv", SetLastError = true)] private static extern bool WritePrinter(IntPtr handle, IntPtr bytes, int count, out int written);

        internal static bool Send(string printerName, byte[] data)
        {
            IntPtr handle;
            if (!OpenPrinter(printerName, out handle, IntPtr.Zero)) return false;
            var pointer = IntPtr.Zero;
            try
            {
                var doc = new DOCINFOA { pDocName = "Premier Cash Drawer", pDataType = "RAW" };
                if (!StartDocPrinter(handle, 1, doc) || !StartPagePrinter(handle)) return false;
                pointer = Marshal.AllocCoTaskMem(data.Length);
                Marshal.Copy(data, 0, pointer, data.Length);
                int written;
                var ok = WritePrinter(handle, pointer, data.Length, out written) && written == data.Length;
                EndPagePrinter(handle); EndDocPrinter(handle);
                return ok;
            }
            finally
            {
                if (pointer != IntPtr.Zero) Marshal.FreeCoTaskMem(pointer);
                ClosePrinter(handle);
            }
        }
    }
}
