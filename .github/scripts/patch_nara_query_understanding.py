#!/usr/bin/env python3
"""Add a conservative language-understanding and source-routing layer to Nara.

This patch is intentionally applied to the generated APK asset, not root index.html.
It fails closed if the expected Step 2P/2B source anchors differ.
"""
from pathlib import Path
import re

path = Path("android/app/src/main/assets/index.html")
if not path.is_file():
    raise SystemExit(f"ERROR: generated APK HTML is missing: {path}")
source = path.read_text(encoding="utf-8")
original = source


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"ERROR: query-understanding patch at {label}: expected one exact anchor, found {count}. Refusing ambiguous edit.")
    return text.replace(old, new, 1)

builder_start = source.find("function naraOnlineLearningContext(question,localDraft=''){")
request_start = source.find("async function naraRequestOnlineAnswer(")
if builder_start < 0 or request_start <= builder_start:
    raise SystemExit("ERROR: Could not isolate the expected Nara online context/answer functions.")

helper = r'''function naraInterpretUserQuery(question,localDraft=''){
  const raw=String(question||'').trim();
  const lower=raw.toLocaleLowerCase('id-ID').normalize('NFKC');
  // Normalize common Indonesian chat shorthand without replacing the original user message.
  const normalized=lower
    .replace(/\bknp\b/g,'kenapa').replace(/\bwhy\b/g,'kenapa')
    .replace(/\bgmn\b/g,'bagaimana').replace(/\bgmn\s+cara\b/g,'bagaimana cara')
    .replace(/\bsy\b/g,'saya').replace(/\baku\b/g,'saya')
    .replace(/\bkm\b/g,'kamu').replace(/\bdg\b|\bdgn\b/g,'dengan')
    .replace(/\byg\b/g,'yang').replace(/\btpi\b|\btp\b/g,'tapi')
    .replace(/\btd\b/g,'tadi').replace(/\btrs\b/g,'terus')
    .replace(/\budah\b/g,'sudah').replace(/\budh\b/g,'sudah')
    .replace(/\bgak\b|\bnggak\b|\bgak\b|\bgk\b|\bga\b/g,'tidak')
    .replace(/\bterong\b/g,'terung').replace(/\bcabe\b/g,'cabai');
  const tokens=typeof naraMemoryTokens==='function'
    ? naraMemoryTokens(normalized)
    : normalized.replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(Boolean);
  const namedPlants=typeof naraPlantEntriesMentionedInText==='function'
    ? naraPlantEntriesMentionedInText(raw) : [];
  const namedIds=new Set(namedPlants.map(p=>String(p.id||p.name||'')));
  const namedNames=[...new Set(namedPlants.map(p=>String(p.name||'').trim()).filter(Boolean))];
  const explicitCrops=typeof naraExplicitCropTerms==='function'
    ? naraExplicitCropTerms(normalized) : [];
  const explicitOnly=explicitCrops.filter(crop=>!namedPlants.some(p=>{
    const pt=typeof naraMemoryTokens==='function'?naraMemoryTokens(p.name||''):String(p.name||'').toLowerCase().split(/\s+/);
    return pt.includes(crop);
  }));
  const explicitGardenCue=/\b(kebun saya|kebunku|di kebun|kebun ini|tanaman saya|buah saya|buah \w+ saya|daun \w+ saya|tanaman \w+ saya|pohon saya|saya menanam|yang saya tanam|tanaman yang saya tanam|catatan kebun saya|data kebun saya|bed saya|kelompok tanam saya|di tanaman saya)\b/i.test(normalized);
  const followUpCue=/\b(itu|tadi|tersebut|yang satunya|yang lain|yang tadi|yang itu|kalau yang|bagaimana dengan|bagaimana kalau|terus bagaimana|lalu bagaimana|dan kalau|kalau begitu|dia|nya|tanaman saya|buah saya|daun tanaman saya|pohon saya|tanaman yang saya tanam|apa yang harus saya lakukan sekarang|apa langkah selanjutnya|langkah selanjutnya|langkah berikutnya|apa berikutnya|apa lagi|setelah itu|sudah saya lakukan|belum saya lakukan|saya lakukan|bagaimana langkahnya)\b/i.test(normalized);
  const priorMessages=(Array.isArray(naraState?.messages)?naraState.messages:[]).slice(-6);
  const recentRecords=[];
  const recentCrops=[];
  if(followUpCue&&!namedPlants.length&&!explicitCrops.length){
    for(const message of priorMessages){
      const text=String(message?.text||'');
      if(typeof naraPlantEntriesMentionedInText==='function'){
        for(const p of naraPlantEntriesMentionedInText(text)){
          const id=String(p.id||p.name||'');
          if(id&&!recentRecords.some(x=>x.id===id))recentRecords.push({id,name:String(p.name||id),kind:'rekaman_kebun'});
        }
      }
      if(typeof naraExplicitCropTerms==='function'){
        for(const crop of naraExplicitCropTerms(text)) if(!recentCrops.includes(crop))recentCrops.push(crop);
      }
    }
    for(const crop of recentCrops){
      const already=recentRecords.some(p=>{
        const pt=typeof naraMemoryTokens==='function'?naraMemoryTokens(p.name):p.name.toLowerCase().split(/\s+/);
        return pt.includes(crop);
      });
      if(!already)recentRecords.push({id:'crop:'+crop,name:crop,kind:'spesies_dari_percakapan'});
    }
  }
  let resolvedReference=null;
  let disambiguationRequired=false;
  let disambiguationReason='';
  if(followUpCue&&!namedPlants.length&&!explicitCrops.length){
    if(recentRecords.length===1){
      resolvedReference=recentRecords[0];
    }else if(recentRecords.length>1){
      disambiguationRequired=true;
      disambiguationReason='Ada lebih dari satu tanaman yang mungkin dirujuk oleh kata ganti atau pertanyaan lanjutan.';
    }
  }
  const focusEntities=[
    ...namedPlants.map(p=>({id:String(p.id||p.name||''),name:String(p.name||''),kind:'rekaman_kebun'})),
    ...explicitOnly.map(c=>({id:'crop:'+c,name:c,kind:'spesies_disebut_pengguna'}))
  ];
  if(resolvedReference)focusEntities.push(resolvedReference);
  const routingQuestion=resolvedReference?`${raw} [rujukan percakapan: ${resolvedReference.name}]`:raw;
  const isGreeting=typeof naraIsSimpleGreeting==='function'&&naraIsSimpleGreeting(raw);
  const isCorrection=typeof naraIsCorrectionTurn==='function'&&naraIsCorrectionTurn(raw);
  let intent='pertanyaan_umum';
  let label='Pertanyaan umum';
  let requiredSources=['pengetahuan umum yang relevan'];
  let routingKeywords=[];
  if(isGreeting){
    intent='sapaan'; label='Sapaan'; requiredSources=[]; routingKeywords=[];
  }else if(isCorrection){
    intent='koreksi_jawaban'; label='Koreksi atau keberatan atas jawaban sebelumnya';
    requiredSources=['pertanyaan terbaru','jawaban sebelumnya','sumber yang digunakan sebelumnya'];
    routingKeywords=['koreksi jawaban sebelumnya'];
  }else if(/\b(saya ajarkan|saya ajari|pernah saya bilang|pernah saya jelaskan|aturan saya|kebiasaan saya|yang saya ajarkan|apa yang pernah saya ajarkan|ingat pelajaran|ingat aturan|ingatkan saya tentang aturan|pelajaran guru|memori saya|ingatan nara)\b/i.test(normalized)){
    intent='memori_pengguna_atau_pelajaran'; label='Pencarian memori atau pelajaran';
    requiredSources=['memori eksplisit pengguna','pelajaran yang relevan','riwayat percakapan bila diperlukan'];
    routingKeywords=['pelajaran memori ingatan aturan ajaran'];
  }else if(/\b(apa itu|apa arti|arti dari|definisi|apa manfaat|manfaat .* untuk|kandungan|asal usul|sejarah|jenis-jenis|jenis jenis|fungsi .* secara umum|secara umum|sifat-sifat|sifat sifat|kandungan gizi|apa perbedaan|apa beda|perbedaan antara|beda antara|bandingkan secara umum)\b/i.test(normalized)){
    intent='pengetahuan_umum'; label='Pertanyaan pengetahuan umum';
    requiredSources=['pengetahuan umum yang relevan'];
    routingKeywords=['penjelasan umum definisi manfaat kandungan fungsi pengetahuan umum'];
  }else if(/\b(bandingkan|dibanding|perbandingan|beda|perbedaan|mana yang lebih|lebih baik daripada|vs)\b/i.test(normalized)){
    intent='perbandingan'; label='Perbandingan';
    requiredSources=['rekaman untuk setiap objek yang dibandingkan','kriteria pembanding yang diminta','pengetahuan umum bila relevan'];
    routingKeywords=['perbandingan beda masing-masing objek'];
  }else if(/\b(siram|disiram|menyiram|menyirami|penyiraman|penyiraman terakhir|air terakhir|berapa kali.*air|kapan.*air|kemarin.*air|kemarin.*siram|tadi.*siram|terakhir.*siram|pernah.*siram|jadwal.*siram)\b/i.test(normalized)&&/\b(kapan|kemarin|tadi|terakhir|riwayat|berapa kali|pernah|sudah|belum|catat|jadwal|apa|apakah)\b/i.test(normalized)){
    intent='riwayat_penyiraman'; label='Pencarian riwayat penyiraman';
    requiredSources=['riwayat aktivitas kebun','rekaman tanaman dan data penyiraman','catatan hujan bila relevan'];
    routingKeywords=['siram penyiraman lastWater aktivitas kebun hujan riwayat'];
  }else if(/\b(perlu.*siram|harus.*siram|kapan.*menyiram|butuh air|kekurangan air|tanah kering|media kering|layu)\b/i.test(normalized)){
    intent='kebutuhan_air'; label='Penilaian kebutuhan air';
    requiredSources=['rekaman tanaman','riwayat penyiraman dan hujan','kondisi lingkungan yang tercatat','pengetahuan umum'];
    routingKeywords=['siram penyiraman air kering lembap hujan cuaca'];
  }else if(/\b(panen|memanen|dipanen|petik|memetik|hasil panen|siap panen)\b/i.test(normalized)){
    intent='panen'; label='Pertanyaan panen';
    requiredSources=['rekaman tanaman','riwayat panen','estimasi panen jika tersedia'];
    routingKeywords=['panen petik harvest riwayat panen'];
  }else if(/\b(riwayat hujan|catatan hujan|hujan kemarin|hujan tadi|kemarin hujan|tadi hujan|apakah kemarin hujan|apakah tadi hujan)\b/i.test(normalized)){
    intent='riwayat_aktivitas'; label='Pencarian riwayat hujan';
    requiredSources=['catatan hujan tersimpan','aktivitas kebun yang waktunya relevan'];
    routingKeywords=['hujan catatan hujan riwayat aktivitas kebun'];
  }else if(/\b(hujan|cuaca|ramalan|prakiraan|suhu|kelembapan|angin|panas hari ini)\b/i.test(normalized)){
    intent='cuaca_dan_lingkungan'; label='Cuaca atau lingkungan';
    requiredSources=['data cuaca terkini bila tersedia'];
    routingKeywords=['cuaca hujan ramalan prakiraan suhu kelembapan lingkungan'];
  }else if(/\b(hama|penyakit|sakit|menguning|kuning|layu|bercak|busuk|keriting|rontok|lubang|dimakan|membusuk|mengering|buah.*rontok|bunga.*rontok|kenapa|mengapa|penyebab|kok bisa|ada apa dengan)\b/i.test(normalized)){
    intent='diagnosis_tanaman'; label='Diagnosis atau analisis gejala';
    requiredSources=['rekaman tanaman yang tepat','catatan hama/penyakit/perhatian','riwayat perawatan yang relevan','pengetahuan hortikultura umum'];
    routingKeywords=['gejala tanaman menguning kuning hama penyakit perhatian masalah perawatan riwayat aktivitas'];
  }else if(/\b(aktivitas kebun|riwayat aktivitas|catatan aktivitas|catatan hujan|riwayat hujan|apa yang saya lakukan|sudah saya lakukan|pernah saya lakukan)\b/i.test(normalized)){
    intent='riwayat_aktivitas'; label='Pencarian riwayat aktivitas';
    requiredSources=['aktivitas kebun tercatat','catatan kebun yang relevan'];
    routingKeywords=['aktivitas kebun riwayat catatan hujan siram'];
  }else if(/\b(tanaman apa saja|apa saja tanaman yang saya tanam|apa yang saya tanam|daftar tanaman|tanaman aktif|tanaman yang ada|apa saja yang tumbuh|semua tanaman saya|inventaris tanaman|berapa tanaman)\b/i.test(normalized)){
    intent='inventaris_tanaman'; label='Pencarian daftar tanaman';
    requiredSources=['daftar tanaman terstruktur','status tanaman dan kelompok aktif'];
    routingKeywords=['ringkasan kondisi kebun semua tanaman daftar tanaman aktif kelompok tanam'];
  }else if(/\b(kapan.*tanam|tanggal tanam|umur tanaman|berapa hari.*tanam|sudah berapa lama|mulai menanam|mulai tanam|kapan ditanam|riwayat tanam|kelompok tanam|umur.*labu|umur.*terung|umur.*tomat)\b/i.test(normalized)){
    intent='riwayat_tanam'; label='Riwayat atau umur tanaman';
    requiredSources=['rekaman tanaman dan kelompok tanam','tanggal tanam yang tercatat','catatan perkembangan bila tersedia'];
    routingKeywords=['tanam kelompok tanggal umur tanaman riwayat'];
  }else if(/\b(ringkasan kebun|kondisi kebun|semua tanaman|kebun hari ini|ringkasan hari ini|status kebun)\b/i.test(normalized)){
    intent='ringkasan_kebun'; label='Ringkasan kondisi kebun';
    requiredSources=['ringkasan data kebun','rekaman tanaman aktif','perhatian dan aktivitas terbaru'];
    routingKeywords=['ringkasan kondisi kebun semua tanaman kebun hari ini'];
  }else if(/\b(perlu diperiksa|perlu perhatian|apa yang harus diperhatikan|perhatian kebun|masalah apa saja|ada masalah di kebun)\b/i.test(normalized)){
    intent='perhatian_kebun'; label='Prioritas perhatian kebun';
    requiredSources=['catatan Perlu Perhatian','rekaman tanaman yang terkait','riwayat tindakan tercatat'];
    routingKeywords=['perhatian masalah hama penyakit tanaman riwayat aktivitas'];
  }else if(/\b(statistik|statistik kebun|produktivitas|jumlah tanaman|berapa tanaman|perkembangan|tren|per bulan|tahun ini|total panen)\b/i.test(normalized)){
    intent='statistik_kebun'; label='Statistik atau tren kebun';
    requiredSources=['data tanaman terstruktur','riwayat panen','data waktu yang sesuai dengan permintaan'];
    routingKeywords=['statistik produktivitas jumlah tanaman perkembangan total panen'];
  }else if(/\b(bed|lokasi|tanah|drainase|cahaya matahari|paparan cahaya|teduh|tempat tanam|media tanam)\b/i.test(normalized)){
    intent='profil_lingkungan'; label='Profil Bed atau lingkungan tanam';
    requiredSources=['profil Bed yang sesuai','rekaman tanaman jika terkait'];
    routingKeywords=['bed lokasi tanah drainase cahaya matahari teduh media'];
  }else if(/\b(catatan kebun|jurnal kebun|catatan yang saya tulis|apa yang pernah saya catat|riwayat saya|isi catatan|catatan saya|pengalaman saya)\b/i.test(normalized)){
    intent='pencarian_catatan'; label='Pencarian catatan pengguna';
    requiredSources=['catatan kebun tersimpan','riwayat yang sesuai'];
    routingKeywords=['catatan jurnal riwayat pengalaman kebun'];
  }else if(/\b(bagaimana cara|cara merawat|sebaiknya|apa yang harus|perlukah|perlu saya|bolehkah|bisa tidak|cara mengatasi|langkah penanganan)\b/i.test(normalized)){
    intent='saran_perawatan'; label='Saran atau tindakan perawatan';
    requiredSources=['rekaman tanaman yang tepat','riwayat perawatan terkait','pengetahuan umum hortikultura'];
    routingKeywords=['perawatan cara mengatasi langkah penanganan tanaman'];
  }
  // If the user asks for a garden-specific diagnosis but does not name a plant or provide one clear reference,
  // ask first rather than attaching an arbitrary plant record to the question.
  if(!disambiguationRequired&&['diagnosis_tanaman','saran_perawatan'].includes(intent)&&explicitGardenCue&&!focusEntities.length&&!resolvedReference){
    disambiguationRequired=true;
    disambiguationReason='Pertanyaan meminta analisis tanaman di kebun pengguna, tetapi identitas tanaman tidak disebutkan dan tidak ada rujukan tunggal yang jelas dari percakapan terbaru.';
  }
  const recordLookupIntents=new Set(['riwayat_penyiraman','kebutuhan_air','panen','cuaca_dan_lingkungan','riwayat_aktivitas','inventaris_tanaman','riwayat_tanam','ringkasan_kebun','perhatian_kebun','statistik_kebun','profil_lingkungan','pencarian_catatan']);
  const hasGardenRecordFocus=namedPlants.length>0||!!(resolvedReference&&resolvedReference.kind==='rekaman_kebun');
  const personalWeatherQuestion=/\b(pengaruh|dampak|memengaruhi|mempengaruhi|berpengaruh|hubungannya|pengaruhi)\b/i.test(normalized)&&!!(namedPlants.length||explicitCrops.length)||/\b(hujan|cuaca)\b/i.test(normalized)&&/\b(kebun|tanaman|bed|tanah|media|siram|penyiraman)\b/i.test(normalized);
  const usePersonalGardenData=intent==='pengetahuan_umum'?explicitGardenCue:intent==='perbandingan'?(explicitGardenCue||!!resolvedReference):intent==='cuaca_dan_lingkungan'?(explicitGardenCue||personalWeatherQuestion):(hasGardenRecordFocus||explicitGardenCue||recordLookupIntents.has(intent));
  const suppressPersonalGardenSources=disambiguationRequired||['sapaan','koreksi_jawaban','memori_pengguna_atau_pelajaran'].includes(intent)||!usePersonalGardenData;
  let confidence='indikasi awal';
  if(disambiguationRequired)confidence='belum cukup';
  else if(isGreeting||isCorrection)confidence='kuat';
  else if(namedPlants.length===1&&intent!=='pertanyaan_umum')confidence='kuat';
  else if(resolvedReference)confidence='sedang';
  else if(explicitOnly.length===1&&intent!=='pertanyaan_umum'&&intent!=='pengetahuan_umum')confidence='sedang';
  const questionForAI=disambiguationRequired
    ? 'Rujukan objek belum jelas. Jangan memilih salah satu sumber; minta pengguna menjelaskan objek yang dimaksud.'
    : (resolvedReference?`Pertanyaan lanjutan merujuk ke ${resolvedReference.name}, berdasarkan satu rujukan yang ditemukan pada pesan terakhir.`:'Tidak ada rujukan objek implisit yang perlu ditambahkan.');
  return {
    versi:'query-understanding-1',
    pertanyaan_asli:raw,
    pertanyaan_dinormalisasi:normalized,
    maksud:intent,
    label_maksud:label,
    fokus:focusEntities,
    rujukan_terselesaikan:resolvedReference?resolvedReference.name:null,
    rujukan_perlu_diperjelas:disambiguationRequired,
    alasan_klarifikasi:disambiguationReason||null,
    sumber_yang_diperlukan:requiredSources,
    petunjuk_routing: routingKeywords,
    keyakinan_pemahaman:confidence,
    catatan_interpretasi:questionForAI,
    gunakan_data_kebun_pribadi:usePersonalGardenData,
    tahan_sumber_kebun_tidak_relevan:suppressPersonalGardenSources,
    routingQuestion,
    disambiguationRequired,
    suppressPersonalGardenSources
  };
}
'''

