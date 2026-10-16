#!/usr/bin/env node
'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const htmlPath = 'android/app/src/main/assets/index.html';
const html = fs.readFileSync(htmlPath, 'utf8');
const start = html.indexOf("function naraInterpretUserQuery(question,localDraft=''){");
const end = html.indexOf("function naraOnlineLearningContext(question,localDraft=''){", start);
if (start < 0 || end <= start) throw new Error('Could not isolate Nara query interpreter from the generated HTML.');
const interpreter = html.slice(start, end);
const plantHelpersStart = html.indexOf('function naraExplicitCropTerms(value){');
const plantHelpersEnd = html.indexOf('\nfunction naraScopeRecentHistory(question,history){', plantHelpersStart);
if (plantHelpersStart < 0 || plantHelpersEnd <= plantHelpersStart) throw new Error('Could not isolate production plant-matching helpers.');
const plantHelpers = html.slice(plantHelpersStart, plantHelpersEnd);
const correctionHelpersStart = html.indexOf('function naraIsSimpleGreeting(question){');
const correctionHelpersEnd = html.indexOf('\nfunction naraAnswer(question)', correctionHelpersStart);
if (correctionHelpersStart < 0 || correctionHelpersEnd <= correctionHelpersStart) throw new Error('Could not isolate production correction helpers.');
const correctionHelpers = html.slice(correctionHelpersStart, correctionHelpersEnd);
const auditHelpersStart = html.indexOf('function naraAuditAnswerPlantScope(question,answer){');
const auditHelpersEnd = html.indexOf('\nfunction naraClipEvidenceText', auditHelpersStart);
if (auditHelpersStart < 0 || auditHelpersEnd <= auditHelpersStart) throw new Error('Could not isolate the production answer-scope audit function.');
const auditHelpers = html.slice(auditHelpersStart, auditHelpersEnd);
const data = [
  {id:'eggplant-1', name:'Terung Bulat Hijau Bergaris Putih'},
  {id:'tomato-1', name:'Tomat Roma'},
  {id:'pumpkin-1', name:'Labu Madu'},
  {id:'onion-red', name:'Bawang Merah'},
  {id:'onion-leaf', name:'Bawang Daun'},
  {id:'garlic-1', name:'Bawang Putih'},
  {id:'radish-1', name:'Lobak Putih'}
];
const normalize = value => String(value || '').toLocaleLowerCase('id-ID').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
function entries(text) {
  const words = new Set(normalize(text));
  return data.filter(p => normalize(p.name).some(w => w.length >= 4 && words.has(w)));
}
function cropTerms(value) {
  const words = new Set(normalize(value));
  const aliases = [
    ['terung',['terung','terong']], ['tomat',['tomat']], ['labu',['labu']],
    ['cabai',['cabai','cabe']], ['timun',['timun','mentimun']], ['kunyit',['kunyit']]
  ];
  return aliases.filter(([,as]) => as.some(a => words.has(a))).map(([name]) => name);
}
function makeContext(messages=[]) {
  const context = {
    naraState: {messages, userLessons:[], teacherLessons:[], lessons:[], onlineTeacherLessons:[]},
    data,
    attentions:[], gardenEvents:[], harvests:[], beds:[], inhabitants:[], gardenNotes:[],
    naraGardenSnapshot: () => ({plants:data.length,active:0,beds:0,inhabitants:0,harvests:0,gardenNotes:0,events:0,waterDue:[],attention:[],upcoming:[]}),
    naraActiveGroups: () => [], groupActiveQty: () => 0, groupLocations: () => [], naraPlantEvents: () => [],
    inhabitantNames: () => [], inhabitantDerivedEvents: () => [], naraWeatherSnapshot: () => null,
    naraGetTaughtKnowledge: () => [], naraAnswer: () => '', naraGuruSafe: (v,n=500) => String(v||'').slice(0,n),
    naraMemoryTokens: normalize,
    naraScopeRecentHistory: (q, messages=[]) => Array.isArray(messages) ? messages.slice(-8) : [],
    naraLessonContextText: (lesson,max=900) => String(lesson && lesson.text || '').slice(0,max),

  };
  vm.createContext(context);
  vm.runInContext(interpreter + '\n' + plantHelpers + '\n' + correctionHelpers + '\n' + auditHelpers, context, {timeout:1000});
  return context;
}

