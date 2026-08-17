// ============================================================
// photo-album-construction.js
// 공사 사진대장 + 점검 사진대장(태그/촬영모드) (원본 5059~5846줄)
// ※ E단계 모듈화(V77) 시 원본 v76 단일 파일에서 그대로 잘라낸 것으로,
//   전역 스코프를 그대로 사용하며 기존 함수 간 참조 관계는 100% 동일합니다.
// ============================================================
// ================= 공사 사진 대장 (점검 일정과는 무관하지만, [v27] 대상물별로 구분해서 기록) =================
let constructionEntries = [];
let constructionBeforePhoto = null;
let constructionAfterPhoto = null;

async function loadConstructionEntries(){
  const list = await storageGetMany('construction:', true);
  if(backendOnline){
    const serverIds = new Set(list.map(e=>e.id));
    const stillPending = constructionEntries.filter(e=>e.id && !serverIds.has(e.id));
    constructionEntries = [...list, ...stillPending].sort((a,b)=>a.ts-b.ts);
    lsCacheSet('construction', constructionEntries);
  } else {
    constructionEntries = lsCacheGet('construction') || constructionEntries;
  }
  renderConstructionEntries();
}
async function saveConstructionEntry(entry){
  const res = await storageSet('construction:'+entry.id, JSON.stringify(entry), true);
  if(!res && !navigator.onLine) showToast('오프라인 - 이 기기에 저장됨(연결되면 자동 동기화)');
}
async function deleteConstructionEntry(id){
  try{ await storageDelete('construction:'+id, true); }catch(e){}
}
// [v27] 전체 목록(constructionEntries)은 모든 대상물의 항목을 그대로 들고 있고(다른 대상물 것도
// 팀원 동기화를 위해 계속 로드해둠), 화면에는 "지금 보고 있는 대상물" 것만 필터링해 보여준다.
// 불량내역/점검사진대장과 동일한 패턴(entry.building===currentBuilding).
function renderConstructionEntries(){
  lsCacheSet('construction', constructionEntries); // [v65] 로컬 변경분도 즉시 캐시에 반영
  $('constructionBuildingLabel').textContent = currentBuilding || '(대상물 미선택)';
  const buildingEntries = constructionEntries.filter(en=>en.building===currentBuilding);
  $('constructionCount').textContent = buildingEntries.length;
  const list = $('constructionList'); list.innerHTML='';
  $('constructionEmpty').style.display = buildingEntries.length ? 'none':'block';
  buildingEntries.slice().reverse().forEach(entry=>{
    const div = document.createElement('div');
    div.className = 'entry';
    div.innerHTML = `
      <div style="display:flex;gap:4px;flex-shrink:0;">
        ${entry.beforePhoto ? `<img src="${entry.beforePhoto}" style="width:44px;height:44px;border-radius:6px;object-fit:cover;">` : `<div style="width:44px;height:44px;border-radius:6px;background:#eee;"></div>`}
        ${entry.afterPhoto ? `<img src="${entry.afterPhoto}" style="width:44px;height:44px;border-radius:6px;object-fit:cover;">` : `<div style="width:44px;height:44px;border-radius:6px;background:#eee;"></div>`}
      </div>
      <div class="meta">
        <div class="title">${entry.itemLabel || '(항목명 미입력)'}</div>
        <div class="sub">${entry.siteName || ''} · ${new Date(entry.ts).toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</div>
      </div>
      <button class="del-btn" data-id="${entry.id}">✕</button>
    `;
    list.appendChild(div);
  });
  list.querySelectorAll('.del-btn').forEach(btn=>{
    btn.onclick = ()=>{
      if(!confirm('이 항목을 삭제할까요?')) return;
      const id = btn.dataset.id;
      constructionEntries = constructionEntries.filter(en=>en.id!==id);
      renderConstructionEntries();
      deleteConstructionEntry(id).catch(()=>{ showToast('삭제 동기화 실패 - 잠시 후 다시 시도해주세요'); });
    };
  });
}
$('constructionBeforeBtn').onclick = ()=> $('constructionBeforeInput').click();
$('constructionBeforeInput').onchange = async (e)=>{
  const file = e.target.files[0]; if(!file) return;
  showToast('사진 처리 중...');
  constructionBeforePhoto = await compressImage(file);
  $('constructionBeforePreview').src = constructionBeforePhoto; $('constructionBeforePreview').style.display='block';
};
$('constructionAfterBtn').onclick = ()=> $('constructionAfterInput').click();
$('constructionAfterInput').onchange = async (e)=>{
  const file = e.target.files[0]; if(!file) return;
  showToast('사진 처리 중...');
  constructionAfterPhoto = await compressImage(file);
  $('constructionAfterPreview').src = constructionAfterPhoto; $('constructionAfterPreview').style.display='block';
};
$('constructionSaveBtn').onclick = async ()=>{
  if(!currentBuilding){ showToast('대상물을 먼저 선택해주세요'); return; }
  const siteName = $('constructionSiteName').value.trim();
  const itemLabel = $('constructionItemLabel').value.trim();
  if(!siteName){ showToast('공사명을 입력해주세요'); return; }
  if(!itemLabel){ showToast('교체 대상 항목을 입력해주세요'); return; }
  if(!constructionBeforePhoto && !constructionAfterPhoto){ showToast('작업전/작업후 사진 중 최소 1장은 촬영해주세요'); return; }
  const entry = {
    id: Date.now()+'-'+Math.random().toString(36).slice(2,7),
    building: currentBuilding,
    siteName, itemLabel,
    beforePhoto: constructionBeforePhoto, afterPhoto: constructionAfterPhoto,
    // [v31] 참고용 점검회차 태깅 — 공사기록은 점검일정과 무관한 독립 기록이라 미선택이어도 저장은 막지 않음
    inspectionType: currentInspectionType,
    inspectionDate: currentInspectionDate,
    inspectionId: currentInspectionId,
    ts: Date.now()
  };
  constructionEntries.push(entry);
  await saveConstructionEntry(entry);
  renderConstructionEntries();
  showToast('저장했습니다 (팀원과 공유됨)');
  $('constructionItemLabel').value='';
  constructionBeforePhoto=null; constructionAfterPhoto=null;
  $('constructionBeforePreview').style.display='none';
  $('constructionAfterPreview').style.display='none';
};
$('constructionExportXlsxBtn').onclick = async ()=>{
  if(!currentBuilding){ showToast('대상물을 먼저 선택해주세요'); return; }
  const buildingEntries = constructionEntries.filter(en=>en.building===currentBuilding);
  if(!buildingEntries.length){ showToast('이 대상물의 저장된 항목이 없습니다'); return; }
  const siteName = buildingEntries[buildingEntries.length-1].siteName || currentBuilding || '공사현장';
  const pairs = buildingEntries.map(en=>[
    en.beforePhoto ? { photo: en.beforePhoto, tag: `${en.itemLabel||''} (작업전)` } : undefined,
    en.afterPhoto ? { photo: en.afterPhoto, tag: `${en.itemLabel||''} (작업후)` } : undefined,
  ]);
  await generateAlbumXlsx({
    title: '공사 사진 대장',
    subjectName: siteName,
    headerLabel: '공 사   사 진',
    pairs,
    filenamePrefix: '공사사진대장',
  });
};
$('constructionClearBtn').onclick = async ()=>{
  if(!currentBuilding){ showToast('대상물을 먼저 선택해주세요'); return; }
  // [v27 변경] 예전엔 "전체 초기화"가 모든 대상물의 공사 사진 대장을 통째로 지웠다.
  // 대상물별로 화면이 분리된 지금은 "지금 보고 있는 대상물" 것만 지우도록 범위를 좁힌다
  // (불량내역/점검사진대장의 "이 대상물만 삭제"와 동일한 방식).
  if(!confirm(`⚠️ "${currentBuilding}"의 공사 사진 대장을 팀 전체와 공유된 상태로 삭제합니다. 다른 대상물의 데이터는 그대로 남습니다. 되돌릴 수 없는데 진행할까요?`)) return;
  const toDelete = constructionEntries.filter(en=>en.building===currentBuilding);
  await Promise.all(toDelete.map(en=>deleteConstructionEntry(en.id)));
  constructionEntries = constructionEntries.filter(en=>en.building!==currentBuilding);
  renderConstructionEntries();
  showToast(`"${currentBuilding}"의 공사 사진 대장을 삭제했습니다`);
};

