using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace PremierSmouhaFormPrintAgentV08;

internal static class FixedTemplateRenderer
{
    internal static bool TryGetTemplate(JsonElement payload, out JsonElement template)
    {
        template = default;
        return payload.ValueKind == JsonValueKind.Object &&
               payload.TryGetProperty("template", out var value) &&
               value.ValueKind == JsonValueKind.Object &&
               value.TryGetProperty("version", out var version) &&
               version.TryGetInt32(out var v) &&
               v == 1 &&
               (template = value.Clone()).ValueKind == JsonValueKind.Object;
    }

    internal static Bitmap Render(JsonElement template, int widthDots)
    {
        var kitchen = S(template, "kind").Equals(
            "kitchen", StringComparison.OrdinalIgnoreCase);
        var isAr = B(template, "isAr");
        var scale = widthDots <= 400 ? 0.78f : 1f;
        var margin = 18f * scale;
        var innerWidth = widthDots - margin * 2;
        const int maxHeight = 12000;

        using var canvas = new Bitmap(widthDots, maxHeight, PixelFormat.Format32bppArgb);
        canvas.SetResolution(203f, 203f);
        using var g = Graphics.FromImage(canvas);
        g.Clear(Color.White);
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.HighQuality;

        using var brand = F("Arial", kitchen ? 36 : 42, FontStyle.Bold, scale);
        using var brandSub = F("Arial", 14, FontStyle.Bold, scale);
        using var title = F("Tahoma", kitchen ? 25 : 27, FontStyle.Bold, scale);
        using var subtitle = F("Tahoma", 16, FontStyle.Bold, scale);
        using var body = F("Tahoma", kitchen ? 18 : 19, FontStyle.Regular, scale);
        using var bodyBold = F("Tahoma", kitchen ? 19 : 20, FontStyle.Bold, scale);
        using var small = F("Tahoma", 15, FontStyle.Regular, scale);
        using var smallBold = F("Tahoma", 15, FontStyle.Bold, scale);
        using var itemFont = F("Tahoma", kitchen ? 25 : 21, FontStyle.Bold, scale);
        using var modifierFont = F("Tahoma", 18, FontStyle.Bold, scale);
        using var noteFont = F("Tahoma", 18, FontStyle.Bold, scale);
        using var grand = F("Tahoma", 29, FontStyle.Bold, scale);
        using var pen = new Pen(Color.Black, Math.Max(1.2f, 2f * scale));
        using var thinPen = new Pen(Color.Black, Math.Max(1f, 1.2f * scale));
        using var grayPen = new Pen(Color.Gray, 1f) { DashStyle = System.Drawing.Drawing2D.DashStyle.Dot };

        float y = 10f * scale;

        y = Center(g, S(template, "storeName", "JOHNA'S"), brand, y, innerWidth, margin, isAr) + 2 * scale;
        y = Center(g, S(template, "storeSubtitle", "RESTAURANT"), brandSub, y, innerWidth, margin, false) + 4 * scale;

        var titleText = S(template, "title");
        var titleH = Measure(g, titleText, title, innerWidth - 16 * scale, isAr) + 12 * scale;
        g.DrawRectangle(pen, margin, y, innerWidth, titleH);
        Draw(g, titleText, title,
            new RectangleF(margin + 8 * scale, y + 4 * scale, innerWidth - 16 * scale, titleH - 8 * scale),
            isAr, StringAlignment.Center);
        y += titleH + 4 * scale;

        foreach (var key in new[] { "subtitle", "slogan", "branchName" })
        {
            var value = S(template, key);
            if (string.IsNullOrWhiteSpace(value)) continue;
            y = Center(g, value, key == "subtitle" ? subtitle : smallBold, y, innerWidth, margin, isAr) + 2 * scale;
        }

        if (kitchen)
        {
            var station = S(template, "station");
            if (!string.IsNullOrWhiteSpace(station))
            {
                y += 4 * scale;
                var boxH = 68 * scale;
                g.DrawRectangle(pen, margin, y, innerWidth, boxH);
                Draw(g, isAr ? "المحطة" : "STATION", smallBold,
                    new RectangleF(margin + 8 * scale, y + 4 * scale, innerWidth - 16 * scale, 24 * scale),
                    isAr, StringAlignment.Center);
                Draw(g, station, title,
                    new RectangleF(margin + 8 * scale, y + 27 * scale, innerWidth - 16 * scale, 36 * scale),
                    isAr, StringAlignment.Center);
                y += boxH + 8 * scale;
            }
        }

        if (template.TryGetProperty("meta", out var meta) && meta.ValueKind == JsonValueKind.Array)
        {
            var start = y;
            y += 5 * scale;
            foreach (var row in meta.EnumerateArray())
            {
                var label = S(row, "label");
                var value = S(row, "value");
                var emph = B(row, "emphasis");
                var rowFont = emph ? bodyBold : body;
                var labelW = Math.Min(155 * scale, innerWidth * 0.36f);
                var valueW = innerWidth - labelW - 20 * scale;
                var rowH = Math.Max(
                    28 * scale,
                    Measure(g, value, rowFont, valueW, isAr) + 6 * scale);

                if (isAr)
                {
                    Draw(g, value, rowFont,
                        new RectangleF(margin + 8 * scale, y, valueW, rowH),
                        true, StringAlignment.Near);
                    Draw(g, label + ":", rowFont,
                        new RectangleF(margin + innerWidth - labelW - 8 * scale, y, labelW, rowH),
                        true, StringAlignment.Near);
                }
                else
                {
                    Draw(g, label + ":", rowFont,
                        new RectangleF(margin + 8 * scale, y, labelW, rowH),
                        false, StringAlignment.Near);
                    Draw(g, value, rowFont,
                        new RectangleF(margin + labelW + 12 * scale, y, valueW, rowH),
                        false, StringAlignment.Near);
                }
                y += rowH;
            }
            y += 5 * scale;
            g.DrawRectangle(thinPen, margin, start, innerWidth, y - start);
            y += 6 * scale;
        }

        g.DrawLine(pen, margin, y, margin + innerWidth, y);
        y += 6 * scale;
        var heading = S(template, "itemsHeading", isAr ? "الأصناف" : "ITEMS");
        y = TextBlock(g, heading, title, y, innerWidth, margin, isAr, StringAlignment.Near) + 4 * scale;

        if (template.TryGetProperty("items", out var items) && items.ValueKind == JsonValueKind.Array)
        {
            if (kitchen)
            {
                foreach (var item in items.EnumerateArray())
                {
                    var qty = S(item, "qty", "1");
                    var name = S(item, "name", "—");
                    var badgeW = 72 * scale;
                    var nameX = isAr ? margin : margin + badgeW + 12 * scale;
                    var nameW = innerWidth - badgeW - 12 * scale;
                    var nameH = Math.Max(48 * scale, Measure(g, name, itemFont, nameW, isAr) + 10 * scale);

                    var badgeX = isAr ? margin + innerWidth - badgeW : margin;
                    g.DrawRectangle(pen, badgeX, y, badgeW, 46 * scale);
                    Draw(g, qty + "×", title,
                        new RectangleF(badgeX + 2 * scale, y + 3 * scale, badgeW - 4 * scale, 40 * scale),
                        false, StringAlignment.Center);

                    if (isAr)
                        nameX = margin;

                    Draw(g, name, itemFont,
                        new RectangleF(nameX, y, nameW, nameH),
                        isAr, isAr ? StringAlignment.Far : StringAlignment.Near);
                    y += nameH + 3 * scale;

                    if (item.TryGetProperty("modifiers", out var mods) &&
                        mods.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var mod in mods.EnumerateArray())
                        {
                            var value = mod.ValueKind == JsonValueKind.String
                                ? mod.GetString() ?? ""
                                : mod.ToString();
                            if (string.IsNullOrWhiteSpace(value)) continue;
                            var indent = 72 * scale;
                            var modW = innerWidth - indent;
                            var h = Measure(g, "+ " + value, modifierFont, modW, isAr) + 6 * scale;
                            Draw(g, "+ " + value, modifierFont,
                                new RectangleF(
                                    isAr ? margin : margin + indent,
                                    y,
                                    modW,
                                    h),
                                isAr,
                                isAr ? StringAlignment.Far : StringAlignment.Near);
                            y += h;
                        }
                    }

                    var note = S(item, "notes");
                    if (!string.IsNullOrWhiteSpace(note))
                    {
                        var noteText = (isAr ? "ملاحظة: " : "Note: ") + note;
                        var noteH = Measure(g, noteText, noteFont, innerWidth - 16 * scale, isAr) + 14 * scale;
                        g.DrawRectangle(pen, margin + 5 * scale, y, innerWidth - 10 * scale, noteH);
                        Draw(g, noteText, noteFont,
                            new RectangleF(margin + 12 * scale, y + 5 * scale, innerWidth - 24 * scale, noteH - 10 * scale),
                            isAr, isAr ? StringAlignment.Far : StringAlignment.Near);
                        y += noteH + 5 * scale;
                    }

                    g.DrawLine(grayPen, margin, y, margin + innerWidth, y);
                    y += 9 * scale;
                }
            }
            else
            {
                var qtyW = 54 * scale;
                var unitW = 112 * scale;
                var totalW = 130 * scale;
                var nameW = innerWidth - qtyW - unitW - totalW;
                var headH = 34 * scale;

                DrawCustomerColumns(
                    g, isAr, margin, y, qtyW, nameW, unitW, totalW, headH,
                    isAr ? "الكمية" : "QTY",
                    isAr ? "الصنف" : "ITEM",
                    isAr ? "السعر" : "UNIT",
                    isAr ? "القيمة" : "TOTAL",
                    smallBold);
                y += headH;
                g.DrawLine(pen, margin, y, margin + innerWidth, y);
                y += 5 * scale;

                foreach (var item in items.EnumerateArray())
                {
                    var qty = S(item, "qty");
                    var name = S(item, "name", "—");
                    var price = S(item, "price");
                    var total = S(item, "total", price);
                    var itemH = Math.Max(
                        42 * scale,
                        Measure(g, name, bodyBold, nameW - 8 * scale, isAr) + 10 * scale);

                    DrawCustomerColumns(
                        g, isAr, margin, y, qtyW, nameW, unitW, totalW, itemH,
                        qty, name, price, total, bodyBold);
                    y += itemH;
                    g.DrawLine(grayPen, margin, y, margin + innerWidth, y);
                    y += 3 * scale;
                }
            }
        }

