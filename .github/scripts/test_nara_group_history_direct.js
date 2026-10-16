#!/usr/bin/env node
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const htmlPath = process.argv[2] || 'nara-apk-source.html';
if (!fs.existsSync(htmlPath)) throw new Error(`HTML source not found: ${htmlPath}`);
const html = fs.readFileSync(htmlPath, 'utf8');
function sliceBetween(startMarker, endMarker, label) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end <= start) throw new Error(`Could not isolate ${label} from direct HTML source.`);
  return html.slice(start, end);
}
const interpreterSource = sliceBetween(
  "function naraInterpretUserQuery(question,localDraft=''){",
  "function naraOnlineLearningContext(question,localDraft=''){",
  'Nara query interpreter'
);
const contextSource = sliceBetween(
  "function naraOnlineLearningContext(question,localDraft=''){",
  'async function naraRequestOnlineAnswer(',
  'Nara online context builder'
);

const fixturePlants = [
  {
    id: 'plant-radish', name: 'Lobak Putih', variety: 'Putih', date: '2026-09-21', qty: 1, note: 'Fixture sintetis.',
    plantingGroups: [{id:'group-radish-2026-09-21',date:'2026-09-21',totalQty:1,qty:1,activeQty:0,completedQty:0,failedQty:1,locations:['Bed Rempah'],createdAt:'2026-09-21T07:00:00.000Z'}],
    events: [{id:'event-radish-complete',date:'2026-10-08',type:'group-cycle-complete',label:'Kelompok tanam menyelesaikan siklus',note:'1 tanaman gagal',groupId:'group-radish-2026-09-21',createdAt:'2026-10-08T08:00:00.000Z'}]
  },
  {
    id: 'plant-tomato', name: 'Tomat Roma', variety: 'Roma', date: '2026-09-20', qty: 3, note: 'Fixture sintetis.',
    plantingGroups: [{id:'group-tomato-mixed-active',date:'2026-09-20',totalQty:3,qty:3,activeQty:2,completedQty:0,failedQty:1,statusUpdatedOn:'2026-10-11',locations:['Bed Veggie'],createdAt:'2026-09-20T07:00:00.000Z'}],
    events: []
  },
  {
    id: 'plant-spinach', name: 'Bayam Hijau', variety: '', date: '2026-09-18', qty: 3, note: 'Fixture sintetis.',
    plantingGroups: [{id:'group-spinach-mixed-closed',date:'2026-09-18',totalQty:3,qty:3,activeQty:0,completedQty:1,failedQty:2,locations:['Bed Veggie'],createdAt:'2026-09-18T07:00:00.000Z'}],
    events: [{id:'event-spinach-complete',date:'2026-10-10',type:'group-cycle-complete',label:'Kelompok tanam menyelesaikan siklus',note:'3 tanaman · 1 selesai · 2 gagal',groupId:'group-spinach-mixed-closed',createdAt:'2026-10-10T08:00:00.000Z'}]
  },
  {
    id: 'plant-eggplant', name: 'Terung Bulat Hijau Bergaris Putih', variety: 'Bergaris Putih', date: '2026-09-24', qty: 2, note: 'Fixture sintetis.',
    plantingGroups: [{id:'group-eggplant-active',date:'2026-09-24',totalQty:2,qty:2,activeQty:2,completedQty:0,failedQty:0,locations:['Bed Spiral'],createdAt:'2026-09-24T07:00:00.000Z'}],
    events: []
  }
];
const normalize = value => String(value || '').toLocaleLowerCase('id-ID').normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
const cropAliases = [
  ['lobak',['lobak','lobak putih']], ['terung',['terung','terong']], ['tomat',['tomat']],
  ['bayam',['bayam']], ['cabai',['cabai','cabe']], ['timun',['timun','mentimun']], ['kunyit',['kunyit']],
  ['labu',['labu']]
];
function explicitCrops(value) {
  const terms = new Set(normalize(value));
  return cropAliases.filter(([, names]) => names.some(n => normalize(n).some(t => terms.has(t)))).map(([n]) => n);
}
function mentionedPlants(value) {
  const terms = new Set(normalize(value));
  return fixturePlants.filter(p => normalize(`${p.name} ${p.variety || ''}`).some(t => t.length >= 4 && terms.has(t)));
}
function total(g) { return Math.max(1, Number(g?.totalQty ?? g?.qty ?? 1)); }
function completed(g) { return Math.max(0, Math.min(total(g), Number(g?.completedQty || 0))); }
function failed(g) { return Math.max(0, Math.min(total(g), Number(g?.failedQty || 0))); }
function active(g) { return Math.max(0, total(g) - completed(g) - failed(g)); }
function derivedStatus(g) { const t=total(g),a=active(g),c=completed(g),f=failed(g); if(a>0)return 'active'; if(c===t)return 'completed'; if(f===t)return 'failed'; return 'mixed'; }
function groupLocations(g) { return Array.isArray(g?.locations) ? g.locations : []; }
function activeGroups(p) { return (Array.isArray(p?.plantingGroups)?p.plantingGroups:[]).filter(g=>active(g)>0); }
const fixtureState = {messages:[], userLessons:[], teacherValidatedLessons:[], lessons:[]};
const fixtureNotes = [];
const fixtureEvents = [];
const fixtureHarvests = [];
const fixtureAttentions = [];
const fixtureBeds = [{id:'bed-rempah',name:'Bed Rempah'},{id:'bed-veggie',name:'Bed Veggie'},{id:'bed-spiral',name:'Bed Spiral'}];
const fixtureInhabitants = [];
const sandbox = {
  console, data: fixturePlants, naraState: fixtureState, attentions: fixtureAttentions, gardenEvents: fixtureEvents,
  harvests: fixtureHarvests, beds: fixtureBeds, inhabitants: fixtureInhabitants, gardenNotes: fixtureNotes,
  growthIndicators: [],
  naraMemoryTokens: normalize,
  naraPlantEntriesMentionedInText: mentionedPlants,
  naraExplicitCropTerms: explicitCrops,
  naraIsSimpleGreeting: q => /^(hai|halo|selamat pagi|selamat malam)[!. ]*$/i.test(String(q||'').trim()),
  naraIsCorrectionTurn: q => /bukan itu|salah|bukan maksud saya|saya tidak bilang/i.test(String(q||'')),
  naraIsGreetingCorrection: q => /saya cuma menyapa|hanya menyapa|cuma menyapa/i.test(String(q||'')),
  naraHasPlantTopic: q => mentionedPlants(q).length > 0 || explicitCrops(q).length > 0,
  naraScopeRecentHistory: (_q, history) => Array.isArray(history) ? history.slice(-8) : [],
  naraGardenSnapshot: () => ({plants:fixturePlants.length,active:fixturePlants.filter(p=>activeGroups(p).length).length,beds:fixtureBeds.length,inhabitants:0,harvests:0,gardenNotes:0,events:fixturePlants.reduce((n,p)=>n+p.events.length,0),waterDue:[],attention:[],flowering:[],upcoming:[],lessons:0}),
  naraActiveGroups: activeGroups, groupActiveQty: active, groupTotal: total, groupCompletedQty: completed, groupFailedQty: failed, groupDerivedStatus: derivedStatus, groupLocations,
  naraPlantEvents: p => (Array.isArray(p?.events)?p.events:[]).slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))),
  inhabitantNames: () => [], inhabitantDerivedEvents: () => [], naraWeatherSnapshot: () => null,
  naraGetTaughtKnowledge: () => [], naraLessonContextText: (lesson,max=900) => String(lesson?.text||'').slice(0,max),
  naraAnswer: () => '', naraGuruSafe: (value,max=500) => String(value ?? '').slice(0,max),
};
vm.createContext(sandbox);
// Execute the real status/quantity helpers from the HTML, instead of trusting test doubles.
const groupHelpersSource = sliceBetween('function groupTotal(g){', 'function bedNames(){', 'group total/status helpers');
vm.runInContext(groupHelpersSource, sandbox, {timeout:1000});
vm.runInContext(interpreterSource + '\n' + contextSource, sandbox, {timeout:3000});

