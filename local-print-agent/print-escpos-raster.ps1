param(
  [Parameter(Position = 0)]
  [string]$PrinterName,
  [Parameter(Position = 1)]
  [string]$FilePath,
  [Parameter(Position = 2)]
  [int]$PaperWidthMm = 80,
  [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$source = @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

public static class JohnsEscPosRasterPrinter
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    private class DOCINFOA
    {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi)]
    private static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);

    [DllImport("winspool.Drv", SetLastError = true)]
    private static extern bool ClosePrinter(IntPtr handle);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi)]
    private static extern bool StartDocPrinter(IntPtr handle, int level, [In] DOCINFOA di);

    [DllImport("winspool.Drv", SetLastError = true)]
    private static extern bool EndDocPrinter(IntPtr handle);

    [DllImport("winspool.Drv", SetLastError = true)]
    private static extern bool StartPagePrinter(IntPtr handle);

    [DllImport("winspool.Drv", SetLastError = true)]
    private static extern bool EndPagePrinter(IntPtr handle);

    [DllImport("winspool.Drv", SetLastError = true)]
    private static extern bool WritePrinter(IntPtr handle, IntPtr bytes, int count, out int written);

    public static void Print(string printerName, string filePath, int paperWidthMm)
    {
        if (string.IsNullOrWhiteSpace(printerName))
            throw new InvalidOperationException("PRINTER_NAME_REQUIRED");
        if (string.IsNullOrWhiteSpace(filePath) || !File.Exists(filePath))
            throw new InvalidOperationException("PRINT_FILE_REQUIRED");

        string text = File.ReadAllText(filePath, new UTF8Encoding(false, true));
        int widthDots = paperWidthMm <= 58 ? 384 : 576;

        using (Bitmap ticket = RenderTicket(text, widthDots))
        {
            byte[] payload = BuildEscPosRaster(ticket);
            SendRaw(printerName, payload);
        }
    }

    private static Bitmap RenderTicket(string text, int widthDots)
    {
        string normalized = (text ?? "")
            .Replace("\r\n", "\n")
            .Replace('\r', '\n');

        string[] sourceLines = normalized.Split(new[] { '\n' }, StringSplitOptions.None);
        var lines = new List<string>();

        using (var measureBitmap = new Bitmap(1, 1))
        using (var measureGraphics = Graphics.FromImage(measureBitmap))
        using (var font = new Font("Tahoma", 22f, FontStyle.Regular, GraphicsUnit.Pixel))
        {
            measureGraphics.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            foreach (string raw in sourceLines)
            {
                foreach (string wrapped in WrapLine(measureGraphics, raw ?? "", font, widthDots - 24))
                    lines.Add(wrapped);
            }
        }

        int lineHeight = 31;
        int top = 12;
        int bottom = 42;
        int height = Math.Max(96, top + Math.Max(1, lines.Count) * lineHeight + bottom);

        var bitmap = new Bitmap(widthDots, height, PixelFormat.Format32bppArgb);
        bitmap.SetResolution(203f, 203f);

        using (Graphics g = Graphics.FromImage(bitmap))
        using (Font font = new Font("Tahoma", 22f, FontStyle.Regular, GraphicsUnit.Pixel))
        {
            g.Clear(Color.White);
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.HighQuality;
            g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;

            float y = top;
            foreach (string line in lines)
            {
                using (var format = new StringFormat(StringFormatFlags.NoClip))
                {
                    if (ContainsArabic(line))
                    {
                        format.FormatFlags |= StringFormatFlags.DirectionRightToLeft;
                        format.Alignment = StringAlignment.Far;
                    }
                    else
                    {
                        format.Alignment = StringAlignment.Near;
                    }

                    g.DrawString(
                        line,
                        font,
                        Brushes.Black,
                        new RectangleF(12f, y, widthDots - 24f, lineHeight + 8f),
                        format);
                }
                y += lineHeight;
            }
        }

        return bitmap;
    }

    private static IEnumerable<string> WrapLine(Graphics g, string line, Font font, int maxWidth)
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

        string[] words = Regex.Split(line, "(\\s+)");
        var current = new StringBuilder();

        foreach (string word in words)
        {
            string candidate = current.ToString() + word;
            if (current.Length > 0 && g.MeasureString(candidate, font).Width > maxWidth)
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

    private static bool ContainsArabic(string value)
    {
        return Regex.IsMatch(value ?? "", "[\u0600-\u06FF]");
    }

    private static byte[] BuildEscPosRaster(Bitmap bitmap)
    {
        int widthBytes = (bitmap.Width + 7) / 8;
        int height = bitmap.Height;
        var data = new byte[8 + (widthBytes * height) + 8];
        int offset = 0;

        // ESC @ : initialize printer.
        data[offset++] = 0x1B;
        data[offset++] = 0x40;

        // GS v 0 : raster bit image, normal density.
        data[offset++] = 0x1D;
        data[offset++] = 0x76;
        data[offset++] = 0x30;
        data[offset++] = 0x00;
        data[offset++] = (byte)(widthBytes & 0xFF);
        data[offset++] = (byte)((widthBytes >> 8) & 0xFF);
        data[offset++] = (byte)(height & 0xFF);
        data[offset++] = (byte)((height >> 8) & 0xFF);

        for (int y = 0; y < height; y++)
        {
            for (int xb = 0; xb < widthBytes; xb++)
            {
                byte value = 0;
                for (int bit = 0; bit < 8; bit++)
                {
                    int x = (xb * 8) + bit;
                    if (x >= bitmap.Width) continue;

                    Color pixel = bitmap.GetPixel(x, y);
                    int luminance = (pixel.R * 299 + pixel.G * 587 + pixel.B * 114) / 1000;
                    if (luminance < 180)
                        value |= (byte)(0x80 >> bit);
                }
                data[offset++] = value;
            }
        }

        // Feed 4 lines then full cut.
        data[offset++] = 0x0A;
        data[offset++] = 0x0A;
        data[offset++] = 0x0A;
        data[offset++] = 0x0A;
        data[offset++] = 0x1D;
        data[offset++] = 0x56;
        data[offset++] = 0x42;
        data[offset++] = 0x00;

        return data;
    }

    private static void SendRaw(string printerName, byte[] bytes)
    {
        IntPtr handle;
        if (!OpenPrinter(printerName, out handle, IntPtr.Zero))
            throw new InvalidOperationException("OPEN_PRINTER_FAILED:" + Marshal.GetLastWin32Error());

        IntPtr pointer = IntPtr.Zero;
        try
        {
            var doc = new DOCINFOA
            {
                pDocName = "Johns ESC POS Raster",
                pDataType = "RAW"
            };

            if (!StartDocPrinter(handle, 1, doc))
                throw new InvalidOperationException("START_DOC_FAILED:" + Marshal.GetLastWin32Error());

            if (!StartPagePrinter(handle))
                throw new InvalidOperationException("START_PAGE_FAILED:" + Marshal.GetLastWin32Error());

            pointer = Marshal.AllocCoTaskMem(bytes.Length);
            Marshal.Copy(bytes, 0, pointer, bytes.Length);

            int written;
            if (!WritePrinter(handle, pointer, bytes.Length, out written) || written != bytes.Length)
                throw new InvalidOperationException("WRITE_PRINTER_FAILED:" + Marshal.GetLastWin32Error());

            EndPagePrinter(handle);
            EndDocPrinter(handle);
        }
        finally
        {
            if (pointer != IntPtr.Zero)
                Marshal.FreeCoTaskMem(pointer);
            ClosePrinter(handle);
        }
    }
}
'@

Add-Type -TypeDefinition $source -ReferencedAssemblies @('System.Drawing.dll')

if ($ValidateOnly) {
  Write-Output 'ESC_POS_RASTER_HELPER_OK'
  exit 0
}

[JohnsEscPosRasterPrinter]::Print($PrinterName, $FilePath, $PaperWidthMm)