# For explicit "what did I teach you?" questions, prioritize the user's own lesson store over Guru lessons.
old_retrieval_sort = ".sort((a,b)=>b.score-a.score||b.matchedTerms-a.matchedTerms||String(b.createdAt||'').localeCompare(String(a.createdAt||'')))"
new_retrieval_sort = r""".sort((a,b)=>{
              const userTaughtIntent=/\b(saya ajarkan|saya ajari|aturan saya|pengalaman saya|ingatan pengguna|memori saya|yang saya ajarkan|saya pernah bilang|saya pernah jelaskan|pernah saya ajarkan|pernah saya bilang|pernah saya jelaskan)\b/i.test(String(q||''));
              const aUser=userTaughtIntent&&a.__memoryKind==='user_taught'?1:0;
              const bUser=userTaughtIntent&&b.__memoryKind==='user_taught'?1:0;
              return bUser-aUser||b.score-a.score||b.matchedTerms-a.matchedTerms||String(b.createdAt||'').localeCompare(String(a.createdAt||''));
            })"""
source = replace_once(source, old_retrieval_sort, new_retrieval_sort, "prioritize explicit user-taught memory")

if "function naraInterpretUserQuery(question,localDraft=''){" not in source:
    source = replace_once(source, "function naraOnlineLearningContext(question,localDraft=''){", helper + "\nfunction naraOnlineLearningContext(question,localDraft=''){", "add query interpreter")

