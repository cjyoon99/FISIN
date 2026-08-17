// ============================================================
// supabase-adapter.js
// [V66/V67] Supabase 연동 어댑터 - storageGet/Set/Delete/List/GetMany/DeleteMany, Row<->Entry 변환, uiPrefs (원본 1082~1729줄)
// ※ E단계 모듈화(V77) 시 원본 v76 단일 파일에서 그대로 잘라낸 것으로,
//   전역 스코프를 그대로 사용하며 기존 함수 간 참조 관계는 100% 동일합니다.
// ============================================================
// ============================================================
// [V66] Supabase 연동 어댑터 — 불량이력/일정/공사이력만 Supabase로,
// 나머지는 기존 Apps Script 그대로. 위에서 추가된 오프라인 동기화 큐
// (enqueueWrite/flushSyncQueue/lsCache)와도 이어지도록, 실패 시 큐에
// 쌓이고 재전송될 때도 Supabase로 다시 가도록 처리한다.
// [V67] 사진현황 로그(photo: 키)도 photos 테이블로 연결, 그리고 불량이력/공사이력/
// 사진현황 로그의 사진 필드는 이제 base64를 그대로 DB에 넣지 않고 Supabase Storage
// (photos 버킷)에 실제 파일로 올린 뒤 그 공개 URL만 저장한다(maybeUploadBase64 참고).
// 태그/소방시설현황수정/공통설정은 여전히 Apps Script 그대로(C단계에서 처리 예정).
// ============================================================
const SUPABASE_URL = 'https://oqwmytxqtegbskorbrou.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9xd215dHhxdGVnYnNrb3Jicm91Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5MTg0NjEsImV4cCI6MjEwMTQ5NDQ2MX0.cL4GmoWjY1wTiwy8ThTBFWDmEc17H3uEJR_bjBQ5eAw';

async function sbFetch(pathAndQuery, options){
  options = options || {};
  const headers = Object.assign({
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
    'Content-Type': 'application/json'
  }, options.headers || {});
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + pathAndQuery, Object.assign({}, options, { headers }));
  const text = await res.text();
  if(!res.ok){ throw new Error('Supabase 오류 ' + res.status + ': ' + text); }
  return text ? JSON.parse(text) : null;
}

let _buildingIdByName = {}, _buildingNameById = {}, _equipTypeIdByName = {};
// [V70/D단계②] 하분류(equipment_subtypes)/구성부품(equipment_details) 캐시.
// 이름이 여러 상위 아래서 겹칠 수 있어(예: '개폐표시형밸브'), "상위ID|이름"을 키로 쓴다.
let _equipSubtypeIdByTypeAndName = {}, _equipDetailIdBySubtypeAndName = {};
let _supabaseCachesPromise = null;
function ensureSupabaseCaches(){
  if(_supabaseCachesPromise) return _supabaseCachesPromise;
  _supabaseCachesPromise = (async ()=>{
    try{
      const buildings = await sbFetch('buildings?select=id,name&tenant_id=eq.' + encodeURIComponent(CURRENT_TENANT_CODE));
      (buildings||[]).forEach(b=>{ _buildingIdByName[b.name] = b.id; _buildingNameById[b.id] = b.name; });
      const types = await sbFetch('equipment_types?select=id,name');
      (types||[]).forEach(t=>{ _equipTypeIdByName[t.name] = t.id; });
      const subtypes = await sbFetch('equipment_subtypes?select=id,name,equipment_type_id');
      (subtypes||[]).forEach(s=>{ _equipSubtypeIdByTypeAndName[s.equipment_type_id + '|' + s.name] = s.id; });
      const details = await sbFetch('equipment_details?select=id,name,equipment_subtype_id');
      (details||[]).forEach(d=>{ _equipDetailIdBySubtypeAndName[d.equipment_subtype_id + '|' + d.name] = d.id; });
      backendOnline = true; updateSyncBanner();
    }catch(e){
      console.error('Supabase 캐시 로드 실패', e);
      backendOnline = false; updateSyncBanner();
      _supabaseCachesPromise = null; // 실패하면 다음 호출 때 다시 시도
      throw e;
    }
  })();
  return _supabaseCachesPromise;
}

// [V76/F단계] 마스터DB(203개)에 없는 새 대상물명으로 일정/불량이력 등을 저장하려 하면
// building_id가 NOT NULL이라 예전엔 무조건 실패했다. 캐시에 없으면 그 자리에서 buildings에
// 새로 등록하고 그 id를 쓴다(대상물 마스터 파일 안 건드리고도 새 현장 입력이 가능해짐).
async function resolveBuildingId(name){
  if(!name) return null;
  if(_buildingIdByName[name]) return _buildingIdByName[name];
  try{
    const existing = await sbFetch('buildings?select=id&tenant_id=eq.' + encodeURIComponent(CURRENT_TENANT_CODE) + '&name=eq.' + encodeURIComponent(name));
    if(existing && existing.length){
      _buildingIdByName[name] = existing[0].id; _buildingNameById[existing[0].id] = name;
      return existing[0].id;
    }
    const created = await sbFetch('buildings', {
      method: 'POST', headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify([{ tenant_id: CURRENT_TENANT_CODE, name }])
    });
    if(created && created[0]){
      _buildingIdByName[name] = created[0].id; _buildingNameById[created[0].id] = name;
      return created[0].id;
    }
  }catch(e){ console.error('건물 자동등록 실패:', name, e); }
  return null;
}