// 1. Informal spelling should still identify a symptom-diagnosis question and its plant.
let cx = makeContext([]);
let plan = cx.naraInterpretUserQuery('knp buah terung sy menguning?');
assert.strictEqual(plan.maksud, 'diagnosis_tanaman');
assert(plan.fokus.some(x => /terung/i.test(x.name)), 'Must resolve the specifically named garden plant.');
assert(plan.sumber_yang_diperlukan.some(x => /rekaman tanaman/i.test(x)), 'Diagnosis must request plant records as evidence.');
assert.strictEqual(plan.tahan_sumber_kebun_tidak_relevan, false, 'A specifically named recorded plant should retain relevant garden data.');

// 2. A shorthand question about yesterday's watering must route to activity history.
cx = makeContext([]);
plan = cx.naraInterpretUserQuery('kemarin sy siram nggak?');
assert.strictEqual(plan.maksud, 'riwayat_penyiraman');
assert(plan.sumber_yang_diperlukan.some(x => /aktivitas kebun/i.test(x)));
assert.strictEqual(plan.tahan_sumber_kebun_tidak_relevan, false, 'A watering-history query should retain garden activity sources.');

// 3. Explicit user-teaching/memory question should route to user memory and relevant lessons.
cx = makeContext([]);
plan = cx.naraInterpretUserQuery('apa aturan yg pernah saya ajarkan?');
assert.strictEqual(plan.maksud, 'memori_pengguna_atau_pelajaran');
assert(plan.sumber_yang_diperlukan.some(x => /memori eksplisit pengguna/i.test(x)));
assert.strictEqual(plan.tahan_sumber_kebun_tidak_relevan, true, 'A memory question should not carry unrelated garden records.');

// 4. One unambiguous recent plant reference can resolve a short follow-up.
cx = makeContext([{role:'user', text:'Buah terung saya mulai menguning.'}]);
plan = cx.naraInterpretUserQuery('bagaimana dengan yang tadi?');
assert.strictEqual(plan.rujukan_perlu_diperjelas, false);
assert(/Terung/i.test(plan.rujukan_terselesaikan || ''), 'Should resolve the unique preceding plant reference.');
assert(/Terung/i.test(plan.routingQuestion), 'Resolved plant should be available to source routing.');

// 5. Competing recent plant references must not be guessed.
cx = makeContext([
  {role:'user', text:'Tomat Roma baru mulai berbunga.'},
  {role:'assistant', text:'Kita juga mencatat Terung Bulat Hijau Bergaris Putih.'}
]);
plan = cx.naraInterpretUserQuery('bagaimana dengan yang satunya?');
assert.strictEqual(plan.rujukan_perlu_diperjelas, true);
assert.strictEqual(plan.keyakinan_pemahaman, 'belum cukup');
assert.strictEqual(plan.tahan_sumber_kebun_tidak_relevan, true, 'Ambiguous follow-ups must suppress personal source records.');
assert(plan.alasan_klarifikasi, 'Ambiguous referent needs a reason.');

// 6. A clearly named crop without a matching garden record remains a valid general-knowledge question.
cx = makeContext([]);
plan = cx.naraInterpretUserQuery('kenapa daun kunyit menguning?');
assert.strictEqual(plan.maksud, 'diagnosis_tanaman');
assert(plan.fokus.some(x => x.name === 'kunyit' && x.kind === 'spesies_disebut_pengguna'));
assert.strictEqual(plan.rujukan_perlu_diperjelas, false);
assert.strictEqual(plan.tahan_sumber_kebun_tidak_relevan, true, 'General knowledge about an unrecorded crop must not pull unrelated garden facts.');

