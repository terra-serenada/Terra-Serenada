#!/usr/bin/env python3
"""Safely patch the Terra Serenada Nara prototype's AI Teacher audit loop.

Run from the Terra-Serenada repository root:
    python apply_nara_ai_teacher_audit_patch.py

This script only edits nara-prototype.html after checkpoint and unique-match checks.
It creates a backup and syntax-checks the main inline JavaScript with Node.js when available.
"""
from pathlib import Path
import shutil
import subprocess
import tempfile

TARGET = Path("nara-prototype.html")
if not TARGET.exists():
    raise SystemExit("Tidak menemukan nara-prototype.html. Jalankan skrip ini dari root repositori Terra Serenada.")

source = TARGET.read_text(encoding="utf-8")
if "Nara AI Teacher System v1" not in source or "function teacherDiagnose(question,answer,correction='')" not in source:
    raise SystemExit("Checkpoint prototype tidak cocok. File tidak diubah agar versi lain tidak tertimpa.")

changes = []
def replace_once(old, new, label):
    global source
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: memerlukan satu kecocokan, ditemukan {count}. File tidak ditulis.")
    source = source.replace(old, new, 1)
    changes.append(label)

def replace_range(start, end, new, label):
    global source
    a = source.find(start)
    if a < 0 or source.find(start, a + len(start)) >= 0:
        raise RuntimeError(f"{label}: penanda awal tidak ada atau ganda. File tidak ditulis.")
    b = source.find(end, a + len(start))
    if b < 0:
        raise RuntimeError(f"{label}: penanda akhir tidak ditemukan. File tidak ditulis.")
    source = source[:a] + new + source[b:]
    changes.append(label)

# 1. A direct correction such as “jawabanmu salah” is an audit command.
replace_once(
    r"function isLanguageCorrection(q){const n=langNormalize(q);return /^(koreksi|koreksi pemahaman|maksud saya|yang saya maksud|sebenarnya maksud saya|bukan itu maksud saya)\b/.test(n)||/^(bukan|tidak begitu|bukan begitu)[, ]+(maksud saya|yang saya maksud|saya ingin|saya mau)\b/.test(n)}",
    r"""function isLanguageCorrection(q){const n=langNormalize(q);return /^(koreksi|koreksi pemahaman|maksud saya|yang saya maksud|sebenarnya maksud saya|bukan itu maksud saya)\b/.test(n)||/^(bukan|tidak begitu|bukan begitu)[, ]+(maksud saya|yang saya maksud|saya ingin|saya mau)\b/.test(n)}
function isAnswerChallenge(text){const n=langNormalize(String(text||'').trim());return /^(?:jawaban(?:mu| kamu| anda)?|jawaban (?:yang )?(?:tadi|sebelumnya|itu)|itu|yang tadi)\s*(?:(?:memang|jelas|tadi)\s*)?(?:salah|keliru|tidak benar|kurang tepat|tidak tepat|enggak tepat|nggak tepat|tidak sesuai)\b/.test(n)||/^(?:salah|keliru|tidak benar|kurang tepat|tidak tepat)\s+(?:jawaban(?:mu| kamu| anda)?|itu|tadi)\b/.test(n)}""",
    "Mengenali koreksi langsung terhadap jawaban Nara",
)

