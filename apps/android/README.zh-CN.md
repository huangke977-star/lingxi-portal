# HLOVET Android TWA

这个目录是用 Bubblewrap 生成的 Android Trusted Web Activity 包装工程，用来把 `https://5200918.xyz` 打成一个可安装的 Android 测试 APK。

## 本地签名

签名密钥不会提交到仓库。当前工程的 manifest 期望密钥位于：

```text
../../output/android/hlovet-twa-test.p12
```

本地密钥密码文件也保留在 git 之外：

```text
../../output/android/hlovet-twa-keystore-password.txt
```

## 构建

需要使用 JDK 17 和 Android SDK 命令行工具。当前这台 Windows 机器上的位置是：

```text
D:\app\android-build\jdk17
D:\app\android-build\android-sdk
```

在本目录执行：

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

构建完成后会生成 `app-release-signed.apk`，可以复制到 `../../output/android/hlovet-twa-test.apk` 用于本地安装测试。

## 网站下载

网站会从下面的位置提供当前 Android 测试 APK 下载：

```text
../web/public/downloads/android/hlovet-latest.apk
../web/public/downloads/android/latest.json
```

以后构建新版 APK 后，把签名后的 APK 复制为 `hlovet-latest.apk`，同时更新 `latest.json` 中的 `versionCode`、`sizeBytes`、`sha256` 和更新说明，然后重新部署 Web 应用。
