Set-Location "c:\Users\israe\Desktop\Nova pasta"
$env:GIT_PAGER='cat'
$node = (Get-Command node.exe).Source
$out = "c:\Users\israe\Desktop\Nova pasta\vite.out.log"
$err = "c:\Users\israe\Desktop\Nova pasta\vite.err.log"
Remove-Item $out,$err -ErrorAction SilentlyContinue
& $node "c:\Users\israe\Desktop\Nova pasta\node_modules\vite\bin\vite.js" --host 0.0.0.0 --port 5000 --strictPort 1> $out 2> $err
