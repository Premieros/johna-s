param(
  [Parameter(Position = 0)]
  [string]$PrinterName,
  [Parameter(Position = 1)]
  [string]$FilePath,
  [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$source = @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Printing;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Drawing.Text;

public static class JohnsUnicodePrinter
{
    public static void Print(string printerName, string filePath)
    {
        string text = File.ReadAllText(filePath, new UTF8Encoding(false, true));

        using (PrintDocument document = new PrintDocument())
        using (Font font = new Font("Tahoma", 9f, FontStyle.Regular, GraphicsUnit.Point))
        {
            document.DocumentName = "Johns Print Service Unicode";
            document.PrintController = new StandardPrintController();
            document.PrinterSettings.PrinterName = printerName;

            if (!document.PrinterSettings.IsValid)
                throw new InvalidOperationException("INVALID_PRINTER:" + printerName);

            document.DefaultPageSettings.Margins = new Margins(0, 0, 0, 0);

            string[] lines = NormalizeLines(text);
            int index = 0;

            document.PrintPage += delegate(object sender, PrintPageEventArgs e)
            {
                float left = e.MarginBounds.Left + 3f;
                float right = e.MarginBounds.Right - 3f;
                float y = e.MarginBounds.Top + 3f;
                float lineHeight = font.GetHeight(e.Graphics) + 2f;

                while (index < lines.Length)
                {
                    string line = lines[index++];

                    if (line == "\f")
                    {
                        e.HasMorePages = index < lines.Length;
                        return;
                    }

                    using (StringFormat format = new StringFormat())
                    {
                        if (ContainsArabic(line))
                        {
                            format.FormatFlags |= StringFormatFlags.DirectionRightToLeft;
                            format.Alignment = StringAlignment.Far;
                        }

                        DrawRasterizedLine(
                            e.Graphics,
                            line,
                            font,
                            format,
                            new RectangleF(
                                left,
                                y,
                                Math.Max(1f, right - left),
                                lineHeight * 2f));
                    }

                    y += lineHeight;

                    if (y + lineHeight > e.MarginBounds.Bottom)
                    {
                        e.HasMorePages = index < lines.Length;
                        return;
                    }
                }

                e.HasMorePages = false;
            };

            document.Print();
        }
    }

    private static void DrawRasterizedLine(
        Graphics printerGraphics,
        string line,
        Font font,
        StringFormat format,
        RectangleF destination)
    {
        float dpiX = Math.Max(96f, printerGraphics.DpiX);
        float dpiY = Math.Max(96f, printerGraphics.DpiY);

        int pixelWidth = Math.Max(
            1,
            (int)Math.Ceiling((destination.Width / 100f) * dpiX));

        int pixelHeight = Math.Max(
            1,
            (int)Math.Ceiling((destination.Height / 100f) * dpiY));

        using (Bitmap bitmap = new Bitmap(
            pixelWidth,
            pixelHeight,
            PixelFormat.Format32bppArgb))
        {
            bitmap.SetResolution(dpiX, dpiY);

            using (Graphics graphics = Graphics.FromImage(bitmap))
            using (StringFormat bitmapFormat = (StringFormat)format.Clone())
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
        return (text ?? "")
            .Replace("\r\n", "\n")
            .Replace('\r', '\n')
            .Replace("\f", "\n\f\n")
            .Split(new[] { '\n' }, StringSplitOptions.None);
    }

    private static bool ContainsArabic(string value)
    {
        return Regex.IsMatch(value ?? "", "[\u0600-\u06FF]");
    }
}
'@

Add-Type -TypeDefinition $source -ReferencedAssemblies @('System.Drawing.dll')

if ($ValidateOnly) {
  Write-Output 'UNICODE_PRINT_HELPER_OK'
  exit 0
}

if ([string]::IsNullOrWhiteSpace($PrinterName)) {
  throw 'PRINTER_NAME_REQUIRED'
}

if ([string]::IsNullOrWhiteSpace($FilePath) -or !(Test-Path -LiteralPath $FilePath)) {
  throw 'PRINT_FILE_REQUIRED'
}

[JohnsUnicodePrinter]::Print($PrinterName, $FilePath)
