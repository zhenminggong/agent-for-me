Get-Content .env.local -Encoding UTF8 | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
  $parts = $_ -split '=', 2
  $name = $parts[0].Trim()
  $value = $parts[1].Trim().Trim([char]34).Trim([char]39)
  Set-Item -Path \"env:$name\" -Value $value
}
npx vercel dev --yes *> _vercel-dev.log
