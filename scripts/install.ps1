param([string]$CodexCommand = 'codex.cmd')
$ErrorActionPreference = 'Stop'
$pluginDirectory = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$marketplaceDirectory = Join-Path $pluginDirectory '.local-marketplace'
$catalogDirectory = Join-Path $marketplaceDirectory '.agents\plugins'
$installedSource = Join-Path $marketplaceDirectory 'plugins\ui-studio'

Push-Location -LiteralPath $pluginDirectory
try {
    if (-not (Test-Path -LiteralPath 'node_modules')) {
        & npm.cmd ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
    New-Item -ItemType Directory -Path $catalogDirectory -Force | Out-Null
    New-Item -ItemType Directory -Path $installedSource -Force | Out-Null
    $copyNames = @('.codex-plugin','.mcp.json','skills','src','scripts','native','web','dist','package.json','package-lock.json','README.md','PRODUCT_REQUIREMENTS.md','VALIDATION.md','node_modules')
    foreach ($copyName in $copyNames) {
        $source = Join-Path $pluginDirectory $copyName
        Copy-Item -LiteralPath $source -Destination $installedSource -Recurse -Force
    }
    $catalog = @{
        name = 'ui-studio-local'
        interface = @{ displayName = 'UI Studio 本地开发' }
        plugins = @(@{
            name = 'ui-studio'
            source = @{ source = 'local'; path = './plugins/ui-studio' }
            policy = @{ installation = 'AVAILABLE'; authentication = 'ON_INSTALL' }
            category = 'Developer Tools'
        })
    }
    $catalog | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $catalogDirectory 'marketplace.json') -Encoding utf8
    & $CodexCommand plugin marketplace add $marketplaceDirectory --json
    if ($LASTEXITCODE -ne 0) { throw 'Marketplace registration failed.' }
    & $CodexCommand plugin add 'ui-studio@ui-studio-local' --json
    if ($LASTEXITCODE -ne 0) { throw 'Plugin installation failed.' }
    Write-Host 'UI Studio installed. Use it in a new Codex chat; restart the client if its tool list has not refreshed.'
} finally { Pop-Location }
