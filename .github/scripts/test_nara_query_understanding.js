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
const data = [
  {id:'eggplant-1', name:'Terung Bulat Hijau Bergaris Putih'},
  {id:'tomato-1', name:'Tomat Roma'},
  {id:'pumpkin-1', name:'Labu Madu'}
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
    naraPlantEntriesMentionedInText: entries,
    naraExplicitCropTerms: cropTerms,
    naraIsSimpleGreeting: q => /^(hai|halo|selamat pagi|selamat malam)[!. ]*$/i.test(String(q||'').trim()),
    naraIsCorrectionTurn: q => /bukan itu|salah|bukan maksud saya|saya tidak bilang/i.test(String(q||''))
  };
  vm.createContext(context);
  vm.runInContext(interpreter, context, {timeout:1000});
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
  teacherLessons: [{id:'guru-rule', title:'Aturan yang pernah saya ajarkan tentang penyiraman', topic:'Penyiraman', text:'Aturan umum penyiraman yang pernah saya ajarkan kepada Nara untuk semua tanaman.', createdAt:'2026-10-13', origin:'Guru AI Online', learningType:'model_language'}]
};
vm.runInContext(retrievalSource, rx, {timeout:1000});
const memoryHits = rx.naraGetTaughtKnowledge('apa aturan yang pernah saya ajarkan tentang penyiraman');
assert(memoryHits.length >= 2, 'Test should return both the user and Guru lesson candidates.');
assert.strictEqual(memoryHits[0].__memoryKind, 'user_taught', 'Explicit user-taught questions must prioritize user memory.');
console.log('PASS: explicit user-taught memory outranks Guru lesson candidates');