# Re-isolate the exact context builder after helper insertion and modify only this function.
builder_start = source.find("function naraOnlineLearningContext(question,localDraft=''){")
request_start = source.find("async function naraRequestOnlineAnswer(", builder_start)
if builder_start < 0 or request_start <= builder_start:
    raise SystemExit("ERROR: Could not re-isolate the context builder after inserting query interpreter.")
builder = source[builder_start:request_start]
old_q = "  const q=String(question||'').toLocaleLowerCase('id-ID');"
new_q = "  const naraQueryPlan=naraInterpretUserQuery(question,localDraft);\n  const routedQuestion=String(naraQueryPlan.routingQuestion||question||'');\n  const q=(routedQuestion+' '+(Array.isArray(naraQueryPlan.petunjuk_routing)?naraQueryPlan.petunjuk_routing.join(' '):'')).toLocaleLowerCase('id-ID');"
builder = replace_once(builder, old_q, new_q, "plan-driven routing text")
# Resolve follow-up references only inside this builder. Keep original question for the final online audit.
builder = builder.replace("naraPlantEntriesMentionedInText(question)", "naraPlantEntriesMentionedInText(naraQueryPlan.routingQuestion)")
builder = builder.replace("naraHasPlantTopic(question)", "naraHasPlantTopic(naraQueryPlan.routingQuestion)")
builder = builder.replace("naraScopeRecentHistory(question,", "naraScopeRecentHistory(naraQueryPlan.routingQuestion,")