console.log('PASS: informal Indonesian and spelling normalization');
console.log('PASS: symptom query intent and plant focus');
cx = makeContext([]);
plan = cx.naraInterpretUserQuery('apa kondisi kebun hari ini?');
assert.strictEqual(plan.maksud, 'ringkasan_kebun');
assert.strictEqual(plan.tahan_sumber_kebun_tidak_relevan, false, 'A garden overview must retain structured garden data.');
console.log('PASS: garden-overview queries preserve personal sources');
// General-knowledge wording must not pull a similarly named plant's private garden record.
data.push({id:'turmeric-1', name:'Kunyit di Bed Rempah'});
cx = makeContext([]);
plan = cx.naraInterpretUserQuery('apa manfaat kunyit untuk kesehatan?');
assert.strictEqual(plan.maksud, 'pengetahuan_umum');
assert.strictEqual(plan.tahan_sumber_kebun_tidak_relevan, true, 'General-knowledge questions must suppress unrelated personal garden facts even when that crop is recorded.');
data.pop();
console.log('PASS: general-knowledge intent suppresses incidental plant records');
cx = makeContext([]);
plan = cx.naraInterpretUserQuery('apa perbedaan tomat dan terung?');
assert.strictEqual(plan.maksud, 'pengetahuan_umum');
assert.strictEqual(plan.tahan_sumber_kebun_tidak_relevan, true, 'General comparisons must not silently use individual plant records.');
cx = makeContext([]);
plan = cx.naraInterpretUserQuery('bagaimana cuaca sekarang?');
assert.strictEqual(plan.maksud, 'cuaca_dan_lingkungan');
assert.strictEqual(plan.tahan_sumber_kebun_tidak_relevan, true, 'Current weather alone should not include unrelated garden records.');
cx = makeContext([]);
plan = cx.naraInterpretUserQuery('apa catatan hujan kemarin?');
assert.strictEqual(plan.maksud, 'riwayat_aktivitas');
assert.strictEqual(plan.tahan_sumber_kebun_tidak_relevan, false, 'Stored rain history should route to the garden log.');
cx = makeContext([]);
plan = cx.naraInterpretUserQuery('ingat kapan saya menyiram terung?');
assert.strictEqual(plan.maksud, 'riwayat_penyiraman', 'The word ingat alone must not override the requested garden-history source.');
cx = makeContext([]);
plan = cx.naraInterpretUserQuery('apa saja tanaman yang saya tanam?');
assert.strictEqual(plan.maksud, 'inventaris_tanaman');
assert.strictEqual(plan.tahan_sumber_kebun_tidak_relevan, false);
console.log('PASS: plant-inventory questions route to structured garden records');
console.log('PASS: watering-history source routing');
console.log('PASS: explicit user-memory source routing');
console.log('PASS: unique conversational reference resolution');
console.log('PASS: ambiguous reference fails closed');
cx = makeContext([
  {role:'user', text:'Tomat Roma baru mulai berbunga.'},
  {role:'assistant', text:'Kita juga mencatat Terung Bulat Hijau Bergaris Putih.'}
]);
plan = cx.naraInterpretUserQuery('bagaimana cuaca sekarang?');
assert.strictEqual(plan.maksud, 'cuaca_dan_lingkungan');
assert.strictEqual(plan.rujukan_perlu_diperjelas, false, 'A time word by itself must not resolve a plant reference.');
assert.strictEqual(plan.rujukan_terselesaikan, null);
console.log('PASS: generic current-time questions do not inherit unrelated plant references');
console.log('PASS: named unrecorded species remains answerable from general knowledge');

// A personal diagnosis without a clear plant must ask instead of selecting a random record.
cx = makeContext([]);
plan = cx.naraInterpretUserQuery('kenapa tanaman saya menguning?');
assert.strictEqual(plan.rujukan_perlu_diperjelas, true);
assert.strictEqual(plan.tahan_sumber_kebun_tidak_relevan, true);
console.log('PASS: unidentified personal plant questions request clarification');

