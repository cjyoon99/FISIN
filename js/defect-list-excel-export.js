// ============================================================
// defect-list-excel-export.js
// 엑셀 불량내역 역마이그레이션 + 불량내역 목록/휴지통/수정 오버레이 + 엑셀 저장(공식양식) (원본 3983~5058줄)
// ※ E단계 모듈화(V77) 시 원본 v76 단일 파일에서 그대로 잘라낸 것으로,
//   전역 스코프를 그대로 사용하며 기존 함수 간 참조 관계는 100% 동일합니다.
// ============================================================
// ================= 엑셀 불량내역 역마이그레이션 (v28) =================
// 참소방_불량내역엑셀_출력규칙에 맞춰 출력된 "소방시설등 시정보완 조치명령 사항" 형태의
// 엑셀(소방시설/설비명 병합, 위치, 시정보완사항, 보완대책, 비고 열)을 읽어 불량내역으로 되돌려 넣는다.
async function parseDefectXlsx(file){
  const buf = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if(!ws) throw new Error('시트를 찾을 수 없습니다');

  // '위치'라는 글자가 있는 행을 헤더 행으로 판단
  let headerRowNum = null;
  ws.eachRow((row, rowNumber)=>{
    if(headerRowNum) return;
    row.eachCell((cell)=>{
      const v = (cell.value==null?'':cell.value.toString()).replace(/\s/g,'');
      if(v==='위치') headerRowNum = rowNumber;
    });
  });
  if(!headerRowNum) throw new Error('헤더(위치 열)를 찾지 못했습니다. 양식을 확인해주세요');

  const colMap = {};
  ws.getRow(headerRowNum).eachCell((cell, colNumber)=>{
    const v = (cell.value==null?'':cell.value.toString()).replace(/\s/g,'');
    if(v.includes('소방시설')) colMap.category = colNumber;
    else if(v.includes('설비명')) colMap.equip = colNumber;
    else if(v==='위치') colMap.location = colNumber;
    else if(v.includes('시정보완') || v.includes('시정보수')) colMap.content = colNumber;
    else if(v.includes('보완대책')) colMap.action = colNumber;
    else if(v.includes('비고')) colMap.note = colNumber;
  });
  if(!colMap.equip || !colMap.location || !colMap.content){
    throw new Error('엑셀에서 설비명/위치/시정보완사항 열을 찾지 못했습니다. 양식을 확인해주세요');
  }

  const getCellVal = (row, colNumber)=>{
    if(!colNumber) return '';
    const cell = row.getCell(colNumber);
    const v = cell.isMerged ? cell.master.value : cell.value;
    return (v==null ? '' : v.toString().trim());
  };

  const rows = [];
  let lastCategory='', lastEquip='';
  for(let r=headerRowNum+1; r<=ws.rowCount; r++){
    const row = ws.getRow(r);
    const location = getCellVal(row, colMap.location);
    const content = getCellVal(row, colMap.content);
    if(!location && !content) continue; // 빈 행은 건너뜀
    const category = getCellVal(row, colMap.category) || lastCategory;
    const equip = getCellVal(row, colMap.equip) || lastEquip;
    lastCategory = category; lastEquip = equip;
    const action = getCellVal(row, colMap.action);
    rows.push({ category, equip, location, content, action });
  }
  return rows;
}
// [v30] 엑셀의 "설비명"(예: 옥내소화전설비, 자동화재탐지설비 같은 대분류 표기)만 보고 대표 칩
// 하나를 임의로 골랐더니, 본문에 "피난구유도등"이라고 분명히 적혀 있어도 "거실통로유도등"으로,
// "경종"이라고 적혀 있어도 "불꽃감지기"로 엉뚱하게 표시되는 문제가 있었다. 이제는:
//   1) 같은 대분류 안에서, 시정보완사항 "본문"에 실제로 등장하는 더 구체적인 설비명을 우선 채택
//   2) 본문에 구체적 설비명이 없으면(예: "경종", "감지기"만 있고 세부명 없음) 흔한 약칭/동의어로 보완
//   3) 그래도 못 찾으면 기존처럼 대분류 대표값으로 폴백
// 그리고 채택된 설비명이 "본문의 어느 지점에" 있는지를 그대로 이용해서, 그 앞부분은 상세위치로,
// 그 지점부터는 불량내용으로 자동 분리한다.