function supabaseTableFor(key){
  if(!key) return null;
  if(key.indexOf('defect:') === 0) return 'defects';
  if(key.indexOf('schedule:') === 0) return 'schedules';
  if(key.indexOf('construction:') === 0) return 'constructions';
  if(key.indexOf('photo:') === 0) return 'photos';
  // [V68/C단계]
  if(key === 'ui_prefs') return 'ui_prefs';
  if(key.indexOf('photo_tag_list:') === 0) return 'tag_sets';
  if(key === 'photo_other_tag_list') return 'tag_sets';
  if(key.indexOf('building_edits:') === 0) return 'building_facility_edits';
  if(key.indexOf('building_history:') === 0) return 'building_edit_history';
  return null;
}

// ---- [V67] 사진 Storage 업로드 헬퍼 ----------------------------------
// base64(data:image/...) 값을 Supabase Storage(photos 버킷)에 실제 파일로 올리고
// 공개 URL을 돌려준다. 이미 URL이거나 값이 없으면 그대로 통과시킨다.
// 실패하면(오프라인 등) base64를 그대로 반환해 데이터 유실은 막는다(안전망 원칙).
const STORAGE_BUCKET = 'photos';
function dataUrlToBlob(dataUrl){
  const comma = dataUrl.indexOf(',');
  const meta = dataUrl.slice(0, comma);
  const b64 = dataUrl.slice(comma + 1);
  const mimeMatch = meta.match(/data:(.*?);base64/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
async function uploadImageToStorage(dataUrl, path){
  const blob = dataUrlToBlob(dataUrl);
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      'Content-Type': blob.type,
      'x-upsert': 'true'
    },
    body: blob
  });
  if(!res.ok){ const t = await res.text(); throw new Error('Storage 업로드 실패 ' + res.status + ': ' + t); }
  return `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`;
}
async function maybeUploadBase64(dataUrl, pathNoExt){
  if(!dataUrl || dataUrl.indexOf('data:image') !== 0) return dataUrl; // 이미 URL이거나 없음
  try{
    const ext = dataUrl.indexOf('image/png') > -1 ? 'png' : 'jpg';
    return await uploadImageToStorage(dataUrl, `${pathNoExt}.${ext}`);
  }catch(e){
    console.error('사진 Storage 업로드 실패, base64로 대체 저장', e);
    return dataUrl; // 실패해도 저장 자체는 진행(예전 방식으로 폴백)
  }
}
function legacyIdFromKey(key){ return key.slice(key.indexOf(':') + 1); }

