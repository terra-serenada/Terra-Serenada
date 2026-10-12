#!/usr/bin/env python3
"""Patch the generated Android project with Kotlin/LiteRT-LM and model-file import."""
from pathlib import Path
import shutil

root = Path.cwd()
app_gradle = root / "android/app/build.gradle.kts"
root_gradle = root / "android/build.gradle.kts"
main_java = root / "android/app/src/main/java/com/terra/serenada/MainActivity.java"
kotlin_source = root / "android-local/NaraLocalEngine.kt"
kotlin_dest = root / "android/app/src/main/java/com/terra/serenada/NaraLocalEngine.kt"
for p in (app_gradle, root_gradle, main_java, kotlin_source):
    if not p.is_file():
        raise SystemExit(f"ERROR: required integration source missing: {p}")

# Enable Kotlin and add the official LiteRT-LM Android Maven artifact.
s = root_gradle.read_text(encoding="utf-8")
old = 'plugins { id("com.android.application") version "8.13.0" apply false }'
new = '''plugins {
    id("com.android.application") version "8.13.0" apply false
    id("org.jetbrains.kotlin.android") version "2.2.20" apply false
}'''
if "org.jetbrains.kotlin.android" not in s:
    if old not in s: raise SystemExit("ERROR: root Gradle plugin marker did not match.")
    root_gradle.write_text(s.replace(old, new, 1), encoding="utf-8")

s = app_gradle.read_text(encoding="utf-8")
if 'id("org.jetbrains.kotlin.android")' not in s:
    old = 'plugins { id("com.android.application") }'
    new = '''plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}'''
    if old not in s: raise SystemExit("ERROR: app Gradle plugin marker did not match.")
    s = s.replace(old, new, 1)
if "kotlinOptions" not in s:
    old = "android {\n"
    new = '''android {
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
'''
    if old not in s: raise SystemExit("ERROR: android block marker did not match.")
    s = s.replace(old, new, 1)
old = 'dependencies { implementation("androidx.webkit:webkit:1.14.0") }'
new = '''dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("com.google.ai.edge.litertlm:litertlm-android:latest.release")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
}'''
if "com.google.ai.edge.litertlm:litertlm-android" not in s:
    if old not in s: raise SystemExit("ERROR: app dependency marker did not match.")
    s = s.replace(old, new, 1)
app_gradle.write_text(s, encoding="utf-8")