// EQUIP_MASTER_INFO 키들을 NFTC 번호 기준으로 그룹핑 — 같은 그룹 안의 키들은 전부 NFTC 출력
// 결과가 동일하므로, 그 안에서만 더 구체적인 이름을 찾으면 안전하다(다른 대분류의 설비명(예:
// 방화셔터)이 본문에 같이 언급돼도 잘못 채택되지 않도록 범위를 제한). 공식 설비명(officialName)
// 표기가 서로 달라도 NFTC가 같으면 같은 그룹으로 묶는다 — 예: "자동화재탐지설비"(수신기·발신기·
// 감지기 등)와 "시각경보장치"(시각경보기)는 표기는 다르지만 둘 다 NFTC 203이라 실무에서 같이
// 취급되는 경우가 많음. NFTC가 비어있는(기타) 항목은 공식 설비명 기준으로만 묶는다.
function buildEquipGroups(){
  const groups = {};
  for(const key of Object.keys(EQUIP_MASTER_INFO)){
    const [, nftc, officialName] = EQUIP_MASTER_INFO[key];
    const groupKey = nftc ? nftc : ('NAME:' + (officialName || key).replace(/\s/g, ''));
    if(!groups[groupKey]) groups[groupKey] = [];
    groups[groupKey].push(key);
  }
  return groups;
}
// 본문에 세부 설비명이 없을 때 쓰는 흔한 약칭/동의어. anchor가 본문에서 실제로 매치된 "위치"를
// 상세위치/불량내용 분리 기준으로 그대로 쓰고, decide()는 그 앞뒤 문맥을 보고 어떤 세부 설비로
// 볼지만 결정한다(분리 지점 자체는 항상 anchor의 실제 위치).
const EQUIP_TEXT_SYNONYMS = [
  { anchor:/감지기/, decide:(content)=>{
      // "열식→연기식"처럼 화살표로 종류가 바뀌는 경우, 최종적으로 바뀐 뒤(오른쪽) 종류를 우선 참고
      const seg = content.slice(content.lastIndexOf('→')+1);
      if(/차동식|정온식|보상식|열식/.test(seg)) return '열감지기';
      if(/연기식|이온화식|광전식/.test(seg)) return '연기감지기';
      return '연기감지기'; // 세부 종류 언급이 전혀 없을 때의 기본값
    } },
  { anchor:/경종/, decide:()=>'발신기' }, // 경종은 통상 발신기(발신기+경종+표시등 세트)에 포함되는 부속
  { anchor:/시각전원반|시각경보/, decide:()=>'시각경보기' },
  { anchor:/소화기함|소화기/, decide:()=>'분말소화기' },
  { anchor:/유도등/, decide:()=>'피난구유도등' }, // 거실/계단/복도/피난구 중 세부 명시가 없을 때의 기본값
  { anchor:/소화전/, decide:()=>'옥내소화전' }, // "옥내"를 생략하고 그냥 "소화전"이라고만 쓴 경우
];
// 반환: { chip, matchIndex, matchText } — matchIndex가 -1이면 본문에서 위치를 못 찾은 것(분리 불가)
function resolveEquipAndSplit(rawExcelEquip, content){
  const groups = resolveEquipAndSplit._groups || (resolveEquipAndSplit._groups = buildEquipGroups());
  const fallbackChip = equipTextToChipName(rawExcelEquip);
  const info = EQUIP_MASTER_INFO[fallbackChip];
  const groupKey = info ? (info[1] ? info[1] : ('NAME:' + (info[2] || fallbackChip).replace(/\s/g, ''))) : fallbackChip;
  const candidateKeys = (groups[groupKey] || [fallbackChip]).slice().sort((a,b)=>b.length-a.length);

  // 1) 같은 대분류 안에서, 본문에 실제로 등장하는(가장 왼쪽에 나오는) 구체적 설비명 채택
  let bestIdx = -1, bestKey = null;
  for(const key of candidateKeys){
    const idx = content.indexOf(key);
    if(idx!==-1 && (bestIdx===-1 || idx<bestIdx)){ bestIdx = idx; bestKey = key; }
  }
  if(bestKey) return { chip:bestKey, matchIndex:bestIdx };

  // 2) 흔한 약칭/동의어로 재시도 (같은 대분류에 속하는 동의어만 인정)
  for(const syn of EQUIP_TEXT_SYNONYMS){
    const m = syn.anchor.exec(content);
    if(!m) continue;
    const key = syn.decide(content);
    if(candidateKeys.includes(key)) return { chip:key, matchIndex:m.index };
  }

  // 3) 못 찾으면 대분류 대표값으로 폴백 — 상세위치 분리는 하지 않음(원문 그대로 불량내용에 둠)
  return { chip: fallbackChip, matchIndex: -1 };
}
// 엑셀의 "설비명"(예: 옥내소화전설비, 자동화재탐지설비 같은 대분류 표기)을 앱 내부 칩 이름
// (예: 옥내소화전, 수신기)으로 바꿔둔다. 이렇게 해두면 나중에 엑셀로 다시 내보낼 때, 수동으로
// 입력한 항목과 완전히 동일한 방식(resolveEquipPrimary → EQUIP_MASTER_INFO)으로 비고(NFTC)와
// 설비명 열이 자동으로 채워진다 — 즉 비고란을 따로 저장해둘 필요 없이 기존 로직 그대로 재사용.
// resolveEquipAndSplit()이 본문에서 아무것도 못 찾았을 때의 최종 폴백으로도 쓰인다.
function equipTextToChipName(rawText){
  const norm = (rawText||'').replace(/\s/g,'');
  if(!norm) return rawText;
  if(EQUIP_MASTER_INFO[norm]) return norm; // 방화문/방화셔터처럼 이미 칩 이름 그대로인 경우
  if(!equipTextToChipName._map){
    const map = {};
    for(const key of Object.keys(EQUIP_MASTER_INFO)){
      const officialName = (EQUIP_MASTER_INFO[key][2] || key).replace(/\s/g,'');
      if(!map[officialName]) map[officialName] = key; // 먼저 나온 것을 대표로 채택(어차피 NFTC 동일)
    }
    equipTextToChipName._map = map;
  }
  return equipTextToChipName._map[norm] || rawText;
}
function buildEntriesFromXlsxRows(rows){
  return rows.map((r,i)=>{
    const { chip, matchIndex } = resolveEquipAndSplit(r.equip, r.content);
    let detailLocation = '', defectContent = r.content;
    if(matchIndex > 0){
      detailLocation = r.content.slice(0, matchIndex).trim();
      defectContent = r.content.slice(matchIndex).trim();
    }
    return {
      id: Date.now()+'-'+i+'-'+Math.random().toString(36).slice(2,7),
      building: currentBuilding,
      inspector: inspectorName,
      location: r.location,
      detailLocation,
      equip: chip || '(설비명 미상)',
      defectContent,
      equipName: chip || null, equipSub: null, // [V69/D단계] 엑셀 일괄등록은 세부항목까지는 안 갈라내므로 이름만
      parentEquip: null,
      // 보완대책 문구("~완료"라고 명시된 경우만 조치완료, 그 외(대부분의 "~요함" 문구)는 조치요함)
      action: /완료/.test(r.action||'') ? '조치완료' : '조치요함',
      photo: null,
      ts: Date.now()
    };
  });
}
$('defectXlsxImportBtn').onclick = ()=>{
  if(!currentBuilding){ showToast('대상물을 먼저 선택해주세요'); return; }
  if(typeof ExcelJS === 'undefined'){ showToast('엑셀 라이브러리 로드에 실패했습니다. 인터넷 연결을 확인해주세요'); return; }
  $('defectXlsxImportInput').click();
};
$('defectXlsxImportInput').onchange = async (e)=>{
  const file = e.target.files[0];
  e.target.value = ''; // 같은 파일을 다시 선택할 수 있도록 초기화
  if(!file) return;
  showToast('엑셀을 읽는 중...');
  let rows;
  try{ rows = await parseDefectXlsx(file); }
  catch(err){ showToast('엑셀을 읽지 못했습니다: ' + err.message); return; }
  if(!rows.length){ showToast('엑셀에서 불러올 항목을 찾지 못했습니다'); return; }
  if(!confirm(`"${currentBuilding}" 대상물에 ${rows.length}건을 불러옵니다.\n조치결과는 "완료"라고 적힌 것만 조치완료, 나머지는 모두 조치요함으로 등록됩니다.\n비고(NFTC)는 저장하지 않고, 엑셀로 다시 내보낼 때 기존과 동일한 방식으로 자동 계산됩니다.\n불러온 뒤 목록에서 개별 수정·삭제할 수 있습니다.\n계속할까요?`)) return;
  const entries = buildEntriesFromXlsxRows(rows);
  for(let i=0;i<entries.length;i++){
    defectEntries.push(entries[i]);
    await saveDefectEntry(entries[i]);
    if(i%5===0 || i===entries.length-1) showToast(`불러오는 중... (${i+1}/${entries.length})`);
  }
  renderDefectEntries();
  showToast(`${entries.length}건을 불러왔습니다 (팀원과 공유됨)`);
};
async function moveEntryToTrash(id){
  const idx = defectEntries.findIndex(en=>en.id===id);
  if(idx===-1) return;
  const [entry] = defectEntries.splice(idx,1);
  entry.deleted = true;
  entry._deletedAt = Date.now();
  defectTrash.push(entry);
  await saveDefectEntry(entry);
  renderDefectEntries();
}
function fmtEntryDateTime(ts){
  const d = new Date(ts);
  const date = d.toLocaleDateString('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit'});
  const time = d.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});
  return `${date} ${time}`;
}
function renderDefectEntries(){
  // [v65] 화면을 그릴 때마다 현재 상태를 로컬 캐시에도 저장해둔다 — 오프라인 중 입력한 내용이
  // 아직 서버 동기화 전이라도(큐 대기중이라도) 새로고침/재접속 시 사라지지 않게 한다.
  lsCacheSet('defects', defectEntries); lsCacheSet('defectTrash', defectTrash);
  // [v22 버그수정] 대상물을 옮기면 그 전 대상물의 불량내역까지 같이 보이던 문제 — 반드시
  // currentBuilding으로 필터링한다. (전체 데이터 자체는 defectEntries에 계속 다 들어있고,
  // 엑셀 생성 등 다른 곳에서도 쓰이므로 배열 자체를 자르지 않고 화면 표시만 필터링한다.)
  const buildingEntries = defectEntries.filter(e=>e.building===currentBuilding);
  $('defectCount').textContent = buildingEntries.length;
  $('defectTrashCount').textContent = defectTrash.filter(e=>e.building===currentBuilding).length;
  const list = $('defectList'); list.innerHTML='';
  $('defectEmpty').style.display = buildingEntries.length ? 'none':'block';
  buildingEntries.slice().reverse().forEach(entry=>{
    const div = document.createElement('div');
    div.className = 'entry';
    div.style.cursor = 'pointer';
    div.innerHTML = `
      ${entry.photo ? `<img src="${entry.photo}">` : `<div style="width:52px;height:52px;border-radius:8px;background:#eee;flex-shrink:0;"></div>`}
      <div class="meta">
        <div class="title">${entry.building||''} · ${entry.location||'(위치 미입력)'} · ${entry.equip||'(설비 미선택)'}</div>
        <div class="sub">${entry.detailLocation ? entry.detailLocation + ' · ' : ''}${entry.defectContent||''}</div>
        <div class="sub">${entry.inspector ? entry.inspector+' · ' : ''}${entry.action} · ${fmtEntryDateTime(entry.ts)}</div>
      </div>
      <button class="del-btn edit-btn" data-id="${entry.id}" title="수정">✏️</button>
      <button class="del-btn" data-id="${entry.id}" title="삭제(휴지통으로)">🗑</button>
    `;
    div.addEventListener('click', (e)=>{
      if(e.target.closest('.del-btn')) return;
      openEditEntry(entry.id);
    });
    list.appendChild(div);
  });
  list.querySelectorAll('.edit-btn').forEach(btn=>{
    btn.onclick = (e)=>{ e.stopPropagation(); openEditEntry(btn.dataset.id); };
  });
  list.querySelectorAll('.del-btn:not(.edit-btn)').forEach(btn=>{
    btn.onclick = async (e)=>{
      e.stopPropagation();
      await moveEntryToTrash(btn.dataset.id);
      showToast('휴지통으로 옮겼습니다 (복원 가능)');
    };
  });
}