// 7. Verify the interpretation is applied to the actual context payload, not merely computed.
const builderStart = html.indexOf("function naraOnlineLearningContext(question,localDraft=''){");
const builderEnd = html.indexOf('\nasync function naraRequestOnlineAnswer(', builderStart);
if (builderStart < 0 || builderEnd <= builderStart) throw new Error('Could not isolate the online context builder.');
const builderSource = html.slice(builderStart, builderEnd);
const routeContext = makeContext([]);
vm.runInContext(builderSource, routeContext, {timeout:1000});
let builtPayload = JSON.parse(routeContext.naraOnlineLearningContext('kenapa daun kunyit menguning?', 'draft lokal yang tidak relevan'));
assert.strictEqual(builtPayload.ringkasan_kebun, null, 'Unrecorded general-knowledge questions must not receive a garden summary.');
assert.deepStrictEqual(Array.from(builtPayload.tanaman_relevan), []);
assert.strictEqual(builtPayload.draft_reasoning_lokal, '', 'Irrelevant local drafts must be suppressed.');
builtPayload = JSON.parse(routeContext.naraOnlineLearningContext('apa perbedaan tomat dan terung?', 'draft lokal tak terkait'));
assert.strictEqual(builtPayload.ringkasan_kebun, null, 'A general crop comparison must not receive unrelated personal records.');
assert.deepStrictEqual(Array.from(builtPayload.tanaman_relevan), []);
routeContext.lastRetrievalQuery = '';
routeContext.naraGetTaughtKnowledge = q => { routeContext.lastRetrievalQuery = q; return []; };
routeContext.naraOnlineLearningContext('kemarin sy siram nggak?', '');
assert(routeContext.lastRetrievalQuery.includes('aktivitas kebun'), 'Intent routing keywords must participate in memory retrieval.');
assert(routeContext.lastRetrievalQuery.includes('kemarin saya siram'), 'Normalized wording must participate in memory retrieval.');
routeContext.data.push({id:'turmeric-1', name:'Kunyit di Bed Rempah'});
builtPayload = JSON.parse(routeContext.naraOnlineLearningContext('apa manfaat kunyit untuk kesehatan?', 'draft lokal tak terkait'));
assert.strictEqual(builtPayload.ringkasan_kebun, null, 'General-knowledge intent must suppress garden records even when the species exists in Terra Serenada.');
assert.deepStrictEqual(Array.from(builtPayload.tanaman_relevan), []);
routeContext.data.pop();
builtPayload = JSON.parse(routeContext.naraOnlineLearningContext('apa kondisi kebun hari ini?', ''));
assert.notStrictEqual(builtPayload.ringkasan_kebun, null, 'A garden overview must retain personal garden data.');
const ambiguousContext = makeContext([
  {role:'user', text:'Tomat Roma baru mulai berbunga.'},
  {role:'assistant', text:'Kita juga mencatat Terung Bulat Hijau Bergaris Putih.'}
]);
vm.runInContext(builderSource, ambiguousContext, {timeout:1000});
builtPayload = JSON.parse(ambiguousContext.naraOnlineLearningContext('bagaimana dengan yang satunya?', 'draft lokal'));
assert.strictEqual(builtPayload.ringkasan_kebun, null);
assert.strictEqual(builtPayload.konteks_dibatasi.includes('Rujukan belum jelas'), true);
console.log('PASS: query interpretation controls the actual outgoing context payload');

// 8. Explicit user-taught-memory questions prefer the user's store over equally matching Guru material.
const retrievalStart = html.indexOf('function naraGetTaughtKnowledge(q){');
const retrievalEnd = html.indexOf('\nfunction naraLessonContextText', retrievalStart);
if (retrievalStart < 0 || retrievalEnd <= retrievalStart) throw new Error('Could not isolate the memory-retrieval function.');
const retrievalSource = html.slice(retrievalStart, retrievalEnd);
const rx = makeContext([]);
rx.naraNormalizeState = () => {};
rx.naraState = {
  messages: [],
  userLessons: [{id:'user-rule', title:'Aturan kebun', topic:'Penyiraman', text:'Aturan penyiraman yang pernah saya ajarkan: periksa kelembapan sebelum menyiram.', createdAt:'2026-10-01', origin:'Pengguna', learningType:'user_taught'}],
  teacherLessons: [],
  teacherValidatedLessons: [{id:'guru-rule', title:'Aturan tentang penyiraman', topic:'Penyiraman', summary:'Prinsip umum penyiraman', text:'Aturan umum penyiraman: sesuaikan air dengan kebutuhan tanaman.', createdAt:'2026-10-13', origin:'Guru AI Online (lolos uji otomatis)', learningType:'validated_model_language'}],
  teacherCandidateLessons: []
};
vm.runInContext(retrievalSource, rx, {timeout:1000});
const memoryHits = rx.naraGetTaughtKnowledge('apa aturan yang pernah saya ajarkan tentang penyiraman');
assert(memoryHits.length >= 2, 'Test should return both the user and Guru lesson candidates.');
assert.strictEqual(memoryHits[0].__memoryKind, 'user_taught', 'Explicit user-taught questions must prioritize user memory.');
console.log('PASS: explicit user-taught memory outranks Guru lesson candidates');

