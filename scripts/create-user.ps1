# Create a login account without Node.js.
# This script does not write to D1 directly - it only prints an INSERT SQL statement.
# Paste that SQL into the Cloudflare dashboard: D1 > apt-advisor-db > Console tab.
#
# Hashing matches src/auth.js's hashPassword() exactly: PBKDF2-SHA256, 100000
# iterations, 16-byte salt, 32-byte output.

$username = Read-Host "Username"
$securePassword = Read-Host "Password" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$password = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

if ([string]::IsNullOrWhiteSpace($username) -or [string]::IsNullOrWhiteSpace($password)) {
	Write-Error "Username/password cannot be empty."
	exit 1
}

$salt = New-Object byte[] 16
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($salt)

$pbkdf2 = New-Object Security.Cryptography.Rfc2898DeriveBytes(
	$password, $salt, 100000, [Security.Cryptography.HashAlgorithmName]::SHA256
)
$hash = $pbkdf2.GetBytes(32)

$hashHex = -join ($hash | ForEach-Object { $_.ToString("x2") })
$saltHex = -join ($salt | ForEach-Object { $_.ToString("x2") })
$usernameEscaped = $username.Replace("'", "''")

$sql = "INSERT INTO users (username, password_hash, salt) VALUES ('$usernameEscaped', '$hashHex', '$saltHex') ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, salt = excluded.salt;"

Write-Host "`nPaste this SQL into the D1 Console (Cloudflare dashboard):`n" -ForegroundColor Cyan
Write-Output $sql
