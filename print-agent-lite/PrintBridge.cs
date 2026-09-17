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
        private readonly ConcurrentDictionary<string, int> _queueDepth = new ConcurrentDictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        private static readonly int[] PreflightRetryDelaysMs = { 150, 350 };

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
            if (!PrinterInstalled(printerName)) return Fail("PRINTER_NOT_FOUND:" + printerName);
            var printable = !string.IsNullOrWhiteSpace(text) ? text : HtmlToText(html);
            if (string.IsNullOrWhiteSpace(printable)) return Fail("NO_CONTENT_TO_PRINT");

            var queuedAhead = Math.Max(0, _queueDepth.AddOrUpdate(printerName, 1, delegate(string _, int depth) { return depth + 1; }) - 1);
            var lane = _lanes.GetOrAdd(printerName, _ => new SemaphoreSlim(1, 1));
            await lane.WaitAsync().ConfigureAwait(false);
            try
            {
                var result = await Task.Run(() => PrintText(printerName, printable, Math.Max(1, Math.Min(5, copies)))).ConfigureAwait(false);
                if (result.TryGetValue("success", out var success) && success is bool ok && ok)
                {
                    result["acceptedBySpooler"] = true;
                    result["queuedAhead"] = queuedAhead;
                }
                return result;
            }
            finally
            {
                lane.Release();
                var remaining = _queueDepth.AddOrUpdate(printerName, 0, delegate(string _, int depth) { return Math.Max(0, depth - 1); });
                if (remaining <= 0) _queueDepth.TryRemove(printerName, out _);
            }
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
                EnsurePrinterReadyWithRetry(printerName);

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
                                    e.Graphics.DrawString(line, font, Brushes.Black, new RectangleF(left, y, Math.Max(1, right - left), height * 2f), format);
                                }
                                y += height;
                                if (y + height > e.MarginBounds.Bottom) { e.HasMorePages = index < lines.Length; return; }
                            }
                            e.HasMorePages = false;
                        };

                        document.Print();
                    }
                }
                return Ok();
            }
            catch (Exception ex) { return Fail(ex.GetType().Name + ":" + ex.Message); }
        }

        private static void EnsurePrinterReadyWithRetry(string printerName)
        {
            Exception lastError = null;
            for (var attempt = 0; attempt <= PreflightRetryDelaysMs.Length; attempt++)
            {
                try
                {
                    EnsurePrinterReady(printerName);
                    return;
                }
                catch (Exception ex)
                {
                    lastError = ex;
                    if (attempt >= PreflightRetryDelaysMs.Length) break;
                    Thread.Sleep(PreflightRetryDelaysMs[attempt]);
                }
            }
            throw lastError ?? new InvalidOperationException("PRINTER_NOT_READY");
        }

        private static void EnsurePrinterReady(string printerName)
        {
            if (!PrinterInstalled(printerName))
                throw new InvalidOperationException("PRINTER_NOT_FOUND:" + printerName);

            var settings = new PrinterSettings { PrinterName = printerName };
            if (!settings.IsValid)
                throw new InvalidOperationException("INVALID_PRINTER:" + printerName);
        }

        private static bool PrinterInstalled(string printerName)
        {
            return PrinterSettings.InstalledPrinters.Cast<string>()
                .Any(x => string.Equals(x, printerName, StringComparison.OrdinalIgnoreCase));
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