// 9. Production correction phrasings must route to correction before harvesting rules.
const correctionCases = [
  'Koreksi jawabanmu. Estimasi panen kelompok pertama pada aplikasi adalah 18 Desember 2026.',
  'Salah, jawabanmu sebelumnya tidak sesuai dengan rekaman Bawang Putih.',
  'Jawabanmu salah. Periksa kembali sumbernya.',
  'Audit ulang jawabanmu',
  'Audit ulang jawabanmu dengan membandingkannya terhadap jawaban sebelumnya dan rekaman Terra Serenada.',
  'Periksa kembali sumber data dan jawaban sebelumnya.'
];
cx = makeContext([]);
for (const q of correctionCases) {
  assert.strictEqual(cx.naraIsCorrectionTurn(q), true, 'Production correction detector must recognize: ' + q);
  plan = cx.naraInterpretUserQuery(q);
  assert.strictEqual(plan.maksud, 'koreksi_jawaban', 'Correction must outrank embedded harvest keywords: ' + q);
}
console.log('PASS: production correction detector recognizes the agreed correction phrasings');
for (const [q, expected] of [
  ['Kapan perkiraan panen Bawang Putih?', 'panen'],
  ['Kenapa buah terung menguning?', 'diagnosis_tanaman'],
  ['Apa saja tanaman yang saya tanam?', 'inventaris_tanaman']
]) {
  assert.strictEqual(cx.naraIsCorrectionTurn(q), false, 'Ordinary requests must not be mistaken for corrections: ' + q);
  plan = cx.naraInterpretUserQuery(q);
  assert.strictEqual(plan.maksud, expected, 'Ordinary query should retain its own intent: ' + q);
}
console.log('PASS: normal harvest, diagnosis, and inventory requests do not become corrections');


// 10. Exact plant matching must keep shared-word records out of a Bawang Putih question.
cx = makeContext([]);
plan = cx.naraInterpretUserQuery('Periksa estimasi panen Bawang Putih.');
assert.strictEqual(plan.maksud, 'panen');
assert.strictEqual(plan.fokus.map(x=>x.name).join(','), 'Bawang Putih');
assert.strictEqual(cx.naraPlantEntriesMentionedInText('Periksa rekaman Bawang Putih.').map(x=>x.name).join(','), 'Bawang Putih');
vm.runInContext(builderSource, cx, {timeout:1000});
builtPayload = JSON.parse(cx.naraOnlineLearningContext('Periksa estimasi panen Bawang Putih.', ''));
assert.strictEqual(builtPayload.tanaman_relevan.map(x=>x.nama).join(','), 'Bawang Putih');
console.log('PASS: exact plant matching excludes unrelated bawang/lobak records');
const inventoryPayload = JSON.parse(cx.naraOnlineLearningContext('Apa saja tanaman yang saya tanam?', ''));
assert(inventoryPayload.tanaman_relevan.length > 0, 'An inventory query must select structured plant records, not an empty context.');
assert(inventoryPayload.interpretasi_pertanyaan.maksud === 'inventaris_tanaman');
console.log('PASS: inventory intent actually selects structured plant records');


// 11. A correction without a repeated plant name inherits its target from the previous user question.
cx = makeContext([
  {role:'user', text:'Bawang Putih saya memiliki dua kelompok tanam. Sebutkan estimasi panen masing-masing.'},
  {role:'assistant', text:'Kelompok pertama dan kedua memiliki estimasi panen.'},
  {role:'user', text:'Koreksi jawabanmu. Periksa ulang tanggal panen kelompok pertama.'},
  {role:'assistant', text:'Maaf, aku akan memeriksa kembali.'}
]);
const inheritedCorrection = 'Jawabanmu salah. Periksa kembali sumbernya.';
plan = cx.naraInterpretUserQuery(inheritedCorrection, 'Maaf, aku akan memeriksa kembali.');
assert.strictEqual(plan.maksud, 'koreksi_jawaban');
assert.strictEqual(plan.fokus.map(x=>x.name).join(','), 'Bawang Putih');
assert.strictEqual(plan.tahan_sumber_kebun_tidak_relevan, false);
vm.runInContext(builderSource, cx, {timeout:1000});
builtPayload = JSON.parse(cx.naraOnlineLearningContext(inheritedCorrection, 'Maaf, aku akan memeriksa kembali.'));
assert.strictEqual(builtPayload.tanaman_relevan.map(x=>x.nama).join(','), 'Bawang Putih');
console.log('PASS: correction preserves prior user focus and garden evidence');