# 2. Detect the drainage qualifier and preserve it all the way to the data filter.
replace_once(
    "function isBedCountQuestion(text){",
    r"""function detectBedDrainageFilter(text){const n=langNormalize(String(text||''));const hasBed=/\b(bed|beds|petak)\b/.test(n),hasCount=/\b(berapa|jumlah|total|banyak|seberapa banyak)\b/.test(n),hasDrainage=/\b(drainase(?:nya)?|drainage)\b/.test(n),hasFast=/\b(cepat|fast|rapid)\b/.test(n);return hasBed&&hasCount&&hasDrainage&&hasFast?'fast':''}
function bedDrainageFilterStats(filter,bedsInput=asArray(garden?.beds)){const all=[],seen=new Set();for(const [index,bed] of asArray(bedsInput).entries()){const name=String(bed?.name||'').trim(),id=bed?.id,key=id!==undefined&&id!==null&&String(id)!==''?'id:'+String(id):name?'name:'+canonicalEntityText(name):'unnamed:'+index;if(seen.has(key))continue;seen.add(key);const p=bed?.profile&&typeof bed.profile==='object'?bed.profile:bed||{},drainage=String(p.drainage||'').trim(),dn=langNormalize(drainage),status=!drainage?'unknown':filter==='fast'?(/\b(cepat|fast|rapid)\b/.test(dn)?'match':'other'):'unknown';all.push({bed,drainage,status});}return {all,matches:all.filter(x=>x.status==='match'),unknown:all.filter(x=>x.status==='unknown')}}
function isBedCountQuestion(text){""",
    "Menambahkan filter atribut drainase pada pertanyaan jumlah Bed",
)
replace_once(
    "function isBedCountQuestion(text){\n  const n=langNormalize(text);",
    "function isBedCountQuestion(text){\n  const n=langNormalize(text);\n  if(detectBedDrainageFilter(text))return false;",
    "Mencegah pertanyaan berfilter dianggap sebagai hitung seluruh Bed",
)
replace_once(
    "  const plantEntity=found.find(e=>e.type==='plant'),bedEntity=found.find(e=>e.type==='bed'),inhabitantEntity=found.find(e=>e.type==='inhabitant');\n  if(isBedCountQuestion(q))return {domain:'garden_beds',operation:'count',metric:'bed_count',target:null,period:parseQueryPeriod(q,referenceDate),query:q,source:'Daftar Bed',responseStyle:'direct',questionTask:'quantity',reason:'Hitung jumlah Bed yang tercatat di daftar Bed kebun. Jangan mengganti operasi hitung dengan laporan profil atau relasi antar-Bed.'};",
    """  const plantEntity=found.find(e=>e.type==='plant'),bedEntity=found.find(e=>e.type==='bed'),inhabitantEntity=found.find(e=>e.type==='inhabitant');
  const drainageFilter=detectBedDrainageFilter(q);
  if(drainageFilter)return {domain:'garden_beds',operation:'filtered_count',metric:'bed_count_by_drainage',filter:drainageFilter,target:null,period:parseQueryPeriod(q,referenceDate),query:q,source:'Daftar Bed + profil drainase',responseStyle:'direct',questionTask:'quantity',reason:'Filter setiap Bed memakai atribut drainase yang benar-benar tercatat, kemudian hitung hanya Bed yang cocok. Jangan mengganti filter dengan jumlah seluruh Bed.'};
  if(isBedCountQuestion(q))return {domain:'garden_beds',operation:'count',metric:'bed_count',target:null,period:parseQueryPeriod(q,referenceDate),query:q,source:'Daftar Bed',responseStyle:'direct',questionTask:'quantity',reason:'Hitung jumlah Bed yang tercatat di daftar Bed kebun. Jangan mengganti operasi hitung dengan laporan profil atau relasi antar-Bed.'};""",
    "Mengarahkan pertanyaan jumlah bersyarat ke filtered-count plan",
)
replace_once(
    "function executeReasoningPlan(plan){\n  if(!plan)return null;\n  if(plan.domain==='garden_beds'&&plan.operation==='count'){",
    """function executeReasoningPlan(plan){
  if(!plan)return null;
  if(plan.domain==='garden_beds'&&plan.operation==='filtered_count'){
    const stats=bedDrainageFilterStats(plan.filter),sources=[evidence('Daftar Bed',stats.all.length+' Bed diperiksa untuk atribut drainase','','Daftar Bed')];
    for(const row of stats.all){const name=String(row.bed?.name||'Bed tanpa nama');sources.push(evidence('Bed '+name,row.drainage?'Drainase tercatat: '+row.drainage:'Atribut drainase belum tercatat',row.bed?.updatedAt||row.bed?.createdAt||'','Profil Bed'));}
    if(!stats.all.length)return createResponse('Belum ada Bed yang tercatat pada data kebun yang dimuat, jadi jumlah Bed dengan drainase cepat belum dapat dihitung.',sources,'Daftar Bed kosong');
    const names=stats.matches.map(row=>String(row.bed?.name||'Bed tanpa nama'));
    let answer='Dari '+stats.all.length+' Bed yang diperiksa, '+stats.matches.length+' Bed terverifikasi memiliki drainase cepat'+(names.length?': '+names.join(', '):'')+'.';
    if(stats.unknown.length)answer+=' Ada '+stats.unknown.length+' Bed yang atribut drainasenya belum tercatat, sehingga jumlah total Bed dengan drainase cepat belum bisa dipastikan.';
    else answer+=' Semua Bed dalam daftar memiliki atribut drainase yang tercatat.';
    return createResponse(answer,sources,stats.unknown.length?'Data drainase sebagian belum tercatat':'Bukti atribut drainase');
  }
  if(plan.domain==='garden_beds'&&plan.operation==='count'){""",
    "Menghitung hanya Bed dengan drainase cepat dan menampilkan bukti per Bed",
)

