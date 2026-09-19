using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Drawing.Printing;

namespace PremierCleopatraPrintAgent
{
    internal sealed class RawEscPosPrinter
    {
        private readonly ConcurrentDictionary<string, SemaphoreSlim> _lanes =
            new ConcurrentDictionary<string, SemaphoreSlim>(StringComparer.OrdinalIgnoreCase);

        internal List<string> GetPrinters()
        {
            return PrinterSettings.InstalledPrinters.Cast<string>().OrderBy(x => x).ToList();
        }

        internal async Task PrintAsync(string printerName, string text, int paperWidthMm)
        {
            printerName = printerName ?? "";
            if (string.IsNullOrWhiteSpace(printerName)) throw new InvalidOperationException("PRINTER_NAME_REQUIRED");
            if (!GetPrinters().Contains(printerName)) throw new InvalidOperationException("PRINTER_NOT_FOUND:" + printerName);
            var lane = _lanes.GetOrAdd(printerName, _ => new SemaphoreSlim(1, 1));
            await lane.WaitAsync().ConfigureAwait(false);
            try
            {
                await Task.Run(() => {
                    using (var ticket = RenderTicket(text ?? "", paperWidthMm <= 58 ? 384 : 576))
                        SendRaw(printerName, BuildEscPosRaster(ticket));
                }).ConfigureAwait(false);
            }
            finally { lane.Release(); }
        }

        private static Bitmap RenderTicket(string text, int widthDots)
        {
            var normalized = (text ?? "").Replace("\r\n", "\n").Replace('\r', '\n');
            var sourceLines = normalized.Split(new[] { '\n' }, StringSplitOptions.None);
            var lines = new List<string>();
            using (var measureBitmap = new Bitmap(1, 1))
            using (var measureGraphics = Graphics.FromImage(measureBitmap))
            using (var font = new Font("Tahoma", 22f, FontStyle.Regular, GraphicsUnit.Pixel))
            {
                measureGraphics.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
                foreach (var raw in sourceLines)
                    foreach (var wrapped in WrapLine(measureGraphics, raw ?? "", font, widthDots - 24))
                        lines.Add(wrapped);
            }
            const int lineHeight = 31, top = 12, bottom = 42;
            var height = Math.Max(96, top + Math.Max(1, lines.Count) * lineHeight + bottom);
            var bitmap = new Bitmap(widthDots, height, PixelFormat.Format32bppArgb);
            bitmap.SetResolution(203f, 203f);
            using (var g = Graphics.FromImage(bitmap))
            using (var font = new Font("Tahoma", 22f, FontStyle.Regular, GraphicsUnit.Pixel))
            {
                g.Clear(Color.White);
                g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
                float y = top;
                foreach (var line in lines)
                {
                    using (var format = new StringFormat(StringFormatFlags.NoClip))
                    {
                        if (Regex.IsMatch(line ?? "", "[\\u0600-\\u06FF]"))
                        {
                            format.FormatFlags |= StringFormatFlags.DirectionRightToLeft;
                            format.Alignment = StringAlignment.Far;
                        }
                        else format.Alignment = StringAlignment.Near;
                        g.DrawString(line, font, Brushes.Black, new RectangleF(12f, y, widthDots - 24f, lineHeight + 8f), format);
                    }
                    y += lineHeight;
                }
            }
            return bitmap;
        }

        private static IEnumerable<string> WrapLine(Graphics g, string line, Font font, int maxWidth)
        {
            if (string.IsNullOrEmpty(line)) { yield return ""; yield break; }
            if (g.MeasureString(line, font).Width <= maxWidth) { yield return line; yield break; }
            var words = Regex.Split(line, "(\\s+)");
            var current = new StringBuilder();
            foreach (var word in words)
            {
                var candidate = current.ToString() + word;
                if (current.Length > 0 && g.MeasureString(candidate, font).Width > maxWidth)
                {
                    yield return current.ToString().TrimEnd();
                    current.Clear();
                    current.Append(word.TrimStart());
                }
                else current.Append(word);
            }
            if (current.Length > 0) yield return current.ToString().TrimEnd();
        }