// 12. Shared partial names should ask for clarification rather than mix records.
cx = makeContext([]);
plan = cx.naraInterpretUserQuery('Periksa tanaman bawang saya.');
assert.strictEqual(plan.rujukan_perlu_diperjelas, true, 'Ambiguous "bawang" must require clarification.');
assert.strictEqual(plan.tahan_sumber_kebun_tidak_relevan, true, 'Ambiguous partial matches must withhold specific rows.');
assert.strictEqual(plan.maksud, 'klarifikasi_rekaman');
console.log('PASS: partial shared plant-name matches trigger clarification');



// 13. Correction-answer audits must inherit the prior question's target plant.
cx = makeContext([
  {role:'user', text:'Kapan perkiraan panen Bawang Putih?'},
  {role:'assistant', text:'Kelompok pertama diperkirakan panen pada 18 Desember 2026.'},
  {role:'user', text:'Koreksi jawabanmu. Periksa kembali sumber data dan jawaban sebelumnya.'},
  {role:'assistant', text:'Aku belum dapat memberi kesimpulan spesifik berdasarkan konteks yang tersedia.'}
]);
const correctionText = 'Koreksi jawabanmu. Periksa kembali sumber data dan jawaban sebelumnya.';
const correctionAnswer = 'Menurut catatan Bawang Putih, kelompok pertama ditanam 20 September 2026.';
assert.strictEqual(cx.naraAuditAnswerPlantScope(correctionText, correctionAnswer).ok, false,
  'Regression fixture should reproduce the previous false rejection when the correction text has no plant name.');
plan = cx.naraInterpretUserQuery(correctionText, 'Aku belum dapat memberi kesimpulan spesifik berdasarkan konteks yang tersedia.');
assert(/Bawang Putih/i.test(plan.routingQuestion), "Correction routing must carry forward the prior user plant reference.");
assert.strictEqual(cx.naraAuditAnswerPlantScope(plan.routingQuestion, correctionAnswer).ok, true,
  'The same answer must pass the production audit when its inherited target is included.');
console.log('PASS: correction audit reproduces and resolves inherited-target false rejection');

// The production online-request path must use the inherited routing scope in both audit attempts.
const requestStart = html.indexOf('async function naraRequestOnlineAnswer(question,localAnswer,recentHistory=[]){');
const requestEnd = html.indexOf('\nfunction naraBuildTeacherPrompt', requestStart);
if (requestStart < 0 || requestEnd <= requestStart) throw new Error('Could not isolate production online-request function.');
const requestSource = html.slice(requestStart, requestEnd);
assert(requestSource.includes('const auditScopeQuestion=String(base.interpretasi_pertanyaan?.routingQuestion||question);'),
  'Online request must compute the audited scope from the resolved routing question.');
assert(requestSource.includes('naraAuditAnswerPlantScope(auditScopeQuestion,response.text)'),
  'First response audit must use inherited correction focus.');
assert(requestSource.includes('naraAuditAnswerPlantScope(auditScopeQuestion,retry.text)'),
  'Retry response audit must use inherited correction focus.');
assert(requestSource.includes('naraPlantScopeSafeFallback(auditScopeQuestion)'),
  'Safe fallback should preserve the inherited target rather than losing it.');
console.log('PASS: production online request and retry audit use inherited correction focus');

// The runtime diagnostic must capture and display the context handed to the online chat wrapper.
assert(html.includes('naraLastRetrievalAudit.contextJson=content;'),
  'Diagnostic must capture the serialized context string actually handed to naraGuruChat.');