function defectRowToEntry(row){
  return {
    id: row.legacy_id, building: _buildingNameById[row.building_id] || null,
    inspector: '', location: row.location_floor || '', detailLocation: row.detail_location || '',
    equip: row.equip_raw || '', defectContent: row.content || '',
    // [V69/D단계] 예전엔 항상 null로 하드코딩되어 있었음 — 이제 실제로 컬럼에서 복원한다.
    equipName: row.equip_name || null, equipSub: row.equip_sub || null,
    parentEquip: row.parent_equip || null,
    action: row.action || '조치요함', photo: row.photo_url || null,
    inspectionType: row.inspection_type || '', inspectionDate: row.inspection_date || '',
    inspectionId: row.inspection_id_text || '',
    ts: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    deleted: !!row.deleted,
    _deletedAt: row.deleted_at ? new Date(row.deleted_at).getTime() : undefined
  };
}
async function entryToDefectRow(entry){
  // [V67] base64로 들어온 사진은 Supabase Storage에 실제 파일로 올리고 URL만 저장한다
  // (예전엔 base64 그대로 photo_url 텍스트 컬럼에 박아 넣고 있었음 — 용량/속도 문제의 원인).
  const photoUrl = await maybeUploadBase64(entry.photo, `${CURRENT_TENANT_CODE}/defects/${entry.id}`);
  // [V69/D단계①] "설비명" 예전엔 entry.equip(합쳐진 문자열, 예:"옥내소화전 소화전함")로 equipment_types를
  // 조회해서 부속항목이 있는 경우 거의 항상 매칭 실패했다. 이제 실제 "중분류" 이름으로만 조회한다.
  // 펌프류(주펌프/충압펌프 등)처럼 부속설비가 승격되어 equipName 자리에 온 경우엔 parentEquip이
  // 진짜 중분류(옥내소화전/스프링클러)이므로 그쪽을 우선 사용한다.
  // [V72] parentEquip이 있어도 두 가지 경우가 섞여있다:
  //  (a) 진짜 펌프류 승격 — equipName('주펌프' 등)은 중분류가 아니라 하분류라 parentEquip이 꼭 필요함
  //  (b) 유도등류 승격 — equipName('피난구유도등' 등)이 이미 그 자체로 정식 중분류라 parentEquip 없이도 매칭됨
  // equipName이 이미 중분류 이름으로 매칭되면 (b)로 보고 그대로 쓰고, 안 되면 (a)로 보고 parentEquip을 쓴다.
  const equipNameIsRealType = !!_equipTypeIdByName[entry.equipName];
  const isPromotedSubtype = !!entry.parentEquip && !equipNameIsRealType;
  const equipTypeName = isPromotedSubtype ? entry.parentEquip : entry.equipName;
  const equipTypeId = _equipTypeIdByName[equipTypeName] || null;
  // [V70/D단계②] 중분류를 찾았으면 그 아래서 하분류(부속설비), 그 아래서 구성부품(4단계)까지 매칭.
  // 일반 경우: equipName=중분류, equipSub=하분류(더 아래 없음).
  // 펌프 승격 경우: equipName 자체가 하분류(예:'주펌프'), equipSub가 그 밑 구성부품(예:'압력계').
  let equipSubtypeId = null, equipDetailId = null;
  if(equipTypeId){
    const subtypeName = isPromotedSubtype ? entry.equipName : entry.equipSub;
    if(subtypeName){
      equipSubtypeId = _equipSubtypeIdByTypeAndName[equipTypeId + '|' + subtypeName] || null;
      const detailName = isPromotedSubtype ? entry.equipSub : null; // 4단계는 펌프 승격 경우에만 존재
      if(equipSubtypeId && detailName){
        equipDetailId = _equipDetailIdBySubtypeAndName[equipSubtypeId + '|' + detailName] || null;
      }
    }
  }
  return {
    legacy_id: entry.id, tenant_id: CURRENT_TENANT_CODE, building_id: await resolveBuildingId(entry.building),
    equipment_type_id: equipTypeId, equip_raw: entry.equip || null,
    equipment_subtype_id: equipSubtypeId, equipment_detail_id: equipDetailId,
    equip_name: entry.equipName || null, equip_sub: entry.equipSub || null,
    parent_equip: entry.parentEquip || null,
    location_wing: (entry.location||'').split(' ')[0] || null, location_floor: entry.location || null,
    detail_location: entry.detailLocation || null, content: entry.defectContent || '',
    action: entry.action || '조치요함', photo_url: photoUrl || null,
    inspection_type: entry.inspectionType || null, inspection_date: entry.inspectionDate || null,
    inspection_id_text: entry.inspectionId || null, deleted: !!entry.deleted,
    deleted_at: entry._deletedAt ? new Date(entry._deletedAt).toISOString() : null
  };
}
function scheduleRowToEntry(row){
  return {
    id: row.legacy_id, building: _buildingNameById[row.building_id] || null,
    type: row.type || '', team: row.team || '', district: row.district || '',
    area: row.area != null ? Number(row.area) : 0, startDate: row.start_date,
    duration: row.duration || 1, note: row.note || '', status: row.status || 'wait',
    statusChangedAt: row.status_changed_at ? new Date(row.status_changed_at).getTime() : undefined
  };
}
async function entryToScheduleRow(entry){
  return {
    legacy_id: entry.id, tenant_id: CURRENT_TENANT_CODE, building_id: await resolveBuildingId(entry.building),
    type: entry.type || null, team: entry.team || null, district: entry.district || null,
    area: (entry.area || entry.area === 0) ? Number(entry.area) : null,
    start_date: entry.startDate || null, duration: entry.duration || 1,
    status: entry.status || 'wait',
    status_changed_at: entry.statusChangedAt ? new Date(entry.statusChangedAt).toISOString() : null,
    note: entry.note || null
  };
}
function constructionRowToEntry(row){
  return {
    id: row.legacy_id, building: _buildingNameById[row.building_id] || null,
    siteName: row.site_name || '', itemLabel: row.item_label || '',
    beforePhoto: row.before_photo_url || null, afterPhoto: row.after_photo_url || null,
    inspectionType: row.inspection_type || '', inspectionDate: row.inspection_date || '',
    inspectionId: row.inspection_id_text || '',
    ts: row.created_at ? new Date(row.created_at).getTime() : Date.now()
  };
}
async function entryToConstructionRow(entry){
  const beforeUrl = await maybeUploadBase64(entry.beforePhoto, `${CURRENT_TENANT_CODE}/constructions/${entry.id}-before`);
  const afterUrl  = await maybeUploadBase64(entry.afterPhoto,  `${CURRENT_TENANT_CODE}/constructions/${entry.id}-after`);
  return {
    legacy_id: entry.id, tenant_id: CURRENT_TENANT_CODE, building_id: await resolveBuildingId(entry.building),
    site_name: entry.siteName || '', item_label: entry.itemLabel || '',
    before_photo_url: beforeUrl || null, after_photo_url: afterUrl || null,
    inspection_type: entry.inspectionType || null, inspection_date: entry.inspectionDate || null,
    inspection_id_text: entry.inspectionId || null
  };
}
// [V67] 사진현황 로그(photolog, photo: 키) — photos 테이블 매핑
function photoRowToEntry(row){
  return {
    id: row.legacy_id, building: _buildingNameById[row.building_id] || null,
    tag: row.tag || '', group: row.tag_group || 'report',
    photo: row.photo_url || null,
    ts: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    include: row.included !== false,
    inspectionType: row.inspection_type || '', inspectionDate: row.inspection_date || '',
    inspectionId: row.inspection_id_text || '',
    deleted: !!row.deleted,
    _deletedAt: row.deleted_at ? new Date(row.deleted_at).getTime() : undefined
  };
}
async function entryToPhotoRow(entry){
  const photoUrl = await maybeUploadBase64(entry.photo, `${CURRENT_TENANT_CODE}/photolog/${entry.id}`);
  return {
    legacy_id: entry.id, tenant_id: CURRENT_TENANT_CODE,
    building_id: await resolveBuildingId(entry.building),
    tag: entry.tag || null, tag_group: entry.group || 'report',
    photo_url: photoUrl || null,
    included: entry.include !== false,
    inspection_type: entry.inspectionType || null, inspection_date: entry.inspectionDate || null,
    inspection_id_text: entry.inspectionId || null,
    deleted: !!entry.deleted,
    deleted_at: entry._deletedAt ? new Date(entry._deletedAt).toISOString() : null
  };
}
function rowToEntryFor(table, row){
  if(table==='defects') return defectRowToEntry(row);
  if(table==='schedules') return scheduleRowToEntry(row);
  if(table==='constructions') return constructionRowToEntry(row);
  if(table==='photos') return photoRowToEntry(row);
  if(table==='ui_prefs') return uiPrefsRowToEntry(row);
  if(table==='building_facility_edits') return buildingFacilityEditRowToEntry(row);
  if(table==='building_edit_history') return buildingEditHistoryRowToEntry(row);
  return row;
}
// [V67] 사진 업로드가 비동기라 entryToRowFor 전체를 async로 변경 (호출부도 await 필요)
// [V68/C단계] key도 같이 받는다 — ui_prefs/building_facility_edits처럼 entry 자체엔
// 대상물명 등 식별정보가 없고 key(예: 'building_edits:서면빌딩')에만 들어있는 경우가 있어서.
// (tag_sets는 태그 1개당 1행 구조라 이 공용 경로를 안 타고 storageGet/supabaseWrite에서 직접 처리한다)
async function entryToRowFor(table, entry, key){
  if(table==='defects') return await entryToDefectRow(entry);
  if(table==='schedules') return await entryToScheduleRow(entry);
  if(table==='constructions') return await entryToConstructionRow(entry);
  if(table==='photos') return await entryToPhotoRow(entry);
  if(table==='ui_prefs') return entryToUiPrefsRow(entry);
  if(table==='building_facility_edits') return await entryToBuildingFacilityEditRow(entry, key);
  if(table==='building_edit_history') return await entryToBuildingEditHistoryRow(entry, key);
  return entry;
}

