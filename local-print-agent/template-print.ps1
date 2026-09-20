param(
  [Parameter(Mandatory=$true)][string]$PrinterName,
  [Parameter(Mandatory=$true)][string]$TemplatePath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Clamp([double]$Value, [double]$Min, [double]$Max) {
  return [Math]::Max($Min, [Math]::Min($Max, $Value))
}

function Safe([object]$Value) {
  if ($null -eq $Value) { return '' }
  return [string]$Value
}

$data = Get-Content -LiteralPath $TemplatePath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($null -eq $data -or [int]$data.version -ne 1) { throw 'FIXED_TEMPLATE_VERSION_UNSUPPORTED' }
if ($data.kind -ne 'customer' -and $data.kind -ne 'kitchen') { throw 'FIXED_TEMPLATE_KIND_INVALID' }

$paperWidthMm = Clamp ([double]$data.paperWidthMm) 50 100
$isKitchen = $data.kind -eq 'kitchen'
$isAr = [bool]$data.isAr

$metaCount = @($data.meta).Count
$itemUnits = 0.0
foreach ($item in @($data.items)) {
  $itemUnits += $(if ($isKitchen) { 7.2 } else { 9.5 })
  $itemUnits += @($item.modifiers).Count * 4.5
  if ((Safe $item.notes).Trim()) { $itemUnits += 5.0 }
}
$totalCount = @($data.totals).Count
$footerCount = @($data.footerLines).Count

if ($isKitchen) {
  $paperHeightMm = 50 + ($metaCount * 5.2) + $itemUnits + ($footerCount * 7.0)
} else {
  $paperHeightMm = 72 + ($metaCount * 5.5) + $itemUnits + ($totalCount * 6.2) + ($footerCount * 5.8)
}
$paperHeightMm = Clamp $paperHeightMm 75 500

$widthHundredths = [int][Math]::Ceiling(($paperWidthMm / 25.4) * 100)
$heightHundredths = [int][Math]::Ceiling(($paperHeightMm / 25.4) * 100)

$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName = $PrinterName
if (-not $doc.PrinterSettings.IsValid) { throw 'PRINTER_NOT_INSTALLED' }
$doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController
$doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0,0,0,0)
$doc.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize('JohnsFixedThermal', $widthHundredths, $heightHundredths)