assert(html.includes('Riwayat percakapan yang disusun untuk AI'),
  'Diagnostic must show which prior conversation turns were included.');
assert(html.includes('Rekaman tanaman yang disusun untuk AI'),
  'Diagnostic must show which structured plant records were included.');
console.log('PASS: diagnostics trace the assembled online context, garden records, and prior turns');

// 14. Short audit commands must inherit focus through intervening correction/audit turns,
// and the actual production payload builder must include the structured target plant record.
const longAuditUser = 'Audit ulang jawabanmu dengan membandingkannya terhadap jawaban sebelumnya dan rekaman Terra Serenada. Tampilkan semua kelompok tanam Bawang Putih beserta tanggal tanam dan estimasi panen yang tercatat.';
const auditTrail = [
  {role:'user', text:'Berapa jenis semua tanaman di kebun saya?'},
  {role:'assistant', text:'Terdapat total 20 jenis tanaman.'},
  {role:'user', text:'Kapan perkiraan panen Bawang Putih?'},
  {role:'assistant', text:'Kelompok pertama diperkirakan panen 18 Desember 2026 dan kelompok kedua 9 Januari 2027.'},
  {role:'user', text:'Koreksi jawabanmu. Periksa kembali sumber data dan jawaban sebelumnya.'},
  {role:'assistant', text:'Berikut estimasi panen dari perhitungan 90 hari.'},
  {role:'user', text:longAuditUser},
  {role:'assistant', text:'Saya belum memiliki akses langsung ke rekaman spesifik.'}
];
const auditContext = makeContext(auditTrail);
vm.runInContext(builderSource, auditContext, {timeout:1000});
const shortAudit = 'Audit ulang jawabanmu';
plan = auditContext.naraInterpretUserQuery(shortAudit, 'jawaban sebelumnya');
assert.strictEqual(plan.maksud, 'koreksi_jawaban', 'Short audit prompts must route as corrections, not general questions.');
assert(plan.fokus.some(x=>x.name==='Bawang Putih'), 'Short audit must inherit the most recent specific non-correction target.');
assert.strictEqual(plan.tahan_sumber_kebun_tidak_relevan, false, 'Inherited audit focus must not suppress relevant garden data.');
const actualAuditPayload = JSON.parse(auditContext.naraOnlineLearningContext(shortAudit, 'jawaban sebelumnya'));
assert(actualAuditPayload.tanaman_relevan.some(p=>p.nama==='Bawang Putih'), 'The actual context builder must include the target plant row for a short audit command.');
assert.strictEqual(actualAuditPayload.interpretasi_pertanyaan.maksud, 'koreksi_jawaban');
console.log('PASS: short audit inherits Bawang Putih focus through intervening corrections and sends the structured record');

// The diagnostic must never report a text-only match as a coverage pass when garden evidence is missing.
assert(html.includes('auditContextMissingGardenEvidence'), 'Diagnostic must detect audit context with prior plant references but zero structured plant rows.');
assert(/teks riwayat saja bukan bukti kebun/i.test(html), 'Diagnostic must explicitly avoid treating conversation text as structured garden evidence.');
console.log('PASS: diagnostic fails closed when audit history exists but structured plant evidence is absent');


// 15. Execute the production online-request function with a stubbed model response to verify the real audit path.
(async()=>{
  const runtimeMessages = [
    {role:'user', text:'Kapan perkiraan panen Bawang Putih?'},
    {role:'assistant', text:'Estimasi panen Bawang Putih untuk dua kelompok.'},
    {role:'user', text:correctionText},
    {role:'assistant', text:'Aku belum dapat memberi kesimpulan spesifik berdasarkan konteks yang tersedia.'}
  ];
  const runtime = makeContext(runtimeMessages);
  runtime.naraGuruChat = async messages => ({
    text: correctionAnswer,
    model: 'test-model',
    messagesSeen: messages
  });
  vm.runInContext('let naraLastRetrievalAudit=null;\n' + builderSource + '\n' + requestSource, runtime, {timeout:1000});
  const liveHistory = runtimeMessages.slice(0,2).map(m=>({role:m.role,text:m.text}));
  const runtimeResult = await runtime.naraRequestOnlineAnswer(correctionText, {text:'local draft'}, liveHistory);
  assert.strictEqual(runtimeResult.answerSource, 'online_direct',
    'The production request path should accept a target-specific correction answer instead of replacing it with a generic fallback.');
  assert.strictEqual(runtimeResult.text, correctionAnswer);
  assert.strictEqual(vm.runInContext('naraLastRetrievalAudit.requestStatus', runtime), 'success', 'Runtime diagnostics must record a completed online response.');
  assert.strictEqual(vm.runInContext('naraLastRetrievalAudit.requestOutcome', runtime), 'online_direct');
  console.log('PASS: production online-request path does not falsely reject inherited Bawang Putih correction answers');
})().catch(err=>{ console.error(err && err.stack || err); process.exitCode=1; });