// ---- [V68/C단계] ui_prefs (공통설정) — 단일 행, entry가 곧 uiPrefs 객체 전체 ----
function uiPrefsRowToEntry(row){ return row.data || {}; }
function entryToUiPrefsRow(entry){
  return { legacy_id: tenantScopedLegacyId('ui_prefs'), tenant_id: CURRENT_TENANT_CODE, data: entry };
}

// ---- [V68/C단계 → V71 수정] tag_sets (태그)
// 처음엔 "건물당 한 행 + tags(jsonb 배열)"로 설계했는데, 실제 기존 테이블은 태그 1개당 1행
// (tenant_id/kind/name 모두 NOT NULL, sort_order로 순서 유지) 구조였다. 그래서 이 테이블만은
// entryToRowFor/rowToEntryFor 공용 경로를 안 타고, storageGet/supabaseWrite에서 바로 분기 처리한다.
function tagSetQueryParams(key){
  const isOther = key === 'photo_other_tag_list';
  const building = isOther ? null : key.slice('photo_tag_list:'.length);
  const buildingId = building ? (_buildingIdByName[building] || null) : null;
  return { buildingId, kind: isOther ? 'other' : 'report' };
}
async function writeTagSetList(key, list){
  const { buildingId, kind } = tagSetQueryParams(key);
  let delQ = 'tag_sets?tenant_id=eq.' + encodeURIComponent(CURRENT_TENANT_CODE) + '&kind=eq.' + encodeURIComponent(kind);
  delQ += buildingId ? ('&building_id=eq.' + encodeURIComponent(buildingId)) : '&building_id=is.null';
  await sbFetch(delQ, { method:'DELETE' }); // 목록 전체를 통째로 다시 쓰는 앱 동작에 맞춰 지우고 다시 채움
  const names = Array.isArray(list) ? list : [];
  if(names.length){
    const rows = names.map((name, i)=>({ tenant_id: CURRENT_TENANT_CODE, building_id: buildingId, kind, name, sort_order: i }));
    await sbFetch('tag_sets', { method:'POST', headers:{ 'Prefer':'return=minimal' }, body: JSON.stringify(rows) });
  }
}
async function readTagSetList(key){
  const { buildingId, kind } = tagSetQueryParams(key);
  let q = 'tag_sets?select=name&kind=eq.' + encodeURIComponent(kind)
    + '&tenant_id=eq.' + encodeURIComponent(CURRENT_TENANT_CODE) + '&order=sort_order.asc';
  q += buildingId ? ('&building_id=eq.' + encodeURIComponent(buildingId)) : '&building_id=is.null';
  const rows = await sbFetch(q);
  return (rows||[]).map(r=>r.name);
}

