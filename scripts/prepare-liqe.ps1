param([ValidateSet('cpu', 'cuda')][string]$Device = 'cuda')
$ErrorActionPreference = 'Stop'
$runtimeDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\vendor\liqe-runtime'))
$venvPython = Join-Path $runtimeDirectory 'Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venvPython)) {
    & uv venv --python 3.12 $runtimeDirectory
    if ($LASTEXITCODE -ne 0) { throw '无法准备 Python 3.12 环境' }
}
$indexUrl = if ($Device -eq 'cuda') { 'https://download.pytorch.org/whl/cu128' } else { 'https://download.pytorch.org/whl/cpu' }
& uv pip install -q --python $venvPython torch==2.7.1 torchvision==0.22.1 --index-url $indexUrl
if ($LASTEXITCODE -ne 0) { throw '无法安装本地推理环境' }
& uv pip install -q --python $venvPython 'setuptools<81' wheel ftfy regex tqdm pillow numpy
if ($LASTEXITCODE -ne 0) { throw '无法安装图像处理依赖' }
& uv pip install -q --no-build-isolation --python $venvPython 'clip @ https://github.com/openai/CLIP/archive/a1d071733d7111c9c014f024669f959182114e33.zip'
if ($LASTEXITCODE -ne 0) { throw '无法安装 CLIP' }
& $venvPython -I (Join-Path $PSScriptRoot 'download-liqe.py') $runtimeDirectory
if ($LASTEXITCODE -ne 0) { throw '模型下载或校验失败' }
# A real local Python executable and standard library make the runtime relocatable.
# Keep the installed site-packages; never copy any user profile or credentials.
$basePythonDirectory = (& $venvPython -I -c 'import sys; print(sys.base_prefix)').Trim()
foreach ($name in @('python.exe', 'pythonw.exe', 'python3.dll', 'python312.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'LICENSE.txt', 'DLLs')) {
    $source = Join-Path $basePythonDirectory $name
    if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination $runtimeDirectory -Recurse -Force }
}
Get-ChildItem -LiteralPath (Join-Path $basePythonDirectory 'Lib') | Where-Object { $_.Name -ne 'site-packages' } | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $runtimeDirectory 'Lib') -Recurse -Force
}
# The root executable uses the local Lib and DLLs instead of the venv redirector.
[IO.File]::WriteAllText((Join-Path $runtimeDirectory 'python312._pth'), "Lib`nLib/site-packages`nDLLs`n.`nimport site`n", [Text.UTF8Encoding]::new($false))
& (Join-Path $runtimeDirectory 'python.exe') -I -c 'import torch, clip; print(torch.cuda.is_available())'
if ($LASTEXITCODE -ne 0) { throw '本地推理环境验证失败' }
Write-Host 'LIQE runtime ready; the value above indicates CUDA availability.'