// 16. Harvest-date arithmetic must remain date-only and not shift backward in UTC+ time zones.
const harvestStart = html.indexOf('function groupHarvestDate(item,g){');
const harvestEnd = html.indexOf('\nfunction openGroupModal', harvestStart);
if (harvestStart < 0 || harvestEnd <= harvestStart) throw new Error('Could not isolate production groupHarvestDate helper.');
const harvestContext = vm.createContext({});
vm.runInContext(html.slice(harvestStart, harvestEnd), harvestContext, {timeout:1000});
assert.strictEqual(harvestContext.groupHarvestDate({harvestDays:90},{date:'2026-09-20'}), '2026-12-19');
assert.strictEqual(harvestContext.groupHarvestDate({harvestDays:90},{date:'2026-10-12'}), '2027-01-10');
assert.strictEqual(harvestContext.groupHarvestDate({harvestDays:90},{date:'not-a-date'}), '');
console.log('PASS: app harvest dates use timezone-safe calendar-day arithmetic');

// 17. Group source payload must include the app's estimated harvest date and the assigned light zone.
assert(html.includes('tanggal_estimasi_panen:estimatedHarvestDate'), 'Structured group payload must carry the same harvest estimate used by the app.');
assert(html.includes('umur_panen_hari_yang_digunakan:p.harvestDays??null'), 'Payload must disclose the plant-level harvest interval that drives the estimate.');
assert(html.includes('zona_cahaya:zone?.name||null'), 'Structured group payload must carry the selected light-zone name when available.');
assert(html.includes("zona_cahaya_jam:zone?`${zone.start||''}–${zone.end||''}`:null"), 'Structured group payload should preserve zone time range.');
console.log('PASS: structured plant-group payload includes harvest estimate and light-zone evidence');

// 18. An online failure must be observable in the diagnostic rather than appearing as a generic fallback only.
(async()=>{
  const failedRuntime = makeContext([
    {role:'user', text:'Kapan perkiraan panen Bawang Putih?'},
    {role:'assistant', text:'Estimasi panen kelompok pertama.'}
  ]);
  failedRuntime.naraGuruChat = async () => { throw new Error('Worker merespons HTTP 502'); };
  vm.runInContext('let naraLastRetrievalAudit=null;\n' + builderSource + '\n' + requestSource, failedRuntime, {timeout:1000});
  let caught=false;
  try { await failedRuntime.naraRequestOnlineAnswer('Audit ulang jawabanmu tentang Bawang Putih', {text:'draft lokal'}, [{role:'user',text:'Kapan perkiraan panen Bawang Putih?'}]); }
  catch (_) { caught=true; }
  assert.strictEqual(caught, true, 'Production request path should still propagate an online failure for fallback handling.');
  assert.strictEqual(vm.runInContext('naraLastRetrievalAudit.requestStatus', failedRuntime), 'failed');
  assert.strictEqual(vm.runInContext('naraLastRetrievalAudit.requestFailureStage', failedRuntime), 'primary_chat');
  assert.match(vm.runInContext('naraLastRetrievalAudit.requestError', failedRuntime), /HTTP 502/);
  assert(html.includes('Status permintaan AI online'), 'Diagnostic UI must display request outcome.');
  assert(html.includes('Rincian kegagalan'), 'Diagnostic UI must show the online failure reason.');
  console.log('PASS: diagnostic captures and displays the production online-request failure stage and message');
})().catch(err=>{ console.error(err && err.stack || err); process.exitCode=1; });
