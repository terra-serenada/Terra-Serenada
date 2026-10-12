set -euo pipefail
mkdir -p android/app/src/main/java/com/terra/serenada
mkdir -p android/app/src/main/res/drawable
mkdir -p android/app/src/main/res/values
mkdir -p android/app/src/main/assets

cat > android/settings.gradle.kts <<'KOT'
pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories { google(); mavenCentral() }
}
rootProject.name = "TerraSerenadaAndroid"
include(":app")
KOT

cat > android/build.gradle.kts <<'KOT'
plugins { id("com.android.application") version "8.13.0" apply false }
KOT

cat > android/gradle.properties <<'PROP'
org.gradle.jvmargs=-Xmx3072m -Dfile.encoding=UTF-8
android.useAndroidX=true
kotlin.code.style=official
PROP

cat > android/app/build.gradle.kts <<'KOT'
plugins { id("com.android.application") }
val ciRunNumber = System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 1
android {
    namespace = "com.terra.serenada"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.terra.serenada"
        minSdk = 24
        targetSdk = 36
        versionCode = 1000 + ciRunNumber
        versionName = "1.0.21.$ciRunNumber"
    }
    signingConfigs {
        create("release") {
            storeFile = file(System.getenv("ANDROID_KEYSTORE_PATH"))
            storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias = System.getenv("ANDROID_KEY_ALIAS")
            keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            storeType = "PKCS12"
        }
    }
    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }
}
dependencies { implementation("androidx.webkit:webkit:1.14.0") }
KOT

cat > android/app/src/main/res/values/strings.xml <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<resources><string name="app_name">Terra Serenada</string></resources>
XML

cat > android/app/src/main/res/values/styles.xml <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="Theme.TerraSerenada" parent="android:style/Theme.Material.NoActionBar">
        <item name="android:fontFamily">sans</item>
        <item name="android:windowLightStatusBar">false</item>
        <item name="android:statusBarColor">#101712</item>
        <item name="android:navigationBarColor">#101712</item>
        <item name="android:windowLightNavigationBar">false</item>
        <item name="android:windowActionModeOverlay">true</item>
    </style>
</resources>
XML

cat > android/app/src/main/AndroidManifest.xml <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <application
        android:allowBackup="true"
        android:usesCleartextTraffic="false"
        android:icon="@drawable/icon"
        android:label="@string/app_name"
        android:roundIcon="@drawable/icon"
        android:supportsRtl="true"
        android:theme="@style/Theme.TerraSerenada">
        <activity android:name=".MainActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
        <receiver android:name=".ReminderReceiver" android:exported="false" />
    </application>
</manifest>
XML

cp icon.png android/app/src/main/res/drawable/icon.png
cp index.html android/app/src/main/assets/index.html
cp manifest.webmanifest android/app/src/main/assets/manifest.webmanifest
cp icon.png android/app/src/main/assets/icon.png
cp icon-192.png android/app/src/main/assets/icon-192.png
cp icon-512.png android/app/src/main/assets/icon-512.png
if [ -f sw.js ]; then cp sw.js android/app/src/main/assets/sw.js; fi

cat > android/app/src/main/java/com/terra/serenada/MainActivity.java <<'JAVA'
package com.terra.serenada;

import android.app.Activity;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.Manifest;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.webkit.WebViewAssetLoader;

