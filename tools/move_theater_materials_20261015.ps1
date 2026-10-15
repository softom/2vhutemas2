$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath 'D:\WORK\2Vhutemas').Path
$storeRoot = (Resolve-Path -LiteralPath 'E:\Dropbox\2VHUTEMAS').Path
$taipeiRoot = Join-Path $storeRoot 'ЧТО\ПРОЕКТЫ\арх_объекты_Тайбэйский центр исполнительских искусств (Taipei Performing Arts Center)'
$taichungRoot = Join-Path $storeRoot 'ЧТО\ПРОЕКТЫ\арх_объекты_Национальный театр Тайчжуна (National Taichung Theater)'
foreach ($root in @($taipeiRoot,$taichungRoot)) { if (-not (Test-Path -LiteralPath $root -PathType Container)) { throw "Missing object folder: $root" } }
$moves = @(
    @{ Relative='research_notes\Материалы для программы Тайбэйского центра'; Root=$taipeiRoot },
    @{ Relative='research_notes\Конкурсные проекты и документы Тайбэя'; Root=$taipeiRoot },
    @{ Relative='research_notes\Материалы для программы театра Тайчжуна'; Root=$taichungRoot },
    @{ Relative='WIKI\assets\taichung-national-theater'; Root=$taichungRoot }
)
$entries = [System.Collections.Generic.List[object]]::new()
$completed = [System.Collections.Generic.List[object]]::new()
function Copy-VerifiedFile([string]$sourcePath,[string]$destinationPath,[string]$operation) {
    $destinationFull = [IO.Path]::GetFullPath($destinationPath)
    if (-not $destinationFull.StartsWith($storeRoot + '\',[StringComparison]::OrdinalIgnoreCase)) { throw "Destination outside store: $destinationFull" }
    $null = New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($destinationFull))
    $before = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if (Test-Path -LiteralPath $destinationFull) {
        if ((Get-FileHash -LiteralPath $destinationFull -Algorithm SHA256).Hash.ToLowerInvariant() -ne $before) { throw "Destination conflict: $destinationFull" }
    } else { Copy-Item -LiteralPath $sourcePath -Destination $destinationFull }
    $after = (Get-FileHash -LiteralPath $destinationFull -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($before -ne $after) { throw "Copy hash mismatch: $sourcePath" }
    $entries.Add([pscustomobject]@{source=$sourcePath;destination=$destinationFull;sha256=$after;bytes=(Get-Item -LiteralPath $destinationFull).Length;operation=$operation})
}
foreach ($move in $moves) {
    $sourceFull = [IO.Path]::GetFullPath((Join-Path $repoRoot $move.Relative))
    $destinationFull = [IO.Path]::GetFullPath((Join-Path $move.Root $move.Relative))
    if (-not $sourceFull.StartsWith($repoRoot + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Source outside workspace' }
    $item = Get-Item -LiteralPath $sourceFull
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Already a link; inspect before retry: $sourceFull" }
    $files = @(Get-ChildItem -LiteralPath $sourceFull -Recurse -File)
    foreach ($f in $files) {
        $relative = $f.FullName.Substring($sourceFull.Length+1)
        Copy-VerifiedFile $f.FullName (Join-Path $destinationFull $relative) 'move-original-and-junction'
    }
    $completed.Add([pscustomobject]@{source=$sourceFull;destination=$destinationFull;files=$files.Count})
}
# Versioned code and WIKI remain in the repository; copy their object-specific snapshots.
$snapshots = @(
    @{Pattern='tpac_*.py';Folder='research_notes';Root=$taipeiRoot},
    @{Pattern='fetch_tpac_finalists.py';Folder='research_notes';Root=$taipeiRoot},
    @{Pattern='taichung_*.py';Folder='research_notes';Root=$taichungRoot},
    @{Pattern='*Тайб*';Folder='reports';Root=$taipeiRoot},
    @{Pattern='*Тайч*';Folder='reports';Root=$taichungRoot},
    @{Pattern='TPAC*.md';Folder='WIKI';Root=$taipeiRoot},
    @{Pattern='Тайбэйский*.md';Folder='WIKI';Root=$taipeiRoot},
    @{Pattern='*Тайчжун*.md';Folder='WIKI';Root=$taichungRoot},
    @{Pattern='tpac-four-flows-*';Folder='WIKI\assets';Root=$taipeiRoot}
)
foreach ($s in $snapshots) {
    foreach ($f in Get-ChildItem -LiteralPath (Join-Path $repoRoot $s.Folder) -Filter $s.Pattern -File) {
        Copy-VerifiedFile $f.FullName (Join-Path (Join-Path $s.Root $s.Folder) $f.Name) 'versioned-documentation-snapshot'
    }
}
$auditPath = Join-Path $repoRoot 'reports\theater-materials-move-2026-10-15.json'
$audit = [ordered]@{date='2026-10-15';phase='copied-and-sha256-verified';moves=$completed;files=$entries}
[IO.File]::WriteAllText($auditPath,($audit|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
# Every target is an explicit verified directory below the named workspace and object store.
foreach ($move in $completed) {
    $resolvedSource = (Resolve-Path -LiteralPath $move.source).Path
    $resolvedTarget = (Resolve-Path -LiteralPath $move.destination).Path
    if ($resolvedSource -ne $move.source -or -not $resolvedSource.StartsWith($repoRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Deletion boundary check failed' }
    if (-not $resolvedTarget.StartsWith($storeRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Target boundary check failed' }
    $expected = @($entries | Where-Object {$_.operation -eq 'move-original-and-junction' -and $_.source.StartsWith($resolvedSource+'\',[StringComparison]::OrdinalIgnoreCase)})
    foreach ($record in $expected) {
        if ((Get-FileHash -LiteralPath $record.source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $record.sha256) { throw 'Source changed during copy' }
        if ((Get-FileHash -LiteralPath $record.destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $record.sha256) { throw 'Target changed during copy' }
    }
    Remove-Item -LiteralPath $resolvedSource -Recurse -Force
    $null = New-Item -ItemType Junction -Path $resolvedSource -Target $resolvedTarget
    if ((Get-Item -LiteralPath $resolvedSource).LinkType -ne 'Junction') { throw 'Compatibility junction not confirmed' }
}
$audit.phase='moved-sha256-verified-junctions-created'
[IO.File]::WriteAllText($auditPath,($audit|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
[pscustomobject]@{files=$entries.Count;bytes=($entries|Measure-Object bytes -Sum).Sum;junctions=$completed.Count;audit=$auditPath}|ConvertTo-Json