# Make the interpretation explicit in the structured payload sent to the online model.
payload_anchor = "const payload={pedoman_sumber_dan_kasus:["
builder = replace_once(builder, payload_anchor, "const payload={interpretasi_pertanyaan:naraQueryPlan,pedoman_sumber_dan_kasus:[", "include interpretation in payload")
builder = replace_once(
    builder,
    "const matched=naraGetTaughtKnowledge(question);",
    "const retrievalQuery=[naraQueryPlan.pertanyaan_dinormalisasi,...(Array.isArray(naraQueryPlan.petunjuk_routing)?naraQueryPlan.petunjuk_routing:[])].join(' ');\n  const matched=naraGetTaughtKnowledge(retrievalQuery);",
    "use normalized intent to retrieve relevant lessons"
)

# If the referent is ambiguous, never send unrelated garden evidence that could bias the answer.
ambiguity_guard = r'''  if(naraQueryPlan.suppressPersonalGardenSources){
    payload.ringkasan_kebun=null;
    payload.tanaman_relevan=[];
    payload.perhatian_tercatat=[];
    payload.aktivitas_kebun=[];
    payload.riwayat_panen=[];
    payload.profil_bed=[];
    payload.inhabitant=[];
    payload.catatan_kebun=[];
    if(naraQueryPlan.maksud!=='cuaca_dan_lingkungan')payload.cuaca=null;
    payload.draft_reasoning_lokal='';
    payload.konteks_dibatasi='Data kebun pribadi ditahan karena pertanyaan ini tidak memerlukannya atau fokusnya belum cukup jelas.';
  }
  if(naraQueryPlan.disambiguationRequired){
    payload.draft_reasoning_lokal='';
    payload.tanaman_relevan=[];
    payload.perhatian_tercatat=[];
    payload.aktivitas_kebun=[];
    payload.riwayat_panen=[];
    payload.profil_bed=[];
    payload.inhabitant=[];
    payload.catatan_kebun=[];
    payload.cuaca=null;
    payload.ingatan_belajar_relevan=[];
    payload.percakapan_terakhir=[];
    payload.konteks_dibatasi='Rujukan belum jelas. Jangan memilih rekaman kebun; tanyakan objek yang dimaksud terlebih dahulu.';
  }
'''
builder = replace_once(builder, "  let serial=JSON.stringify(payload);", ambiguity_guard + "  let serial=JSON.stringify(payload);", "fail closed on ambiguous reference")
source = source[:builder_start] + builder + source[request_start:]