// ---- 휴지통(삭제 항목 복원) ----
function renderDefectTrash(){
  const buildingTrash = defectTrash.filter(e=>e.building===currentBuilding); // [v22] 대상물별 분리
  const list = $('defectTrashList'); list.innerHTML='';
  $('defectTrashEmpty').style.display = buildingTrash.length ? 'none':'block';
  buildingTrash.slice().reverse().forEach(entry=>{
    const div = document.createElement('div');
    div.className = 'entry';
    div.innerHTML = `
      ${entry.photo ? `<img src="${entry.photo}">` : `<div style="width:52px;height:52px;border-radius:8px;background:#eee;flex-shrink:0;"></div>`}
      <div class="meta">
        <div class="title">${entry.building||''} · ${entry.location||'(위치 미입력)'} · ${entry.equip||'(설비 미선택)'}</div>
        <div class="sub">${entry.defectContent||''}</div>
        <div class="sub">${entry.inspector ? entry.inspector+' · ' : ''}${fmtEntryDateTime(entry.ts)}</div>
      </div>
      <button class="del-btn restore-btn" data-id="${entry.id}" title="복원">↺</button>
      <button class="del-btn perm-del-btn" data-id="${entry.id}" title="완전삭제">🗑</button>
    `;
    list.appendChild(div);
  });
  list.querySelectorAll('.restore-btn').forEach(btn=>{
    btn.onclick = async ()=>{
      const idx = defectTrash.findIndex(en=>en.id===btn.dataset.id);
      if(idx===-1) return;
      const [entry] = defectTrash.splice(idx,1);
      delete entry.deleted; delete entry._deletedAt;
      defectEntries.push(entry);
      await saveDefectEntry(entry);
      renderDefectEntries(); renderDefectTrash();
      showToast('복원했습니다');
    };
  });
  list.querySelectorAll('.perm-del-btn').forEach(btn=>{
    btn.onclick = async ()=>{
      if(!confirm('완전히 삭제할까요? 되돌릴 수 없습니다.')) return;
      defectTrash = defectTrash.filter(en=>en.id!==btn.dataset.id);
      await storageDelete('defect:'+btn.dataset.id, true);
      renderDefectEntries(); renderDefectTrash();
    };
  });
}
$('defectTrashOpenBtn').onclick = ()=>{ renderDefectTrash(); $('defectTrashOverlay').classList.add('show'); };
$('defectTrashClose').onclick = ()=> $('defectTrashOverlay').classList.remove('show');
$('defectTrashOverlay').onclick = (e)=>{ if(e.target.id==='defectTrashOverlay') $('defectTrashOverlay').classList.remove('show'); };

// ---- 지우기(불량내용 비우기) ----
$('defectClearInlineBtn').onclick = ()=>{
  $('defectContent').value = '';
  currentEquipPrefix = '';
  tagInsertCount = 0;
};

// ---- 점검자 이름 ----
// 이 화면의 입력창은 제거함 — 향후 로그인 화면에서 점검자를 특정하면 그 값을 여기 inspectorName에 채우는 것으로 대체 예정.
// 지금은 이전에 저장된 값이 있으면 그대로 이어서 쓴다(팀 공유 저장소).
let inspectorName = '';
async function loadInspectorName(){
  try{ const res = await storageGet('inspector_name'); if(res && res.value) inspectorName = res.value; }catch(e){}
}

// ---- 불량내역 상세보기/수정 오버레이 ----
let editingEntryId = null;
function openEditEntry(id){
  const entry = defectEntries.find(en=>en.id===id);
  if(!entry) return;
  editingEntryId = id;
  $('editMeta').textContent = `${entry.building||''} · ${new Date(entry.ts).toLocaleString('ko-KR')}`;

  const struct = BUILDING_STRUCTURE[entry.building] || BUILDING_STRUCTURE['_default'];
  const wingSel = $('editWing'), floorSel = $('editFloor');
  if(struct.wings.length){
    wingSel.style.display = '';
    wingSel.innerHTML = struct.wings.map(w=>`<option value="${w}">${w}</option>`).join('');
  } else { wingSel.style.display = 'none'; wingSel.innerHTML=''; }
  floorSel.innerHTML = struct.floors.map(f=>`<option value="${f}">${f}</option>`).join('');
  // 기존 위치값에서 동/층 역파싱해서 선택 상태 맞추기
  if(entry.location){
    const parts = entry.location.split(' ');
    const floorPart = parts[parts.length-1];
    const wingPart = parts.slice(0,-1).join(' ');
    if(wingPart && struct.wings.includes(wingPart)) wingSel.value = wingPart;
    if(struct.floors.includes(floorPart)) floorSel.value = floorPart;
  }

  $('editDetailLocation').value = entry.detailLocation || '';
  $('editEquip').value = entry.equip || '';
  $('editDefectContent').value = entry.defectContent || '';
  entry._editAction = entry.action;
  openEditActionOnly(entry);
  if(entry.photo){ $('editPhotoPreview').src = entry.photo; $('editPhotoPreview').style.display='block'; }
  else { $('editPhotoPreview').style.display='none'; }
  $('editOverlay').classList.add('show');
}
function openEditActionOnly(entry){
  renderChipGroup('editActionChips', ACTIONS, a=>a===entry._editAction, a=>{
    entry._editAction = a;
    openEditActionOnly(entry);
  });
}
$('editClose').onclick = ()=> $('editOverlay').classList.remove('show');
$('editOverlay').onclick = (e)=>{ if(e.target.id==='editOverlay') $('editOverlay').classList.remove('show'); };
$('editPhotoBtn').onclick = ()=> $('editPhotoInput').click();
$('editPhotoInput').onchange = async (e)=>{
  const file = e.target.files[0]; if(!file) return;
  showToast('사진 처리 중...');
  const dataUrl = await compressImage(file);
  const entry = defectEntries.find(en=>en.id===editingEntryId);
  entry._editPhoto = dataUrl;
  $('editPhotoPreview').src = dataUrl; $('editPhotoPreview').style.display='block';
};
$('editSaveBtn').onclick = async ()=>{
  const entry = defectEntries.find(en=>en.id===editingEntryId);
  if(!entry) return;
  const wing = $('editWing').style.display !== 'none' ? $('editWing').value : '';
  const floor = $('editFloor').value;
  entry.location = (wing ? wing+' ' : '') + floor;
  entry.detailLocation = $('editDetailLocation').value.trim();
  const newEquip = $('editEquip').value.trim() || entry.equip;
  if(newEquip !== entry.equip){
    // [V69/D단계] 자유 텍스트 칸에서 설비명을 직접 고쳤다면, 저장돼 있던 equipName/equipSub/parentEquip
    // (설비 ID 매칭용)은 더는 이 문자열과 안 맞을 수 있으니 비워서 잘못된 ID가 남지 않게 한다.
    // (다시 매칭하려면 새로 등록하듯 설비명 칩에서 골라야 함 — 자유 텍스트만으론 정확한 매칭이 어려움)
    entry.equipName = null; entry.equipSub = null; entry.parentEquip = null;
  }
  entry.equip = newEquip;
  entry.defectContent = $('editDefectContent').value.trim();
  entry.action = entry._editAction || entry.action;
  if(entry._editPhoto) entry.photo = entry._editPhoto;
  delete entry._editAction; delete entry._editPhoto;
  await saveDefectEntry(entry);
  renderDefectEntries();
  $('editOverlay').classList.remove('show');
  showToast('수정했습니다');
};
$('editDeleteBtn').onclick = async ()=>{
  if(!confirm('이 항목을 휴지통으로 옮길까요? 휴지통에서 다시 복원할 수 있습니다.')) return;
  await moveEntryToTrash(editingEntryId);
  $('editOverlay').classList.remove('show');
  showToast('휴지통으로 옮겼습니다 (복원 가능)');
};