# 3. AI Guru rejects a global Bed count when the question was filtered by drainage.
replace_once(
    "  const hasCorrection=!!correction;\n  if(isFutureWeatherQuestion(q)",
    r"""  const hasCorrection=!!correction;
  const drainageFilter=detectBedDrainageFilter(q);
  if(drainageFilter){
    const asksCount=/\b(berapa|jumlah|total|banyak|seberapa banyak)\b/.test(nq);
    const globalBedCount=/\b(?:ada|tercatat|jumlah|total|sebanyak)\s+\d+\s+(?:bed|beds|petak)\b/.test(na);
    const mentionsFastDrainage=/(?:drainase(?:nya)?|drainage).{0,60}(?:cepat|fast|rapid)|(?:cepat|fast|rapid).{0,60}(?:drainase(?:nya)?|drainage)/.test(na);
    const stats=bedDrainageFilterStats(drainageFilter);
    const filteredCountMatch=na.match(/\b(\d+)\s+(?:bed|beds|petak)\s+(?:(?:terverifikasi\s+)?memiliki|dengan)\s+drainase\s+(?:yang\s+)?(?:cepat|fast|rapid)\b/i);
    const claimedFilteredCount=filteredCountMatch?Number(filteredCountMatch[1]):null;
    const unknownNotDisclosed=stats.unknown.length>0&&claimedFilteredCount!==null&&!/\b(?:belum tercatat|tidak tercatat|belum diketahui|tidak diketahui|belum bisa dipastikan|belum dapat dipastikan|tidak bisa dipastikan|tidak dapat dipastikan)\b/.test(na);
    const wrongFilteredCount=(claimedFilteredCount!==null&&stats.unknown.length===0&&stats.all.length>0&&claimedFilteredCount!==stats.matches.length)||unknownNotDisclosed;
    if(asksCount&&((globalBedCount&&!mentionsFastDrainage)||wrongFilteredCount))return {category:'filtered_quantity_alignment',severity:'high',confidence:'high',title:'Jumlah Bed bersyarat dijawab dengan jumlah global',reason:'Pertanyaan meminta Bed yang memiliki drainase cepat, tetapi jawaban hanya menghitung seluruh Bed atau menyatakan jumlah yang tidak cocok dengan atribut drainase yang tercatat.',principle:'Pertahankan syarat/filter dalam pertanyaan sampai tahap pengambilan data dan penghitungan. Hitung hanya Bed dengan atribut drainase yang cocok; jika ada Bed tanpa data drainase, laporkan ketidakpastian dan jangan mengganti hasil filter dengan jumlah seluruh Bed.',question:q,answer:a,correction};
  }
  if(isFutureWeatherQuestion(q)""",
    "Menambahkan audit AI Guru untuk jumlah bersyarat versus jumlah global",
)
replace_once(
    "  quantity_operation_alignment:{title:'Pilih operasi kuantitatif yang benar',principle:'Bedakan jumlah tanaman awal, tanaman aktif, kelompok, catatan, dan jumlah hasil panen; filter objek/periode/satuan sebelum menghitung.',effect:'quantity_first'},",
    "  quantity_operation_alignment:{title:'Pilih operasi kuantitatif yang benar',principle:'Bedakan jumlah tanaman awal, tanaman aktif, kelompok, catatan, dan jumlah hasil panen; filter objek/periode/satuan sebelum menghitung.',effect:'quantity_first'},\n  filtered_quantity_alignment:{title:'Pertahankan filter saat menghitung Bed',principle:'Jika pertanyaan meminta jumlah Bed dengan atribut tertentu, terapkan filter pada setiap profil Bed sebelum menghitung. Jumlah seluruh Bed tidak menjawab jumlah subset.',effect:'filtered_quantity_first'},",
    "Menambahkan pelajaran validasi untuk hitungan berfilter",
)
replace_once(
    " }else if(category==='entity_evidence_alignment'){\n  const koksi={id:'koksi-test',name:'Kumbang Koksi'",
    """ }else if(category==='filtered_quantity_alignment'){
  const q='berapa jumlah bed yang drainasenya cepat?';
  const bad='Di kebunmu tercatat 4 Bed: Veggie, Spiral, Solanum, Sanctuary.';
  const fixture=[{id:'tb-fast',name:'Veggie',profile:{drainage:'cepat'}},{id:'tb-slow',name:'Spiral',profile:{drainage:'lambat'}},{id:'tb-fast2',name:'Solanum',profile:{drainage:'cepat'}},{id:'tb-unknown',name:'Sanctuary',profile:{}}];
  add('AI Guru mendeteksi jumlah seluruh Bed sebagai pengganti filter drainase',withTeacherGardenFixture({plants:[],beds:fixture},()=>teacherDiagnose(q,bad)?.category==='filtered_quantity_alignment'));
  add('Nara menerapkan rencana filtered count, bukan global count',withTeacherGardenFixture({plants:[],beds:fixture},()=>{const p=buildReasoningPlan(q,[],todayISO()),r=executeReasoningPlan(p);return p.domain==='garden_beds'&&p.operation==='filtered_count'&&r.text.includes('2 Bed terverifikasi memiliki drainase cepat')&&r.text.includes('1 Bed yang atribut drainasenya belum tercatat')&&r.sources.some(x=>x.label==='Bed Veggie')&&r.sources.some(x=>x.label==='Bed Sanctuary')}));
  add('Jawaban filter yang didukung atribut tidak ditandai sebagai gagal',withTeacherGardenFixture({plants:[],beds:fixture},()=>teacherDiagnose(q,'Dari 4 Bed yang diperiksa, 2 Bed terverifikasi memiliki drainase cepat: Veggie dan Solanum. Ada 1 Bed yang atribut drainasenya belum tercatat, sehingga jumlah total Bed dengan drainase cepat belum bisa dipastikan.')===null));
  add('AI Guru menolak jumlah filter definitif saat ada data drainase yang hilang',withTeacherGardenFixture({plants:[],beds:fixture},()=>teacherDiagnose(q,'2 Bed memiliki drainase cepat: Veggie dan Solanum.')?.category==='filtered_quantity_alignment'));
  add('Pernyataan “jawabanmu salah” dikenali sebagai pemicu audit',isAnswerChallenge('jawabanmu salah')&&isAnswerChallenge('Jawaban kamu tidak tepat.'));
 }else if(category==='entity_evidence_alignment'){
  const koksi={id:'koksi-test',name:'Kumbang Koksi'""",
    "Menambahkan tes diagnostik, filter data, dan koreksi pengguna",
)
replace_once(
    "function teacherRegressionTests(){return [\n {name:'Riwayat panen tetap terpisah dari estimasi'",
    """function teacherRegressionTests(){return [
 {name:'Koreksi “jawabanmu salah” memicu audit ulang',passed:isAnswerChallenge('jawabanmu salah')&&isAnswerChallenge('Jawaban kamu tidak tepat.')},
 {name:'Jumlah Bed dengan drainase cepat tidak diperlakukan sebagai jumlah global',passed:!isBedCountQuestion('berapa jumlah bed yang drainasenya cepat?')&&buildReasoningPlan('berapa jumlah bed yang drainasenya cepat?',[],todayISO()).operation==='filtered_count'},
 {name:'AI Guru mendeteksi jumlah global yang menggantikan filter drainase',passed:withTeacherGardenFixture({plants:[],beds:[{id:'rg-fast',name:'Veggie',profile:{drainage:'cepat'}},{id:'rg-slow',name:'Spiral',profile:{drainage:'lambat'}}]},()=>teacherDiagnose('berapa jumlah bed yang drainasenya cepat?','Di kebunmu tercatat 2 Bed: Veggie dan Spiral.')?.category==='filtered_quantity_alignment')},
 {name:'Riwayat panen tetap terpisah dari estimasi'""",
    "Menambahkan kasus regresi untuk koreksi dan filter atribut",
)
replace_once(
    "function teacherRunEvaluation(){const categories=['future_weather_source','event_type_alignment','attribute_alignment','quantity_operation_alignment','entity_evidence_alignment','inhabitant_behavior_task'];",
    "function teacherRunEvaluation(){const categories=['future_weather_source','event_type_alignment','attribute_alignment','quantity_operation_alignment','filtered_quantity_alignment','entity_evidence_alignment','inhabitant_behavior_task'];",
    "Memasukkan diagnostik hitungan berfilter ke Uji AI Guru",
)
replace_once(
    "function recordAutonomousObservation(text,response){const q=String(text||'').trim();if(!q||isLanguageCorrection(q)||parseRemember(q))return;",
    "function recordAutonomousObservation(text,response){const q=String(text||'').trim();if(!q||isLanguageCorrection(q)||isAnswerChallenge(q)||parseRemember(q))return;",
    "Mencegah koreksi pengguna dicatat sebagai contoh jawaban biasa",
)
replace_once(
    "function teacherObserveInteraction(question,answer){if(isLanguageCorrection(question)||parseRemember(question))return null;",
    "function teacherObserveInteraction(question,answer){if(isLanguageCorrection(question)||isAnswerChallenge(question)||parseRemember(question))return null;",
    "Mencegah AI Guru menilai pesan koreksi sebagai pertanyaan baru",
)