# Add source-routing instructions to the online teacher prompt, while preserving its existing guardrails.
request_start = source.find("async function naraRequestOnlineAnswer(")
request_end = source.find("\nfunction naraBuildTeacherPrompt(", request_start)
if request_start < 0 or request_end <= request_start:
    raise SystemExit("ERROR: Could not isolate online answer function.")
request_fn = source[request_start:request_end]
# The restored Step 2P prompt exists in source revisions with either literal\n escapes
# or actual newline characters inside the template literal. Match the exact style present
# in this source rather than failing a valid build on representation-only differences.
policy = "INTERPRETASI MAKSUD DAN SUMBER: Objek interpretasi_pertanyaan adalah rencana pemahaman dan routing buatan Nara, bukan fakta tambahan dan bukan pengganti pertanyaan_pengguna. Prioritaskan pertanyaan asli yang paling baru. Gunakan maksud, fokus, dan sumber yang disarankan hanya jika cocok dengan kata-kata dan konteks pengguna. Jangan anggap sebuah sumber relevan hanya karena kata kuncinya cocok. Untuk klaim tentang kebun, cocokkan identitas tanaman, waktu, lokasi, serta jenis catatan. Bedakan bukti tercatat, pengetahuan umum, inferensi, dan informasi yang belum tersedia. Jika rujukan_perlu_diperjelas bernilai true, jangan menebak tanaman atau mengirim klaim dari rekaman yang tidak pasti; ajukan satu pertanyaan klarifikasi yang singkat. Petunjuk routing tidak boleh diperlakukan sebagai ucapan pengguna."
anchor_variants = [
    ("\n\nPRIORITAS MAKSUD TERBARU:", "\n\n" + policy + "\n\nPRIORITAS MAKSUD TERBARU:"),
    (r"\n\nPRIORITAS MAKSUD TERBARU:", r"\n\n" + policy + r"\n\nPRIORITAS MAKSUD TERBARU:"),
]
matched_anchors = [(old, new) for old, new in anchor_variants if request_fn.count(old) == 1]
if len(matched_anchors) != 1:
    counts = [request_fn.count(old) for old, _ in anchor_variants]
    raise SystemExit(f"ERROR: query-understanding patch at online interpretation policy: expected one supported anchor representation; counts={counts}. Refusing ambiguous edit.")