$('defectSaveBtn').onclick = async ()=>{
  const eff = getEffectiveEquip();
  const equip = eff.name ? eff.name + (eff.sub ? ' '+eff.sub : '') : null;
  const defectContent = $('defectContent').value.trim();
  if(!equip){ showToast('설비명을 선택하거나 입력해주세요'); return; }
  if(!defectContent){ showToast('불량내용을 입력해주세요'); return; }
  if(!currentInspectionType){ showToast('점검종류를 먼저 선택해주세요'); openInspectionTypeOverlay(); return; }
  const wing = $('wingSelect').options.length !== 0 ? $('wingSelect').value : '';
  const floor = $('floorSelect').value;
  const location = (wing ? wing+' ' : '') + floor;
  const entry = {
    id: Date.now()+'-'+Math.random().toString(36).slice(2,7),
    building: currentBuilding || '(대상물명 미입력)',
    inspector: inspectorName,
    location,
    detailLocation: $('detailLocation').value.trim(),
    equip, defectContent,
    // [V69/D단계] 화면엔 하나로 합쳐 보여주지만(equip), 나중에 설비 ID와 정확히 매칭하려면
    // 이름과 세부항목을 따로 알고 있어야 한다("옥내소화전 소화전함"을 다시 쪼개는 건 애매함이 생김).
    // eff.name/eff.sub는 이미 화면에서 따로 선택된 값이라 그대로 별도 필드로 저장해둔다.
    equipName: eff.name || null,
    equipSub: eff.sub || null,
    parentEquip: eff.parent || null,  // 옥내소화전/스프링클러 밑에서 고른 공용 펌프류일 때, 어느 쪽 소속인지 (엑셀 출력 시 NFTC 102/103 직접 결정용)
    action: defectState.action,
    photo: defectState.photo,
    // [v31] 점검회차 태깅 — 나중에 점검종류/방문일자별로 모아보기 위한 최소 필드
    inspectionType: currentInspectionType,
    inspectionDate: currentInspectionDate,
    inspectionId: currentInspectionId,
    ts: Date.now()
  };
  defectEntries.push(entry);
  await saveDefectEntry(entry);
  renderDefectEntries();
  showToast('저장했습니다 (팀원과 공유됨)');
  $('defectContent').value='';
  // [v21] 상세위치는 더 이상 여기서 비우지 않는다 — 같은 위치에서 불량이 2~3건씩 나오는 경우가
  // 많아서, 층/동을 실제로 바꾸기 전까지는 마지막에 입력한 상세위치를 그대로 유지한다.
  // (아래 wingSelect/floorSelect의 onchange에서만 지운다)
  // 설비명/세부항목 선택은 그대로 유지 — 같은 설비에서 불량이 여러 건 나올 때 매번 다시 고르지 않도록 함.
  // 사양(벽부/소형 등)은 개체마다 다를 수 있어 저장할 때마다 초기화.
  defectState.specTags = []; currentSpecSuffix = '';
  // 불량내용 박스는 비웠으니, 유지된 설비명 프리픽스를 다시 채워 다음 항목도 바로 이어서 쓸 수 있게 함.
  syncEquipToDefectContent();
  defectState.photo=null;
  tagInsertCount = 0;
  $('defectPhotoPreview').style.display='none';
  renderDefectChips();
};
$('defectExportBtn').onclick = ()=>{
  if(!defectEntries.length){ showToast('내보낼 항목이 없습니다'); return; }
  const blob = new Blob([JSON.stringify(defectEntries,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=`불량내역_${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url);
};

// ================= 엑셀 저장 (공식 양식) =================
// V36까지 쓰던 EQUIP_TO_OFFICIAL/FACILITY_INFO는 V28 이전의 옛 설비명 체계(감지기/경종/소방펌프 등 단순 명칭) 기준이라,
// V28에서 MASTER_EQUIP_LIST가 61종 체계(가압송수장치(소화용수 펌프), 이산화탄소소화설비 등 공식 명칭)로 전면 개편된 뒤로
// 두 표가 서로 어긋나 있었음(다수 설비가 매핑 안 됨 → "기타"로 잘못 표시 + 비고 공란).
// 혁신소방_설비목록_불량내용_편집용_V02(철주님 검수본) 대조 결과 MASTER_EQUIP_LIST 61종은 정확히 일치함을 확인했고,
// 아래 EQUIP_MASTER_INFO는 그 61종 전체를 기준으로 다시 만든 표.
// 설비명 카테고리 탭(전체/수계소화설비/가스계소화설비/...) 정렬 순서 — MASTER_EQUIP_LIST의 e.cat 값 기준
// (혁신소방_설비목록_불량내용_편집용_V02_수정후 반영: 자동소화설비+일반소화설비가 "소화설비"로 통합됨)
const CATEGORY_ORDER = ["수계소화설비","가스계소화설비","소화설비","경보설비","피난구조설비","소화용수설비","소화활동설비","기타"];

// 엑셀(공식양식) 출력 시 행 정렬 순서 — buildOfficialRecords()가 채우는 공식 소방시설 대분류 기준(위와 다름)
const OFFICIAL_CATEGORY_ORDER = ["소화설비","경보설비","피난구조설비","소화용수설비","소화활동설비","기타"];

// name → [공식 소방시설 대분류, NFTC 번호]
// 혁신소방_설비목록_불량내용_편집용_V02_수정후(4차)의 "소방설비명(코드생성)" 컬럼을 그대로 신뢰해서 생성함.
// 4차 수정: "소방 펌프"에 뭉쳐 있던 부속(엔진펌프·예비펌프·주펌프·충압펌프)이 각각 독립된 최상위 설비로 분리됨.
// 5차 수정: "소방 펌프" 자체가 없어지고, 남아있던 부속 물올림장치·압력쳄버도 각각 독립 설비로 승격(부속 없는 단독 항목).
// 엔진펌프도 sub가 자기 자신을 가리키던 중복 구조에서 정상적인 단독(sub:null) 항목으로 정리됨.
// 물올림장치·압력쳄버 둘 다 옥내소화전설비/스프링클러설비 겸용이라 동적 처리 유지.
const EQUIP_MASTER_INFO = {
  "이산화탄소소화설비": ["소화설비","NFTC 106","이산화탄소소화설비"],
  "할로겐화합물 및 불활성기체소화설비": ["소화설비","NFTC 107A","할로겐화합물 및 불활성기체소화설비"],
  "할론소화설비": ["소화설비","NFTC 107","할론소화설비"],
  "가스누설경보기": ["경보설비","NFTC 206","가스누설경보기"],
  "누전경보기": ["경보설비","NFTC 205","누전경보기"],
  "단독경보형감지기": ["경보설비","NFTC 201","단독경보형감지기"],
  "불꽃감지기": ["경보설비","NFTC 203","자동화재탐지설비"],
  "비상방송설비": ["경보설비","NFTC 202","비상방송설비"],
  "수신기": ["경보설비","NFTC 203","자동화재탐지설비"],
  "시각경보기": ["경보설비","NFTC 203","시각경보장치"],
  "감지기": ["경보설비","NFTC 203","자동화재탐지설비"],  // [v35] 종류 무관 공용 감지기 항목
  "연기감지기": ["경보설비","NFTC 203","자동화재탐지설비"],
  "열감지기": ["경보설비","NFTC 203","자동화재탐지설비"],
  "자동화재속보기": ["경보설비","NFTC 204","자동화재속보설비"],
  "중계기": ["경보설비","NFTC 203","자동화재탐지설비"],
  "문열림경보장치(자동개폐장치)": ["기타","","기타(NFTC 해당없음)"],
  "방염": ["기타","","기타(NFTC 해당없음)"],
  "방화문": ["기타","","기타(NFTC 해당없음)"],
  "방화셔터": ["기타","","기타(NFTC 해당없음)"],
  "비상구": ["기타","","기타(NFTC 해당없음)"],
  "방수함": ["소화용수설비","NFTC 402","소화수조 및 저수조"],
  "상수도소화용수설비": ["소화용수설비","NFTC 401","상수도소화용수설비"],
  "소화수조": ["소화용수설비","NFTC 402","소화수조 및 저수조"],
  "무선통신보조설비": ["소화활동설비","NFTC 505","무선통신보조설비"],
  "비상콘센트설비": ["소화활동설비","NFTC 504","비상콘센트설비"],
  "연결살수설비": ["소화활동설비","NFTC 503","연결살수설비"],
  "연결송수관": ["소화활동설비","NFTC 502","연결송수관설비"],
  "연소방지설비": ["소화활동설비","NFTC 506","연소방지설비"],
  "제연설비": ["소화활동설비","NFTC 501","제연설비"],
  "간이스프링클러": ["소화설비","NFTC 103A","간이스프링클러설비"],
  "물분무소화설비": ["소화설비","NFTC 104","물분무소화설비"],
  "미분무소화설비": ["소화설비","NFTC 104A","미분무소화설비"],
  "스프링클러": ["소화설비","NFTC 103","스프링클러설비"],
  "옥내소화전": ["소화설비","NFTC 102","옥내소화전설비"],
  "옥외소화전": ["소화설비","NFTC 109","옥외소화전설비"],
  "포소화설비": ["소화설비","NFTC 105","포소화설비"],
  "K급소화기": ["소화설비","NFTC 101","소화기구"],
  "분말소화기": ["소화설비","NFTC 101","소화기구"],
  "자동확산소화기": ["소화설비","NFTC 112","자동확산소화기"],
  "고체에어로졸소화설비": ["소화설비","NFTC 110","고체에어로졸소화설비"],
  "분말소화설비": ["소화설비","NFTC 108","분말소화설비"],
  "주거용주방자동소화장치": ["소화설비","NFTC 113","주거용주방자동소화장치"],
  "캐비닛형자동소화장치": ["소화설비","NFTC 111","캐비닛형자동소화장치"],
  "화재조기진압용 스프링클러설비": ["소화설비","NFTC 103B","화재조기진압용 스프링클러설비"],
  "거실통로유도등": ["피난구조설비","NFTC 303","유도등 및 유도표지"],
  "계단통로유도등": ["피난구조설비","NFTC 303","유도등 및 유도표지"],
  "구조대": ["피난구조설비","NFTC 301","피난기구"],
  "복도통로유도등": ["피난구조설비","NFTC 303","유도등 및 유도표지"],
  "비상조명등": ["피난구조설비","NFTC 304","비상조명등 및 휴대용비상조명등"],
  "완강기": ["피난구조설비","NFTC 301","피난기구"],
  "인명구조기구": ["피난구조설비","NFTC 302","인명구조기구"],
  "피난구유도등": ["피난구조설비","NFTC 303","유도등 및 유도표지"],
  "피난기구": ["피난구조설비","NFTC 301","피난기구"],
  "휴대용비상조명등": ["피난구조설비","NFTC 304","비상조명등 및 휴대용비상조명등"],
  "발신기": ["경보설비","NFTC 203","자동화재탐지설비"],
  "자동화재탐지설비": ["경보설비","NFTC 203","자동화재탐지설비"],
  "비상벨설비": ["경보설비","NFTC 201","비상경보설비"],
  "고가수조": ["소화설비","",""],  // 동적: DYNAMIC_EQUIP_NFTC_OPTIONS
  "물올림장치": ["소화설비","",""],  // 동적: DYNAMIC_EQUIP_NFTC_OPTIONS
  "압력쳄버": ["소화설비","",""],  // 동적: DYNAMIC_EQUIP_NFTC_OPTIONS
  "주펌프": ["소화설비","",""],  // 동적: DYNAMIC_EQUIP_NFTC_OPTIONS
  "충압펌프": ["소화설비","",""],  // 동적: DYNAMIC_EQUIP_NFTC_OPTIONS
  "예비펌프": ["소화설비","",""],  // 동적: DYNAMIC_EQUIP_NFTC_OPTIONS
  "엔진펌프": ["소화설비","",""],  // 동적: DYNAMIC_EQUIP_NFTC_OPTIONS
  "자가발전설비": ["소화설비","",""],  // 동적: DYNAMIC_EQUIP_NFTC_OPTIONS
  "저수조": ["소화설비","",""],  // 동적: DYNAMIC_EQUIP_NFTC_OPTIONS
};

// 대상물의 실제 소방시설현황(facility)에 따라 NFTC를 동적으로 정하는 설비들.
// 값은 [소방시설현황 키, 그 NFTC] 후보 목록 — 실제 설치된 게 있으면 그것만, 여러 개 설치돼 있으면 병기,
// 설치현황 정보가 아예 없으면 후보 전부를 병기(기존 동작 유지).
const DYNAMIC_EQUIP_NFTC_OPTIONS = {
  "물올림장치": [["옥내소화전설비","NFTC 102","옥내소화전설비"],["스프링클러설비","NFTC 103","스프링클러설비"]],
  "압력쳄버": [["옥내소화전설비","NFTC 102","옥내소화전설비"],["스프링클러설비","NFTC 103","스프링클러설비"]],
  "주펌프": [["옥내소화전설비","NFTC 102","옥내소화전설비"],["스프링클러설비","NFTC 103","스프링클러설비"]],
  "충압펌프": [["옥내소화전설비","NFTC 102","옥내소화전설비"],["스프링클러설비","NFTC 103","스프링클러설비"]],
  "예비펌프": [["옥내소화전설비","NFTC 102","옥내소화전설비"],["스프링클러설비","NFTC 103","스프링클러설비"]],
  "엔진펌프": [["옥내소화전설비","NFTC 102","옥내소화전설비"],["스프링클러설비","NFTC 103","스프링클러설비"]],
  "고가수조": [["옥내소화전설비","NFTC 102","옥내소화전설비"],["스프링클러설비","NFTC 103","스프링클러설비"]],
  "저수조": [["옥내소화전설비","NFTC 102","옥내소화전설비"],["스프링클러설비","NFTC 103","스프링클러설비"]],
  "자가발전설비": [["옥내소화전설비","NFTC 102","옥내소화전설비"],["스프링클러설비","NFTC 103","스프링클러설비"]],
};
const PARENT_TO_FACILITY_KEY = { '옥내소화전':'옥내소화전설비', '스프링클러':'스프링클러설비' };
function dynamicEquipNFTC(name, parentHint){
  const options = DYNAMIC_EQUIP_NFTC_OPTIONS[name];
  if(!options) return '';
  // 2단계에서 옥내소화전/스프링클러 밑에 들어있는 펌프류를 골랐다면, 대상물 현황 추정 없이 그 소속으로 바로 결정
  if(parentHint && PARENT_TO_FACILITY_KEY[parentHint]){
    const key = PARENT_TO_FACILITY_KEY[parentHint];
    const found = options.find(([k])=>k===key);
    if(found) return found[1];
  }
  const profile = BUILDING_PROFILES[currentBuilding];
  const fac = (profile && profile.facility) || {};
  const matched = options.filter(([key])=>fac[key]);
  const nftcs = (matched.length ? matched : options).map(([,n])=>n);
  return nftcs.map((n,i)=> i===0 ? n : n.replace(/^NFTC\s*/,'')).join('·');
}

// 엑셀 "설비명" 열에는 앱 내부 칩 이름(예: 주펌프)이 아니라 소방설비명(코드생성) 공식 용어를 써야 하므로,
// 동적 항목도 NFTC와 같은 방식으로 공식 설비명을 구한다.
function dynamicEquipOfficialName(name, parentHint){
  const options = DYNAMIC_EQUIP_NFTC_OPTIONS[name];
  if(!options) return name;
  if(parentHint && PARENT_TO_FACILITY_KEY[parentHint]){
    const key = PARENT_TO_FACILITY_KEY[parentHint];
    const found = options.find(([k])=>k===key);
    if(found) return found[2];
  }
  const profile = BUILDING_PROFILES[currentBuilding];
  const fac = (profile && profile.facility) || {};
  const matched = options.filter(([key])=>fac[key]);
  const names = (matched.length ? matched : options).map(([,,n])=>n);
  return [...new Set(names)].join('·');
}

const FACILITY_WRAP_MAP = {
  "이산화탄소소화설비":"이산화탄소\n소화설비", "할로겐화합물 및 불활성기체소화설비":"할로겐화합물 및\n불활성기체소화설비",
  "자동확산소화기":"자동확산\n소화기",
  "가스누설경보기":"가스누설\n경보기", "자동화재속보설비":"자동화재\n속보설비",
  "간이스프링클러설비":"간이스프링클러설비",
  "옥외소화전설비":"옥외소화전설비", "연결송수관설비":"연결송수관설비",
  "연결살수설비":"연결살수\n설비", "화재조기진압용 스프링클러설비":"화재조기진압용\n스프링클러설비",
  "문열림경보장치(자동개폐장치)":"문열림경보장치\n(자동개폐장치)", "상수도소화용수설비":"상수도소화\n용수설비",
  "유도등 및 유도표지":"유도등 및\n유도표지",
  "비상조명등 및 휴대용비상조명등":"비상조명등 및\n휴대용비상조명등",
  "소화수조 및 저수조":"소화수조\n및 저수조",
  "옥내소화전설비":"옥내소화전설비", "스프링클러설비":"스프링클러설비",
  "주거용주방자동소화장치":"주거용주방\n자동소화장치", "캐비닛형자동소화장치":"캐비닛형\n자동소화장치",
};

const ACTION_TO_MEASURE = { '조치완료':'조치완료', '조치요함':'조치 요함', '확인필요':'확인 요함' };

function nftcSortKey(nftc){
  const m = /NFTC\s*(\d+)([A-Z]?)/.exec(nftc||'');
  if(!m) return 9999;
  const n = parseInt(m[1],10);
  const s = m[2] ? (m[2].charCodeAt(0)-64)*0.1 : 0;
  return n+s;
}

// en.equip = "설비명" 또는 "설비명 세부항목" (둘 다 공백을 포함할 수 있음 — 예: "가압송수장치(소화용수 펌프) 압력계").
// 예전엔 split(' ')[0]로 첫 단어만 잘라써서 "가압송수장치(소화용수 펌프)"처럼 이름 자체에 공백이 있으면
// "가압송수장치(소화용수" 로 잘려버리는 버그가 있었음 — 알려진 설비명 목록(EQUIP_MASTER_INFO의 key들)과
// 대조해서 가장 길게 일치하는 설비명을 앞에서부터 찾는 방식으로 교체.
const KNOWN_EQUIP_NAMES = Object.keys(EQUIP_MASTER_INFO).sort((a,b)=>b.length-a.length);
function resolveEquipPrimary(equipStr){
  equipStr = equipStr || '';
  for(const name of KNOWN_EQUIP_NAMES){
    if(equipStr===name || equipStr.indexOf(name+' ')===0) return name;
  }
  // 알려진 목록에 없는 이름(현장에서 직접 추가한 설비 등)은 첫 단어로 폴백
  return equipStr.split(' ')[0];
}

function buildOfficialRecords(){
  // 보고서 제목(대 상 명)이 currentBuilding 하나인데 정작 records는 필터 없이 defectEntries 전체(다른 대상물 포함)를
  // 쓰고 있던 기존 버그를 같이 고침 — 이 대상물 것만 뽑는다.
  return defectEntries.filter(en=>en.building===currentBuilding).map(en=>{
    const primary = resolveEquipPrimary(en.equip);
    const info = EQUIP_MASTER_INFO[primary] || ['기타','',primary];
    const content = (en.detailLocation ? en.detailLocation+' ' : '') + (en.defectContent||'');
    const isDynamic = !!DYNAMIC_EQUIP_NFTC_OPTIONS[primary];
    const nftc = isDynamic ? dynamicEquipNFTC(primary, en.parentEquip) : (info[1] || '');
    // "설비명" 열은 앱 내부 칩 이름(주펌프 등)이 아니라 소방설비명(코드생성) 공식 용어로 출력
    const officialName = isDynamic ? dynamicEquipOfficialName(primary, en.parentEquip) : (info[2] || primary);
    return {
      소방시설: info[0],
      설비명: officialName,
      위치: en.location || '',
      시정보완사항: content.trim(),
      보완대책: ACTION_TO_MEASURE[en.action] || (en.action||''),
      비고: nftc,
    };
  });
}

$('defectExportXlsxBtn').onclick = async ()=>{
  if(!defectEntries.length){ showToast('내보낼 항목이 없습니다'); return; }
  if(typeof ExcelJS === 'undefined'){ showToast('엑셀 라이브러리 로드에 실패했습니다. 인터넷 연결을 확인해주세요'); return; }
  showToast('엑셀 생성 중...');

  const records = buildOfficialRecords();
  const catRank = Object.fromEntries(OFFICIAL_CATEGORY_ORDER.map((c,i)=>[c,i]));
  records.sort((a,b)=>{
    const ra = catRank[a.소방시설] ?? 99, rb = catRank[b.소방시설] ?? 99;
    if(ra!==rb) return ra-rb;
    return nftcSortKey(a.비고) - nftcSortKey(b.비고);
  });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('전체불량내역', {
    pageSetup: { orientation:'landscape', paperSize:9, scale:100, fitToPage:false },
    views: [{ style:'pageBreakPreview', zoomScale:100, zoomScaleNormal:100, showGridLines:true }],
  });
  ws.columns = [
    {width:10.78},{width:11.78},{width:12.66},{width:42.0},{width:20.33},{width:9.44}
  ];

  // 행높이 상수 (무룡초불량내역.xls 실측치 기준)
  const ROW_H1 = 30.0, ROW_H2 = 25.5, ROW_H_BASE = 35.1;
  const ROW_CHARS_PER_LINE = 19, ROW_H_EXTRA_LINE = 16.875;

  // D열(시정보완사항)을 ROW_CHARS_PER_LINE 기준으로 명시적 줄바꿈 삽입.
  // → 열너비(COL_W)와 실제 렌더링 폰트(돋움)의 문자폭이 정확히 비례하지 않아
  //   Excel 자동 줄바꿈에 맡기면 줄 수가 들쭉날쭉해지므로, 줄바꿈 위치를 직접
  //   계산해 행높이(calcRowHeight)와 실제 표시 줄 수가 항상 일치하도록 한다.
  function wrapAtWidth(text, perLine){
    text = (text||'').trim();
    if(!text) return text;
    const lines = [];
    let rest = text;
    while(rest.length > perLine){
      let idx = rest.lastIndexOf(' ', perLine);
      if(idx <= 0) idx = perLine; // 공백이 없으면 그냥 글자수 기준으로 자름
      lines.push(rest.slice(0, idx).trim());
      rest = rest.slice(idx).trim();
    }
    lines.push(rest);
    return lines.join('\n');
  }

  function calcRowHeight(text){
    text = text || '';
    let linesNeeded = 0;
    text.split('\n').forEach(line=>{
      linesNeeded += Math.max(1, Math.ceil(line.length/ROW_CHARS_PER_LINE));
    });
    linesNeeded = Math.max(2, linesNeeded);
    const extra = Math.max(0, linesNeeded-2);
    return ROW_H_BASE + extra*ROW_H_EXTRA_LINE;
  }

  // 실제 값에 줄바꿈을 미리 적용(행높이 계산과 셀 표시 내용이 항상 같은 기준을 쓰도록)
  records.forEach(rec => { rec.시정보완사항 = wrapAtWidth(rec.시정보완사항, ROW_CHARS_PER_LINE); });

  ws.mergeCells('B1:F1');
  ws.getCell('B1').value = '소방시설등 시정보완 조치명령 사항';
  ws.getCell('B1').font = { name:'맑은 고딕', bold:true, size:26 };
  ws.getCell('B1').alignment = { horizontal:'center', vertical:'middle', wrapText:true };
  ws.getRow(1).height = ROW_H1;

  ws.mergeCells('A2:F2');
  const bldgSpaced = (currentBuilding || '점검대상').split('').join(' ');
  ws.getCell('A2').value = `대 상 명 : ${bldgSpaced}`;
  ws.getCell('A2').font = { name:'맑은 고딕', bold:true, size:14 };
  ws.getCell('A2').alignment = { horizontal:'left', vertical:'middle', wrapText:true };
  ws.getRow(2).height = ROW_H2;

  const headers = ['소방시설','설비명','위치','시 정 보 완 사 항','보완대책','비고'];
  const headerRow = ws.getRow(3);
  headers.forEach((h,i)=>{
    const c = headerRow.getCell(i+1);
    c.value = h;
    c.font = { name:'맑은 고딕', bold:true, size:12 };
    c.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFC0C0C0'} };
    c.alignment = { horizontal:'center', vertical:'middle', wrapText:true };
    c.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
  });
  headerRow.height = ROW_H_BASE;

  // 데이터 행: 폰트 돋움 11pt, 전 열 가운데 정렬 (무룡초불량내역.xls 실측)
  // 행높이를 먼저 전부 계산해두고(페이지 나누기 예산 계산에 필요), 그다음 실제 셀에 적용한다.
  const rowHeights = records.map(rec => calcRowHeight(rec.시정보완사항));
  records.forEach((rec,idx)=>{
    const r = ws.getRow(4+idx);
    const isDone = (rec.보완대책||'').replace(/\s/g,'') === '조치완료';
    const vals = [ rec.소방시설, FACILITY_WRAP_MAP[rec.설비명]||rec.설비명, rec.위치, rec.시정보완사항, rec.보완대책, rec.비고 ];
    vals.forEach((v,ci)=>{
      const c = r.getCell(ci+1);
      c.value = v;
      c.font = { name:'돋움', size:11 };
      c.alignment = { horizontal:'center', vertical:'middle', wrapText:true };
      c.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
      if(ci===4 && isDone) c.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFFFF00'} };
    });
    r.height = rowHeights[idx];
  });

  // ---- 페이지 나누기 사전계산 ----
  // 반복행(1~3행, 제목/대상명/헤더)이 매 페이지 앞에 다시 나오므로,
  // 데이터행은 페이지당 정확히 9행씩 끊는다.
  // → 1페이지: 4~12행(데이터 9행), 2페이지: 13~21행(9행), 3페이지: 22~30행(9행) ...
  const ROWS_PER_PAGE = 9;
  function computePageBreakRows(count){
    const breaks = []; // 0-based 데이터행 인덱스: 이 행 "바로 다음"에서 페이지가 갈린다
    for(let i = ROWS_PER_PAGE-1; i < count-1; i += ROWS_PER_PAGE){
      breaks.push(i);
    }
    return breaks;
  }
  const pageBreakDataIdx = computePageBreakRows(records.length);
  const pageBreakRowSet = new Set(pageBreakDataIdx.map(i => 4+i)); // 실제 엑셀 행번호(그 행 뒤에서 페이지가 갈림)


  // A열(소방시설)·B열(설비명) 연속 동일값 세로 병합
  // ← 페이지 경계(pageBreakRowSet)에 걸리면 값이 같아도 그 경계에서 강제로 병합을 끊는다
  //   (병합된 셀이 페이지 중간에서 잘려 인쇄되는 것을 방지)
  function mergeRepeated(col, keyFn){
    let start = 4;
    for(let i=4; i<=3+records.length+1; i++){
      const cur = i<=3+records.length ? keyFn(records[i-4]) : Symbol('end');
      const prev = keyFn(records[start-4]);
      const brokenByPageBreak = pageBreakRowSet.has(i-1);
      if(cur !== prev || brokenByPageBreak){
        if(i-1 > start) ws.mergeCells(start,col,i-1,col);
        start = i;
      }
    }
  }
  if(records.length){
    mergeRepeated(1, r=>r.소방시설);
    mergeRepeated(2, r=>r.설비명);
  }

  // 페이지 나누기를 openpyxl Break(row_breaks)와 동일하게 수동 지정
  // — 렌더링 환경(Excel/LibreOffice/뷰어)별로 자동 나누기 위치가 달라지는 편차를 차단
  pageBreakRowSet.forEach(rowNum => { ws.getRow(rowNum).addPageBreak(); });

  ws.pageSetup.printArea = `A1:F${3+records.length}`;
  ws.pageSetup.horizontalCentered = true;
  // 여백(인치): 무룡초불량내역.xls 실측치 (좌우상하 1.0" · 머리글 0.51" · 바닥글 0.5")
  ws.pageSetup.margins = { left:1.0, right:1.0, top:1.0, bottom:1.0, header:0.51, footer:0.5 };
  ws.pageSetup.printTitlesRow = '1:3';
  // 인쇄 배율: "페이지 설정 > 페이지 > 확대/축소 배율 100%" (자동맞춤 미사용)
  ws.pageSetup.scale = 100;
  ws.pageSetup.fitToPage = false;

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const bldg = currentBuilding || '점검대상';
  const filename = `불량내역_${bldg}_${new Date().toISOString().slice(0,10)}.xlsx`;
  await shareOrDownloadBlob(blob, filename, filename);
  showToast('엑셀로 저장했습니다');
};

$('defectClearBtn').onclick = async ()=>{
  if(!currentBuilding){ showToast('대상물을 먼저 선택해주세요'); return; }
  // [v23 변경] 예전엔 "전체 초기화"가 모든 대상물의 불량내역·휴지통을 통째로 지웠다.
  // 화면이 대상물별로 분리된 지금(v22)과 어긋나고, 실수로 다른 대상물 데이터까지
  // 날릴 위험이 있어 "지금 보고 있는 대상물"만 지우도록 범위를 좁힌다.
  if(!confirm(`⚠️ "${currentBuilding}"의 불량내역(휴지통 포함)을 팀 전체와 공유된 상태로 삭제합니다. 다른 대상물의 데이터는 그대로 남습니다. 되돌릴 수 없는데 진행할까요?`)) return;
  const toDelete = [...defectEntries, ...defectTrash].filter(en=>en.building===currentBuilding);
  await Promise.all(toDelete.map(en=>storageDelete('defect:'+en.id, true)));
  defectEntries = defectEntries.filter(en=>en.building!==currentBuilding);
  defectTrash = defectTrash.filter(en=>en.building!==currentBuilding);
  renderDefectEntries(); renderDefectTrash();
  showToast(`"${currentBuilding}"의 불량내역을 초기화했습니다`);
};


// ================= 점검 사진대장 : 엑셀(공식양식) 저장 =================
// 테스트 기간에는 혁신소방 마크를 고정 사용. 실제 서비스에서는 로그인한 점검업체의
// 회사명/로고로 교체해야 함 (건물-점검업체 매핑 정보 연동 필요).
const COMPANY_NAME = '혁신소방주식회사';
const COMPANY_LOGO_B64 = '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'; // PNG, 'HS F' 마크 (테스트용)

function colWidthToPx(w){ return Math.round(w*7+5); }
function rowHeightToPx(h){ return Math.round(h*96/72); }
function stripB64(dataUrl){ return dataUrl.split(',')[1]; }

function loadImageEl(src){
  return new Promise((resolve,reject)=>{ const im=new Image(); im.onload=()=>resolve(im); im.onerror=reject; im.src=src; });
}
// 대상 박스 비율에 맞춰 가운데 기준으로 잘라(cover-fit) 채우기 — 파이썬 생성기와 동일 로직
async function coverFitDataUrl(dataUrl, targetW, targetH){
  const img = await loadImageEl(dataUrl);
  const srcW = img.width, srcH = img.height;
  const targetRatio = targetW/targetH, srcRatio = srcW/srcH;
  let sx=0, sy=0, sw=srcW, sh=srcH;
  if(srcRatio > targetRatio){ sw = srcH*targetRatio; sx = (srcW-sw)/2; }
  else{ sh = srcW/targetRatio; sy = (srcH-sh)/2; }
  const canvas = document.createElement('canvas');
  canvas.width = targetW; canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
  return canvas.toDataURL('image/jpeg', 0.85);
}

// 사진을 태그(=화면에 보이는 태그 목록) 순서대로 정렬. 목록에 없는 태그(직접입력 등)는 뒤로 보냄.
// 특정 태그에 사진이 없으면 그냥 건너뛰고 다음 태그 사진으로 이어짐(빈 자리 없음).
// [v17] 펌프성능시험(정격유량/150%유량) 사진은 그 대상물의 태그 목록 순서가 어떻든 상관없이
// 항상 맨 마지막(있는 그대로 12장이면 11·12번째)에 오도록 별도로 강제 배치한다. 직접입력한
// 커스텀 태그처럼 목록에 없는 태그는 원래 맨 뒤로 밀리는데, 그러면 펌프성능시험보다도 더
// 뒤로 가버려 펌프성능시험이 11·12번째를 벗어나는 경우가 있었기 때문.
const PUMP_TAG_ORDER = ['펌프성능시험(정격유량)','펌프성능시험(150%유량)'];
function sortByTagOrder(entries, tagList){
  const rank = t => { const i = tagList.indexOf(t); return i===-1 ? 9999 : i; };
  const sorted = entries.slice().sort((a,b)=> rank(a.tag) - rank(b.tag));
  const pumps = [], rest = [];
  sorted.forEach(e=> (PUMP_TAG_ORDER.includes(e.tag) ? pumps : rest).push(e));
  pumps.sort((a,b)=> PUMP_TAG_ORDER.indexOf(a.tag) - PUMP_TAG_ORDER.indexOf(b.tag));
  return [...rest, ...pumps];
}

// 점검 사진대장 / 공사 사진대장 공용 엑셀 생성기 (표지+그리드 서식은 완전히 동일, 제목/헤더/내용만 다름)
async function generateAlbumXlsx({ title, subjectName, headerLabel, pairs, filenamePrefix }){
  if(typeof ExcelJS === 'undefined'){ showToast('엑셀 라이브러리 로드에 실패했습니다. 인터넷 연결을 확인해주세요'); return; }
  showToast('엑셀 생성 중...');

  // 사진 필드가 구글드라이브 링크(팀 공유 저장소로 바뀐 뒤 생긴 형태)인 경우,
  // 엑셀에 이미지로 끼워넣으려면 base64가 필요하므로 여기서 미리 변환해둔다.
  // (이미 base64인 경우는 그대로 통과, 실패한 사진은 건너뛰고 나머지는 계속 진행)
  showToast('사진 불러오는 중...');
  for(const pair of pairs){
    for(const item of pair){
      if(item && item.photo){
        try{ item.photo = await resolvePhotoToBase64(item.photo); }
        catch(e){ item.photo = null; }
      }
    }
  }
  showToast('엑셀 생성 중...');

  try{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet 1', {
    pageSetup: { orientation:'portrait', paperSize:9, scale:100, fitToPage:false },
    views: [{ style:'pageBreakPreview', zoomScale:100, zoomScaleNormal:100, showGridLines:true }],
  });
  ws.columns = [ {width:38.625}, {width:2.125}, {width:38.625} ];

  // ---- 표지 (원본 견본 '종합점검_사진대장_독서체험관.xlsm' 실측 서식) ----
  const COVER_ROW_H = {1:16.5,2:16.5,3:16.5,4:16.5,5:18.0,6:48.0,7:16.5,8:16.5,9:16.5,10:9.95,11:15.0,12:15.0,13:15.0,14:9.95,15:9.95,28:16.5,29:16.5,30:16.5,35:45.0};
  Object.entries(COVER_ROW_H).forEach(([r,h])=>{ ws.getRow(+r).height = h; });

  ws.mergeCells('A1:C6');
  ws.getCell('A1').value = title;
  ws.getCell('A1').font = { name:'돋움', size:31, bold:true };
  ws.getCell('A1').alignment = { horizontal:'center', vertical:'middle', wrapText:true };

  ws.mergeCells('A16:C19');
  const bldgSpaced = (subjectName || '점검대상').split('').join(' ');
  ws.getCell('A16').value = `대 상 명 : ${bldgSpaced}`;
  ws.getCell('A16').font = { name:'맑은 고딕', size:20, bold:true };
  ws.getCell('A16').alignment = { horizontal:'center', vertical:'middle' };

  ws.mergeCells('A32:C35');
  ws.getCell('A32').value = COMPANY_NAME;
  ws.getCell('A32').font = { name:'맑은 고딕', size:18, bold:true };
  ws.getCell('A32').alignment = { horizontal:'center', vertical:'bottom' };

  if(COMPANY_LOGO_B64){
    // 회사명이 병합블록(A32:C35) 안에서 가로 중앙에 놓이므로, 텍스트 폭을 근사
    // 추정해 그 바로 왼쪽에 로고를 붙여 "이름 옆" 배치를 만든다 (파이썬 생성기와 동일 로직).
    const colWidthsPx = [colWidthToPx(38.625), colWidthToPx(2.125), colWidthToPx(38.625)];
    const blockWidthPx = colWidthsPx.reduce((a,b)=>a+b,0);
    const logoW = 60, logoH = 53; // 원본 비율(103x91) 근사 유지
    const charWPx = 22.0; // 맑은고딕 bold 18pt 실측 보정치 (PDF 실측 기반)
    const textWidthPx = COMPANY_NAME.length * charWPx;
    const textStartX = Math.max(0, (blockWidthPx - textWidthPx) / 2);
    const logoGapPx = -4; // 살짝 겹칠 정도로 바짝 붙임
    const logoX = Math.max(0, textStartX - logoW - logoGapPx);
    // px 오프셋을 (col, colOff) 로 변환
    function pxToAnchor(xPx, sizesPx){
      let idx=0, remaining=Math.max(0,xPx);
      for(let i=0;i<sizesPx.length;i++){
        if(remaining < sizesPx[i] || i===sizesPx.length-1) break;
        remaining -= sizesPx[i]; idx++;
      }
      return { idx, offPx: remaining };
    }
    const { idx: logoCol, offPx: logoColOffPx } = pxToAnchor(logoX, colWidthsPx);
    // 세로: 텍스트가 '하단(bottom)' 정렬이므로 로고도 블록 맨 아래(row35 하단)에 맞춘다
    const rowHeightsPx = [rowHeightToPx(15.0), rowHeightToPx(15.0), rowHeightToPx(15.0), rowHeightToPx(45.0)];
    const blockHeightPx = rowHeightsPx.reduce((a,b)=>a+b,0);
    const logoY = Math.max(0, blockHeightPx - logoH);
    const { idx: logoRowRel, offPx: logoRowOffPx } = pxToAnchor(logoY, rowHeightsPx);
    const logoId = wb.addImage({ base64: COMPANY_LOGO_B64, extension:'png' });
    // 주의: ExcelJS는 tl:{col:소수} 형태를 열의 width 기준으로 재환산하는데,
    // 우리처럼 열 너비를 크게 커스텀한 경우 그 환산식이 실제 EMU와 어긋난다.
    // → nativeColOff/nativeRowOff(EMU, 1px=9525)를 직접 지정해 이 버그를 우회한다.
    const EMU_PER_PX = 9525;
    ws.addImage(logoId, {
      tl: {
        nativeCol: logoCol, nativeColOff: Math.round(logoColOffPx * EMU_PER_PX),
        nativeRow: 31 + logoRowRel, nativeRowOff: Math.round(logoRowOffPx * EMU_PER_PX),
      },
      ext: { width: logoW, height: logoH },
    });
  }

  // ---- 사진 그리드 (사진 3쌍=6장마다 헤더 반복) ----
  const PAIR_PHOTO_H=174.95, PAIR_CAP_H=39.95, GAP_H=20.1, HEADER_H=39.95, PAIRS_PER_GROUP=3;
  const THIN = {style:'thin'};
  const BOX = { top:THIN, bottom:THIN, left:THIN, right:THIN };

  let curRow = 41;
  let pairIdxInGroup = 0;
  const groupEndRows = []; // 그룹(헤더+최대 3쌍)이 끝나는 행 번호 → 페이지 나누기에 사용
  for(let idx=0; idx<pairs.length; idx++){
    const pair = pairs[idx];
    if(pairIdxInGroup===0){
      ws.mergeCells(`A${curRow}:C${curRow}`);
      const hc = ws.getCell(`A${curRow}`);
      hc.value = headerLabel;
      hc.font = { name:'돋움', size:26 };
      hc.alignment = { horizontal:'center', vertical:'top' };
      ws.getRow(curRow).height = HEADER_H;
      curRow++;
    }

    const photoRow = curRow;
    ws.getRow(photoRow).height = PAIR_PHOTO_H;
    for(let ci=0; ci<pair.length; ci++){
      if(!pair[ci]) continue;
      const col = ci===0 ? 'A' : 'C';
      const cell = ws.getCell(`${col}${photoRow}`);
      cell.border = BOX;
      if(pair[ci].photo){
        try{
          const imgId = wb.addImage({ base64: stripB64(pair[ci].photo), extension:'jpeg' });
          const colIdx = ci===0 ? 0 : 2;
          // tl→br 두 앵커로 지정하면 셀 크기에 맞춰 늘려서(비율이 달라도) 빈틈없이 채워진다.
          ws.addImage(imgId, { tl:{col:colIdx, row:photoRow-1}, br:{col:colIdx+1, row:photoRow} });
        }catch(e){
          console.error('사진 삽입 실패(건너뜀):', pair[ci].tag, e);
        }
      }
    }
    if(!pair[1]){ ws.getCell(`C${photoRow}`).border = BOX; }
    curRow++;

    const capRow = curRow;
    ws.getRow(capRow).height = PAIR_CAP_H;
    for(let ci=0; ci<pair.length; ci++){
      if(!pair[ci]) continue;
      const col = ci===0 ? 'A' : 'C';
      const cell = ws.getCell(`${col}${capRow}`);
      cell.value = pair[ci].tag;
      cell.font = { name:'돋움', size:11 };
      cell.alignment = { horizontal:'left', vertical:'middle', indent:1 };
      cell.border = BOX;
    }
    if(!pair[1]){ ws.getCell(`C${capRow}`).border = BOX; }
    curRow++;

    pairIdxInGroup++;
    const isLast = idx===pairs.length-1;
    if(pairIdxInGroup===PAIRS_PER_GROUP){ pairIdxInGroup=0; groupEndRows.push(curRow-1); }
    else if(!isLast){ ws.getRow(curRow).height = GAP_H; curRow++; }
  }

  const lastRow = curRow - 1;
  ws.pageSetup.printArea = `A1:C${lastRow}`;
  // 여백: '보통 여백' (좌우 0.7", 상하 0.75", 머리글/바닥글 0.3")
  ws.pageSetup.margins = { left:0.7, right:0.7, top:0.75, bottom:0.75, header:0.3, footer:0.3 };

  // ---- 페이지 나누기 : 표지(40행) 뒤, 그룹(7행) 경계마다 고정 삽입
  //      (자동 나누기에 맡기면 렌더러/버전에 따라 위치가 들쭉날쭉해지므로 수동 지정)
  const breakRows = [40, ...groupEndRows.filter(r => r < lastRow)];
  breakRows.forEach(r => { ws.getRow(r).addPageBreak(); });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const filename = `${filenamePrefix}_${subjectName||'대상'}_${new Date().toISOString().slice(0,10)}.xlsx`;
  await shareOrDownloadBlob(blob, filename, filename);
  showToast('엑셀로 저장했습니다');
  }catch(e){
    console.error('엑셀 생성 실패:', e);
    showToast('엑셀 생성 중 오류가 발생했습니다. 다시 시도해주세요');
  }
}

// [v26 신규] 홈 화면 대상물 목록(SAMPLE_BUILDINGS)의 sub 문구("종합점검 · 07-20 예정" 등)에서
// 점검유형(종합/작동)을 뽑아온다. 점검사진대장 엑셀 표지 제목을 여기에 맞춰 다르게 낸다.
function getInspectTypeLabel(building){
  const b = SAMPLE_BUILDINGS.find(x=>x.name===building);
  if(b && b.sub && b.sub.indexOf('작동점검')===0) return '작동';
  if(b && b.sub && b.sub.indexOf('종합점검')===0) return '종합';
  return '종합'; // 목록에 없는 대상물(직접입력)은 기존과 동일하게 안전하게 '종합'으로 처리
}

$('photoExportXlsxBtn').onclick = async ()=>{
  // [v22 버그수정] 다른 대상물 사진까지 엑셀에 섞여 들어가지 않도록 currentBuilding으로 필터링
  const selected = sortByTagOrder(
    photoEntries.filter(e=>e.include && (e.group||'report')==='report' && e.building===currentBuilding),
    TAGS
  );
  if(!selected.length){ showToast('선택된 사진이 없습니다 (기타 보관용 사진은 엑셀에 포함되지 않습니다)'); return; }
  const pairs = [];
  for(let i=0;i<selected.length;i+=2) pairs.push(selected.slice(i,i+2));
  await generateAlbumXlsx({
    title: `소방시설 ${getInspectTypeLabel(currentBuilding)}점검 사진대장`,
    subjectName: currentBuilding,
    headerLabel: '점 검   사 진',
    pairs,
    filenamePrefix: '점검사진대장',
  });
};
// [v49 신규] 기타 보관용 사진 — PDF(인쇄)뿐 아니라 엑셀로도 뽑을 수 있게 함(사진대장과 같은 양식 재사용).
$('otherPhotoExportXlsxBtn').onclick = async ()=>{
  const selected = photoEntries.filter(e=>e.include && e.group==='other' && e.building===currentBuilding);
  if(!selected.length){ showToast('선택된 기타 보관용 사진이 없습니다'); return; }
  const pairs = [];
  for(let i=0;i<selected.length;i+=2) pairs.push(selected.slice(i,i+2));
  await generateAlbumXlsx({
    title: '기타 보관용 사진',
    subjectName: currentBuilding,
    headerLabel: '기타 보관용 사진',
    pairs,
    filenamePrefix: '기타보관용사진',
  });
};