$doc.add_PrintPage({
  param($sender, $e)

  $g = $e.Graphics
  $g.PageUnit = [System.Drawing.GraphicsUnit]::Millimeter
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  $left = $(if ($paperWidthMm -le 60) { 3.0 } else { 4.2 })
  $right = $left
  $contentWidth = $paperWidthMm - $left - $right
  $centerX = $left + ($contentWidth / 2)
  $y = $(if ($isKitchen) { 3.0 } else { 4.0 })

  $black = [System.Drawing.Brushes]::Black
  $thinPen = New-Object System.Drawing.Pen([System.Drawing.Color]::Black, 0.22)
  $strongPen = New-Object System.Drawing.Pen([System.Drawing.Color]::Black, 0.38)

  $bodyFamily = 'Arial Narrow'
  $brandFamily = 'Arial'
  $brandFont = New-Object System.Drawing.Font($brandFamily, $(if ($isKitchen) { 17 } else { 20 }), [System.Drawing.FontStyle]::Bold)
  $brandSubFont = New-Object System.Drawing.Font($brandFamily, $(if ($isKitchen) { 7.2 } else { 8 }), [System.Drawing.FontStyle]::Regular)
  $titleFont = New-Object System.Drawing.Font($bodyFamily, $(if ($isKitchen) { 12.5 } else { 14 }), [System.Drawing.FontStyle]::Bold)
  $subTitleFont = New-Object System.Drawing.Font($bodyFamily, 8.2, [System.Drawing.FontStyle]::Bold)
  $bodyFont = New-Object System.Drawing.Font($bodyFamily, $(if ($isKitchen) { 9.2 } else { 9.8 }), [System.Drawing.FontStyle]::Regular)
  $bodyBold = New-Object System.Drawing.Font($bodyFamily, $(if ($isKitchen) { 9.8 } else { 10.4 }), [System.Drawing.FontStyle]::Bold)
  $smallFont = New-Object System.Drawing.Font($bodyFamily, $(if ($isKitchen) { 7.6 } else { 8.2 }), [System.Drawing.FontStyle]::Regular)
  $itemsTitleFont = New-Object System.Drawing.Font($bodyFamily, $(if ($isKitchen) { 12.5 } else { 13.5 }), [System.Drawing.FontStyle]::Bold)
  $totalFont = New-Object System.Drawing.Font($bodyFamily, 13.5, [System.Drawing.FontStyle]::Bold)
  $footerFont = New-Object System.Drawing.Font($bodyFamily, 9.4, [System.Drawing.FontStyle]::Regular)

  $fmtCenter = New-Object System.Drawing.StringFormat
  $fmtCenter.Alignment = [System.Drawing.StringAlignment]::Center
  $fmtCenter.LineAlignment = [System.Drawing.StringAlignment]::Near
  if ($isAr) { $fmtCenter.FormatFlags = $fmtCenter.FormatFlags -bor [System.Drawing.StringFormatFlags]::DirectionRightToLeft }

  $fmtLeft = New-Object System.Drawing.StringFormat
  $fmtLeft.Alignment = [System.Drawing.StringAlignment]::Near
  $fmtLeft.LineAlignment = [System.Drawing.StringAlignment]::Near

  $fmtRight = New-Object System.Drawing.StringFormat
  $fmtRight.Alignment = [System.Drawing.StringAlignment]::Far
  $fmtRight.LineAlignment = [System.Drawing.StringAlignment]::Near

  $fmtRtlRight = New-Object System.Drawing.StringFormat
  $fmtRtlRight.Alignment = [System.Drawing.StringAlignment]::Far
  $fmtRtlRight.LineAlignment = [System.Drawing.StringAlignment]::Near
  $fmtRtlRight.FormatFlags = [System.Drawing.StringFormatFlags]::DirectionRightToLeft

  $fmtRtlLeft = New-Object System.Drawing.StringFormat
  $fmtRtlLeft.Alignment = [System.Drawing.StringAlignment]::Near
  $fmtRtlLeft.LineAlignment = [System.Drawing.StringAlignment]::Near
  $fmtRtlLeft.FormatFlags = [System.Drawing.StringFormatFlags]::DirectionRightToLeft

  # Brand
  $g.DrawString((Safe $data.storeName), $brandFont, $black, (New-Object System.Drawing.RectangleF($left, $y, $contentWidth, 10)), $fmtCenter)
  $y += $(if ($isKitchen) { 8.2 } else { 9.5 })
  $g.DrawString((Safe $data.storeSubtitle), $brandSubFont, $black, (New-Object System.Drawing.RectangleF($left, $y, $contentWidth, 5)), $fmtCenter)
  $y += $(if ($isKitchen) { 6.0 } else { 7.0 })

  # Title with side rules.
  $ruleY = $y + 3.6
  $rule = $(if ($isKitchen) { 13.0 } else { 14.0 })
  $g.DrawLine($thinPen, $left, $ruleY, $left + $rule, $ruleY)
  $g.DrawLine($thinPen, $paperWidthMm - $right - $rule, $ruleY, $paperWidthMm - $right, $ruleY)
  $g.DrawString((Safe $data.title), $titleFont, $black, (New-Object System.Drawing.RectangleF($left + $rule, $y, $contentWidth - (2*$rule), 7.5)), $fmtCenter)
  $y += 7.4

  if ((Safe $data.subtitle).Trim()) {
    $g.DrawString((Safe $data.subtitle), $subTitleFont, $black, (New-Object System.Drawing.RectangleF($left, $y, $contentWidth, 5)), $fmtCenter)
    $y += 5.0
  }
  if ((Safe $data.slogan).Trim()) {
    $g.DrawString((Safe $data.slogan), $smallFont, $black, (New-Object System.Drawing.RectangleF($left, $y, $contentWidth, 5)), $fmtCenter)
    $y += 5.3
  }
  if ((Safe $data.branchName).Trim()) {
    $g.DrawString((Safe $data.branchName), $smallFont, $black, (New-Object System.Drawing.RectangleF($left, $y, $contentWidth, 5)), $fmtCenter)
    $y += 5.2
  }

  if ($isKitchen -and (Safe $data.station).Trim()) {
    $stationLabel = $(if ($isAr) { 'المحطة' } else { 'Station' })
    $stationText = $stationLabel + ':  ' + (Safe $data.station)
    $g.DrawString($stationText, $bodyBold, $black, (New-Object System.Drawing.RectangleF($left, $y, $contentWidth, 6)), $(if ($isAr) { $fmtRtlRight } else { $fmtLeft }))
    $y += 6.3
  }

  # Meta rows.
  $labelWidth = $contentWidth * 0.34
  $valueWidth = $contentWidth - $labelWidth
  foreach ($row in @($data.meta)) {
    $label = (Safe $row.label) + ':'
    $value = Safe $row.value
    $font = $(if ([bool]$row.emphasis) { $bodyBold } else { $bodyFont })
    if ($isAr) {
      $g.DrawString($label, $font, $black, (New-Object System.Drawing.RectangleF($paperWidthMm - $right - $labelWidth, $y, $labelWidth, 6)), $fmtRtlRight)
      $g.DrawString($value, $font, $black, (New-Object System.Drawing.RectangleF($left, $y, $valueWidth, 6)), $fmtRtlLeft)
    } else {
      $g.DrawString($label, $font, $black, (New-Object System.Drawing.RectangleF($left, $y, $labelWidth, 6)), $fmtLeft)
      $g.DrawString($value, $font, $black, (New-Object System.Drawing.RectangleF($left + $labelWidth, $y, $valueWidth, 6)), $fmtLeft)
    }
    $y += $(if ($isKitchen) { 5.2 } else { 5.5 })
  }

  $y += 1.2
  $g.DrawLine($thinPen, $left, $y, $paperWidthMm - $right, $y)
  $y += 3.5

  # Items heading
  $g.DrawString((Safe $data.itemsHeading), $itemsTitleFont, $black, (New-Object System.Drawing.RectangleF($left, $y, $contentWidth, 7)), $(if ($isAr) { $fmtRtlRight } else { $fmtLeft }))
  $y += 7.0

  if ($isKitchen) {
    foreach ($item in @($data.items)) {
      $qty = Safe $item.qty
      $name = Safe $item.name
      if ($isAr) {
        $g.DrawString($qty, $bodyBold, $black, (New-Object System.Drawing.RectangleF($paperWidthMm - $right - 10, $y, 10, 6)), $fmtRight)
        $g.DrawString($name, $bodyBold, $black, (New-Object System.Drawing.RectangleF($left, $y, $contentWidth - 12, 6)), $fmtRtlLeft)
      } else {
        $g.DrawString($qty, $bodyBold, $black, (New-Object System.Drawing.RectangleF($left, $y, 10, 6)), $fmtLeft)
        $g.DrawString($name, $bodyBold, $black, (New-Object System.Drawing.RectangleF($left + 12, $y, $contentWidth - 12, 6)), $fmtLeft)
      }
      $y += 6.2

      foreach ($modifier in @($item.modifiers)) {
        $prefix = '+ ' + (Safe $modifier)
        $g.DrawString($prefix, $smallFont, $black, (New-Object System.Drawing.RectangleF($left + 4, $y, $contentWidth - 4, 5)), $(if ($isAr) { $fmtRtlRight } else { $fmtLeft }))
        $y += 4.5
      }
      if ((Safe $item.notes).Trim()) {
        $noteLabel = $(if ($isAr) { 'ملاحظة: ' } else { 'Note: ' })
        $g.DrawString($noteLabel + (Safe $item.notes), $smallFont, $black, (New-Object System.Drawing.RectangleF($left + 4, $y, $contentWidth - 4, 5.5)), $(if ($isAr) { $fmtRtlRight } else { $fmtLeft }))
        $y += 5.0
      }
      $y += 1.3
    }
  } else {
    $qtyW = 11.0
    $priceW = 22.0
    $nameW = $contentWidth - $qtyW - $priceW
    $qtyHead = $(if ($isAr) { 'الكمية' } else { 'QTY' })
    $itemHead = $(if ($isAr) { 'الصنف' } else { 'ITEM' })
    $priceHead = $(if ($isAr) { 'السعر' } else { 'PRICE' })
    $g.DrawString($qtyHead, $smallFont, $black, (New-Object System.Drawing.RectangleF($left, $y, $qtyW, 5)), $fmtLeft)
    $g.DrawString($itemHead, $smallFont, $black, (New-Object System.Drawing.RectangleF($left + $qtyW, $y, $nameW, 5)), $(if ($isAr) { $fmtRtlRight } else { $fmtLeft }))
    $g.DrawString($priceHead, $smallFont, $black, (New-Object System.Drawing.RectangleF($paperWidthMm - $right - $priceW, $y, $priceW, 5)), $fmtRight)
    $y += 5.7

    foreach ($item in @($data.items)) {
      $g.DrawString((Safe $item.qty), $bodyFont, $black, (New-Object System.Drawing.RectangleF($left, $y, $qtyW, 7)), $fmtCenter)
      $g.DrawString((Safe $item.name), $bodyFont, $black, (New-Object System.Drawing.RectangleF($left + $qtyW, $y, $nameW, 7)), $(if ($isAr) { $fmtRtlRight } else { $fmtLeft }))
      $displayPrice = $(if ((Safe $item.total).Trim()) { Safe $item.total } else { Safe $item.price })
      $g.DrawString($displayPrice, $bodyFont, $black, (New-Object System.Drawing.RectangleF($paperWidthMm - $right - $priceW, $y, $priceW, 7)), $fmtRight)
      $y += 8.0
    }
  }

  $y += 1.0
  $g.DrawLine($thinPen, $left, $y, $paperWidthMm - $right, $y)
  $y += 3.5

  # Customer totals
  if (-not $isKitchen) {
    foreach ($row in @($data.totals)) {
      $isStrong = [bool]$row.emphasis
      $font = $(if ($isStrong) { $totalFont } else { $bodyFont })
      $rowHeight = $(if ($isStrong) { 8.0 } else { 5.8 })
      if ($isAr) {
        $g.DrawString((Safe $row.label) + ':', $font, $black, (New-Object System.Drawing.RectangleF($paperWidthMm - $right - ($contentWidth*0.6), $y, $contentWidth*0.6, $rowHeight)), $fmtRtlRight)
        $g.DrawString((Safe $row.value), $font, $black, (New-Object System.Drawing.RectangleF($left, $y, $contentWidth*0.42, $rowHeight)), $fmtRight)
      } else {
        $g.DrawString((Safe $row.label) + ':', $font, $black, (New-Object System.Drawing.RectangleF($left, $y, $contentWidth*0.58, $rowHeight)), $fmtLeft)
        $g.DrawString((Safe $row.value), $font, $black, (New-Object System.Drawing.RectangleF($left + ($contentWidth*0.55), $y, $contentWidth*0.45, $rowHeight)), $fmtRight)
      }
      $y += $rowHeight
    }

    $y += 1.0
    $g.DrawLine($thinPen, $left, $y, $paperWidthMm - $right, $y)
    $y += 5.0
  }

  foreach ($line in @($data.footerLines)) {
    $font = $(if ($isKitchen) { $bodyBold } else { $footerFont })
    $g.DrawString((Safe $line), $font, $black, (New-Object System.Drawing.RectangleF($left, $y, $contentWidth, 7)), $fmtCenter)
    $y += $(if ($isKitchen) { 7.0 } else { 5.8 })
  }

  $e.HasMorePages = $false

  $thinPen.Dispose()
  $strongPen.Dispose()
  foreach ($font in @($brandFont,$brandSubFont,$titleFont,$subTitleFont,$bodyFont,$bodyBold,$smallFont,$itemsTitleFont,$totalFont,$footerFont)) { $font.Dispose() }
  foreach ($fmt in @($fmtCenter,$fmtLeft,$fmtRight,$fmtRtlRight,$fmtRtlLeft)) { $fmt.Dispose() }
})

try {
  $doc.Print()
} finally {
  $doc.Dispose()
}