old_prompt_anchor, new_prompt_anchor = matched_anchors[0]
request_fn = request_fn.replace(old_prompt_anchor, new_prompt_anchor, 1)
request_fn = replace_once(
    request_fn,
    "naraScopeRecentHistory(question,recentHistory)",
    "naraScopeRecentHistory(base.interpretasi_pertanyaan?.routingQuestion||question,recentHistory)",
    "scope online conversation history with resolved reference"
)
request_fn = replace_once(
    request_fn,
    "  const content=JSON.stringify(base);",
    "  if(base.interpretasi_pertanyaan?.disambiguationRequired){modeInstruction+='\\n\\nMODE KLARIFIKASI WAJIB: Rujukan pengguna ambigu. Jangan menganalisis tanaman atau mengambil kesimpulan dari rekaman mana pun. Tanyakan satu pertanyaan singkat untuk memastikan objek yang dimaksud.';}\n  const content=JSON.stringify(base);",
    "force clarification for ambiguous reference"
)

# Expand the request trace so the diagnostic panel can reveal interpretation and selected source types.
old_audit = r'''naraLastRetrievalAudit={
              at:new Date().toISOString(),
              question:naraGuruSafe(question,220),
              memoryCount:diagnosticMemories.length,
              memories:diagnosticMemories.map(m=>({
                topik:naraGuruSafe(m.topik||m.topic||'',140),
                asal:naraGuruSafe(m.asal||m.origin||'Sumber tidak berlabel',100),
                jenis:naraGuruSafe(m.jenis||'',80),
                materi:naraGuruSafe(m.materi||m.text||'',950)
              }))
            };'''