# 4. Audit the actual prior Q/A pair, skipping the correction message itself.
replace_range(
    "function teacherDiagnoseLastInteraction(){",
    "\nfunction teacherRunCycle(options={})",
    r"""function latestQuestionAnswerPair(messages=protoMemory.messages){for(let i=messages.length-1;i>=0;i--){if(messages[i]?.role!=='assistant')continue;let qi=-1;for(let j=i-1;j>=0;j--){if(messages[j]?.role==='user'){qi=j;break;}}if(qi<0||isAnswerChallenge(messages[qi]?.text))continue;return {question:messages[qi].text,answer:messages[i]};}return null}
function teacherDiagnoseLastInteraction(){const pair=latestQuestionAnswerPair();if(!pair){$('teacherLatestDiagnosis').textContent='Belum ada pasangan pertanyaan dan jawaban untuk diperiksa.';return null;}const q=pair.question,a=pair.answer;const d=teacherDiagnose(q,a);if(!d){$('teacherLatestDiagnosis').className='teacher-result pass';$('teacherLatestDiagnosis').textContent='Tidak ditemukan pola kegagalan yang cukup kuat secara otomatis. Ini bukan bukti bahwa jawaban pasti benar; gunakan koreksi manual bila perlu.';renderTeacher();return null;}const t=ensureTeacherState();d.id='diag-'+Date.now()+'-'+Math.random().toString(36).slice(2,6);d.signature=[d.category,normalizeQuestionSignature(q)].join('::');d.createdAt=new Date().toISOString();t.diagnoses.push(d);t.diagnoses=t.diagnoses.slice(-100);const c=teacherAddCandidate(d);saveProtoMemory();renderTeacher(d);toast('AI Guru mendeteksi: '+d.title);return c;}
function teacherRecordCorrection(question,answer,correction){let d=teacherDiagnose(question,answer,correction);if(!d&&isAnswerChallenge(correction))d={category:'user_correction_review',severity:'medium',confidence:'needs_review',title:'Koreksi pengguna diterima; audit perlu ditinjau',reason:'Pengguna secara eksplisit menyatakan jawaban salah, tetapi diagnostik lokal belum bisa menunjuk penyebab spesifik. Jawaban sebelumnya tidak boleh dianggap tervalidasi hanya karena pemeriksaan otomatis belum menemukan pola.',principle:'Periksa kembali maksud pertanyaan, bukti data, filter yang dipakai, dan kesimpulan. Jangan mengarang koreksi; minta rincian tambahan jika akar kesalahan belum dapat dipastikan.',question:String(question||''),answer:teacherAnswerText(answer),correction:String(correction||'')};if(!d)return null;const t=ensureTeacherState();d.id='diag-'+Date.now()+'-'+Math.random().toString(36).slice(2,6);d.signature=[d.category,normalizeQuestionSignature(question)].join('::');d.createdAt=new Date().toISOString();t.diagnoses.push(d);t.diagnoses=t.diagnoses.slice(-100);const c=teacherAddCandidate(d);saveProtoMemory();renderTeacher(d);return {diagnosis:d,candidate:c};}
function handleAnswerChallenge(feedback,frame){
  const pair=latestQuestionAnswerPair(protoMemory.messages.slice(0,-1));
  if(!pair)return attachLanguageFrame(createResponse('Aku menerima koreksimu, tetapi tidak menemukan pasangan pertanyaan dan jawaban sebelumnya yang bisa diaudit. Ajukan ulang pertanyaan atau beri tahu jawaban mana yang perlu diperiksa.',[],'Audit AI Guru'),frame);
  const audit=teacherRecordCorrection(pair.question,pair.answer,feedback),d=audit?.diagnosis;
  if(audit?.candidate&&['candidate','needs_review'].includes(audit.candidate.status))teacherRunCycle({silent:true,candidateId:audit.candidate.id});
  if(d&&d.category!=='user_correction_review'){
    const retry=answerQuestion(pair.question),retest=teacherDiagnose(pair.question,retry);
    const status=retest?'Audit ulang masih menemukan pola masalah: '+retest.title+'. Jawaban ini belum dianggap lolos.':'Audit ulang tidak lagi menemukan pola kegagalan yang sama pada pemeriksaan lokal. Ini bukan jaminan mutlak bahwa seluruh fakta benar.';
    const message='Koreksimu diterima. AI Guru mendeteksi masalah pada jawaban sebelumnya: '+d.title+'.\n'+d.reason+'\n\nNara mengulang pencarian berdasarkan pertanyaan awal.\n\nJawaban setelah audit:\n'+retry.text+'\n\n'+status;
    return attachLanguageFrame(createResponse(message,Array.isArray(retry.sources)?retry.sources:[],'Audit AI Guru · pencarian ulang'),frame);
  }
  const message='Koreksimu diterima. AI Guru mencatat audit ulang untuk pertanyaan: “'+pair.question+'”. Diagnostik lokal belum dapat menunjuk kesalahan spesifik dengan yakin, jadi jawaban lama tidak dianggap tervalidasi. Periksa kembali maksud pertanyaan, sumber data, atribut/filter, dan logika; jika penyebabnya belum bisa dibuktikan, AI Guru harus meminta rincian tambahan, bukan mengarang koreksi.';
  return attachLanguageFrame(createResponse(message,Array.isArray(pair.answer.sources)?pair.answer.sources:[],'Audit AI Guru · perlu verifikasi'),frame);
}""",
    "Mengaudit pasangan pertanyaan-jawaban sebelumnya saat pengguna memberi koreksi",
)
replace_once(
    "  const frame=parseLanguageFrame(text);currentLanguageFrame=frame;\n  const remember=parseRemember(text);",
    "  const frame=parseLanguageFrame(text);currentLanguageFrame=frame;\n  if(isAnswerChallenge(text))return handleAnswerChallenge(text,frame);\n  const remember=parseRemember(text);",
    "Menghubungkan pesan ‘jawabanmu salah’ dengan audit ulang",
)