// ---- [V68/C단계 → V71 수정] building_facility_edits (소방시설현황수정)
// 이미 있던 테이블의 컬럼이 'edits'가 아니라 'data'(NOT NULL, 기본값 '{}')였음 — 거기 맞춤.
function buildingFacilityEditRowToEntry(row){ return row.data || {}; }
async function entryToBuildingFacilityEditRow(entry, key){
  const building = key.slice('building_edits:'.length);
  return {
    legacy_id: tenantScopedLegacyId(building), // 다른 테넌트에 동명 건물 있어도 안 겹치게
    tenant_id: CURRENT_TENANT_CODE,
    building_id: await resolveBuildingId(building),
    data: entry
  };
}

// ---- [V68/C단계 → V71 수정] building_edit_history (수정이력)
// 이미 있던 테이블이 통짜 JSONB가 아니라 tab/tab_label/changes(NOT NULL)로 나뉜 구조였음 — 거기 맞춤.
// (원본 entry 전체도 참고용으로 같이 넣어두되, 필수 컬럼은 반드시 채워서 NOT NULL 위반을 막는다)
function buildingEditHistoryRowToEntry(row){
  return {
    building: _buildingNameById[row.building_id] || null,
    tab: row.tab || null, tabLabel: row.tab_label || null,
    changes: row.changes || [],
    ts: row.ts != null ? row.ts : (row.created_at ? new Date(row.created_at).getTime() : Date.now()),
    inspector: ''
  };
}
async function entryToBuildingEditHistoryRow(entry, key){
  return {
    legacy_id: legacyIdFromKey(key), // 'building_history:<건물>:<ts>' → '<건물>:<ts>' (유일함)
    tenant_id: CURRENT_TENANT_CODE,
    building_id: await resolveBuildingId(entry.building),
    tab: entry.tab || null,
    tab_label: entry.tabLabel || null,
    changes: entry.changes || [], // NOT NULL 컬럼 — 값 없으면 빈 배열로라도 채움
    ts: entry.ts || null
  };
}

// 오프라인 큐가 재전송할 때도 쓰는 공통 디스패처(성공하면 true 계열 값, 실패하면 null)
async function supabaseWrite(payload){
  const table = supabaseTableFor(payload.key) || (payload.keys && payload.keys.length ? supabaseTableFor(payload.keys[0]) : null);
  if(!table) return null;
  try{
    await ensureSupabaseCaches();
    if(payload.action === 'set'){
      let entry; try{ entry = JSON.parse(payload.value); }catch(e){ return null; }
      if(table === 'tag_sets'){
        await writeTagSetList(payload.key, entry); // 태그 1개당 1행 구조라 통째 지우고 다시 씀
      } else {
        const row = await entryToRowFor(table, entry, payload.key);
        await sbFetch(table + '?on_conflict=legacy_id', {
          method: 'POST', headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify([row])
        });
      }
    } else if(payload.action === 'delete'){
      await sbFetch(table + '?legacy_id=eq.' + encodeURIComponent(legacyIdFromKey(payload.key)) + '&tenant_id=eq.' + encodeURIComponent(CURRENT_TENANT_CODE), { method:'DELETE' });
    } else if(payload.action === 'deleteMany'){
      const ids = (payload.keys||[]).map(legacyIdFromKey);
      if(ids.length) await sbFetch(table + '?legacy_id=in.(' + ids.map(encodeURIComponent).join(',') + ')&tenant_id=eq.' + encodeURIComponent(CURRENT_TENANT_CODE), { method:'DELETE' });
    } else {
      return null;
    }
    backendOnline = true; updateSyncBanner();
    return { ok:true };
  }catch(e){
    console.error('Supabase 처리 실패', e);
    backendOnline = false; updateSyncBanner();
    return null;
  }
}

// [V73/F단계] 'ui_prefs'처럼 모든 테넌트가 같은 key를 쓰는 경우, DB legacy_id는
// 테넌트별로 구분되게 접두어를 붙인다(안 그러면 나중 테넌트가 이전 테넌트 값을 덮어씀).
function tenantScopedLegacyId(base){ return CURRENT_TENANT_CODE + ':' + base; }
function resolveLegacyIdForRead(table, key){
  if(table === 'ui_prefs') return tenantScopedLegacyId('ui_prefs');
  if(table === 'building_facility_edits') return tenantScopedLegacyId(key.slice('building_edits:'.length));
  return legacyIdFromKey(key);
}