new_audit = r'''naraLastRetrievalAudit={
              at:new Date().toISOString(),
              question:naraGuruSafe(question,220),
              interpretation:base.interpretasi_pertanyaan||null,
              sourceCounts:{
                tanaman_relevan:Array.isArray(base.tanaman_relevan)?base.tanaman_relevan.length:0,
                perhatian_tercatat:Array.isArray(base.perhatian_tercatat)?base.perhatian_tercatat.length:0,
                aktivitas_kebun:Array.isArray(base.aktivitas_kebun)?base.aktivitas_kebun.length:0,
                riwayat_panen:Array.isArray(base.riwayat_panen)?base.riwayat_panen.length:0,
                profil_bed:Array.isArray(base.profil_bed)?base.profil_bed.length:0,
                catatan_kebun:Array.isArray(base.catatan_kebun)?base.catatan_kebun.length:0,
                pelajaran_relevan:diagnosticMemories.length
              },
              memoryCount:diagnosticMemories.length,
              memories:diagnosticMemories.map(m=>({
                topik:naraGuruSafe(m.topik||m.topic||'',140),
                asal:naraGuruSafe(m.asal||m.origin||'Sumber tidak berlabel',100),
                jenis:naraGuruSafe(m.jenis||'',80),
                materi:naraGuruSafe(m.materi||m.text||'',950)
              }))
            };'''
request_fn = replace_once(request_fn, old_audit, new_audit, "record interpretation in online request trace")
source = source[:request_start] + request_fn + source[request_end:]

# Show the intent plan in the existing retrieval diagnostic panel for testing.
diag_start = source.find("function naraRunRetrievalDiagnostic(){")
diag_end = source.find("\n          document.addEventListener('click'", diag_start)
if diag_start < 0 or diag_end <= diag_start:
    raise SystemExit("ERROR: Could not isolate existing retrieval diagnostic function.")