        if (!kitchen &&
            template.TryGetProperty("totals", out var totals) &&
            totals.ValueKind == JsonValueKind.Array)
        {
            y += 4 * scale;
            var start = y;
            y += 5 * scale;
            foreach (var row in totals.EnumerateArray())
            {
                var label = S(row, "label");
                var value = S(row, "value");
                var emph = B(row, "emphasis");
                var rowFont = emph ? grand : bodyBold;
                var rowH = emph ? 42 * scale : 28 * scale;

                if (emph)
                {
                    g.DrawLine(pen, margin + 7 * scale, y, margin + innerWidth - 7 * scale, y);
                    y += 4 * scale;
                }

                if (isAr)
                {
                    // Arabic form: label stays on the RIGHT, numeric value on the LEFT.
                    Draw(g, value, rowFont,
                        new RectangleF(margin + 10 * scale, y, innerWidth * 0.40f, rowH),
                        false, StringAlignment.Far);
                    Draw(g, label + ":", rowFont,
                        new RectangleF(margin + innerWidth * 0.42f, y, innerWidth * 0.56f - 10 * scale, rowH),
                        true, StringAlignment.Far);
                }
                else
                {
                    Draw(g, label + ":", rowFont,
                        new RectangleF(margin + 10 * scale, y, innerWidth * 0.55f, rowH),
                        false, StringAlignment.Near);
                    Draw(g, value, rowFont,
                        new RectangleF(margin + innerWidth * 0.55f, y, innerWidth * 0.43f - 10 * scale, rowH),
                        false, StringAlignment.Far);
                }
                y += rowH;
            }
            y += 5 * scale;
            g.DrawRectangle(pen, margin, start, innerWidth, y - start);
            y += 6 * scale;
        }