for marker in ["function isAnswerChallenge", "function detectBedDrainageFilter", "operation:'filtered_count'", "category:'filtered_quantity_alignment'", "function handleAnswerChallenge", "category:'user_correction_review'"]:
    if marker not in source:
        raise RuntimeError("Verifikasi patch gagal; penanda hilang: " + marker)

# Syntax-check the modified inline JavaScript before writing anything.
script_start = source.rfind("<script>")
script_end = source.rfind("</script>")
if script_start < 0 or script_end <= script_start:
    raise RuntimeError("Blok JavaScript utama tidak ditemukan; file tidak ditulis.")
js = source[script_start + len("<script>"):script_end]
try:
    with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8", delete=False) as temp:
        temp.write(js)
        temp_path = Path(temp.name)
    check = subprocess.run(["node", "--check", str(temp_path)], capture_output=True, text=True, timeout=30)
    if check.returncode != 0:
        raise RuntimeError("Node.js menemukan kesalahan sintaks; file tidak ditulis:\n" + check.stderr[:4000])
    changes.append("Pemeriksaan sintaks JavaScript lulus")
except FileNotFoundError:
    changes.append("Node.js tidak tersedia; pemeriksaan sintaks otomatis dilewati")
finally:
    if "temp_path" in locals():
        temp_path.unlink(missing_ok=True)

backup = TARGET.with_name(TARGET.name + ".before-ai-teacher-audit.bak")
if not backup.exists():
    shutil.copy2(TARGET, backup)
TARGET.write_text(source, encoding="utf-8")
print("Patch selesai diterapkan ke", TARGET)
print("Cadangan:", backup)
print("Perubahan:")
for item in changes:
    print(" -", item)
print("Ukuran akhir:", TARGET.stat().st_size, "byte")