// ================= 점검 사진대장 =================
// ---------------------------------------------------------------------------
// 📌 개발자용 설정: 사진대장 기본 태그 목록 (fallback 전용, v14부터)
//    [v14] 이 배열은 더 이상 "기본값"이 아니라 EQUIP_DB에 등록되지 않은 대상물
//    (예: 직접입력으로 새로 추가한 대상물)일 때만 쓰이는 최후의 안전장치다.
//    실제 기본값은 아래 composePhotoAlbumTags()가 대상물별 설치 설비(EQUIP_DB)를
//    보고 매번 새로 계산한다.
// ---------------------------------------------------------------------------
// ================= 점검 사진대장 =================
// ---------------------------------------------------------------------------
// 📌 개발자용 설정: 사진대장 기본 태그 목록 (첫 화면 기본 표시용)
// ---------------------------------------------------------------------------
const DEFAULT_TAGS = [
  '수신기 기능점검','소화기 압력점검','수동발신기 작동점검','옥내소화전 함내점검',
  '연기감지기 작동점검','열감지기 작동점검','유도등 점검','비상조명등 점검','고가수조 점검',
  '방화문 기능점검','펌프성능시험(정격유량)','펌프성능시험(150%유량)','스프링클러헤드 점검',
  '완강기 점검','구조대 점검','유수검지장치 작동 점검','상수도소화설비 점검','비상방송설비 점검',
];

// ---------------------------------------------------------------------------
// 📌 사진대장 구성 로직 (대상물별 설비 연동)
// ---------------------------------------------------------------------------
function _equipListOf(building){ return EQUIP_DB[building] || EQUIP_DB['_default'] || []; }
function _hasEquip(building, names){
  return _equipListOf(building).some(e => names.includes(e.name));
}
function _hasEquipWithSub(building, equipName, subNames){
  const eq = _equipListOf(building).find(e => e.name === equipName);
  if(!eq || !Array.isArray(eq.sub)) return false;
  return eq.sub.some(s => subNames.includes(s));
}
function _hasEquipLoose(building, names){
  const aliasMap = { '연기감지기':'감지기', '열감지기':'감지기',
    '피난구유도등':'유도등', '복도통로유도등':'유도등', '계단통로유도등':'유도등', '거실통로유도등':'유도등' };
  const looseNames = names.map(n=>aliasMap[n]).filter(Boolean);
  return _hasEquip(building, names) || (looseNames.length && _hasEquip(building, looseNames));
}
function _hasPumpSpec(building){
  if(typeof BUILDINGS_MASTER === 'undefined' || !BUILDINGS_MASTER || !BUILDINGS_MASTER.data) return false;
  const entry = findMasterEntryByName(building);
  if(!entry || !entry.spec) return false;
  const common = entry.spec['수계소화설비(공통)'];
  return !!(common && common['가압송수장치'] && common['가압송수장치'].length);
}
function _hasPumpEquip(building){
  const bySub = _equipListOf(building).some(e => Array.isArray(e.sub) && e.sub.some(s => NESTED_PUMP_EQUIP.includes(s)));
  return bySub || _hasPumpSpec(building);
}