        private static byte[] BuildEscPosRaster(Bitmap bitmap)
        {
            var widthBytes = (bitmap.Width + 7) / 8;
            var height = bitmap.Height;
            var data = new byte[10 + widthBytes * height + 8];
            var offset = 0;
            data[offset++] = 0x1B; data[offset++] = 0x40;
            data[offset++] = 0x1D; data[offset++] = 0x76; data[offset++] = 0x30; data[offset++] = 0x00;
            data[offset++] = (byte)(widthBytes & 0xFF); data[offset++] = (byte)((widthBytes >> 8) & 0xFF);
            data[offset++] = (byte)(height & 0xFF); data[offset++] = (byte)((height >> 8) & 0xFF);
            for (var y = 0; y < height; y++)
                for (var xb = 0; xb < widthBytes; xb++)
                {
                    byte value = 0;
                    for (var bit = 0; bit < 8; bit++)
                    {
                        var x = xb * 8 + bit;
                        if (x >= bitmap.Width) continue;
                        var pixel = bitmap.GetPixel(x, y);
                        var luminance = (pixel.R * 299 + pixel.G * 587 + pixel.B * 114) / 1000;
                        if (luminance < 180) value |= (byte)(0x80 >> bit);
                    }
                    data[offset++] = value;
                }
            data[offset++] = 0x0A; data[offset++] = 0x0A; data[offset++] = 0x0A; data[offset++] = 0x0A;
            data[offset++] = 0x1D; data[offset++] = 0x56; data[offset++] = 0x42; data[offset++] = 0x00;
            return data;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
        private sealed class DOCINFOA
        {
            [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
            [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
            [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
        }

        [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi)]
        private static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
        [DllImport("winspool.Drv", SetLastError = true)] private static extern bool ClosePrinter(IntPtr handle);
        [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi)]
        private static extern bool StartDocPrinter(IntPtr handle, int level, [In] DOCINFOA di);
        [DllImport("winspool.Drv", SetLastError = true)] private static extern bool EndDocPrinter(IntPtr handle);
        [DllImport("winspool.Drv", SetLastError = true)] private static extern bool StartPagePrinter(IntPtr handle);
        [DllImport("winspool.Drv", SetLastError = true)] private static extern bool EndPagePrinter(IntPtr handle);
        [DllImport("winspool.Drv", SetLastError = true)] private static extern bool WritePrinter(IntPtr handle, IntPtr bytes, int count, out int written);

        private static void SendRaw(string printerName, byte[] bytes)
        {
            if (!OpenPrinter(printerName, out var handle, IntPtr.Zero))
                throw new InvalidOperationException("OPEN_PRINTER_FAILED:" + Marshal.GetLastWin32Error());
            IntPtr pointer = IntPtr.Zero;
            try
            {
                var doc = new DOCINFOA { pDocName = "Premier Cleopatra ESC POS Raster", pDataType = "RAW" };
                if (!StartDocPrinter(handle, 1, doc)) throw new InvalidOperationException("START_DOC_FAILED:" + Marshal.GetLastWin32Error());
                if (!StartPagePrinter(handle)) throw new InvalidOperationException("START_PAGE_FAILED:" + Marshal.GetLastWin32Error());
                pointer = Marshal.AllocCoTaskMem(bytes.Length);
                Marshal.Copy(bytes, 0, pointer, bytes.Length);
                if (!WritePrinter(handle, pointer, bytes.Length, out var written) || written != bytes.Length)
                    throw new InvalidOperationException("WRITE_PRINTER_FAILED:" + Marshal.GetLastWin32Error());
                EndPagePrinter(handle);
                EndDocPrinter(handle);
            }
            finally
            {
                if (pointer != IntPtr.Zero) Marshal.FreeCoTaskMem(pointer);
                ClosePrinter(handle);
            }
        }
    }
}
