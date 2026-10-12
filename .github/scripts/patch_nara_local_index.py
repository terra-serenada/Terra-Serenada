#!/usr/bin/env python3
"""Idempotently connect the existing Nara panel to the native offline model picker."""
from pathlib import Path
import sys

path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("android/app/src/main/assets/index.html")
if not path.is_file():
    raise SystemExit(f"ERROR: HTML source not found: {path}")
s = path.read_text(encoding="utf-8")
original = s

# Guard against building from a different/incompatible page rather than silently dropping app features.
for marker in ("naraLocalEnginePanel", "naraLocalSaveBtn", "naraLocalTestBtn", "function naraBindUI()", "AndroidBridge.saveBackup", "buildBackupJson"):
    if marker not in s:
        raise SystemExit(f"ERROR: Required Terra Serenada/Nara marker missing: {marker}")

button = '<button type="button" class="primary" id="naraDownloadRecommendedModelBtn">Unduh model dasar (~0,93 GB)</button><button type="button" class="secondary" id="naraNativeModelBtn">Pilih model offline (.litertlm)</button>'
if "id=\"naraNativeModelBtn\"" not in s and "id=\"naraDownloadRecommendedModelBtn\"" not in s:
    anchor = '<div class="nara-local-actions"><button type="button" class="secondary" id="naraLocalSaveBtn">'
    if anchor not in s:
        raise SystemExit("ERROR: Could not find local engine action row; HTML was not modified.")
    s = s.replace(anchor, '<div class="nara-local-actions">' + button + '<button type="button" class="secondary" id="naraLocalSaveBtn">', 1)

old_intro = 'Penghubung model native Android belum otomatis tersedia hanya dari HTML; aplikasi Android perlu menyediakan bridge model lokal, atau kamu dapat mengisi endpoint lokal yang kompatibel.'
new_intro = 'Unduh OLMo-2 1B-Instruct melalui tombol di bawah (sekitar 0,93 GB; lisensi Apache-2.0), atau pilih file .litertlm kompatibel lain yang sudah kamu unduh. Setelah tersimpan di penyimpanan privat, model tidak perlu diunduh ulang. Model 1B ini dapat terasa berat atau lambat pada HP RAM 4 GB; model lain yang kompatibel bisa diimpor melalui tombol pilihan file.'
if old_intro in s:
    s = s.replace(old_intro, new_intro, 1)

# Do not route chat to native inference until a model is loaded; the bridge itself exists from startup.
old_availability = "if(bridgeReady)return true;"
new_availability = "if(bridgeReady)return typeof b.isModelReady==='function'?b.isModelReady():true;"
if old_availability in s:
    s = s.replace(old_availability, new_availability, 1)
elif new_availability not in s:
    raise SystemExit("ERROR: Local-engine availability block did not match expected revision.")

# Distinguish a bridge that exists from a model that has actually finished loading.
old_bridge = "if(bridgeReady){label='Bridge Android terdeteksi';copy='Penghubung model native Android terdeteksi. Tekan “Uji model lokal” untuk memastikan runtime model benar-benar dapat menghasilkan jawaban.';cls='good';}"
new_bridge = "if(bridgeReady && b && typeof b.isModelReady==='function' && b.isModelReady()){label='Model lokal siap';copy='Model lokal termuat. Tekan “Uji model lokal” untuk menguji inferensi.';cls='good';} else if(bridgeReady){label='Model lokal belum dipilih';copy='Bridge Android tersedia, tetapi model belum siap. Tekan “Pilih model offline (.litertlm)” untuk memuat model.';cls='warn';}"
if old_bridge in s:
    s = s.replace(old_bridge, new_bridge, 1)
elif "typeof b.isModelReady==='function'" not in s:
    raise SystemExit("ERROR: Local engine status block did not match expected revision; refusing risky edit.")

# Native status updates arrive through evaluateJavascript after the page and model load.
status_helper = '''window.__naraSetNativeStatus=function(message,ready){
  const status=document.getElementById('naraLocalEngineStatus');
  const detail=document.getElementById('naraLocalEngineDetail');
  if(status){status.textContent=ready?'Model lokal siap':'Model lokal belum siap';status.className='nara-local-engine-status '+(ready?'good':'warn');}
  if(detail){detail.textContent=String(message||'');detail.className='nara-local-status-box '+(ready?'good':'warn');}
};
'''
if "window.__naraSetNativeStatus=function" not in s:
    anchor = "function naraBindUI(){"
    if anchor not in s:
        raise SystemExit("ERROR: Could not locate Nara UI binding function.")
    s = s.replace(anchor, status_helper + anchor, 1)

download_listener = "  $('naraDownloadRecommendedModelBtn')?.addEventListener('click',()=>{const b=window.NaraLocalAI;if(b&&typeof b.downloadRecommendedModel==='function'){if(confirm('Unduh model lokal sekitar 0,93 GB? Model disimpan di perangkat untuk penggunaan offline.'))b.downloadRecommendedModel();}else showToast('Bridge model lokal Android belum tersedia.');});\n"
select_listener = "  $('naraNativeModelBtn')?.addEventListener('click',()=>{const b=window.NaraLocalAI;if(b&&typeof b.selectLocalModel==='function')b.selectLocalModel();else showToast('Bridge model lokal Android belum tersedia.');});\n"
anchor = "  naraUpdateLocalEngineStatus();\n"
if anchor not in s:
    raise SystemExit("ERROR: Could not locate start of naraBindUI().")
if "$('naraDownloadRecommendedModelBtn')?.addEventListener" not in s:
    s = s.replace(anchor, anchor + download_listener, 1)
if "$('naraNativeModelBtn')?.addEventListener" not in s:
    # Insert next to the download button listener when possible.
    marker = download_listener
    s = s.replace(marker, marker + select_listener, 1)

if "naraNativeModelBtn" not in s or "naraDownloadRecommendedModelBtn" not in s or "window.__naraSetNativeStatus=function" not in s:
    raise SystemExit("ERROR: Nara native UI integration markers missing after patch.")
path.write_text(s, encoding="utf-8")
print(f"OK: Nara offline-model UI patch applied to {path} ({len(original)} -> {len(s)} chars).")
