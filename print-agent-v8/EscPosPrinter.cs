using System.Collections.Concurrent;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Printing;
using System.Drawing.Text;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace PremierSmouhaFormPrintAgentV08;

internal sealed class EscPosPrinter
{
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _lanes =
        new(StringComparer.OrdinalIgnoreCase);

    internal List<string> GetPrinters() =>
        PrinterSettings.InstalledPrinters
            .Cast<string>()
            .OrderBy(x => x)
            .ToList();

    internal async Task PrintTemplateAsync(
        string printerName,
        JsonElement template,
        int paperWidthMm)
    {
        await WithPrinterLaneAsync(printerName, () =>
        {
            using var ticket = FixedTemplateRenderer.Render(
                template,
                paperWidthMm <= 58 ? 384 : 576);
            SendRaw(printerName, BuildEscPosRaster(ticket));
        }).ConfigureAwait(false);
    }

    internal async Task PrintTextAsync(
        string printerName,
        string text,
        int paperWidthMm)
    {
        await WithPrinterLaneAsync(printerName, () =>
        {
            using var ticket = RenderLegacyText(
                text ?? "",
                paperWidthMm <= 58 ? 384 : 576);
            SendRaw(printerName, BuildEscPosRaster(ticket));
        }).ConfigureAwait(false);
    }

    private async Task WithPrinterLaneAsync(string printerName, Action print)
    {
        printerName ??= "";
        if (string.IsNullOrWhiteSpace(printerName))
            throw new InvalidOperationException("PRINTER_NAME_REQUIRED");

        if (!GetPrinters().Contains(printerName))
            throw new InvalidOperationException("PRINTER_NOT_FOUND:" + printerName);

        var lane = _lanes.GetOrAdd(
            printerName,
            _ => new SemaphoreSlim(1, 1));

        await lane.WaitAsync().ConfigureAwait(false);
        try
        {
            await Task.Run(print).ConfigureAwait(false);
        }
        finally
        {
            lane.Release();
        }
    }

    private static Bitmap RenderLegacyText(string text, int widthDots)
    {
        var normalized = (text ?? "")
            .Replace("\r\n", "\n")
            .Replace('\r', '\n');
        var sourceLines = normalized.Split('\n');
        var lines = new List<string>();
        var scale = widthDots <= 400 ? 0.8f : 1f;

        using (var probe = new Bitmap(1, 1))
        using (var g = Graphics.FromImage(probe))
        using (var font = new Font(
                   "Tahoma",
                   28f * scale,
                   FontStyle.Regular,
                   GraphicsUnit.Pixel))
        {
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            foreach (var raw in sourceLines)
                lines.AddRange(WrapLine(g, raw ?? "", font, widthDots - 32));
        }

        var lineHeight = (int)Math.Ceiling(39 * scale);
        var height = Math.Max(
            120,
            16 + Math.Max(1, lines.Count) * lineHeight + 54);
        var bitmap = new Bitmap(
            widthDots,
            height,
            PixelFormat.Format32bppArgb);
        bitmap.SetResolution(203f, 203f);

        using var graphics = Graphics.FromImage(bitmap);
        using var drawFont = new Font(
            "Tahoma",
            28f * scale,
            FontStyle.Regular,
            GraphicsUnit.Pixel);
        graphics.Clear(Color.White);
        graphics.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;

        float y = 14;
        foreach (var line in lines)
        {
            using var format = new StringFormat(StringFormatFlags.NoClip);
            if (Regex.IsMatch(line ?? "", "[\\u0600-\\u06FF]"))
            {
                format.FormatFlags |= StringFormatFlags.DirectionRightToLeft;
                format.Alignment = StringAlignment.Far;
            }
            else
            {
                format.Alignment = StringAlignment.Near;
            }

            graphics.DrawString(
                line,
                drawFont,
                Brushes.Black,
                new RectangleF(16, y, widthDots - 32, lineHeight + 10),
                format);
            y += lineHeight;
        }

        return bitmap;
    }

    private static IEnumerable<string> WrapLine(
        Graphics g,
        string line,
        Font font,
        int maxWidth)
    {
        if (string.IsNullOrEmpty(line))
        {
            yield return "";
            yield break;
        }

        if (g.MeasureString(line, font).Width <= maxWidth)
        {
            yield return line;
            yield break;
        }

        var words = Regex.Split(line, "(\\s+)");
        var current = new StringBuilder();

        foreach (var word in words)
        {
            var candidate = current + word;
            if (current.Length > 0 &&
                g.MeasureString(candidate, font).Width > maxWidth)
            {
                yield return current.ToString().TrimEnd();
                current.Clear();
                current.Append(word.TrimStart());
            }
            else
            {
                current.Append(word);
            }
        }

        if (current.Length > 0)
            yield return current.ToString().TrimEnd();
    }

