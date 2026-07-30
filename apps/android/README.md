# HLOVET Android TWA

This folder contains a Bubblewrap-generated Android Trusted Web Activity wrapper for `https://5200918.xyz`.

## Local Signing

The signing keystore is intentionally not committed. The generated manifest expects it at:

```text
../../output/android/hlovet-twa-test.p12
```

The local keystore password file is also kept outside git:

```text
../../output/android/hlovet-twa-keystore-password.txt
```

## Build

Use JDK 17 and Android SDK command-line tools. On the current Windows machine they are installed under:

```text
D:\app\android-build\jdk17
D:\app\android-build\android-sdk
```

From this folder:

```powershell
$env:JAVA_HOME='D:\app\android-build\jdk17'
$env:ANDROID_HOME='D:\app\android-build\android-sdk'
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
$env:PATH="$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\cmdline-tools\latest\bin;$env:PATH"
$pw=(Get-Content -Raw '..\..\output\android\hlovet-twa-keystore-password.txt').Trim()
$env:BUBBLEWRAP_KEYSTORE_PASSWORD=$pw
$env:BUBBLEWRAP_KEY_PASSWORD=$pw
npx --yes @bubblewrap/cli build --skipPwaValidation
```

The signed APK is generated as `app-release-signed.apk`. Copy it to `../../output/android/hlovet-twa-test.apk` for local installation testing.