const PHOTO_ALBUM_FIXED_1_7 = [
  { label:'수신기 기능점검',        check:b=>_hasEquip(b,['수신기']) },
  { label:'소화기 압력점검',        check:b=>_hasEquip(b,['분말소화기','K급소화기','자동확산소화기']) },
  { label:'수동발신기 작동점검',    check:b=>_hasEquip(b,['발신기']) },
  { label:'옥내소화전 함내점검',    check:b=>_hasEquip(b,['옥내소화전']) },
  { label:'연기감지기 작동점검',    check:b=>_hasEquipLoose(b,['연기감지기']) },
  { label:'열감지기 작동점검',      check:b=>_hasEquipLoose(b,['열감지기']) },
  { label:'유도등 점검',            check:b=>_hasEquipLoose(b,['피난구유도등','복도통로유도등','계단통로유도등','거실통로유도등']) },
];
const PHOTO_ALBUM_POOL_8_10 = [
  { label:'비상조명등 점검',        check:b=>_hasEquip(b,['비상조명등','휴대용비상조명등']) },
  { label:'고가수조 점검',          check:b=>_hasEquip(b,['고가수조']) },
  { label:'방화문 기능점검',        check:b=>_hasEquip(b,['방화문']) },
  { label:'완강기 점검',            check:b=>_hasEquip(b,['완강기']) },
  { label:'구조대 점검',            check:b=>_hasEquip(b,['구조대']) },
  { label:'유수검지장치 작동 점검', check:b=>_hasEquipWithSub(b,'스프링클러',['알람밸브','프리액션밸브(준비작동식)','드라이밸브(건식)']) },
  { label:'상수도소화설비 점검',    check:b=>_hasEquip(b,['상수도소화용수설비']) },
];
const PHOTO_ALBUM_PUMP_11_12 = ['펌프성능시험(정격유량)','펌프성능시험(150%유량)'];

function composePhotoAlbumTags(building){
  // 대상물이 없거나 정보가 없으면 기본 DEFAULT_TAGS 반환
  if(!building || !EQUIP_DB[building]) return [...DEFAULT_TAGS]; 
  
  const fixedOk = PHOTO_ALBUM_FIXED_1_7.filter(x=>x.check(building)).map(x=>x.label);
  const poolOk = PHOTO_ALBUM_POOL_8_10.filter(x=>x.check(building)).map(x=>x.label);
  const pumpOk = _hasPumpEquip(building) ? PHOTO_ALBUM_PUMP_11_12 : [];
  
  const calculated = [...fixedOk, ...poolOk, ...pumpOk];
  
  // 계산된 결과가 비어있거나 부족할 경우 DEFAULT_TAGS를 기반으로 안전하게 통합 제공
  return calculated.length > 0 ? Array.from(new Set([...DEFAULT_TAGS, ...calculated])) : [...DEFAULT_TAGS];
}

let TAGS = [...DEFAULT_TAGS];  // 최초 실행 시 화면에는 항상 DEFAULT_TAGS가 나타나도록 설정
let currentTag = null;
let photoEntries = [];

async function loadTags(){
  // 첫 화면 진입 시 사용자 경험을 위해 즉시 DEFAULT_TAGS 기반으로 렌더링
  TAGS = [...DEFAULT_TAGS];
  renderTags(); 

  try{
    const res = await storageGet('photo_tag_list:'+currentBuilding, true);
    if (res && res.value) {
      TAGS = JSON.parse(res.value);
    } else {
      // 저장된 커스텀 태그가 없을 경우 대상물 맞춤형 또는 기본값 반영
      TAGS = composePhotoAlbumTags(currentBuilding);
    }
  }catch(e){ 
    TAGS = [...DEFAULT_TAGS]; 
  }
  renderTags();
}

async function persistTags(){
  try{ await storageSet('photo_tag_list:'+currentBuilding, JSON.stringify(TAGS), true); }
  catch(e){ showToast('태그 저장 실패'); }
}

function renderTags(){
  const el = $('tagChips'); el.innerHTML='';
  TAGS.forEach(tag=>{
    const b = document.createElement('button');
    b.className = 'chip' + (currentTag===tag && currentTagGroup==='report' ? ' active':'');
    b.textContent = tag;
    b.onclick = ()=>{
      currentTag = tag; currentTagGroup='report'; $('tagCustom').value=''; $('otherTagCustom').value='';
      renderTags(); renderOtherTags(); updateTagCurrent();
      $('photoInput').click(); // 태그 선택 시 바로 카메라 작동
    };
    el.appendChild(b);
  });
}
// ---- 기타 보관용 사진 태그 (보고서 엑셀에는 포함되지 않음, 별도 PDF용) ----
const DEFAULT_OTHER_TAGS = ['현장 특이사항','민원 관련','안전조치 전/후','자재·부품 확인','기타'];
let OTHER_TAGS = [...DEFAULT_OTHER_TAGS];
let currentTagGroup = 'report'; // 'report' | 'other'
async function loadOtherTags(){
  renderOtherTags(); // 즉시 표시(깜빡임 방지)
  try{
    const res = await storageGet('photo_other_tag_list', true);
    OTHER_TAGS = (res && res.value) ? JSON.parse(res.value) : [...DEFAULT_OTHER_TAGS];
  }catch(e){ OTHER_TAGS = [...DEFAULT_OTHER_TAGS]; }
  renderOtherTags();
}
async function persistOtherTags(){
  try{ await storageSet('photo_other_tag_list', JSON.stringify(OTHER_TAGS), true); }
  catch(e){ showToast('태그 저장 실패'); }
}
function renderOtherTags(){
  const el = $('otherTagChips'); el.innerHTML='';
  OTHER_TAGS.forEach(tag=>{
    const b = document.createElement('button');
    b.className = 'chip' + (currentTag===tag && currentTagGroup==='other' ? ' active':'');
    b.textContent = tag;
    b.onclick = ()=>{ currentTag = tag; currentTagGroup='other'; $('tagCustom').value=''; $('otherTagCustom').value=''; renderTags(); renderOtherTags(); updateTagCurrent(); };
    el.appendChild(b);
  });
  const addBtn = document.createElement('button');
  addBtn.className = 'chip add';
  addBtn.textContent = '+ 추가';
  addBtn.onclick = ()=>{
    const input = document.createElement('input');
    input.className = 'chip-input';
    input.placeholder = '태그 입력 후 Enter';
    addBtn.replaceWith(input);
    input.focus();
    const commit = async ()=>{
      const v = input.value.trim();
      if(v && !OTHER_TAGS.includes(v)){ OTHER_TAGS.push(v); await persistOtherTags(); }
      if(v){ currentTag=v; currentTagGroup='other'; $('tagCustom').value=''; $('otherTagCustom').value=''; }
      renderTags(); renderOtherTags(); updateTagCurrent();
    };
    input.addEventListener('keydown', ev=>{ if(ev.key==='Enter'){ ev.preventDefault(); commit(); } });
    input.addEventListener('blur', commit);
  };
  el.appendChild(addBtn);
}