    private static byte[] BuildEscPosRaster(Bitmap bitmap)
    {
        var widthBytes = (bitmap.Width + 7) / 8;
        var height = bitmap.Height;
        var raster = new byte[widthBytes * height];

        var rect = new Rectangle(0, 0, bitmap.Width, bitmap.Height);
        var data = bitmap.LockBits(
            rect,
            ImageLockMode.ReadOnly,
            PixelFormat.Format32bppArgb);

        try
        {
            unsafe
            {
                var basePtr = (byte*)data.Scan0;
                for (var y = 0; y < height; y++)
                {
                    var row = basePtr + y * data.Stride;
                    for (var x = 0; x < bitmap.Width; x++)
                    {
                        var pixel = row + x * 4;
                        var b = pixel[0];
                        var g = pixel[1];
                        var r = pixel[2];
                        var luminance = (r * 299 + g * 587 + b * 114) / 1000;
                        if (luminance < 180)
                        {
                            var index = y * widthBytes + (x >> 3);
                            raster[index] |= (byte)(0x80 >> (x & 7));
                        }
                    }
                }
            }
        }
        finally
        {
            bitmap.UnlockBits(data);
        }

        using var stream = new MemoryStream(raster.Length + 32);
        stream.WriteByte(0x1B);
        stream.WriteByte(0x40);
        stream.WriteByte(0x1D);
        stream.WriteByte(0x76);
        stream.WriteByte(0x30);
        stream.WriteByte(0x00);
        stream.WriteByte((byte)(widthBytes & 0xFF));
        stream.WriteByte((byte)((widthBytes >> 8) & 0xFF));
        stream.WriteByte((byte)(height & 0xFF));
        stream.WriteByte((byte)((height >> 8) & 0xFF));
        stream.Write(raster, 0, raster.Length);

        // Feed and partial cut.
        stream.Write(new byte[]
        {
            0x0A, 0x0A, 0x0A,
            0x1D, 0x56, 0x42, 0x00
        });
        return stream.ToArray();
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    private sealed class DOCINFOA
    {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName = "";
        [MarshalAs(UnmanagedType.LPStr)] public string? pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType = "RAW";
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA",
        SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true,
        CallingConvention = CallingConvention.StdCall)]
    private static extern bool OpenPrinter(
        [MarshalAs(UnmanagedType.LPStr)] string szPrinter,
        out IntPtr hPrinter,
        IntPtr pd);

    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter",
        SetLastError = true, ExactSpelling = true,
        CallingConvention = CallingConvention.StdCall)]
    private static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA",
        SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true,
        CallingConvention = CallingConvention.StdCall)]
    private static extern bool StartDocPrinter(
        IntPtr hPrinter,
        int level,
        [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter",
        SetLastError = true, ExactSpelling = true,
        CallingConvention = CallingConvention.StdCall)]
    private static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter",
        SetLastError = true, ExactSpelling = true,
        CallingConvention = CallingConvention.StdCall)]
    private static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter",
        SetLastError = true, ExactSpelling = true,
        CallingConvention = CallingConvention.StdCall)]
    private static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "WritePrinter",
        SetLastError = true, ExactSpelling = true,
        CallingConvention = CallingConvention.StdCall)]
    private static extern bool WritePrinter(
        IntPtr hPrinter,
        IntPtr pBytes,
        int dwCount,
        out int dwWritten);

    private static void SendRaw(string printerName, byte[] bytes)
    {
        if (!OpenPrinter(printerName, out var handle, IntPtr.Zero))
            throw new InvalidOperationException(
                "OPEN_PRINTER_FAILED:" + Marshal.GetLastWin32Error());

        IntPtr pointer = IntPtr.Zero;
        try
        {
            var info = new DOCINFOA
            {
                pDocName = BuildConfig.AppName + " Form",
                pDataType = "RAW"
            };

            if (!StartDocPrinter(handle, 1, info))
                throw new InvalidOperationException(
                    "START_DOC_FAILED:" + Marshal.GetLastWin32Error());
            try
            {
                if (!StartPagePrinter(handle))
                    throw new InvalidOperationException(
                        "START_PAGE_FAILED:" + Marshal.GetLastWin32Error());
                try
                {
                    pointer = Marshal.AllocCoTaskMem(bytes.Length);
                    Marshal.Copy(bytes, 0, pointer, bytes.Length);
                    if (!WritePrinter(
                            handle,
                            pointer,
                            bytes.Length,
                            out var written) ||
                        written != bytes.Length)
                        throw new InvalidOperationException(
                            "WRITE_PRINTER_FAILED:" + Marshal.GetLastWin32Error());
                }
                finally
                {
                    EndPagePrinter(handle);
                }
            }
            finally
            {
                EndDocPrinter(handle);
            }
        }
        finally
        {
            if (pointer != IntPtr.Zero) Marshal.FreeCoTaskMem(pointer);
            ClosePrinter(handle);
        }
    }
}
