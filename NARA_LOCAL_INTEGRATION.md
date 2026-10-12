# Terra Serenada — Nara Local AI (APK only)

## What is included

- `.github/workflows/build-apk-v25.yml` — replacement workflow; creates and publishes APK 1.0.20 with the native LiteRT-LM runtime.
- `.github/scripts/patch_nara_android.py` — adds the Kotlin engine, model import, private storage and bridge to the generated Android project without replacing existing backup, file-picker or reminder code.
- `.github/scripts/patch_nara_local_index.py` — patches the copy of `index.html` embedded into the APK. It adds the model download/import buttons and corrects Nara's status/routing so a native bridge is not mistaken for a loaded model.
- `android-local/NaraLocalEngine.kt` — on-device LiteRT-LM inference bridge.

The original root `index.html` is intentionally left untouched in the repository. The workflow patches a copy after copying it into the APK assets. This avoids replacing the large application HTML with a generated or truncated copy and limits changes to the native Android APK.

## Upload to GitHub

Upload the files while preserving their paths at the repository root:

```text
.github/workflows/build-apk-v25.yml
.github/scripts/patch_nara_android.py
.github/scripts/patch_nara_local_index.py
android-local/NaraLocalEngine.kt
NARA_LOCAL_INTEGRATION.md
```

**Important:** upload the two scripts, Kotlin file and documentation first. Upload `.github/workflows/build-apk-v25.yml` last so its first run does not start before its helper files exist. Alternatively, commit all files together in one commit. Do not delete or overwrite `build-apk-v24.yml`; the new workflow is separate so you can revert by returning to the old workflow.

The workflow still requires the repository secrets already used by the existing release workflow: `ANDROID_KEYSTORE_BASE64` and `ANDROID_KEYSTORE_PASSWORD` (key alias `terra-serenada`). If those secrets are missing, the signed-release step will fail.

## First launch and offline use

1. Let the `Build and publish APK v1.0.20` workflow finish. Download the APK from the run's artifact, or from GitHub Releases if publishing succeeded.
2. Install/update the APK. Open Nara and expand **Mesin Bahasa Lokal**.
3. Tap **Unduh model dasar (~0,93 GB)** while online. The APK downloads `OLMo-2-1B-Instruct_q4_block32_ekv4096.litertlm` from the LiteRT Community Hugging Face repository, checks the transfer completed, copies it into app-private storage, and initializes the runtime. The model source lists Apache-2.0 licensing and a 0.93 GB quantized bundle: <https://huggingface.co/litert-community/OLMo-2-1B-Instruct>.
4. Wait for **Model lokal siap**, then press **Uji model lokal**. This sends a real inference request to the device engine. It is not a simulated response.
5. After the first successful load, the model file remains in the app's private storage and is reloaded when the app opens. Local inference itself can run without internet. Do not uninstall the app or clear its app data if you want to retain the stored model.

If the download is blocked, use **Pilih model offline (.litertlm)** to import a compatible `.litertlm` bundle saved on the phone. The app requires about 1.25 GB of free space for its built-in first download because it downloads to a temporary file before promoting it to the final file. The application checks available space before starting.

## Device / quality notes

- The default 1B model is approximately 0.93 GB on disk. Its runtime can be demanding, especially on phones with only 4 GB RAM; generation may be slow or the operating system may reclaim the app's memory. For 4 GB devices, consider importing a smaller LiteRT-LM-compatible model. Do not select arbitrary `.gguf` files; this bridge expects `.litertlm` files supported by the LiteRT-LM runtime.
- This is a general instruction-following base for local inference, not a copy of Anoman AI's model weights or private knowledge. Nara's local prompt/capability instructions guide behavior but do not make a 1B model equivalent to the online teacher.
- The existing Nara online fallback setting is preserved. If it is enabled, the app may use the online teacher when a local request fails and internet is available. To use only on-device inference, turn that fallback off; when offline, online calls naturally cannot complete.
- This workflow's CI can verify compilation and packaging but does not have the actual Android phone or a model loaded into an emulator. The definitive inference check is the in-app **Uji model lokal** after the model has loaded. A successful APK build alone does not prove that device inference works.

## Test scope performed while preparing these files

- Parsed the new workflow as YAML.
- Ran the generated Android-project step with placeholder assets and verified the integration patch adds Kotlin, model import and Gradle dependencies.
- Ran the HTML patch helper against a representative Nara panel fixture twice; it applied correctly and was idempotent.
- Compiled the Kotlin bridge against API-shape test stubs as a syntax smoke test.

A full Gradle/Android build and a real model inference test could not be run in this environment because the Android SDK/Gradle build environment and a physical device/model were not available. The GitHub Actions run is the next full build validation; the device inference test remains required after installation.