async function storageGet(key, shared){
  const table = supabaseTableFor(key);
  if(table){
    await ensureSupabaseCaches();
    try{
      if(table === 'tag_sets'){
        const list = await readTagSetList(key);
        // [V74 버그수정] 저장된 태그가 하나도 없으면 null을 돌려줘야
        // 호출부(loadTags 등)가 "값 없음"으로 보고 대상물 맞춤 기본 태그 계산으로 넘어간다.
        // 빈 배열을 그대로 돌려주면 "빈 목록이 저장되어 있음"으로 오인해 기본 태그가 안 뜬다.
        if(!list.length) return null;
        return { value: JSON.stringify(list) };
      }
      const rows = await sbFetch(table + '?legacy_id=eq.' + encodeURIComponent(resolveLegacyIdForRead(table, key))
        + '&tenant_id=eq.' + encodeURIComponent(CURRENT_TENANT_CODE) + '&select=*');
      if(rows && rows.length) return { value: JSON.stringify(rowToEntryFor(table, rows[0])) };
      return null;
    }catch(e){ console.error('Supabase 조회 실패', e); return null; }
  }
  const res = await callAppsScript({ action:'get', key, shared: !!shared });
  if(res && res.value != null) return { value: res.value };
  return null;
}
async function storageSet(key, value, shared, opts){
  opts = opts || {};
  const table = supabaseTableFor(key);
  if(table){
    const res = await supabaseWrite({ action:'set', key, value, shared: !!shared });
    if(!res && !opts.noQueue) enqueueWrite({ action:'set', key, value, shared: !!shared });
    return res;
  }
  const res = await callAppsScript({ action:'set', key, value, shared: !!shared }, opts);
  return res;
}
async function storageDelete(key, shared, opts){
  opts = opts || {};
  const table = supabaseTableFor(key);
  if(table){
    const res = await supabaseWrite({ action:'delete', key, shared: !!shared });
    if(!res && !opts.noQueue) enqueueWrite({ action:'delete', key, shared: !!shared });
    return res;
  }
  const res = await callAppsScript({ action:'delete', key, shared: !!shared }, opts);
  return res;
}
// [v52] 여러 키를 한 번의 호출로 지운다(백엔드 V03의 'deleteMany' 액션 필요).
async function storageDeleteMany(keys, shared, opts){
  if(!keys || !keys.length) return 0;
  opts = opts || {};
  const supaKeys = keys.filter(k=>supabaseTableFor(k));
  const otherKeys = keys.filter(k=>!supabaseTableFor(k));
  let deleted = 0;
  if(supaKeys.length){
    const res = await supabaseWrite({ action:'deleteMany', keys:supaKeys, shared: !!shared });
    if(res){ deleted += supaKeys.length; }
    else if(!opts.noQueue){ enqueueWrite({ action:'deleteMany', keys:supaKeys, shared: !!shared }); }
  }
  if(otherKeys.length){
    const res = await callAppsScript({ action:'deleteMany', keys:otherKeys, shared: !!shared }, opts);
    deleted += (res && res.deletedCount) || 0;
  }
  return deleted;
}
async function storageList(prefix, shared){
  const table = supabaseTableFor(prefix);
  if(table){
    await ensureSupabaseCaches();
    try{
      const rows = await sbFetch(table + '?select=legacy_id&tenant_id=eq.' + encodeURIComponent(CURRENT_TENANT_CODE));
      const p = prefix.split(':')[0] + ':';
      return { keys: (rows||[]).map(r=>p+r.legacy_id) };
    }catch(e){ console.error('Supabase 목록조회 실패', e); return { keys: [] }; }
  }
  const res = await callAppsScript({ action:'list', prefix: prefix||'', shared: !!shared });
  return { keys: (res && res.keys) || [] };
}
// 여러 키를 한 번에 읽어와 JSON 파싱까지 마친 값 배열로 반환 (없거나 파싱 실패한 항목은 제외)
async function storageGetMany(prefix, shared){
  const table = supabaseTableFor(prefix);
  if(table){
    await ensureSupabaseCaches();
    try{
      // [V73/F단계] 이 테이블들은 여러 테넌트 데이터가 한 테이블에 같이 들어있으므로
      // 항상 현재 테넌트로 필터링한다(예전엔 이게 빠져있어서 목록을 통째로 가져오고 있었음).
      let query = table + '?select=*&tenant_id=eq.' + encodeURIComponent(CURRENT_TENANT_CODE);
      // [V68/C단계] building_edit_history는 한 테이블에 모든 대상물 이력이 섞여있으므로,
      // prefix('building_history:<건물>:')에서 건물명을 뽑아 그 건물만 필터링해서 가져온다.
      if(table === 'building_edit_history' && prefix.indexOf('building_history:') === 0){
        const building = prefix.slice('building_history:'.length, -1);
        const bId = _buildingIdByName[building];
        query += '&building_id=eq.' + encodeURIComponent(bId || '00000000-0000-0000-0000-000000000000');
      }
      const rows = await sbFetch(query);
      backendOnline = true; updateSyncBanner();
      return (rows||[]).map(r=>rowToEntryFor(table, r));
    }catch(e){
      console.error('Supabase 목록조회 실패', e);
      backendOnline = false; updateSyncBanner();
      return [];
    }
  }
  const res = await callAppsScript({ action:'listValues', prefix: prefix||'', shared: !!shared });
  const values = (res && res.values) || [];
  return values.map(v=>{ try{ return JSON.parse(v); }catch(e){ return null; } }).filter(Boolean);
}


