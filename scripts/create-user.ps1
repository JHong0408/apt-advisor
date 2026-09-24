# Node.js 없이 로그인 계정을 만드는 방법.
# 이 스크립트는 D1에 직접 쓰지 않고, INSERT SQL문만 출력합니다.
# 그 SQL을 Cloudflare 대시보드 > Workers & Pages > D1 > apt-advisor-db > Console 탭에
# 붙여넣어서 실행하세요.
#
# src/auth.js의 hashPassword()와 동일한 방식(PBKDF2-SHA256, 100000회 반복, salt 16바이트,
# 결과 32바이트)으로 해시를 계산합니다.

$email = Read-Host "이메일"
$securePassword = Read-Host "비밀번호" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$password = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

if ([string]::IsNullOrWhiteSpace($email) -or [string]::IsNullOrWhiteSpace($password)) {
	Write-Error "이메일/비밀번호는 비워둘 수 없습니다."
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
$emailEscaped = $email.Replace("'", "''")

$sql = "INSERT INTO users (email, password_hash, salt) VALUES ('$emailEscaped', '$hashHex', '$saltHex') ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, salt = excluded.salt;"

Write-Host "`n아래 SQL을 D1 Console(대시보드)에 붙여넣어 실행하세요:`n" -ForegroundColor Cyan
Write-Output $sql