// ---- 태그 편집 오버레이 (드래그로 순서 변경, 탭하면 이름 수정창) ----
let tagSortable = null;
let renamingTagIndex = null;

function renderTagManage(){
  const el = $('tagManageList'); el.innerHTML='';
  TAGS.forEach((tag,i)=>{
    const row = document.createElement('div');
    row.className = 'tag-row';
    row.dataset.i = i;
    row.innerHTML = `
      <span class="tag-handle">☰</span>
      <span class="tag-label" data-i="${i}">${tag.replace(/</g,'&lt;')}</span>
      <button type="button" class="tag-del" data-i="${i}">✕</button>
    `;
    el.appendChild(row);
  });
  el.querySelectorAll('.tag-label').forEach(span=>{
    span.onclick = ()=>{
      renamingTagIndex = +span.dataset.i;
      $('tagRenameInput').value = TAGS[renamingTagIndex];
      $('tagRenameOverlay').classList.add('show');
      setTimeout(()=>$('tagRenameInput').focus(), 50);
    };
  });
  el.querySelectorAll('.tag-del').forEach(btn=>{
    btn.onclick = ()=>{
      const i = +btn.dataset.i;
      TAGS.splice(i,1);
      renderTagManage(); renderTags();
      persistTags();
    };
  });

  if(tagSortable){ tagSortable.destroy(); tagSortable=null; }
  if(typeof Sortable !== 'undefined'){
    tagSortable = Sortable.create(el, {
      handle: '.tag-handle',
      animation: 150,
      onEnd: ()=>{
        const newOrder = Array.from(el.querySelectorAll('.tag-row')).map(row => TAGS[+row.dataset.i]);
        TAGS = newOrder;
        renderTagManage();  // data-i 값들을 새 순서 기준으로 다시 매김
        renderTags();
        persistTags(); // 저장은 백그라운드에서 진행(화면은 이미 바뀐 순서로 즉시 표시됨)
      },
    });
  }
}
$('tagManageBtn').onclick = ()=>{ renderTagManage(); $('tagManageOverlay').classList.add('show'); };
$('tagManageClose').onclick = ()=>{ $('tagManageOverlay').classList.remove('show'); };
$('tagManageOverlay').onclick = (e)=>{ if(e.target.id==='tagManageOverlay') $('tagManageOverlay').classList.remove('show'); };
$('tagAddBtn').onclick = ()=>{
  const v = $('tagNewInput').value.trim();
  if(!v){ showToast('태그 이름을 입력해주세요'); return; }
  TAGS.push(v);
  $('tagNewInput').value='';
  renderTagManage(); renderTags();
  persistTags();
};
$('tagResetBtn').onclick = ()=>{
  if(!confirm('이 대상물의 설치 설비 기준으로 자동 계산된 기본 태그로 되돌릴까요? 직접 편집한 내용은 사라집니다.')) return;
  TAGS = composePhotoAlbumTags(currentBuilding);
  renderTagManage(); renderTags();
  persistTags();
  showToast('대상물 기준 기본 태그로 초기화했습니다');
};

// ---- 태그 이름 수정 편집창 ----
$('tagRenameSaveBtn').onclick = ()=>{
  const v = $('tagRenameInput').value.trim();
  if(!v || renamingTagIndex===null){ $('tagRenameOverlay').classList.remove('show'); return; }
  TAGS[renamingTagIndex] = v;
  renamingTagIndex = null;
  $('tagRenameOverlay').classList.remove('show');
  renderTagManage(); renderTags();
  persistTags();
};
$('tagRenameCancelBtn').onclick = ()=>{ renamingTagIndex=null; $('tagRenameOverlay').classList.remove('show'); };
$('tagRenameOverlay').onclick = (e)=>{ if(e.target.id==='tagRenameOverlay'){ renamingTagIndex=null; $('tagRenameOverlay').classList.remove('show'); } };