// ---- UI 커스터마이징 저장(위치 추가, 칩 순서, 직접추가 항목) : 3인 공유 저장소 사용 ----
let uiPrefs = { locationOverrides:{}, equipOrder:{}, customEquip:{}, subEquipOrder:{}, customSubEquip:{}, defectTagOrder:{}, customDefectTags:{}, defaultLocation:{}, locationRenames:{}, structureOverrides:{}, inspectionSession:{}, customBuildings:{}, customBuildingsDeleted:[] };
async function loadUiPrefs(){
  try{
    const res = await storageGet('ui_prefs', true);
    if(res && res.value){ const parsed = JSON.parse(res.value); Object.assign(uiPrefs, parsed); lsCacheSet('ui_prefs', uiPrefs); return; }
  }catch(e){}
  const cached = lsCacheGet('ui_prefs'); // [v65] 오프라인이면 마지막으로 받아둔 값으로라도 채운다
  if(cached) Object.assign(uiPrefs, cached);
}
const uiPrefsReady = loadUiPrefs();
let uiPrefsSaveTimer = null;
// 세 사람이 동시에 태그/설비를 추가할 수 있으므로, 저장 직전에 공유저장소의 "최신값"을 다시 읽어와
// (추가류 항목은 합집합으로, 순서류는 마지막 사람 기준으로) 병합한 뒤 저장한다 → 서로 덮어쓰지 않음.
function unionMergeMap(remote, local){
  const merged = {}; const keys = new Set([...Object.keys(remote||{}), ...Object.keys(local||{})]);
  keys.forEach(k=>{ merged[k] = [...new Set([...(remote&&remote[k]||[]), ...(local&&local[k]||[])])]; });
  return merged;
}
function mergeLocationOverrides(remote, local){
  const merged = {}; const keys = new Set([...Object.keys(remote||{}), ...Object.keys(local||{})]);
  keys.forEach(b=>{
    const r = (remote&&remote[b]) || {wings:[],floors:[]};
    const l = (local&&local[b]) || {wings:[],floors:[]};
    merged[b] = { wings:[...new Set([...(r.wings||[]), ...(l.wings||[])])], floors:[...new Set([...(r.floors||[]), ...(l.floors||[])])] };
  });
  return merged;
}
// 대상물별 동/층 "오탈자 수정" 이력 병합 — { [건물]: { wings:{옛값:새값}, floors:{옛값:새값} } }
function mergeLocationRenames(remote, local){
  const merged = {}; const keys = new Set([...Object.keys(remote||{}), ...Object.keys(local||{})]);
  keys.forEach(b=>{
    const r = (remote&&remote[b]) || {wings:{},floors:{}};
    const l = (local&&local[b]) || {wings:{},floors:{}};
    merged[b] = { wings: Object.assign({}, r.wings, l.wings), floors: Object.assign({}, r.floors, l.floors) };
  });
  return merged;
}
function saveUiPrefsDebounced(){
  clearTimeout(uiPrefsSaveTimer);
  uiPrefsSaveTimer = setTimeout(async ()=>{
    try{
      const res = await storageGet('ui_prefs', true);
      const remote = res && res.value ? JSON.parse(res.value) : {};
      uiPrefs = {
        locationOverrides: mergeLocationOverrides(remote.locationOverrides, uiPrefs.locationOverrides),
        equipOrder: Object.assign({}, remote.equipOrder, uiPrefs.equipOrder),
        customEquip: unionMergeMap(remote.customEquip, uiPrefs.customEquip),
        subEquipOrder: Object.assign({}, remote.subEquipOrder, uiPrefs.subEquipOrder),
        customSubEquip: unionMergeMap(remote.customSubEquip, uiPrefs.customSubEquip),
        defectTagOrder: Object.assign({}, remote.defectTagOrder, uiPrefs.defectTagOrder),
        customDefectTags: unionMergeMap(remote.customDefectTags, uiPrefs.customDefectTags),
        defaultLocation: Object.assign({}, remote.defaultLocation, uiPrefs.defaultLocation), // 대상물별 "기본 위치" — 마지막에 저장한 사람 기준
        locationRenames: mergeLocationRenames(remote.locationRenames, uiPrefs.locationRenames), // 대상물별 동/층 오탈자 수정 이력
        structureOverrides: Object.assign({}, remote.structureOverrides, uiPrefs.structureOverrides), // [v44] 대상물별 동/층 구조 전체 편집본 — 통째로 교체하는 작업이라 건물 단위로 "마지막에 저장한 사람 기준"으로 병합
        inspectionSession: Object.assign({}, remote.inspectionSession, uiPrefs.inspectionSession), // 대상물별 "오늘의 점검종류" — 마지막에 저장한 사람 기준
      };
      // [v37] 수기 일정(+새 일정 추가) 병합 — 추가는 합집합, 삭제는 "삭제이력(tombstone)"을 합쳐서
      // 다른 팀원이 아직 갖고있는 예전 값이 되살아나지 않게 한다(마지막에 지운 사람 기준으로 확정).
      {
        const delSet = new Set([...(remote.customBuildingsDeleted||[]), ...(uiPrefs.customBuildingsDeleted||[])]);
        const mergedCB = Object.assign({}, remote.customBuildings, uiPrefs.customBuildings);
        delSet.forEach(id=>{ delete mergedCB[id]; });
        uiPrefs.customBuildings = mergedCB;
        uiPrefs.customBuildingsDeleted = [...delSet];
      }
      const res2 = await storageSet('ui_prefs', JSON.stringify(uiPrefs), true);
      if(!res2) markUiPrefsPending(true); // [v65] 실패 — 나중에 재시도할 때 이 스냅샷을 그대로 재전송하지 않고, 병합을 처음부터 다시 함
    }catch(e){ markUiPrefsPending(true); }
  }, 400);
}
function applyLocationOverrides(building){
  const ov = uiPrefs.locationOverrides[building];
  if(!ov) return;
  const struct = BUILDING_STRUCTURE[building] || (BUILDING_STRUCTURE[building] = {wings:[...BUILDING_STRUCTURE['_default'].wings], floors:[...BUILDING_STRUCTURE['_default'].floors]});
  (ov.wings||[]).forEach(w=>{ if(!struct.wings.includes(w)) struct.wings.push(w); });
  (ov.floors||[]).forEach(f=>{ if(!struct.floors.includes(f)) struct.floors.push(f); });
}
// [v20 신규] 대상물마다 하드코딩된 동/층 이름에 오탈자·오류가 있을 수 있다(예: 꽃바위유치원의
// 'B3'가 실제로는 'F3'이어야 하는 경우). 이런 건 "다른 값을 기본으로 고르기"가 아니라 목록에
// 있는 값 자체를 고쳐야 하므로, 저장해둔 수정 이력(locationRenames)을 구조에 실제로 적용한다.
function applyLocationRenames(building){
  const renames = uiPrefs.locationRenames[building];
  if(!renames) return;
  const struct = BUILDING_STRUCTURE[building];
  if(!struct) return;
  Object.entries(renames.wings||{}).forEach(([oldV,newV])=>{ const i=struct.wings.indexOf(oldV); if(i!==-1) struct.wings[i]=newV; });
  Object.entries(renames.floors||{}).forEach(([oldV,newV])=>{ const i=struct.floors.indexOf(oldV); if(i!==-1) struct.floors[i]=newV; });
  // 기본값으로 저장해둔 값이 옛 이름을 가리키고 있었다면 그것도 같이 바꿔준다.
  const def = uiPrefs.defaultLocation[building];
  if(def){
    if(def.wing && renames.wings && renames.wings[def.wing]) def.wing = renames.wings[def.wing];
    if(def.floor && renames.floors && renames.floors[def.floor]) def.floor = renames.floors[def.floor];
  }
}
// [v44 신규] "동/층 구조 편집" 결과 적용 — locationOverrides(추가만)·locationRenames(1:1 이름 수정)와 달리,
// 이 편집은 대상물의 동/층 구조 자체를 통째로 재정의(교체)한다. 기준 동/층 정보가 실제와 다르면(마스터DB
// 오류 포함) 지우거나 바꾸고, 새 동/층은 추가하는 현장 요구를 반영. 저장된 값이 있으면 항상 최종 우선 적용.
function applyStructureOverride(building){
  const ov = uiPrefs.structureOverrides[building];
  if(!ov) return;
  BUILDING_STRUCTURE[building] = {
    wings: [...(ov.wings||[])],
    floors: [...(ov.floors||[])],
    floorsByWing: ov.floorsByWing ? JSON.parse(JSON.stringify(ov.floorsByWing)) : undefined
  };
}
// 칩 컨테이너에 드래그 정렬 부여 (재렌더링마다 안전하게 재부착)
function attachSortable(el, onEnd){
  if(!window.Sortable || !el) return;
  if(el._sortableInst){ try{ el._sortableInst.destroy(); }catch(e){} }
  el._sortableInst = new Sortable(el, { animation:150, filter:'.chip.add,.chip-input', onEnd });
}
function compressImage(file){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = e=>{
      const img = new Image();
      img.onload = ()=>{
        const maxW = 900;
        const scale = Math.min(1, maxW/img.width);
        const canvas = document.createElement('canvas');
        canvas.width = img.width*scale; canvas.height = img.height*scale;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img,0,0,canvas.width,canvas.height);
        resolve(canvas.toDataURL('image/jpeg',0.6));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