public class MainActivity extends Activity {
    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private Uri pendingCaptureUri;
    private String pendingBackupJson;
    private String pendingBackupFilename = "backup-terra-serenada.json";
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final int BACKUP_CREATE_REQUEST = 1002;
    private static final int NOTIFICATION_REQUEST = 1003;
    private static final String CHANNEL_ID = "terra_serenada_reminders";
    private static final int DAILY_ALARM_ID = 230103;

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            nm.createNotificationChannel(new NotificationChannel(CHANNEL_ID, "Pengingat Terra Serenada", NotificationManager.IMPORTANCE_DEFAULT));
        }
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_REQUEST);
        }
    }

    private void scheduleDailyReminder(String payload) {
        getSharedPreferences("terra_notifications", MODE_PRIVATE).edit().putString("payload", payload == null ? "{}" : payload).apply();
        AlarmManager am = (AlarmManager)getSystemService(ALARM_SERVICE);
        PendingIntent pi = PendingIntent.getBroadcast(this, DAILY_ALARM_ID, new Intent(this, ReminderReceiver.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        java.util.Calendar cal = java.util.Calendar.getInstance();
        cal.set(java.util.Calendar.HOUR_OF_DAY, 8);
        cal.set(java.util.Calendar.MINUTE, 0);
        cal.set(java.util.Calendar.SECOND, 0);
        cal.set(java.util.Calendar.MILLISECOND, 0);
        if (cal.getTimeInMillis() <= System.currentTimeMillis()) cal.add(java.util.Calendar.DAY_OF_YEAR, 1);
        am.setInexactRepeating(AlarmManager.RTC_WAKEUP, cal.getTimeInMillis(), AlarmManager.INTERVAL_DAY, pi);
    }

    private class TerraBridge {
        @JavascriptInterface
        public boolean saveBackup(String filename, String json) {
            pendingBackupFilename = (filename == null || filename.isEmpty()) ? "backup-terra-serenada.json" : filename;
            pendingBackupJson = json;
            runOnUiThread(() -> {
                try {
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("application/json");
                    intent.putExtra(Intent.EXTRA_TITLE, pendingBackupFilename);
                    startActivityForResult(intent, BACKUP_CREATE_REQUEST);
                } catch (Exception e) {
                    pendingBackupJson = null;
                    webView.evaluateJavascript("window.__terraBackupSaved && window.__terraBackupSaved(false)", null);
                }
            });
            return true;
        }

        @JavascriptInterface
        public boolean requestNotifications() {
            runOnUiThread(() -> { createNotificationChannel(); requestNotificationPermission(); });
            return true;
        }

        @JavascriptInterface
        public boolean scheduleNotifications(String json) {
            runOnUiThread(() -> { createNotificationChannel(); scheduleDailyReminder(json); });
            return true;
        }
    }

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        createNotificationChannel();
        webView = new WebView(this);
        setContentView(webView);

        WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setDatabaseEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(true);
        webView.addJavascriptInterface(new TerraBridge(), "AndroidBridge");

        webView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                pendingCaptureUri = null;
                try {
                    Intent intent = params.createIntent();
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                    if (MediaStore.ACTION_IMAGE_CAPTURE.equals(intent.getAction()) || MediaStore.ACTION_VIDEO_CAPTURE.equals(intent.getAction())) {
                        try { pendingCaptureUri = intent.getParcelableExtra(MediaStore.EXTRA_OUTPUT); } catch (Exception ignored) {}
                    }
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                    return true;
                } catch (Exception e) {
                    pendingCaptureUri = null;
                    filePathCallback = null;
                    return false;
                }
            }
        });
        webView.loadUrl("https://appassets.androidplatform.net/assets/index.html");
    }

    private Uri[] collectFileChooserResults(Intent data) {
        java.util.ArrayList<Uri> uris = new java.util.ArrayList<>();
        if (data != null) {
            ClipData clip = data.getClipData();
            if (clip != null) {
                for (int i = 0; i < clip.getItemCount(); i++) {
                    Uri uri = clip.getItemAt(i).getUri();
                    if (uri != null && !uris.contains(uri)) uris.add(uri);
                }
            }
            Uri single = data.getData();
            if (single != null && !uris.contains(single)) uris.add(single);
            if (single != null && (data.getFlags() & Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION) != 0) {
                try {
                    int takeFlags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                    getContentResolver().takePersistableUriPermission(single, takeFlags);
                } catch (Exception ignored) {}
            }
        }
        if (uris.isEmpty() && pendingCaptureUri != null) uris.add(pendingCaptureUri);
        return uris.isEmpty() ? null : uris.toArray(new Uri[0]);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            Uri[] results = resultCode == RESULT_OK ? collectFileChooserResults(data) : null;
            if (filePathCallback != null) filePathCallback.onReceiveValue(results);
            filePathCallback = null;
            pendingCaptureUri = null;
        } else if (requestCode == BACKUP_CREATE_REQUEST) {
            boolean ok = false;
            Uri uri = resultCode == RESULT_OK && data != null ? data.getData() : null;
            if (pendingBackupJson != null && uri != null) {
                try (java.io.OutputStream out = getContentResolver().openOutputStream(uri)) {
                    if (out == null) throw new java.io.IOException("Output stream unavailable");
                    out.write(pendingBackupJson.getBytes(java.nio.charset.StandardCharsets.UTF_8));
                    out.flush();
                    ok = true;
                } catch (Exception ignored) { ok = false; }
            }
            pendingBackupJson = null;
            webView.evaluateJavascript("window.__terraBackupSaved && window.__terraBackupSaved(" + ok + ")", null);
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack(); else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        if (webView != null) { webView.removeJavascriptInterface("AndroidBridge"); webView.destroy(); }
        super.onDestroy();
    }
}
JAVA

cat > android/app/src/main/java/com/terra/serenada/ReminderReceiver.java <<'JAVA'
package com.terra.serenada;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import org.json.JSONObject;

public class ReminderReceiver extends BroadcastReceiver {
    private static final String CHANNEL_ID = "terra_serenada_reminders";
    @Override public void onReceive(Context context, Intent intent) {
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission("android.permission.POST_NOTIFICATIONS") != android.content.pm.PackageManager.PERMISSION_GRANTED) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationManager nm = context.getSystemService(NotificationManager.class);
                nm.createNotificationChannel(new NotificationChannel(CHANNEL_ID, "Pengingat Terra Serenada", NotificationManager.IMPORTANCE_DEFAULT));
            }
            String payload = context.getSharedPreferences("terra_notifications", Context.MODE_PRIVATE).getString("payload", "{}");
            JSONObject obj = new JSONObject(payload);
            StringBuilder body = new StringBuilder();
            String[] keys = {"harvest", "water", "attention"};
            for (String key : keys) {
                org.json.JSONArray a = obj.optJSONArray(key);
                if (a != null) for (int i = 0; i < a.length(); i++) {
                    if (body.length() > 0) body.append("\n");
                    body.append(a.optString(i));
                }
            }
            if (body.length() == 0) return;
            Intent open = new Intent(context, MainActivity.class);
            PendingIntent pi = PendingIntent.getActivity(context, 230104, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            NotificationCompat.Builder b = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.icon)
                .setContentTitle("Terra Serenada")
                .setContentText("Ada pengingat untuk kebun")
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body.toString()))
                .setAutoCancel(true).setContentIntent(pi).setPriority(NotificationCompat.PRIORITY_DEFAULT);
            ((NotificationManager)context.getSystemService(Context.NOTIFICATION_SERVICE)).notify(230105, b.build());
        } catch (Exception ignored) {}
    }
}
JAVA
