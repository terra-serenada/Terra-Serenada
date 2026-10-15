#!/usr/bin/env node
'use strict';

/*
 * Terra Serenada 2.1 — Nara Data Understanding regression audit.
 *
 * This test runs against android/app/src/main/assets/index.html AFTER the
 * existing 2.1 prepare/patch scripts have run. It uses synthetic fixture data;
 * it never reads, alters, or persists real user data.
 *
 * Default mode is report-only so the current baseline can be measured without
 * blocking an APK build. Pass --strict to exit non-zero on automated failures.
 * The actual live model answer still requires manual runtime evidence; this
 * script verifies the interpretation and serialized request messages, not a
 * live AI-provider response.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const HTML_PATH = path.join('android', 'app', 'src', 'main', 'assets', 'index.html');
const strict = process.argv.includes('--strict');
if (!fs.existsSync(HTML_PATH)) {
  console.error(`ERROR: Generated APK HTML not found: ${HTML_PATH}`);
  process.exit(2);
}
const html = fs.readFileSync(HTML_PATH, 'utf8');

function sliceFunction(startMarker, endMarker, label) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end <= start) throw new Error(`Could not isolate ${label} from generated APK HTML.`);
  return html.slice(start, end);
}

const interpreterSource = sliceFunction(
  "function naraInterpretUserQuery(question,localDraft=''){",
  "function naraOnlineLearningContext(question,localDraft=''){",
  'Nara query interpreter'
);
// The current app does not define a standalone naraBuildAnswerMessages() helper.
// naraOnlineLearningContext() creates the JSON context consumed by the existing
// naraRequestOnlineAnswer() path. Keep this test scoped to that real boundary.
const contextBuilderSource = sliceFunction(
  "function naraOnlineLearningContext(question,localDraft=''){",
  '\nasync function naraRequestOnlineAnswer(',
  'Nara online context builder'
);

const fixtureData = [
  {
    id: 'plant-radish', name: 'Lobak Putih', variety: 'Putih', date: '2026-09-21', qty: 1,
    note: 'Fixture sintetis untuk tes status kelompok.', lastWater: '2026-10-12', lastWaterSource: 'Hujan', harvestDays: 55,
    plantingGroups: [{id:'group-radish-2026-09-21', date:'2026-09-21', totalQty:1, qty:1, activeQty:0, completedQty:0, failedQty:1, locations:['Bed Rempah'], createdAt:'2026-09-21T07:00:00.000Z'}],
    events: [{id:'radish-cycle-complete', date:'2026-10-08', type:'group-cycle-complete', groupId:'group-radish-2026-09-21', label:'Kelompok tanam menyelesaikan siklus', note:'1 tanaman gagal', createdAt:'2026-10-08T08:00:00.000Z'}]
  },
  {
    id: 'plant-tomato', name: 'Tomat Roma', variety: 'Roma', date: '2026-09-20', qty: 3,
    note: 'Fixture sintetis tomat.', lastWater: '2026-10-14', lastWaterSource: 'Disiram', harvestDays: 70,
    plantingGroups: [{id:'group-tomato-mixed', date:'2026-09-20', totalQty:3, qty:3, activeQty:2, completedQty:0, failedQty:1, locations:['Bed Veggie'], createdAt:'2026-09-20T07:00:00.000Z'}],
    events: [{id:'tomato-flowering', date:'2026-10-10', type:'flowering', label:'Mulai berbunga', note:'Fixture pertumbuhan tomat', createdAt:'2026-10-10T08:00:00.000Z'}]
  },
  {
    id: 'plant-eggplant', name: 'Terung Bulat Hijau Bergaris Putih', variety: 'Bergaris Putih', date: '2026-09-24', qty: 2,
    note: 'Fixture sintetis untuk pengujian perhatian terung.', lastWater: '2026-10-14', lastWaterSource: 'Disiram', harvestDays: 65,
    plantingGroups: [{id:'group-eggplant-active', date:'2026-09-24', totalQty:2, qty:2, activeQty:2, completedQty:0, failedQty:0, locations:['Bed Spiral'], createdAt:'2026-09-24T07:00:00.000Z'}],
    events: [
      {id:'eggplant-yellowing', date:'2026-10-13', type:'attention', label:'Buah menguning', note:'Catatan gejala fixture', createdAt:'2026-10-13T08:00:00.000Z', measurements:[{indicatorId:'height',indicatorName:'Tinggi tanaman',value:32,unit:'cm'}]},
      {id:'eggplant-height-new', date:'2026-10-14', type:'measurement', label:'Pengukuran tinggi', note:'Pengukuran fixture', createdAt:'2026-10-14T08:00:00.000Z', measurements:[{indicatorId:'height',indicatorName:'Tinggi tanaman',value:35,unit:'cm'}]}
    ]
  }
];
const fixtureAttentions = [
  {id:'attention-tomato', plantId:'plant-tomato', date:'2026-10-11', type:'attention', problemType:'pest', affectedPart:'leaf', severity:'low', action:'Amati kembali', note:'Catatan khusus tomat', inhabitantTags:[], status:'active', createdAt:'2026-10-11T08:00:00.000Z'},
  {id:'attention-eggplant', plantId:'plant-eggplant', date:'2026-10-13', type:'attention', problemType:'fruit', affectedPart:'fruit', severity:'medium', action:'Periksa buah', note:'Buah terung menguning; penyebab belum dipastikan.', inhabitantTags:['inhabitant-ladybug'], status:'active', createdAt:'2026-10-13T08:00:00.000Z'}
];
const fixtureEvents = [
  {id:'rain-2026-10-12', date:'2026-10-12', type:'rain', label:'Hujan', bedNames:['Bed Rempah','Bed Veggie','Bed Spiral'], scope:'all-beds', createdAt:'2026-10-12T16:00:00.000Z'},
  {id:'water-2026-10-14', date:'2026-10-14', type:'water', label:'Disiram', bedNames:['Bed Rempah'], scope:'configured', createdAt:'2026-10-14T07:00:00.000Z'}
];
const fixtureHarvests = [
  {id:'harvest-eggplant', plantId:'plant-eggplant', date:'2026-10-02', qty:2, unit:'buah', quality:'Baik', note:'Panen fixture', createdAt:'2026-10-02T08:00:00.000Z'}
];
const fixtureBeds = [
  {id:'bed-rempah', name:'Bed Rempah', soilType:'timbunan', drainage:'medium', lightExposure:'06:00–14:00', vegetation:'sedang', note:'Fixture lokasi lobak'},
  {id:'bed-spiral', name:'Bed Spiral', soilType:'lembang', drainage:'slow', lightExposure:'06:00–12:00', vegetation:'rimbun', note:'Fixture lokasi terung'}
];
const fixtureInhabitants = [
  {id:'inhabitant-ladybug', name:'Kumbang koksi', faction:'Guardian League', status:'teramati', note:'Pengamatan fixture; tidak membuktikan sebab-akibat.', events:[{date:'2026-10-13',type:'seen',note:'Teramati dekat tanaman terung'}]}
];
const fixtureNotes = [
  {id:'note-spiral', date:'2026-10-09', datetime:'2026-10-09T18:00', title:'Bed Spiral', text:'Catatan pengguna tentang drainase Bed Spiral.', createdAt:'2026-10-09T18:00:00.000Z'},
  {id:'note-veggie', date:'2026-10-14', datetime:'2026-10-14T18:00', title:'Bed Veggie', text:'Catatan lain yang tidak terkait dengan Bed Spiral.', createdAt:'2026-10-14T18:00:00.000Z'}
];
const fixtureLessons = [
  {id:'lesson-user-watering', title:'Aturan penyiraman pengguna', topic:'Penyiraman', text:'Aturan yang secara eksplisit diajarkan pengguna: periksa kelembapan sebelum menyiram.', origin:'Pengguna', learningType:'user_taught', createdAt:'2026-10-01'},
  {id:'lesson-guru-watering', title:'Materi Guru tentang penyiraman', topic:'Penyiraman', text:'Materi Guru Online yang berbeda: sesuaikan air dengan kebutuhan tanaman.', origin:'Guru AI Online', learningType:'model_language', createdAt:'2026-10-13'}
];
const conversationMessages = [
  {role:'user', text:'Tomat Roma baru mulai berbunga.'},
  {role:'assistant', text:'Kita juga mencatat Terung Bulat Hijau Bergaris Putih.'}
];
const normalize = value => String(value || '').toLocaleLowerCase('id-ID').normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
const aliases = [
  ['lobak',['lobak','lobak putih']], ['terung',['terung','terong']], ['tomat',['tomat']],
  ['cabai',['cabai','cabe']], ['timun',['timun','mentimun']], ['kunyit',['kunyit']], ['labu',['labu']]
];
function cropTerms(value) {
  const tokens = new Set(normalize(value));
  return aliases.filter(([,words]) => words.some(word => normalize(word).some(t => tokens.has(t)))).map(([name]) => name);
}
function mentionPlants(value) {
  const tokens = new Set(normalize(value));
  return fixtureData.filter(plant => {
    const plantWords = normalize(`${plant.name} ${plant.variety || ''}`);
    return plantWords.some(w => w.length >= 4 && tokens.has(w));
  });
}
function groupTotal(g) { return Math.max(1, Number(g?.totalQty ?? g?.qty ?? 1)); }
function groupCompletedQty(g) { return Math.max(0, Math.min(groupTotal(g), Number(g?.completedQty || 0))); }
function groupFailedQty(g) { return Math.max(0, Math.min(groupTotal(g), Number(g?.failedQty || 0))); }
function groupActiveQty(g) { return Math.max(0, groupTotal(g) - groupCompletedQty(g) - groupFailedQty(g)); }
function groupLocations(g) { return Array.isArray(g?.locations) ? g.locations : []; }
function groupHasActive(g) { return groupActiveQty(g) > 0; }
function activeGroups(plant) { return (Array.isArray(plant?.plantingGroups) ? plant.plantingGroups : []).filter(groupHasActive); }
function safeText(value, max=500) { return String(value ?? '').slice(0,max); }
function snapshot() {
  const activePlants = fixtureData.filter(p => activeGroups(p).length);
  const eventsCount = fixtureData.reduce((n,p)=>n+(Array.isArray(p.events)?p.events.length:0),0);
  return {
    plants: fixtureData.length, active: activePlants.length, beds: fixtureBeds.length, inhabitants: fixtureInhabitants.length,
    harvests: fixtureHarvests.length, gardenNotes: fixtureNotes.length, events: eventsCount,
    waterDue: [], attention: fixtureAttentions.filter(a=>a.status==='active'), flowering: [], upcoming: [], lessons: fixtureLessons.length
  };
}

const sandbox = {
  console,
  data: fixtureData,
  attentions: fixtureAttentions,
  gardenEvents: fixtureEvents,
  harvests: fixtureHarvests,
  beds: fixtureBeds,
  inhabitants: fixtureInhabitants,
  gardenNotes: fixtureNotes,
  growthIndicators: [{id:'height', name:'Tinggi tanaman', definition:'Tinggi dari pangkal sampai pucuk', unit:'cm'}],
  naraState: {version:2, messages:conversationMessages, lessons:fixtureLessons, onlineTeacherLessons:fixtureLessons.filter(l=>l.origin==='Guru AI Online'), teacherLearning:{}},
  naraGuruSafe: safeText,
  naraMemoryTokens: normalize,
  naraPlantEntriesMentionedInText: mentionPlants,
  naraExplicitCropTerms: cropTerms,
  naraIsSimpleGreeting: q => /^(hai|halo|selamat pagi|selamat malam)[!. ]*$/i.test(String(q||'').trim()),
  naraIsCorrectionTurn: q => /bukan itu|salah|bukan maksud saya|saya tidak bilang/i.test(String(q||'')),
  naraIsGreetingCorrection: q => /saya cuma menyapa|hanya menyapa|cuma menyapa/i.test(String(q||'')),
  naraHasPlantTopic: q => cropTerms(q).length > 0 || /\b(tanaman|tumbuhan|kebun|buah|daun|batang|akar|bunga|hama|penyakit|panen|siram|penyiraman|pupuk|bed)\b/i.test(normalize(q).join(' ')),
  naraScopeRecentHistory: (_q, limit=8) => conversationMessages.slice(-Math.max(1,Number(limit)||8)),
  naraGardenSnapshot: snapshot,
  naraActiveGroups: activeGroups,
  groupActiveQty,
  groupLocations,
  naraPlantEvents: plant => (Array.isArray(plant?.events)?plant.events:[]).slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))),
  inhabitantNames: ids => (Array.isArray(ids)?ids:[]).map(id=>fixtureInhabitants.find(x=>x.id===id)?.name).filter(Boolean),
  inhabitantDerivedEvents: id => fixtureAttentions.filter(a=>(a.inhabitantTags||[]).includes(id)).map(a=>({type:'attention-tag',date:a.date,note:a.note})),
  naraWeatherSnapshot: () => ({summary:'Fixture cuaca',status:'uji',available:true}),
  naraGetTaughtKnowledge: query => {
    const terms=normalize(query).filter(w=>w.length>=4);
    return fixtureLessons.map(l=>({...l,score:terms.reduce((n,w)=>n+(normalize(`${l.title} ${l.topic} ${l.text}`).includes(w)?1:0),0)})).filter(l=>l.score>0).sort((a,b)=>b.score-a.score);
  },
  naraAnswer: () => '',
  NARA_LOCAL_CAPABILITY_PACK: {system_instruction:'Gunakan bukti, jangan mengarang data.',capabilities:[]}
};
vm.createContext(sandbox);
vm.runInContext(interpreterSource + '\n' + contextBuilderSource, sandbox, {timeout:3000});

function payloadFor(question) {
  const plan = sandbox.naraInterpretUserQuery(question, '');
  // Inspect the structured context at the real source-routing boundary. The
  // existing query-understanding regression test separately verifies that this
  // interpreted context reaches the online request path; this test does not
  // claim to invoke the live AI provider or fabricate a nonexistent helper.
  const payload = JSON.parse(sandbox.naraOnlineLearningContext(question, ''));
  return {plan, payload, outgoing: payload};
}
function includesPlant(records, id) { return Array.isArray(records) && records.some(p => p?.id === id || p?.tanaman_id === id || p?.plantId === id); }
function groupsFor(payload, plantName) { const p=(payload.tanaman_relevan||[]).find(x => x.nama===plantName); return p?.kelompok_tanam||[]; }
function checkAll(result, checks) { return checks.map(([name, fn]) => ({name, passed:!!fn(result)})); }
const scenarios = [];
function run(id, title, question, checks) {
  try {
    const result = payloadFor(question);
    const results = checkAll(result, checks);
    const passed = results.every(x=>x.passed);
    scenarios.push({id,title,question,passed,results,plan:result.plan,selectedPlants:(result.outgoing.tanaman_relevan||[]).map(p=>p.nama),payloadKeys:Object.keys(result.outgoing)});
  } catch (error) {
    scenarios.push({id,title,question,passed:false,results:[{name:'test execution',passed:false,error:String(error)}]});
  }
}

// QD-01: Failure status must be a first-class query, and historical groups must be carried forward.
run('QD-01','Semua tanaman/kelompok yang gagal','Tanaman apa saja yang sudah gagal di kebun saya?',[
  ['intent recognizes failed-status filter',r=>/gagal|failure|status_tanaman/i.test(String(r.plan.maksud)+' '+JSON.stringify(r.plan.sumber_yang_diperlukan||[]))],
  ['both radish and mixed tomato records retrieved',r=>includesPlant(r.outgoing.tanaman_relevan,'plant-radish')&&includesPlant(r.outgoing.tanaman_relevan,'plant-tomato')],
  ['historical failed quantity preserved',r=>JSON.stringify(r.outgoing).includes('failedQty')||JSON.stringify(r.outgoing).includes('jumlah_gagal')||JSON.stringify(r.outgoing).includes('tanaman_gagal')]
]);
run('QD-02','Riwayat kelompok gagal','Buka Riwayat Kelompok Tanam dan sebutkan kelompok gagal.',[
  ['intent recognizes planting-group history',r=>/riwayat_tanam|kelompok|history/i.test(String(r.plan.maksud)+' '+JSON.stringify(r.plan.sumber_yang_diperlukan||[]))],
  ['historical radish group reaches outgoing payload',r=>JSON.stringify(r.outgoing).includes('group-radish-2026-09-21')||JSON.stringify(r.outgoing).includes('Lobak Putih')&&JSON.stringify(r.outgoing).includes('failedQty')]
]);
run('QD-03','Kelompok campuran aktif dan gagal','Kelompok mana yang masih aktif tetapi sudah ada tanaman gagal?',[
  ['mixed status understood',r=>/campuran|gagal|status_tanaman/i.test(String(r.plan.maksud)+' '+JSON.stringify(r.plan.sumber_yang_diperlukan||[]))],
  ['tomato active and failed quantities both carried',r=>{const x=JSON.stringify(r.outgoing);return x.includes('group-tomato-mixed')&&x.includes('failedQty')&&x.includes('activeQty')}]
]);
run('QD-04','Inventaris semua tanaman','Tanaman apa saja yang pernah saya tanam?',[
  ['intent is all-time plant inventory',r=>/inventaris_tanaman/i.test(r.plan.maksud)],
  ['all three fixture plants included',r=>['plant-radish','plant-tomato','plant-eggplant'].every(id=>includesPlant(r.outgoing.tanaman_relevan,id))],
  ['coverage is explicit if truncated',r=>(r.outgoing.cakupan_daftar||r.outgoing.batas_daftar||r.outgoing.paginasi||'').toString().length>0||((r.outgoing.tanaman_relevan||[]).length===fixtureData.length)]
]);
run('QD-05','Jumlah gagal pada kelompok tertentu','Berapa tanaman yang gagal pada kelompok Lobak Putih 21 September 2026?',[
  ['plant/date is supported by selected record, not merely echoed question',r=>{const x=JSON.stringify(r.outgoing.tanaman_relevan||[]);return /Lobak Putih/.test(x)&&/2026-09-21/.test(x)}],
  ['failed and total quantities carried',r=>{const x=JSON.stringify(r.outgoing.tanaman_relevan||[]);return x.includes('failedQty')&&x.includes('totalQty')}],
  ['exact group ID retained',r=>JSON.stringify(r.outgoing.tanaman_relevan||[]).includes('group-radish-2026-09-21')]
]);
run('QD-06','Riwayat penyiraman kemarin','Kemarin saya siram?',[
  ['intent identifies watering history',r=>r.plan.maksud==='riwayat_penyiraman'],
  ['manual watering record for target date reaches request',r=>JSON.stringify(r.outgoing.aktivitas_kebun||[]).includes('2026-10-14')&&JSON.stringify(r.outgoing.aktivitas_kebun||[]).includes('water')],
  ['rain remains a distinct event type',r=>{const a=r.outgoing.aktivitas_kebun||[];return a.some(e=>e.jenis==='rain')&&a.some(e=>e.jenis==='water')}]
]);
run('QD-07','Riwayat hujan dengan cakupan Bed','Bed mana yang tercatat terkena hujan 12 Oktober 2026?',[
  ['rain-history intent uses a historical activity route',r=>r.plan.maksud==='riwayat_aktivitas'&&JSON.stringify(r.plan.sumber_yang_diperlukan||[]).includes('catatan hujan')],
  ['dated rain event reaches request',r=>(r.outgoing.aktivitas_kebun||[]).some(e=>e.tanggal==='2026-10-12'&&e.jenis==='rain')],
  ['Bed coverage of rain is present',r=>JSON.stringify((r.outgoing.aktivitas_kebun||[]).find(e=>e.tanggal==='2026-10-12'&&e.jenis==='rain')||{}).includes('Bed Rempah')]
]);
run('QD-08','Perhatian yang hanya terkait terung','Apa masalah aktif pada terung?',[
  ['plant focus resolves to eggplant',r=>JSON.stringify(r.plan.fokus||[]).includes('Terung')||JSON.stringify(r.outgoing.tanaman_relevan||[]).includes('Terung Bulat')],
  ['eggplant attention included',r=>(r.outgoing.perhatian_tercatat||[]).some(a=>a.tanaman==='Terung Bulat Hijau Bergaris Putih')],
  ['tomato attention excluded from eggplant-only evidence',r=>(r.outgoing.perhatian_tercatat||[]).every(a=>a.tanaman!=='Tomat Roma')]
]);
run('QD-09','Keterkaitan Inhabitant bukan sebab-akibat','Apakah kumbang koksi menyebabkan masalah pada terung?',[
  ['Inhabitant record is selected for this question',r=>(r.outgoing.inhabitant||[]).some(i=>i.nama==='Kumbang koksi')],
  ['Inhabitant evidence has explicit non-causality boundary',r=>JSON.stringify(r.outgoing).includes('tidak membuktikan')||JSON.stringify(r.outgoing).includes('bukan bukti penyebab')]
]);
run('QD-10','Catatan kebun tentang Bed Spiral','Apa catatan kebun saya tentang Bed Spiral?',[
  ['garden note source is selected',r=>Array.isArray(r.outgoing.catatan_kebun)&&r.outgoing.catatan_kebun.some(n=>/spiral/i.test(JSON.stringify(n)))],
  ['unrelated Bed Veggie note excluded',r=>(r.outgoing.catatan_kebun||[]).every(n=>!/Bed Veggie|tidak terkait dengan Bed Spiral/i.test(JSON.stringify(n)))]
]);
run('QD-11','Dua pengukuran tinggi terakhir','Bandingkan dua pengukuran tinggi terakhir terung.',[
  ['eggplant is resolved',r=>JSON.stringify(r.plan.fokus||[]).includes('Terung')||JSON.stringify(r.outgoing.tanaman_relevan||[]).includes('Terung Bulat Hijau Bergaris Putih')],
  ['two dated measurements for the same plant/indicator are present',r=>{const x=JSON.stringify(r.outgoing);return x.includes('pengukuran_pertumbuhan')&&x.includes('2026-10-13')&&x.includes('2026-10-14')&&x.includes('height')}]
]);
run('QD-12','Pemisahan pelajaran pengguna dan Guru','Apa aturan penyiraman yang pernah saya ajarkan?',[
  ['user memory intent is explicit',r=>/memori_pengguna|pelajaran/i.test(String(r.plan.maksud)+' '+JSON.stringify(r.plan))],
  ['user-taught lesson appears with its origin',r=>(r.outgoing.ingatan_belajar_relevan||[]).some(l=>l.asal==='Pengguna'||l.origin==='Pengguna'||l.jenis==='user_taught')],
  ['Guru lesson is not presented as user-authored evidence',r=>(r.outgoing.ingatan_belajar_relevan||[]).filter(l=>l.asal==='Pengguna'||l.origin==='Pengguna'||l.jenis==='user_taught').every(l=>/pengguna/i.test(JSON.stringify(l)))]
]);
run('QD-13','Ringkasan kebun tanpa menyamarkan cakupan','Apa kondisi kebun hari ini?',[
  ['garden summary intent',r=>/ringkasan_kebun/i.test(r.plan.maksud)],
  ['summary contains live fixture counts',r=>r.outgoing.ringkasan_kebun&&r.outgoing.ringkasan_kebun.tanaman===fixtureData.length],
  ['plant detail list complete or clearly bounded',r=>(r.outgoing.tanaman_relevan||[]).length===fixtureData.length||!!(r.outgoing.cakupan_daftar||r.outgoing.batas_daftar||r.outgoing.paginasi)]
]);
run('QD-14','Estimasi panen hanya dari kelompok aktif','Kapan perkiraan panen Terung Bulat Hijau Bergaris Putih?',[
  ['eggplant focus resolved',r=>JSON.stringify(r.plan.fokus||[]).includes('Terung')||JSON.stringify(r.outgoing.tanaman_relevan||[]).includes('Terung Bulat Hijau Bergaris Putih')],
  ['active group identified',r=>groupsFor(r.outgoing,'Terung Bulat Hijau Bergaris Putih').some(g=>Number(g.jumlah_aktif||g.activeQty||0)>0)],
  ['failed/historic groups not used as future harvest basis',r=>groupsFor(r.outgoing,'Terung Bulat Hijau Bergaris Putih').every(g=>Number(g.jumlah_gagal||g.failedQty||0)===0)]
]);
run('QD-15','Referensi lanjutan ambigu','Bagaimana dengan yang satunya?',[
  ['ambiguous referent triggers clarification',r=>r.plan.rujukan_perlu_diperjelas===true||r.plan.disambiguationRequired===true],
  ['unrelated plant records are withheld from outgoing payload',r=>(r.outgoing.tanaman_relevan||[]).length===0]
]);

const failCount = scenarios.reduce((n,s)=>n+(s.passed?0:1),0);
const checkCount = scenarios.reduce((n,s)=>n+s.results.length,0);
const checksPassed = scenarios.reduce((n,s)=>n+s.results.filter(x=>x.passed).length,0);
console.log('NARA DATA UNDERSTANDING — SYNTHETIC FIXTURE AUDIT');
console.log(`Asset: ${HTML_PATH}`);
console.log(`Mode: ${strict ? 'STRICT (blocks on automated failures)' : 'REPORT-ONLY (does not block APK build)'}`);
console.log('Live user data: NOT READ; all records above are synthetic fixtures.');
console.log('Scope: structured context before request serialization; existing 2.1 test covers routing into online-request path.');
console.log('Live AI response: NOT CALLED; answer audit still requires runtime evidence.');
for (const s of scenarios) {
  console.log(`\n${s.passed?'PASS':'GAP'} ${s.id} — ${s.title}`);
  if (s.plan) console.log(`  interpretation: maksud=${s.plan.maksud||'?'}, confidence=${s.plan.keyakinan_pemahaman||'?'}, clarify=${Boolean(s.plan.rujukan_perlu_diperjelas||s.plan.disambiguationRequired)}`);
  if (s.selectedPlants) console.log(`  selected plants: ${s.selectedPlants.join(', ') || '(none)'}`);
  for (const r of s.results) console.log(`  ${r.passed?'PASS':'FAIL'} — ${r.name}${r.error?`: ${r.error}`:''}`);
}
console.log(`\nAUTOMATED ASSERTIONS: ${checksPassed}/${checkCount} passed`);
console.log(`SCENARIOS WITH GAPS: ${failCount}/${scenarios.length}`);
console.log('FINAL ACCEPTANCE: NOT VERIFIED until outgoing-payload evidence and live answer/audit evidence are reviewed.');
if (strict && failCount > 0) process.exitCode = 1;