# Inject the bridge into the existing Java Activity without replacing existing backup,
# file chooser, notification or reminder code.
s = main_java.read_text(encoding="utf-8")
if "NaraLocalEngine naraLocalEngine" not in s:
    old = "import android.content.ClipData;"
    new = "import android.content.ClipData;\nimport android.database.Cursor;\nimport android.provider.OpenableColumns;"
    if old not in s: raise SystemExit("ERROR: MainActivity imports marker not found.")
    s = s.replace(old, new, 1)
    old = "    private WebView webView;"
    new = "    private WebView webView;\n    private NaraLocalEngine naraLocalEngine;\n    private static final int NARA_MODEL_REQUEST = 1004;"
    if old not in s: raise SystemExit("ERROR: WebView field marker not found.")
    s = s.replace(old, new, 1)

    old = '        webView.addJavascriptInterface(new TerraBridge(), "AndroidBridge");'
    new = old + '\n        naraLocalEngine = new NaraLocalEngine(this, webView);\n        webView.addJavascriptInterface(naraLocalEngine, "NaraLocalAI");'
    if old not in s: raise SystemExit("ERROR: AndroidBridge registration marker not found.")
    s = s.replace(old, new, 1)

    old = '''        webView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }
        });'''
    new = '''        webView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }
            @Override public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (naraLocalEngine != null) naraLocalEngine.resumeStoredModel();
            }
        });'''
    if old not in s: raise SystemExit("ERROR: WebViewClient marker not found.")
    s = s.replace(old, new, 1)

    methods = r'''              public void requestNaraModelSelection() {
                  runOnUiThread(() -> {
                      try {
                          Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                          intent.addCategory(Intent.CATEGORY_OPENABLE);
                          intent.setType("*/*");
                          intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/octet-stream", "application/x-binary", "*/*"});
                          intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                          startActivityForResult(intent, NARA_MODEL_REQUEST);
                      } catch (Exception e) {
                          setNaraLocalStatus("Pemilih file tidak dapat dibuka: " + e.getMessage(), false);
                      }
                  });
              }

              public void deliverNaraLocalResult(String requestId, String payloadJson) {
                  runOnUiThread(() -> {
                      if (webView == null) return;
                      String js = "window.naraLocalModelResult && window.naraLocalModelResult(" + org.json.JSONObject.quote(requestId) + "," + payloadJson + ")";
                      webView.evaluateJavascript(js, null);
                  });
              }

              public void setNaraLocalStatus(String message, boolean ready) {
                  runOnUiThread(() -> {
                      if (webView == null) return;
                      String js = "window.__naraSetNativeStatus && window.__naraSetNativeStatus(" + org.json.JSONObject.quote(message) + "," + ready + ")";
                      webView.evaluateJavascript(js, null);
                  });
              }

              private String selectedDisplayName(Uri uri) {
                  String name = "";
                  try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                      if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
                  } catch (Exception ignored) {}
                  return name == null ? "" : name;
              }

              private void importNaraModel(Uri uri) {
                  if (uri == null || naraLocalEngine == null) return;
                  String displayName = selectedDisplayName(uri);
                  if (!displayName.toLowerCase(java.util.Locale.ROOT).endsWith(".litertlm")) {
                      setNaraLocalStatus("File yang dipilih bukan .litertlm. Unduh model LiteRT-LM yang kompatibel, lalu pilih file tersebut.", false);
                      return;
                  }
                  java.io.File modelDir = new java.io.File(getFilesDir(), "models");
                  if (!modelDir.exists() && !modelDir.mkdirs()) {
                      setNaraLocalStatus("Tidak dapat membuat folder penyimpanan model.", false);
                      return;
                  }
                  java.io.File temporary = new java.io.File(modelDir, "nara-model.litertlm.part");
                  java.io.File destination = new java.io.File(modelDir, "nara-model.litertlm");
                  setNaraLocalStatus("Menyalin model ke penyimpanan privat aplikasi. Jangan tutup aplikasi dulu.", false);
                  try (java.io.InputStream in = getContentResolver().openInputStream(uri);
                       java.io.FileOutputStream out = new java.io.FileOutputStream(temporary)) {
                      if (in == null) throw new java.io.IOException("File tidak dapat dibaca");
                      byte[] buffer = new byte[1024 * 1024];
                      int count;
                      while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
                      out.getFD().sync();
                  } catch (Exception e) {
                      temporary.delete();
                      setNaraLocalStatus("Gagal menyalin model: " + e.getMessage(), false);
                      return;
                  }
                  if (temporary.length() < 1000000L) {
                      temporary.delete();
                      setNaraLocalStatus("File model terlalu kecil atau tidak lengkap.", false);
                      return;
                  }
                  if (destination.exists() && !destination.delete()) {
                      temporary.delete();
                      setNaraLocalStatus("Model lama tidak dapat diganti. Pastikan penyimpanan cukup.", false);
                      return;
                  }
                  if (!temporary.renameTo(destination)) {
                      temporary.delete();
                      setNaraLocalStatus("Gagal menyimpan model secara permanen.", false);
                      return;
                  }
                  naraLocalEngine.loadModel(destination.getAbsolutePath());
              }

'''
    anchor = "    private Uri[] collectFileChooserResults(Intent data) {"
    if anchor not in s: raise SystemExit("ERROR: Activity method insertion marker not found.")
    s = s.replace(anchor, methods + anchor, 1)

    old = "        if (requestCode == FILE_CHOOSER_REQUEST) {"
    new = "        if (requestCode == NARA_MODEL_REQUEST) {\n            if (resultCode == RESULT_OK && data != null) importNaraModel(data.getData());\n        } else if (requestCode == FILE_CHOOSER_REQUEST) {"
    if old not in s: raise SystemExit("ERROR: onActivityResult marker not found.")
    s = s.replace(old, new, 1)

    old = '        if (webView != null) { webView.removeJavascriptInterface("AndroidBridge"); webView.destroy(); }'
    new = '        if (naraLocalEngine != null) naraLocalEngine.close();\n        if (webView != null) { webView.removeJavascriptInterface("AndroidBridge"); webView.removeJavascriptInterface("NaraLocalAI"); webView.destroy(); }'
    if old not in s: raise SystemExit("ERROR: onDestroy marker not found.")
    s = s.replace(old, new, 1)
    main_java.write_text(s, encoding="utf-8")

shutil.copy2(kotlin_source, kotlin_dest)

# Re-open and validate key integration markers. This is intentionally fail-closed.
java = main_java.read_text(encoding="utf-8")
gradle = app_gradle.read_text(encoding="utf-8")
for marker, source in (("NaraLocalAI", java), ("importNaraModel", java), ("NaraLocalEngine", java), ("org.jetbrains.kotlin.android", gradle), ("litertlm-android", gradle), ("kotlinx-coroutines-android", gradle)):
    if marker not in source:
        raise SystemExit(f"ERROR: Android integration validation failed: {marker}")
print("OK: native Android bridge, .litertlm import, Kotlin plugin and LiteRT-LM dependency integrated.")