        if (template.TryGetProperty("footerLines", out var footer) &&
            footer.ValueKind == JsonValueKind.Array)
        {
            foreach (var line in footer.EnumerateArray())
            {
                var value = line.ValueKind == JsonValueKind.String
                    ? line.GetString() ?? ""
                    : line.ToString();
                if (string.IsNullOrWhiteSpace(value)) continue;
                y = Center(g, value, bodyBold, y, innerWidth, margin, isAr) + 2 * scale;
            }
        }

        y += 16 * scale;
        var finalHeight = Math.Max(96, Math.Min(maxHeight, (int)Math.Ceiling(y)));
        var result = new Bitmap(widthDots, finalHeight, PixelFormat.Format32bppArgb);
        result.SetResolution(203f, 203f);
        using (var rg = Graphics.FromImage(result))
        {
            rg.Clear(Color.White);
            rg.DrawImageUnscaled(canvas, 0, 0);
        }
        return result;
    }

    private static void DrawCustomerColumns(
        Graphics g,
        bool isAr,
        float x,
        float y,
        float qtyW,
        float nameW,
        float unitW,
        float totalW,
        float height,
        string qty,
        string name,
        string unit,
        string total,
        Font font)
    {
        if (isAr)
        {
            Draw(g, total, font, new RectangleF(x, y, totalW, height), false, StringAlignment.Far);
            Draw(g, unit, font, new RectangleF(x + totalW, y, unitW, height), false, StringAlignment.Far);
            Draw(g, name, font, new RectangleF(x + totalW + unitW, y, nameW, height), true, StringAlignment.Far);
            Draw(g, qty, font, new RectangleF(x + totalW + unitW + nameW, y, qtyW, height), false, StringAlignment.Center);
        }
        else
        {
            Draw(g, qty, font, new RectangleF(x, y, qtyW, height), false, StringAlignment.Center);
            Draw(g, name, font, new RectangleF(x + qtyW, y, nameW, height), false, StringAlignment.Near);
            Draw(g, unit, font, new RectangleF(x + qtyW + nameW, y, unitW, height), false, StringAlignment.Far);
            Draw(g, total, font, new RectangleF(x + qtyW + nameW + unitW, y, totalW, height), false, StringAlignment.Far);
        }
    }

    private static float Center(
        Graphics g,
        string text,
        Font font,
        float y,
        float width,
        float x,
        bool isAr)
    {
        var h = Measure(g, text, font, width, isAr) + 4;
        Draw(g, text, font, new RectangleF(x, y, width, h), isAr, StringAlignment.Center);
        return y + h;
    }

    private static float TextBlock(
        Graphics g,
        string text,
        Font font,
        float y,
        float width,
        float x,
        bool isAr,
        StringAlignment alignment)
    {
        var h = Measure(g, text, font, width, isAr) + 4;
        Draw(g, text, font, new RectangleF(x, y, width, h), isAr, alignment);
        return y + h;
    }

    private static float Measure(
        Graphics g,
        string text,
        Font font,
        float width,
        bool isAr)
    {
        using var format = Format(isAr, isAr ? StringAlignment.Far : StringAlignment.Near);
        return g.MeasureString(
            string.IsNullOrEmpty(text) ? " " : text,
            font,
            new SizeF(Math.Max(10, width), 5000),
            format).Height;
    }

    private static void Draw(
        Graphics g,
        string text,
        Font font,
        RectangleF rect,
        bool isAr,
        StringAlignment alignment)
    {
        using var format = Format(isAr || ContainsArabic(text), alignment);
        g.DrawString(text ?? "", font, Brushes.Black, rect, format);
    }

    private static StringFormat Format(bool rtl, StringAlignment alignment)
    {
        var format = new StringFormat(StringFormatFlags.LineLimit)
        {
            Alignment = alignment,
            LineAlignment = StringAlignment.Near,
            Trimming = StringTrimming.Word
        };
        if (rtl) format.FormatFlags |= StringFormatFlags.DirectionRightToLeft;
        return format;
    }

    private static bool ContainsArabic(string? value) =>
        !string.IsNullOrEmpty(value) &&
        Regex.IsMatch(value, "[\\u0600-\\u06FF]");

    private static Font F(string family, float size, FontStyle style, float scale) =>
        new(family, Math.Max(8, size * scale), style, GraphicsUnit.Pixel);

    private static string S(JsonElement element, string name, string fallback = "")
    {
        if (element.ValueKind != JsonValueKind.Object ||
            !element.TryGetProperty(name, out var value))
            return fallback;

        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString() ?? fallback,
            JsonValueKind.Number => value.ToString(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            _ => fallback
        };
    }

    private static bool B(JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.Object ||
            !element.TryGetProperty(name, out var value))
            return false;
        return value.ValueKind == JsonValueKind.True ||
               (value.ValueKind == JsonValueKind.String &&
                bool.TryParse(value.GetString(), out var parsed) &&
                parsed);
    }
}