diag = source[diag_start:diag_end]
diag = replace_once(
    diag,
    "const contextRows=payload&&Array.isArray(payload.ingatan_belajar_relevan)?payload.ingatan_belajar_relevan:[];",
    "const contextRows=payload&&Array.isArray(payload.ingatan_belajar_relevan)?payload.ingatan_belajar_relevan:[];\n              const plan=payload&&payload.interpretasi_pertanyaan||null;",
    "diagnostic reads query interpretation"
)
diag = replace_once(
    diag,
    "const out=[];",
    "const out=[];\n              if(plan){const focus=Array.isArray(plan.fokus)?plan.fokus.map(x=>x.name).filter(Boolean).join(', '):'';const sources=Array.isArray(plan.sumber_yang_diperlukan)?plan.sumber_yang_diperlukan.join('; '):'';out.push('<div><strong>Interpretasi maksud:</strong> '+escText(plan.label_maksud||plan.maksud||'belum ditentukan')+'; keyakinan: '+escText(plan.keyakinan_pemahaman||'tidak tersedia')+'.</div>');if(focus)out.push('<div><strong>Fokus:</strong> '+escText(focus)+'</div>');out.push('<div><strong>Sumber yang diharapkan:</strong> '+escText(sources||'tidak ada')+'</div>');if(plan.rujukan_perlu_diperjelas)out.push('<div><strong>Klarifikasi diperlukan:</strong> '+escText(plan.alasan_klarifikasi||'rujukan ambigu')+'. Sumber spesifik harus ditahan.</div>');}",
    "show plan in diagnostic panel"
)
source = source[:diag_start] + diag + source[diag_end:]

checks = {
    "query interpreter is present": "function naraInterpretUserQuery(question,localDraft='')" in source,
    "short Indonesian forms normalized": "replace(/\\bknp\\b/g,'kenapa')" in source and "replace(/\\bsy\\b/g,'saya')" in source,
    "explicit user lesson retrieval is prioritized": "userTaughtIntent" in source and "a.__memoryKind==='user_taught'" in source,
    "intent plan controls context routing": "const naraQueryPlan=naraInterpretUserQuery(question,localDraft)" in source and "naraQueryPlan.petunjuk_routing" in source,
    "general-knowledge intent excludes unrelated garden records": "intent='pengetahuan_umum'" in source and "intent==='pengetahuan_umum'?explicitGardenCue" in source,
    "general comparison avoids incidental garden records": "intent==='perbandingan'?(explicitGardenCue||!!resolvedReference)" in source,
    "current weather is separated from rain-history lookup": "Pencarian riwayat hujan" in source and "data cuaca terkini bila tersedia" in source,
    "online history follows resolved reference": "naraScopeRecentHistory(base.interpretasi_pertanyaan?.routingQuestion||question,recentHistory)" in source,
    "interpretation is sent to online AI": "interpretasi_pertanyaan:naraQueryPlan" in source,
    "normalized query improves lesson retrieval": "const retrievalQuery=[naraQueryPlan.pertanyaan_dinormalisasi" in source and "naraGetTaughtKnowledge(retrievalQuery)" in source,
    "irrelevant garden records are suppressed": "if(naraQueryPlan.suppressPersonalGardenSources)" in source and "Data kebun pribadi ditahan" in source,
    "ambiguous follow-up holds back source data": "if(naraQueryPlan.disambiguationRequired)" in source and "Rujukan belum jelas" in source,
    "online prompt treats plan as hypothesis": "INTERPRETASI MAKSUD DAN SUMBER" in source,
    "request diagnostics record interpretation": "interpretation:base.interpretasi_pertanyaan||null" in source and "sourceCounts:" in source,
    "diagnostic UI shows intent plan": "show plan in diagnostic panel" not in source and "Sumber yang diharapkan:" in source,
    "Step 2P diagnostic remains present": "function naraRunRetrievalDiagnostic()" in source and "naraLastRetrievalAudit" in source,
    "online request path remains": "async function naraRequestOnlineAnswer(" in source and "const response=await naraGuruChat" in source,
    "legacy memory stores remain": "naraState.userLessons" in source and "naraState.teacherLessons" in source,
    "source integrity guard remains": "function naraAuditAnswerPlantScope" in source and "PENGUNCI KASUS WAJIB" in source,
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit("ERROR: Query-understanding post-patch checks failed: " + ", ".join(failed))
if source == original:
    raise SystemExit("ERROR: Query-understanding patch made no changes.")
path.write_text(source, encoding="utf-8")
print("Nara Query Understanding & Source Routing patch applied to generated APK HTML.")
for name in checks:
    print("PASS:", name)