function updateTagCurrent(){
  const custom = $('tagCustom').value.trim() || $('otherTagCustom').value.trim();
  const active = custom || currentTag;
  const groupLabel = currentTagGroup==='other' ? ' (기타 보관용)' : '';
  $('tagCurrent').textContent = active ? `다음 태그로 촬영합니다: "${active}"${groupLabel}` : '태그를 선택하거나 입력한 뒤 촬영하세요';
}
$('tagCustom').oninput = ()=>{
  if($('tagCustom').value.trim()){ currentTag=null; currentTagGroup='report'; $('otherTagCustom').value=''; renderTags(); renderOtherTags(); }
  updateTagCurrent();
};
$('otherTagCustom').oninput = ()=>{
  if($('otherTagCustom').value.trim()){ currentTag=null; currentTagGroup='other'; $('tagCustom').value=''; renderTags(); renderOtherTags(); }
  updateTagCurrent();
};
function getActiveTagInfo(){
  if(currentTagGroup==='other'){
    const custom = $('otherTagCustom').value.trim();
    return { tag: custom || currentTag, group:'other' };
  }
  const custom = $('tagCustom').value.trim();
  return { tag: custom || currentTag, group:'report' };
}
// [v27] 사진 등록 방식 토글: 기본은 "촬영"(카메라 직행), "사진함에서 선택"을 고르면
// photoInput의 capture 속성을 떼어내 OS 사진 선택창이 뜨게 한다. 매번 다시 묻지 않도록
// 선택값을 sessionStorage에 저장해, 12장을 다 등록할 때까지(혹은 사용자가 직접 다시 바꿀 때까지) 유지한다.
let photoCaptureMode = (function(){
  try{ return sessionStorage.getItem('_photoCaptureMode') || 'camera'; }catch(e){ return 'camera'; }
})();
function applyCaptureMode(){
  const input = $('photoInput');
  if(photoCaptureMode==='library'){ input.removeAttribute('capture'); }
  else { input.setAttribute('capture','environment'); }
  $('captureModeCameraBtn').classList.toggle('active-mode', photoCaptureMode==='camera');
  $('captureModeLibraryBtn').classList.toggle('active-mode', photoCaptureMode==='library');
}
$('captureModeCameraBtn').onclick = ()=>{
  if(photoCaptureMode==='camera') return;
  photoCaptureMode = 'camera';
  try{ sessionStorage.setItem('_photoCaptureMode','camera'); }catch(e){}
  applyCaptureMode();
  showToast('촬영 모드로 전환했습니다');
};
$('captureModeLibraryBtn').onclick = ()=>{
  if(photoCaptureMode==='library') return;
  photoCaptureMode = 'library';
  try{ sessionStorage.setItem('_photoCaptureMode','library'); }catch(e){}
  applyCaptureMode();
  showToast('사진함에서 선택하는 모드로 전환했습니다. 등록을 마칠 때까지 계속 이 모드가 유지됩니다');
};
applyCaptureMode();
$('tagCustomShootBtn').onclick = ()=>{
  const v = $('tagCustom').value.trim();
  if(!v){ showToast('태그를 입력해주세요'); return; }
  currentTag = v; currentTagGroup = 'report'; $('otherTagCustom').value='';
  renderTags(); renderOtherTags(); updateTagCurrent();
  // [v14 버그수정] 아래 photoBtn과 동일한 이유로, 촬영 직전 태그를 미리 저장해둔다.
  try{ sessionStorage.setItem('_pendingCaptureTag', JSON.stringify({ tag:v, group:'report', building:currentBuilding })); }catch(err){}
  $('photoInput').click();
};
$('photoBtn').onclick = ()=>{
  const { tag, group } = getActiveTagInfo();
  if(!tag){ showToast('먼저 태그를 선택하거나 입력해주세요'); return; }
  // [v14 버그수정] 카메라 앱이 실행되는 동안 모바일 브라우저가 메모리 확보를 위해 페이지를
  // 껐다가 되살리면 currentTag 같은 JS 변수가 초기값(null)으로 리셋될 수 있다. 그러면 카메라에서
  // 돌아온 뒤 저장되는 사진의 태그가 null이 되어(화면엔 "null"로 표시) 순서까지 뒤로 밀려버린다.
  // 이를 막기 위해 "촬영 버튼을 누른 바로 그 순간"의 태그값을 sessionStorage에 미리 적어두고,
  // photoInput의 onchange에서는 라이브 상태(currentTag) 대신 이 값을 우선 신뢰한다.
  try{ sessionStorage.setItem('_pendingCaptureTag', JSON.stringify({ tag, group, building:currentBuilding })); }catch(err){}
  $('photoInput').click();
};
$('photoInput').onchange = async (e)=>{
  const file = e.target.files[0]; if(!file) return;
  // [v14 버그수정] 라이브 상태(currentTag)가 리셋되었을 수 있으니, 촬영 직전 저장해둔
  // sessionStorage 값을 우선 사용하고, 그것도 없을 때만 최후수단으로 현재 라이브 상태를 본다.
  let tag, group, building = currentBuilding;
  try{
    const pending = JSON.parse(sessionStorage.getItem('_pendingCaptureTag') || 'null');
    if(pending && pending.tag){ tag = pending.tag; group = pending.group || 'report'; building = pending.building || currentBuilding; }
  }catch(err){}
  if(!tag){ const info = getActiveTagInfo(); tag = info.tag; group = info.group; }
  if(!tag){
    // [v14 버그수정] 예전에는 이 경우에도 tag=null로 그냥 저장해버려서 캡션이 "null"로 뜨고
    // 엑셀/미리보기 순서까지 맨 뒤로 밀려나는 문제가 있었다. 이제는 태그 없는 저장 자체를 막는다.
    showToast('태그 정보를 잃어버려 사진을 저장하지 못했습니다. 태그를 다시 선택하고 촬영해주세요');
    $('photoInput').value='';
    return;
  }
  showToast('사진 처리 중...');
  const dataUrl = await compressImage(file);
  const entry = { id: Date.now()+'-'+Math.random().toString(36).slice(2,7), building, tag, group, photo: dataUrl, ts: Date.now(), include:true, inspectionType: currentInspectionType, inspectionDate: currentInspectionDate, inspectionId: currentInspectionId };
  photoEntries.push(entry);
  await savePhotoEntry(entry);
  renderPhotoEntries();
  showToast('저장했습니다 (팀원과 공유됨): '+tag);
  $('photoInput').value='';
  try{ sessionStorage.removeItem('_pendingCaptureTag'); }catch(err){}
  currentTag=null; $('tagCustom').value=''; $('otherTagCustom').value=''; renderTags(); renderOtherTags(); updateTagCurrent();
};
let photoTrash = [];
async function loadPhotoEntries(){
  const all = await storageGetMany('photo:', true);
  if(backendOnline){
    // [v65] 사진은 용량이 커서 localStorage에 통째로 영구 캐시하진 않지만, 서버에 아직 안 올라간
    // (동기화 대기중) 로컬 항목이 재조회 시 사라지지 않도록 id 기준으로는 병합해둔다.
    const serverIds = new Set(all.map(e=>e.id));
    const stillPending = [...photoEntries, ...photoTrash].filter(e=>e.id && !serverIds.has(e.id));
    const merged = [...all, ...stillPending];
    photoEntries = merged.filter(e=>!e.deleted).sort((a,b)=>a.ts-b.ts);
    photoTrash = merged.filter(e=>e.deleted).sort((a,b)=>(a._deletedAt||0)-(b._deletedAt||0));
  }
  // 오프라인이면(backendOnline===false) 지금 메모리에 있는 값을 그대로 유지 — 비우지 않음
  renderPhotoEntries();
}
async function savePhotoEntry(entry){
  const res = await storageSet('photo:'+entry.id, JSON.stringify(entry), true);
  if(!res && !navigator.onLine) showToast('오프라인 - 이 기기에 저장됨(연결되면 자동 동기화)');
}
async function deletePhotoEntry(id){
  try{ await storageDelete('photo:'+id, true); }catch(e){}
}
// [v24 신규] 불량내역과 동일한 방식의 휴지통 — 사진을 실제로 지우지 않고 deleted 플래그만 세워서
// 보관해두고(같은 photo: 키에 덮어쓰기), 나중에 복원하거나 완전삭제할 수 있게 한다.
async function movePhotoToTrash(id){
  const idx = photoEntries.findIndex(en=>en.id===id);
  if(idx===-1) return;
  const [entry] = photoEntries.splice(idx,1);
  entry.deleted = true;
  entry._deletedAt = Date.now();
  photoTrash.push(entry);
  renderPhotoEntries();
  await savePhotoEntry(entry);
}
function renderPhotoEntries(){
  // [v22 버그수정] 대상물을 옮기면 그 전 대상물 사진까지 같이 보이고, 심지어 미리보기/엑셀에도
  // 섞여 들어가던 문제 — 화면 표시는 반드시 currentBuilding으로 필터링한다.
  // [v49] 사진대장(보고서용)과 기타 보관용을 완전히 분리 — 이 함수는 report 그룹만 다룬다.
  const buildingPhotos = photoEntries.filter(e=>e.building===currentBuilding && (e.group||'report')==='report');
  $('photoCount').textContent = buildingPhotos.length;
  $('photoTrashCount').textContent = photoTrash.filter(e=>e.building===currentBuilding && (e.group||'report')==='report').length;
  $('photoSelectedCount').textContent = buildingPhotos.length ? `${buildingPhotos.filter(e=>e.include).length}장 선택됨` : '';
  const list = $('photoList'); list.innerHTML='';
  $('photoEmpty').style.display = buildingPhotos.length ? 'none':'block';
  buildingPhotos.slice().reverse().forEach(entry=>{
    const div = document.createElement('div');
    div.className = 'entry';
    div.innerHTML = `
      <input type="checkbox" data-id="${entry.id}" class="incl-cb" ${entry.include?'checked':''}>
      <img src="${entry.photo}">
      <div class="meta">
        <input type="text" class="tag-edit" data-id="${entry.id}" value="${(entry.tag||'').replace(/"/g,'&quot;')}" placeholder="${entry.tag ? '' : '⚠ 태그 없음 - 여기에 다시 입력하세요'}">
        <div class="sub">${entry.building||''} · ${new Date(entry.ts).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}</div>
      </div>
      <button class="del-btn" data-id="${entry.id}" title="삭제(휴지통으로)">🗑</button>
    `;
    list.appendChild(div);
  });
  list.querySelectorAll('.incl-cb').forEach(cb=>{
    cb.onchange = async ()=>{ const en = photoEntries.find(e=>e.id===cb.dataset.id); en.include = cb.checked; await savePhotoEntry(en); $('photoSelectedCount').textContent = buildingPhotos.length ? `${photoEntries.filter(e=>e.building===currentBuilding && (e.group||'report')==='report' && e.include).length}장 선택됨` : ''; };
  });
  list.querySelectorAll('.tag-edit').forEach(inp=>{
    inp.onchange = async ()=>{ const en = photoEntries.find(e=>e.id===inp.dataset.id); en.tag = inp.value.trim() || en.tag; await savePhotoEntry(en); };
  });
  list.querySelectorAll('.del-btn').forEach(btn=>{
    btn.onclick = async ()=>{
      await movePhotoToTrash(btn.dataset.id);
      showToast('휴지통으로 옮겼습니다 (복원 가능)');
    };
  });
  renderOtherPhotoEntries();
}
// [v49 신규] 기타 보관용 사진 — 사진대장(report)과 완전히 분리된 목록/버튼으로 표시한다.
// (저장은 여전히 같은 photoEntries 배열/'photo:' 저장소를 쓰지만 group==='other'만 걸러서
//  화면·내보내기 전부 따로 다뤄, 사용자 입장에서는 완전히 별개 기능처럼 동작한다.)
function renderOtherPhotoEntries(){
  const otherPhotos = photoEntries.filter(e=>e.building===currentBuilding && e.group==='other');
  $('otherPhotoCount').textContent = otherPhotos.length;
  const list = $('otherPhotoList'); list.innerHTML='';
  $('otherPhotoEmpty').style.display = otherPhotos.length ? 'none':'block';
  otherPhotos.slice().reverse().forEach(entry=>{
    const div = document.createElement('div');
    div.className = 'entry';
    div.innerHTML = `
      <input type="checkbox" data-id="${entry.id}" class="incl-cb-other" ${entry.include?'checked':''}>
      <img src="${entry.photo}">
      <div class="meta">
        <input type="text" class="tag-edit-other" data-id="${entry.id}" value="${(entry.tag||'').replace(/"/g,'&quot;')}" placeholder="${entry.tag ? '' : '⚠ 태그 없음'}">
        <div class="sub">${entry.building||''} · ${new Date(entry.ts).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}</div>
      </div>
      <button class="del-btn-other" data-id="${entry.id}" title="삭제(휴지통으로)">🗑</button>
    `;
    list.appendChild(div);
  });
  list.querySelectorAll('.incl-cb-other').forEach(cb=>{
    cb.onchange = async ()=>{ const en = photoEntries.find(e=>e.id===cb.dataset.id); en.include = cb.checked; await savePhotoEntry(en); };
  });
  list.querySelectorAll('.tag-edit-other').forEach(inp=>{
    inp.onchange = async ()=>{ const en = photoEntries.find(e=>e.id===inp.dataset.id); en.tag = inp.value.trim() || en.tag; await savePhotoEntry(en); };
  });
  list.querySelectorAll('.del-btn-other').forEach(btn=>{
    btn.onclick = async ()=>{
      await movePhotoToTrash(btn.dataset.id);
      showToast('휴지통으로 옮겼습니다 (복원 가능)');
    };
  });
}
// ---- 사진 휴지통(삭제한 사진 복원) ----
function renderPhotoTrash(){
  const buildingTrash = photoTrash.filter(e=>e.building===currentBuilding);
  const list = $('photoTrashList'); list.innerHTML='';
  $('photoTrashEmpty').style.display = buildingTrash.length ? 'none':'block';
  buildingTrash.slice().reverse().forEach(entry=>{
    const div = document.createElement('div');
    div.className = 'entry';
    div.innerHTML = `
      <img src="${entry.photo}">
      <div class="meta">
        <div class="title">${entry.tag||'(태그 없음)'}</div>
        <div class="sub">${entry.building||''} · ${new Date(entry.ts).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}</div>
      </div>
      <button class="del-btn restore-btn" data-id="${entry.id}" title="복원">↺</button>
      <button class="del-btn perm-del-btn" data-id="${entry.id}" title="완전삭제">🗑</button>
    `;
    list.appendChild(div);
  });
  list.querySelectorAll('.restore-btn').forEach(btn=>{
    btn.onclick = async ()=>{
      const idx = photoTrash.findIndex(en=>en.id===btn.dataset.id);
      if(idx===-1) return;
      const [entry] = photoTrash.splice(idx,1);
      delete entry.deleted; delete entry._deletedAt;
      photoEntries.push(entry);
      await savePhotoEntry(entry);
      renderPhotoEntries(); renderPhotoTrash();
      showToast('복원했습니다');
    };
  });
  list.querySelectorAll('.perm-del-btn').forEach(btn=>{
    btn.onclick = async ()=>{
      if(!confirm('완전히 삭제할까요? 되돌릴 수 없습니다.')) return;
      const id = btn.dataset.id;
      photoTrash = photoTrash.filter(en=>en.id!==id);
      renderPhotoTrash();
      await deletePhotoEntry(id);
    };
  });
}
$('photoTrashOpenBtn').onclick = ()=>{ renderPhotoTrash(); $('photoTrashOverlay').classList.add('show'); };
$('photoTrashClose').onclick = ()=> $('photoTrashOverlay').classList.remove('show');
$('photoTrashOverlay').onclick = (e)=>{ if(e.target.id==='photoTrashOverlay') $('photoTrashOverlay').classList.remove('show'); };
$('previewBtn').onclick = ()=>{
  // [v22 버그수정] 대상물을 안 가리고 include된 전체 사진을 가져와서, 다른 대상물 사진까지
  // 미리보기/보고서에 섞여 들어가던 문제 — currentBuilding으로 반드시 먼저 필터링한다.
  const selected = photoEntries.filter(e=>e.include && e.building===currentBuilding);
  if(!selected.length){ showToast('선택된 사진이 없습니다'); return; }
  // [v14 버그수정] 예전에는 촬영한 순서(시간순) 그대로 미리보기에 나열해서, 순서에 안 맞게 찍으면
  // 화면도 뒤죽박죽으로 보였다. 엑셀 생성 때 쓰는 것과 동일한 sortByTagOrder()로 맞춰서
  // 미리보기 화면과 실제 엑셀 순서가 항상 일치하도록 한다.
  const reportSel = sortByTagOrder(selected.filter(e=>(e.group||'report')==='report'), TAGS);
  const otherSel = selected.filter(e=>e.group==='other');

  $('previewTitle').textContent = `소방시설 ${getInspectTypeLabel(currentBuilding)}점검 사진대장 (보고서용)`;
  $('previewBuilding').textContent = '대상명 : ' + (currentBuilding || '(미입력)');
  $('previewDate').textContent = new Date().toLocaleDateString('ko-KR');
  const grid = $('previewGrid'); grid.innerHTML='';
  reportSel.forEach(e=>{
    const cell = document.createElement('div'); cell.className='cell';
    cell.innerHTML = `<img src="${e.photo}"><div class="cap">${e.tag}</div>`;
    grid.appendChild(cell);
  });
  $('previewGroupReport').style.display = reportSel.length ? '' : 'none';

  $('previewBuildingOther').textContent = '대상명 : ' + (currentBuilding || '(미입력)');
  $('previewDateOther').textContent = new Date().toLocaleDateString('ko-KR');
  const gridOther = $('previewGridOther'); gridOther.innerHTML='';
  otherSel.forEach(e=>{
    const cell = document.createElement('div'); cell.className='cell';
    cell.innerHTML = `<img src="${e.photo}"><div class="cap">${e.tag}</div>`;
    gridOther.appendChild(cell);
  });
  $('previewGroupOther').style.display = otherSel.length ? '' : 'none';

  $('previewArea').style.display = 'block';
  $('previewArea').scrollIntoView({behavior:'smooth'});
};
$('printBtn').onclick = ()=>{
  document.body.classList.add('print-report-only');
  window.print();
};
$('printOtherBtn').onclick = ()=>{
  document.body.classList.add('print-other-only');
  window.print();
};
window.addEventListener('afterprint', ()=>{
  document.body.classList.remove('print-report-only','print-other-only');
});
$('photoExportOtherPdfBtn').onclick = ()=>{
  const otherEntries = photoEntries.filter(e=>e.include && e.group==='other' && e.building===currentBuilding);
  if(!otherEntries.length){ showToast('기타 보관용으로 선택된 사진이 없습니다'); return; }
  $('previewBtn').click();
  setTimeout(()=>{ $('printOtherBtn').click(); }, 300);
};
$('photoExportBtn').onclick = ()=>{
  if(!photoEntries.length){ showToast('내보낼 항목이 없습니다'); return; }
  const blob = new Blob([JSON.stringify(photoEntries,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=`점검사진대장_${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url);
};
// [v32] 앱 안에만 있던 사진을 증거 보관용으로 내 폰 사진함(갤러리)에도 남길 수 있게 한다.
// 웹페이지는 "사진함에 직접 저장"하는 API가 없어서, iOS/Android가 공통 지원하는
// "공유 시트"(navigator.share)를 띄우고 그 안에서 사용자가 "이미지 저장"을 누르는 방식을 쓴다.
// 이 방식을 지원하지 않는 환경(주로 PC 브라우저)에서는 파일로 하나씩 다운로드하는 것으로 대신한다.
$('photoSaveToGalleryBtn').onclick = async ()=>{
  if(!currentBuilding){ showToast('대상물을 먼저 선택해주세요'); return; }
  const list = photoEntries.filter(en=>en.building===currentBuilding);
  if(!list.length){ showToast('내보낼 사진이 없습니다'); return; }
  showToast(`사진 ${list.length}장 준비 중...`);
  const files = [];
  for(let i=0;i<list.length;i++){
    const en = list[i];
    try{
      const dataUrl = await resolvePhotoToBase64(en.photo);
      if(!dataUrl) continue;
      const blob = await (await fetch(dataUrl)).blob();
      const safeTag = (en.tag||'사진').replace(/[\\/:*?"<>|]/g,'_');
      files.push(new File([blob], `${currentBuilding}_${safeTag}_${i+1}.jpg`, { type: blob.type || 'image/jpeg' }));
    }catch(e){ /* 이 한 장만 건너뛰고 계속 진행 */ }
  }
  if(!files.length){ showToast('사진을 불러오지 못했습니다. 잠시 후 다시 시도해주세요'); return; }

  if(navigator.canShare && navigator.canShare({ files })){
    try{
      await navigator.share({ files, title: `${currentBuilding} 점검 사진` });
      showToast('공유 시트에서 "이미지 저장"을 누르면 내 사진함에 저장됩니다');
      return;
    }catch(e){
      if(e && e.name === 'AbortError') return; // 사용자가 공유창을 취소한 것 — 조용히 종료
      // 그 외 실패는 아래 폴백(개별 다운로드)으로 이어서 진행
    }
  }
  showToast('이 브라우저는 사진함 공유를 지원하지 않아 파일로 하나씩 다운로드합니다');
  files.forEach((file, idx)=>{
    setTimeout(()=>{
      const url = URL.createObjectURL(file);
      const a = document.createElement('a'); a.href=url; a.download=file.name; a.click();
      URL.revokeObjectURL(url);
    }, idx*300);
  });
};
$('photoClearBtn').onclick = async ()=>{
  if(!currentBuilding){ showToast('대상물을 먼저 선택해주세요'); return; }
  // [v23] 예전엔 모든 대상물의 사진을 통째로 지웠다 — 이제 "지금 보고 있는 대상물"만 지운다.
  // [v24] 휴지통(soft-delete)에 있는 것도 이 대상물 것이면 같이 완전히 지운다.
  if(!confirm(`⚠️ "${currentBuilding}"의 사진(휴지통 포함)을 팀 전체와 공유된 상태로 삭제합니다. 다른 대상물의 사진은 그대로 남습니다. 되돌릴 수 없는데 진행할까요?`)) return;
  const toDelete = [...photoEntries, ...photoTrash].filter(en=>en.building===currentBuilding);
  await Promise.all(toDelete.map(en=>storageDelete('photo:'+en.id, true)));
  photoEntries = photoEntries.filter(en=>en.building!==currentBuilding);
  photoTrash = photoTrash.filter(en=>en.building!==currentBuilding);
  renderPhotoEntries(); renderPhotoTrash(); $('previewArea').style.display='none';
  showToast(`"${currentBuilding}"의 사진을 초기화했습니다`);
};

// ---------------- 3인 공유 동기화 ----------------
function updateSyncBanner(){
  const el = $('syncBanner');
  const pending = queuePendingCount();
  const pendingSuffix = pending ? ` · ⏳ 동기화 대기 ${pending}건(눌러서 재시도)` : '';
  // [v25 버그수정] 예전엔 실제 연결 여부와 무관하게 항상 "연결됨"이라는 고정 문구만 표시했다.
  // 이제 callAppsScript() 호출이 실제로 성공/실패했는지(backendOnline)를 반영한다.
  // [v65] 오프라인 중 저장 못 한 항목이 있으면(대기 큐) 그 건수도 함께 보여주고, 배너를 누르면
  // 바로 재전송을 시도한다 — 인터넷이 자주 끊기는 현장에서 "지금 동기화됐나?"를 항상 확인 가능하게.
  if(pending){
    el.className = 'sync-banner';
    el.style.background = '#fff4e5'; el.style.color = '#8a5a00';
    el.textContent = `🟠 오프라인 중 저장된 항목이 있습니다${pendingSuffix}`;
  } else if(backendOnline === true){
    el.className = 'sync-banner shared';
    el.textContent = '🟢 팀 공유 저장소(구글) 연결 확인됨 — 같은 파일을 연 팀원과 실시간에 가깝게 공유되고 있습니다';
  } else if(backendOnline === false){
    el.className = 'sync-banner';
    el.style.background = '#fdecea'; el.style.color = '#b3261e';
    el.textContent = '🔴 팀 공유 저장소 연결 실패 — 입력한 내용은 이 기기에 안전하게 저장되어 있고, 연결되면 자동으로 올라갑니다(눌러서 지금 재시도)';
  } else {
    el.className = 'sync-banner';
    el.style.background=''; el.style.color='';
    el.textContent = '🟡 팀 공유 저장소 연결 확인 중...';
  }
  el.style.cursor = 'pointer';
  el.onclick = ()=> flushSyncQueue(true);
}
// 페이지를 열자마자 실제로 한 번 통신해서 진짜 연결 상태를 확인한다(껍데기 표시가 아니라).
callAppsScript({ action:'list', prefix:'', shared:true });
$('defectSyncBtn').onclick = async ()=>{ showToast('동기화 중...'); await flushSyncQueue(false); await loadDefectEntries(); showToast('동기화 완료'); };
$('photoSyncBtn').onclick = async ()=>{ showToast('동기화 중...'); await flushSyncQueue(false); await loadPhotoEntries(); showToast('동기화 완료'); };
$('constructionSyncBtn').onclick = async ()=>{ showToast('동기화 중...'); await flushSyncQueue(false); await loadConstructionEntries(); showToast('동기화 완료'); };
// 지금 보고 있는 화면 데이터를 주기적으로 자동으로 다시 불러와, 팀원이 방금 올린 항목이 반영되게 함
let scheduleBusy = false; // [v52] 초기화/임포트가 진행 중일 때는 20초 주기 새로고침이 끼어들어 뒤섞이지 않게 막는 플래그
setInterval(()=>{
  if(document.hidden || scheduleBusy) return;
  if(currentView==='defect') loadDefectEntries();
  else if(currentView==='photolog') loadPhotoEntries();
  else if(currentView==='construction') loadConstructionEntries();
  else if(currentView==='home') loadScheduleEntries();
  else if(currentView==='schedule') loadScheduleEntries().then(sdRenderAll);
}, 20000);