const failures = [];
const results = [];
function check(id, title, fn) {
  try { const info=fn(); results.push({id,title,pass:true,info:info||''}); }
  catch(e) { failures.push(`${id}: ${e.message}`); results.push({id,title,pass:false,info:String(e.message||e)}); }
}
function getContext(question) { const plan=sandbox.naraInterpretUserQuery(question,''); const payload=JSON.parse(sandbox.naraOnlineLearningContext(question,'')); return {plan,payload}; }
const failureQuestion = 'Nara, tanaman apa saja yang sudah gagal di kebun saya? Sebutkan nama tanaman, tanggal tanam, jumlah yang gagal, dan tanggal status gagal dicatat. Gunakan Riwayat Kelompok Tanam sebagai bukti.';

check('QD-01','Pertanyaan kegagalan ditafsirkan sebagai pencarian status kelompok',()=>{
  const {plan}=getContext(failureQuestion);
  if(plan.maksud!=='status_kelompok_tanam') throw new Error(`maksud=${plan.maksud}`);
  if(plan.filter_status_kelompok!=='gagal') throw new Error(`filter=${plan.filter_status_kelompok}`);
  if(plan.mode_filter_status_kelompok!=='jumlah_tanaman') throw new Error(`mode=${plan.mode_filter_status_kelompok}`);
  if(plan.tahan_sumber_kebun_tidak_relevan) throw new Error('sumber kebun pribadi ditahan secara keliru');
  return 'intent kegagalan tanaman diarahkan ke filter jumlah_gagal > 0';
});
check('QD-02','Semua tanaman dengan jumlah gagal positif ditemukan',()=>{
  const {payload}=getContext(failureQuestion);
  const names=payload.tanaman_relevan.map(p=>p.nama);
  for(const n of ['Lobak Putih','Tomat Roma','Bayam Hijau']) if(!names.includes(n)) throw new Error(`tanaman ${n} tidak ditemukan; hasil=${names.join(', ')}`);
  if(names.includes('Terung Bulat Hijau Bergaris Putih')) throw new Error('tanaman tanpa kelompok gagal ikut disertakan');
  return names.join(', ');
});
check('QD-03','ID kelompok, tanggal tanam, dan jumlah gagal dikirim',()=>{
  const {payload}=getContext(failureQuestion);
  const flattened=payload.tanaman_relevan.flatMap(p=>p.kelompok_tanam.map(g=>({plant:p.nama,...g})));
  const r=flattened.find(g=>g.id_kelompok==='group-radish-2026-09-21');
  if(!r) throw new Error('ID kelompok Lobak tidak ada dalam payload');
  if(r.tanggal!=='2026-09-21'||r.jumlah_awal!==1||r.jumlah_gagal!==1) throw new Error(JSON.stringify(r));
  return `${r.plant}; tanggal ${r.tanggal}; gagal ${r.jumlah_gagal}/${r.jumlah_awal}`;
});
check('QD-04','Tanggal status eksplisit dan tanggal penutupan dibedakan',()=>{
  const {payload}=getContext(failureQuestion);
  const all=payload.tanaman_relevan.flatMap(p=>p.kelompok_tanam.map(g=>({plant:p.nama,...g})));
  const radish=all.find(g=>g.id_kelompok==='group-radish-2026-09-21');
  const tomato=all.find(g=>g.id_kelompok==='group-tomato-mixed-active');
  if(radish.tanggal_status_dicatat!==null) throw new Error('tanggal status Lobak lama diasumsikan padahal tidak tersimpan');
  if(radish.tanggal_penutupan_kelompok!=='2026-10-08') throw new Error('tanggal event penutupan Lobak hilang');
  if(tomato.tanggal_status_dicatat!=='2026-10-11') throw new Error('tanggal status eksplisit Tomat hilang');
  if(!String(tomato.makna_tanggal_status_dicatat||'').includes('bukan otomatis tanggal pertama')) throw new Error('makna tanggal status terakhir tidak diterangkan');
  return 'tanggal status dan penutupan terpisah; tanggal status terakhir tidak disamakan dengan tanggal kegagalan pertama';
});
check('QD-05','Cakupan pencarian dan definisi jumlah gagal dinyatakan',()=>{
  const {payload}=getContext(failureQuestion);
  const c=payload.ringkasan_pencarian_kelompok_tanam;
  if(!c||c.kelompok_diperiksa!==4||c.kelompok_cocok!==3||c.filter_status!=='gagal') throw new Error(JSON.stringify(c));
  if(c.mode_filter_status!=='jumlah_tanaman') throw new Error(`mode=${c.mode_filter_status}`);
  if(!payload.aturan_status_kelompok_tanam||!payload.aturan_status_kelompok_tanam.includes('mixed tidak berarti aktif+gagal')) throw new Error('definisi status kanonis tidak dikirim');
  if(payload.draft_reasoning_lokal!=='') throw new Error('draft lokal lama yang tidak terverifikasi belum disisihkan');
  return `${c.kelompok_cocok}/${c.kelompok_diperiksa} kelompok cocok; mode filter dan aturan kanonis ada`;
});
check('QD-06','Status kelompok campuran dapat dicari tepat',()=>{
  const {plan,payload}=getContext('Sebutkan kelompok tanam yang berstatus campuran.');
  if(plan.maksud!=='status_kelompok_tanam'||plan.filter_status_kelompok!=='campuran'||plan.mode_filter_status_kelompok!=='status_kelompok') throw new Error(`plan=${plan.maksud}/${plan.filter_status_kelompok}/${plan.mode_filter_status_kelompok}`);
  const all=payload.tanaman_relevan.flatMap(p=>p.kelompok_tanam.map(g=>({plant:p.nama,...g})));
  if(all.length!==1||all[0].id_kelompok!=='group-spinach-mixed-closed'||all[0].status!=='mixed') throw new Error(`hasil=${all.map(g=>g.id_kelompok+':'+g.status).join(',')}`);
  return 'hanya group-spinach-mixed-closed yang cocok dengan status mixed';
});
check('QD-07','Tanaman bernama tetap diperiksa menurut jumlah gagal',()=>{
  const {plan,payload}=getContext('Apakah kelompok Tomat Roma punya tanaman gagal?');
  if(plan.maksud!=='status_kelompok_tanam'||plan.filter_status_kelompok!=='gagal'||plan.mode_filter_status_kelompok!=='jumlah_tanaman') throw new Error(`intent/filter/mode=${plan.maksud}/${plan.filter_status_kelompok}/${plan.mode_filter_status_kelompok}`);
  const tomato=payload.tanaman_relevan.find(p=>p.nama==='Tomat Roma');
  if(!tomato||!tomato.kelompok_tanam.some(g=>g.jumlah_gagal===1&&g.status==='active')) throw new Error('kelompok Tomat aktif dengan 1 gagal tidak dikirim dengan status yang benar');
  return 'kelompok Tomat tetap active walau memiliki 1 tanaman gagal';
});
check('QD-08','Pertanyaan status tanaman yang disebut langsung mengambil riwayat',()=>{
  const {plan,payload}=getContext('Apakah Lobak Putih sudah gagal?');
  if(plan.maksud!=='status_kelompok_tanam'||plan.filter_status_kelompok!=='gagal'||plan.mode_filter_status_kelompok!=='jumlah_tanaman') throw new Error(`intent/filter/mode=${plan.maksud}/${plan.filter_status_kelompok}/${plan.mode_filter_status_kelompok}`);
  const radish=payload.tanaman_relevan.find(p=>p.nama==='Lobak Putih');
  if(!radish||!radish.kelompok_tanam.some(g=>g.id_kelompok==='group-radish-2026-09-21')) throw new Error('riwayat gagal Lobak tidak dikirim');
  return 'riwayat kelompok gagal diambil walau pertanyaan hanya menyebut tanaman';
});
check('QD-09','Pencarian status tanpa hasil tidak mengarang rekaman',()=>{
  const original=sandbox.data;
  try {
    sandbox.data=original.filter(p=>p.name==='Terung Bulat Hijau Bergaris Putih');
    const plan=sandbox.naraInterpretUserQuery('Tanaman apa saja yang sudah gagal di kebun saya?','');
    const payload=JSON.parse(sandbox.naraOnlineLearningContext('Tanaman apa saja yang sudah gagal di kebun saya?',''));
    if(plan.maksud!=='status_kelompok_tanam') throw new Error(`maksud=${plan.maksud}`);
    if(payload.tanaman_relevan.length!==0) throw new Error('rekaman tanpa kelompok gagal disajikan sebagai hasil');
    if(payload.ringkasan_pencarian_kelompok_tanam.kelompok_cocok!==0) throw new Error('cakupan tidak menyebut nol hasil');
    return '0 kecocokan dari rekaman fixture yang diperiksa';
  } finally { sandbox.data=original; }
});
check('QD-10','Payload besar membatasi bukti tanpa menyembunyikan jumlah yang terlewat',()=>{
  const previous=sandbox.data;
  const manyGroups=Array.from({length:60},(_,i)=>({id:`group-lobak-${i+1}`,date:`2026-08-${String((i%28)+1).padStart(2,'0')}`,totalQty:2,qty:2,activeQty:0,completedQty:0,failedQty:2,locations:['Bed Rempah'],createdAt:'2026-08-01T07:00:00.000Z'}));
  sandbox.data=[{id:'plant-many-failures',name:'Lobak Putih',variety:'Putih',date:'2026-08-01',qty:120,plantingGroups:manyGroups,events:[]}];
  try {
    const payload=JSON.parse(sandbox.naraOnlineLearningContext('Tanaman apa saja yang sudah gagal di kebun saya?','draft lokal yang keliru'));
    const c=payload.ringkasan_pencarian_kelompok_tanam;
    if(c.kelompok_cocok!==60) throw new Error(`jumlah cocok=${c.kelompok_cocok}`);
    if(c.kelompok_dikirim>=c.kelompok_cocok||c.kelompok_tidak_dikirim<=0) throw new Error(`cakupan tidak menunjukkan pemotongan: ${JSON.stringify(c)}`);
    if(JSON.stringify(payload).length>12500) throw new Error(`payload masih terlalu panjang: ${JSON.stringify(payload).length}`);
    if(!payload.aturan_status_kelompok_tanam.includes('belum lengkap')) throw new Error('aturan tidak memerintahkan pelaporan cakupan parsial');
    return `${c.kelompok_dikirim} dari ${c.kelompok_cocok} kelompok dikirim; ${c.kelompok_tidak_dikirim} dinyatakan terlewat`;
  } finally { sandbox.data=previous; }
});
check('QD-11','Tanggal status disimpan saat jumlah selesai/gagal berubah',()=>{
  if(!html.includes("next.statusUpdatedOn=today();next.statusUpdatedAt=new Date().toISOString();")) throw new Error('penyimpanan tanggal perubahan status tidak ditemukan');
  return 'bidang tanggal pembaruan ada; diperlakukan sebagai pembaruan terakhir, bukan tanggal kegagalan pertama';
});
check('QD-12','Payload mempertahankan guard sumber, provenance, dan audit',()=>{
  const markers=['pedoman_sumber_dan_kasus','naraLastRetrievalAudit','function naraAuditAnswerPlantScope','answerAudit','function naraLessonContextText','function naraRequestOnlineAnswer','aturan_status_kelompok_tanam','ringkasan_pencarian_kelompok_tanam'];
  const missing=markers.filter(m=>!html.includes(m));
  if(missing.length) throw new Error('marker hilang: '+missing.join(', '));
  return 'marker inti provenance/retrieval masih ada';
});
check('QD-13','Pencarian status akhir failed tidak mengambil kelompok active yang punya tanaman gagal',()=>{
  const {plan,payload}=getContext('Tampilkan kelompok tanam yang berstatus failed.');
  if(plan.maksud!=='status_kelompok_tanam'||plan.filter_status_kelompok!=='gagal'||plan.mode_filter_status_kelompok!=='status_kelompok') throw new Error(`plan=${plan.maksud}/${plan.filter_status_kelompok}/${plan.mode_filter_status_kelompok}`);
  const all=payload.tanaman_relevan.flatMap(p=>p.kelompok_tanam.map(g=>({plant:p.nama,...g})));
  if(all.length!==1||all[0].id_kelompok!=='group-radish-2026-09-21'||all[0].status!=='failed') throw new Error(`hasil tidak ketat: ${all.map(g=>g.id_kelompok+':'+g.status).join(',')}`);
  return 'filter status akhir hanya memilih kelompok dengan status derived failed';
});
check('QD-14','Status derived mengikuti rumus aplikasi',()=>{
  const {payload}=getContext(failureQuestion);
  const groups=payload.tanaman_relevan.flatMap(p=>p.kelompok_tanam.map(g=>({plant:p.nama,...g})));
  const tomato=groups.find(g=>g.id_kelompok==='group-tomato-mixed-active');
  const spinach=groups.find(g=>g.id_kelompok==='group-spinach-mixed-closed');
  if(!tomato||tomato.status!=='active'||tomato.jumlah_aktif!==2||tomato.jumlah_gagal!==1) throw new Error('status active pada grup aktif+gagal keliru');
  if(!spinach||spinach.status!=='mixed'||spinach.jumlah_aktif!==0||spinach.jumlah_selesai!==1||spinach.jumlah_gagal!==2) throw new Error('status mixed pada grup selesai+gagal tanpa tanaman aktif keliru');
  if(groups.some(g=>g.jumlah_kategori_sama_dengan_awal!==true)) throw new Error('jumlah aktif+selesai+gagal tidak sama dengan jumlah awal');
  return 'active dan mixed mengikuti definisi app; total kategori konsisten';
});

console.log('NARA DATA UNDERSTANDING — DIRECT HTML SOURCE TEST');
console.log(`HTML: ${htmlPath}`);
console.log('Data kebun yang digunakan: hanya fixture sintetis. Data pribadi tidak dibaca atau diubah.');
for(const r of results) console.log(`${r.pass?'PASS':'FAIL'} ${r.id} — ${r.title}${r.info?`: ${r.info}`:''}`);
console.log(`RESULT: ${results.filter(r=>r.pass).length}/${results.length} checks passed`);
if(failures.length) { console.error(failures.join('\n')); process.exitCode=1; }
