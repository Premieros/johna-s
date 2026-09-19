using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Printing;
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

        internal async Task<Dictionary<string, object>> PrintAsync(string printerName, string text, string html, int copies, int paperWidthMm)
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
                return await Task.Run(() => PrintText(
                    printerName,
                    printable,
                    Math.Max(1, Math.Min(5, copies)),
                    NormalizePaperWidthMm(paperWidthMm)
                )).ConfigureAwait(false);
            }
            finally { lane.Release(); }
        }

        internal async Task<Dictionary<string, object>> KickDrawerAsync(string printerName)
        {
            printerName = (printerName ?? "").Trim();
            if (printerName.Length == 0) return Fail("PRINTER_NAME_REQUIRED");
            return await Task.Run(() => RawPrinter.Send(
                printerName,
                new byte[] { 0x1B, 0x70, 0x00, 0x19, 0xFA },
                "Premier Cash Drawer"
            ) ? Ok() : Fail("DRAWER_WRITE_FAILED")).ConfigureAwait(false);
        }

        private static Dictionary<string, object> PrintText(string printerName, string text, int copies, int paperWidthMm)
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
                            DrawRasterPage(e, font, lines, ref index, paperWidthMm);
                        };

                        document.Print();

                        // Submission succeeded. Auto-cut is best-effort only: a cut failure must never
                        // mark the receipt failed because retrying could duplicate a physical receipt.
                        Thread.Sleep(250);
                        RawPrinter.Cut(printerName);
                        Thread.Sleep(75);
                    }
                }
                return Ok();
            }
            catch (Exception ex) { return Fail(ex.GetType().Name + ":" + ex.Message); }
        }

        private static void DrawRasterPage(PrintPageEventArgs e, Font font, string[] lines, ref int index, int paperWidthMm)
        {
            var dpiX = Math.Max(96f, e.Graphics.DpiX);
            var dpiY = Math.Max(96f, e.Graphics.DpiY);
            var requestedWidthHundredths = (float)(paperWidthMm / 25.4 * 100.0);
            var widthHundredths = Math.Max(1f, Math.Min(e.MarginBounds.Width, requestedWidthHundredths));
            var maxHeightHundredths = Math.Max(1f, e.MarginBounds.Height);
            var bitmapWidth = Math.Max(1, (int)Math.Ceiling(widthHundredths / 100f * dpiX));
            var maxBitmapHeight = Math.Max(1, (int)Math.Ceiling(maxHeightHundredths / 100f * dpiY));
            var sidePadding = Math.Max(2f, dpiX * 0.03f);
            var topPadding = Math.Max(2f, dpiY * 0.03f);

            float lineHeight;
            using (var measure = new Bitmap(8, 8))
            {
                measure.SetResolution(dpiX, dpiY);
                using (var graphics = Graphics.FromImage(measure))
                {
                    lineHeight = font.GetHeight(graphics) + Math.Max(2f, dpiY * 0.01f);
                }
            }

            var pageStart = index;
            var y = topPadding;
            while (index < lines.Length)
            {
                var line = lines[index];
                if (line == "\f")
                {
                    index++;
                    break;
                }

                if (y + (lineHeight * 2f) > maxBitmapHeight && index > pageStart) break;
                index++;
                y += lineHeight;
            }

            if (index == pageStart && index < lines.Length) index++;

            var usedLines = lines.Skip(pageStart).Take(Math.Max(0, index - pageStart)).Where(x => x != "\f").ToArray();
            var contentHeight = Math.Max(
                (int)Math.Ceiling(topPadding * 2f + Math.Max(1, usedLines.Length) * lineHeight),
                1
            );
            contentHeight = Math.Min(contentHeight, maxBitmapHeight);

            using (var bitmap = new Bitmap(bitmapWidth, contentHeight))
            {
                bitmap.SetResolution(dpiX, dpiY);
                using (var graphics = Graphics.FromImage(bitmap))
                {
                    graphics.Clear(Color.White);
                    var drawY = topPadding;
                    foreach (var line in usedLines)
                    {
                        using (var format = new StringFormat())
                        {
                            if (ContainsArabic(line))
                            {
                                format.FormatFlags |= StringFormatFlags.DirectionRightToLeft;
                                format.Alignment = StringAlignment.Far;
                            }

                            graphics.DrawString(
                                line,
                                font,
                                Brushes.Black,
                                new RectangleF(
                                    sidePadding,
                                    drawY,
                                    Math.Max(1f, bitmap.Width - (sidePadding * 2f)),
                                    lineHeight * 2f
                                ),
                                format
                            );
                        }
                        drawY += lineHeight;
                    }
                }

                var destinationHeight = Math.Max(1f, bitmap.Height / dpiY * 100f);
                e.Graphics.DrawImage(
                    bitmap,
                    new RectangleF(e.MarginBounds.Left, e.MarginBounds.Top, widthHundredths, destinationHeight),
                    new RectangleF(0f, 0f, bitmap.Width, bitmap.Height),
                    GraphicsUnit.Pixel
                );
            }

            e.HasMorePages = index < lines.Length;
        }

        private static int NormalizePaperWidthMm(int value)
        {
            if (value <= 0) return 80;
            return Math.Max(48, Math.Min(90, value));
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

        internal static bool Cut(string printerName)
        {
            // ESC/POS: feed three lines, then full cut.
            return Send(
                printerName,
                new byte[] { 0x1B, 0x64, 0x03, 0x1D, 0x56, 0x00 },
                "Premier Auto Cut"
            );
        }

        internal static bool Send(string printerName, byte[] data, string documentName = "Premier Raw Command")
        {
            IntPtr handle;
            if (!OpenPrinter(printerName, out handle, IntPtr.Zero)) return false;
            var pointer = IntPtr.Zero;
            try
            {
                var doc = new DOCINFOA { pDocName = documentName, pDataType = "RAW" };
                if (!StartDocPrinter(handle, 1, doc) || !StartPagePrinter(handle)) return false;
                pointer = Marshal.AllocCoTaskMem(data.Length);
                Marshal.Copy(data, 0, pointer, data.Length);
                int written;
                var ok = WritePrinter(handle, pointer, data.Length, out written) && written == data.Length;
                EndPagePrinter(handle);
                EndDocPrinter(handle);
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
