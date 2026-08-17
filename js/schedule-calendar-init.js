// ============================================================
// schedule-calendar-init.js
// 일정관리 캘린더 뷰 + 3인 공유 동기화 배너 + 초기화 (원본 5847~6321줄)
// ※ E단계 모듈화(V77) 시 원본 v76 단일 파일에서 그대로 잘라낸 것으로,
//   전역 스코프를 그대로 사용하며 기존 함수 간 참조 관계는 100% 동일합니다.
// ============================================================
// ==================================================================================
// [v48] 아래는 원래 별도 파일이던 "혁신소방_일정관리대시보드"의 로직이다. 병합하면서
// $ / showToast / storageSet·Delete·GetMany / toISO·fromISO·addDays·pad2 / STATUS_STAGES·statusStage /
// scheduleEntries·loadScheduleEntries 는 위에 이미 있는 것을 그대로 재사용하도록 중복 정의를 모두 제거했다.
// (같은 이름을 script 안에서 두 번 선언하면 문법 오류가 나기 때문에 반드시 지워야 했음.)
// ==================================================================================
const DOW_KR = ['일','월','화','수','목','금','토'];

function excelSerialToDate(serial){
  // 엑셀(1900 날짜체계) 시리얼 번호 -> JS Date. 1899-12-30을 기준일로 계산(엑셀의 1900 윤년 버그 포함 보정값).
  return new Date(Date.UTC(1899,11,30) + Math.round(Number(serial))*86400000);
}
function dateToExcelSerial(iso){
  const d = fromISO(iso);
  return Math.round((Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()) - Date.UTC(1899,11,30)) / 86400000);
}

let LIMIT = { 종합점검: 10000, 작동점검: 12500 };
function entriesOnDate(iso){
  return scheduleEntries.filter(e => iso >= e.startDate && iso <= scheduleEntryEndDate(e));
}
async function removeScheduleEntry(id){ await storageDelete('schedule:'+id, true); }

// ---- 엑셀 업로드(가져오기) ----
function cleanBuildingName(raw){
  // [v51] "8,2 울산여고"(쉼표)뿐 아니라 "1.7 중산현대아파트"(마침표) 표기도 나오는 걸 확인했다.
  // 이 접두어를 못 지우면 "1.7 중산현대아파트"라는 완전히 다른 이름으로 저장되어 마스터DB와
  // 매칭이 안 되고(대상물 정보가 통째로 안 나타남), 대신 EQUIP_DB 등이 비어버리는 문제로 이어진다.
  return String(raw||'').replace(/^\d+\s*[,.]\s*\d+\s+/, '').trim();
}
async function parseScheduleXlsx(file){
  const buf = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  let targetWs = null, headerRow = null;
  for(const ws of wb.worksheets){
    for(let r=1; r<=Math.min(ws.rowCount,5); r++){
      const vals = (ws.getRow(r).values||[]).map(v=>(v==null?'':String(v).replace(/\s/g,'')));
      if(vals.includes('대상물명') && vals.includes('시작일')){ targetWs = ws; headerRow = r; break; }
    }
    if(targetWs) break;
  }
  if(!targetWs) throw new Error('"시작일"/"대상물명" 열이 있는 시트를 찾지 못했습니다. 양식을 확인해주세요');
  const colMap = {};
  targetWs.getRow(headerRow).eachCell((cell, colNumber)=>{
    const v = (cell.value==null?'':cell.value.toString()).replace(/\s/g,'');
    if(v==='시작일') colMap.start = colNumber;
    else if(v==='기간(일)') colMap.duration = colNumber;
    else if(v==='수행팀') colMap.team = colNumber;
    else if(v==='점검유형') colMap.type = colNumber;
    else if(v==='대상물명') colMap.building = colNumber;
    else if(v==='LL1') colMap.district = colNumber;
    else if(v.includes('면적')) colMap.area = colNumber;
    else if(v==='비고') colMap.note = colNumber;
  });
  if(!colMap.start || !colMap.building) throw new Error('시작일/대상물명 열을 찾지 못했습니다');
  const entries = [];
  targetWs.eachRow((row, rowNumber)=>{
    if(rowNumber <= headerRow) return;
    const startCell = row.getCell(colMap.start).value;
    const buildingRaw = row.getCell(colMap.building).value;
    if(!startCell || !buildingRaw) return;
    let startIso;
    if(startCell instanceof Date) startIso = toISO(startCell);
    else if(typeof startCell === 'number') startIso = toISO(excelSerialToDate(startCell));
    else return;
    entries.push({
      id: 'sch_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
      building: cleanBuildingName(buildingRaw),
      type: colMap.type ? (String(row.getCell(colMap.type).value||'종합점검').trim()) : '종합점검',
      team: '점검1팀', // [v49] 현재는 팀이 하나뿐이라 엑셀의 수행팀 칼럼 값과 무관하게 고정
      district: colMap.district ? String(row.getCell(colMap.district).value||'').trim() : '',
      area: colMap.area ? Number(row.getCell(colMap.area).value)||0 : 0,
      startDate: startIso,
      duration: colMap.duration ? (Number(row.getCell(colMap.duration).value)||1) : 1,
      note: colMap.note ? String(row.getCell(colMap.note).value||'').trim() : '',
      status: 'wait',
    });
  });
  return entries;
}
$('xlsxPickBtn').onclick = ()=> $('xlsxFileInput').click();
// [v52] 오늘 이후(미래) 일정을 한 번의 백엔드 호출로 안전하게 지운다. 예전엔 건별로 순차/병렬
// 호출했는데, 순차는 느리고(64건이면 수십 초) 병렬은 시트 행번호가 밀려 엉뚱한 행이 지워질
// 위험이 있었다(참소방_GoogleAppsScript_백엔드_V03의 'deleteMany' 참고). 반드시 그 백엔드가
// 배포돼 있어야 한다 — 옛 백엔드(V02 이하)면 이 호출이 실패하고 아래 폴백으로 넘어간다.
async function resetFutureSchedule(onProgress){
  const todayIso = toISO(new Date());
  const toRemove = scheduleEntries.filter(e2 => e2.startDate >= todayIso);
  if(!toRemove.length) return 0;
  const keys = toRemove.map(r=>'schedule:'+r.id);
  const deletedCount = await storageDeleteMany(keys, true);
  if(deletedCount === 0){
    // [폴백] 백엔드가 아직 V03(deleteMany)로 안 올라간 경우 — 건별 순차 삭제로 대체(느리지만 안전).
    let done = 0;
    for(const r of toRemove){ await removeScheduleEntry(r.id); done++; if(onProgress) onProgress(done, toRemove.length); }
  } else if(onProgress){
    onProgress(toRemove.length, toRemove.length);
  }
  scheduleEntries = scheduleEntries.filter(e2 => e2.startDate < todayIso);
  return toRemove.length;
}
$('scheduleResetBtn').onclick = async ()=>{
  const todayIso = toISO(new Date());
  const willRemove = scheduleEntries.filter(e2 => e2.startDate >= todayIso).length;
  if(!willRemove){ showToast('오늘 이후로 예정된 일정이 없어 초기화할 게 없습니다'); return; }
  if(!confirm(`오늘(${todayIso}) 이후로 예정된 일정 ${willRemove}건을 전부 지웁니다. 이미 지난 날짜의 일정은 그대로 남습니다.\n(건수가 많으면 몇 초 정도 걸릴 수 있습니다 — 버튼에 진행 상황이 표시됩니다)\n계속할까요?`)) return;
  const btn = $('scheduleResetBtn');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  scheduleBusy = true;
  try{
    const n = await resetFutureSchedule((done,total)=>{ btn.textContent = `🔄 초기화 중... (${done}/${total})`; });
    sdRenderAll();
    showToast(`${n}건 초기화 완료 — 이제 엑셀을 다시 올려주세요`);
  }catch(err){
    showToast('초기화 중 오류가 발생했습니다: ' + err.message);
  }finally{
    btn.disabled = false;
    btn.textContent = originalLabel;
    scheduleBusy = false;
  }
};
$('xlsxFileInput').onchange = async (e)=>{
  const file = e.target.files[0];
  e.target.value = '';
  if(!file) return;
  $('xlsxFileName').textContent = file.name;
  showToast('엑셀을 읽는 중...');
  let entries;
  try{ entries = await parseScheduleXlsx(file); }
  catch(err){ showToast('엑셀을 읽지 못했습니다: ' + err.message); return; }
  if(!entries.length){ showToast('엑셀에서 불러올 일정을 찾지 못했습니다'); return; }
  // [v49] 같은 대상물명이 여러 번 나오면(재업로드 등) 가장 최근(시작일이 늦은) 1건만 남긴다.
  const byName = {};
  entries.forEach(en=>{ if(!byName[en.building] || byName[en.building].startDate < en.startDate) byName[en.building] = en; });
  const deduped = Object.values(byName);
  if(!confirm(`${deduped.length}건의 일정을 불러옵니다 (원본 ${entries.length}행 중 대상물명 중복은 최신 것만 채택).\n오늘(${toISO(new Date())}) 이후로 예정된 기존 일정은 전부 지우고 이걸로 교체됩니다 — 이미 지난 날짜의 일정은 그대로 보존됩니다.\n(건수가 많으면 몇 초 걸릴 수 있습니다)\n계속할까요?`)) return;
  const importBtn = $('xlsxExportBtn'); // 진행 표시는 파일선택 라벨 자리에 함
  scheduleBusy = true;
  try{
    const removedCount = await resetFutureSchedule((done,total)=>{ $('xlsxFileName').textContent = `정리 중... (${done}/${total})`; });
    let saved = 0;
    for(let i=0; i<deduped.length; i+=8){
      const chunk = deduped.slice(i, i+8);
      await Promise.all(chunk.map(en=>{ scheduleEntries.push(en); return saveScheduleEntry(en); }));
      saved += chunk.length;
      $('xlsxFileName').textContent = `업로드 중... (${saved}/${deduped.length})`;
    }
    sdRenderAll();
    $('xlsxFileName').textContent = file.name;
    showToast(`${deduped.length}건 불러오기 완료 (팀원과 공유됨, 지난 일정 ${removedCount}건 정리)`);
  }catch(err){
    showToast('불러오는 중 오류가 발생했습니다: ' + err.message);
  }finally{
    scheduleBusy = false;
  }
};

// ---- 엑셀 내보내기 ----
$('xlsxExportBtn').onclick = async ()=>{
  if(typeof ExcelJS === 'undefined'){ showToast('엑셀 라이브러리 로드 실패 — 인터넷 연결을 확인해주세요'); return; }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('일정리스트');
  ws.addRow(['시작일','요일','기간(일)','종료일','수행팀','점검유형','대상물명','LL1','면적(㎡)','비고']);
  scheduleEntries.slice().sort((a,b)=>a.startDate<b.startDate?-1:1).forEach(e=>{
    const start = fromISO(e.startDate);
    ws.addRow([ dateToExcelSerial(e.startDate), DOW_KR[start.getDay()], e.duration||1, dateToExcelSerial(scheduleEntryEndDate(e)), e.team, e.type, e.building, e.district, e.area, e.note ]);
  });
  ws.columns.forEach(c=>c.width=14);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download = `소방점검_일정_${toISO(new Date())}.xlsx`; a.click();
  URL.revokeObjectURL(url);
  showToast('엑셀로 내보냈습니다');
};

// ---- 일자별 한도(용량) 체크 ----
function capacityForDate(iso){
  const items = entriesOnDate(iso);
  const sum = { 종합점검:0, 작동점검:0 };
  items.forEach(e=>{ sum[e.type] = (sum[e.type]||0) + (Number(e.area)||0); });
  return {
    jonghap: sum['종합점검']||0, jakdong: sum['작동점검']||0,
    overJonghap: (sum['종합점검']||0) > LIMIT.종합점검,
    overJakdong: (sum['작동점검']||0) > LIMIT.작동점검,
  };
}

// ---- 달력 렌더 ----
let calYear, calMonth;
(function initCalDate(){ const t = new Date(); calYear = t.getFullYear(); calMonth = t.getMonth(); })();
function renderDow(){
  const el = $('calDow'); el.innerHTML='';
  DOW_KR.forEach((d,i)=>{
    const div = document.createElement('div');
    div.className = 'cal-dow' + (i===0?' sun':i===6?' sat':'');
    div.textContent = d;
    el.appendChild(div);
  });
}
function renderCalendar(){
  $('calTitle').textContent = `${calYear}년 ${pad2(calMonth+1)}월`;
  const grid = $('calGrid'); grid.innerHTML='';
  const firstDay = new Date(calYear, calMonth, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();
  const daysInPrevMonth = new Date(calYear, calMonth, 0).getDate();
  const todayIso = toISO(new Date());
  const cells = [];
  for(let i=0;i<startOffset;i++) cells.push({ d: daysInPrevMonth-startOffset+1+i, out:true, month: calMonth-1 });
  for(let d=1; d<=daysInMonth; d++) cells.push({ d, out:false, month: calMonth });
  while(cells.length % 7 !== 0 || cells.length < 35) cells.push({ d: cells.length - (startOffset+daysInMonth) + 1, out:true, month: calMonth+1 });
  cells.forEach((c, idx)=>{
    const dow = idx % 7;
    let y = calYear, m = c.month;
    if(m < 0){ y -= 1; m = 11; }
    if(m > 11){ y += 1; m = 0; }
    const iso = `${y}-${pad2(m+1)}-${pad2(c.d)}`;
    const div = document.createElement('div');
    div.className = 'cal-day' + (c.out?' out':'') + (dow===0?' sun':dow===6?' sat':'') + (iso===todayIso?' today':'');
    div.dataset.date = iso;
    const inner = document.createElement('div'); inner.className='cal-day-inner';
    const dnum = document.createElement('div'); dnum.className='dnum'; dnum.textContent=c.d;
    inner.appendChild(dnum);
    const dayEntries = entriesOnDate(iso).filter(e=>e.startDate===iso);
    dayEntries.forEach(e=>{
      const chip = document.createElement('div');
      chip.className = 'sd-chip ' + (e.type==='종합점검'?'jonghap':'jakdong');
      const st = statusStage(e.status||'wait');
      chip.style.borderLeft = `4px solid ${st.color}`;
      chip.textContent = e.building + (e.duration>1 ? ` (${e.duration}일)` : '');
      chip.title = st.label;
      chip.draggable = true;
      chip.dataset.id = e.id;
      chip.addEventListener('dragstart', ev=>{ ev.dataTransfer.setData('text/plain', e.id); });
      chip.addEventListener('click', ev=>{ ev.stopPropagation(); openEditModal(e); });
      inner.appendChild(chip);
    });
    const cap = capacityForDate(iso);
    if(cap.overJonghap || cap.overJakdong){
      const badge = document.createElement('div'); badge.className='overbadge'; badge.textContent='⚠';
      div.appendChild(badge);
    }
    div.appendChild(inner);
    div.addEventListener('click', ()=>{ openNewModal(iso); });
    div.addEventListener('dragover', ev=>{ ev.preventDefault(); div.classList.add('dragover'); });
    div.addEventListener('dragleave', ()=> div.classList.remove('dragover'));
    div.addEventListener('drop', async ev=>{
      ev.preventDefault(); div.classList.remove('dragover');
      const id = ev.dataTransfer.getData('text/plain');
      const entry = scheduleEntries.find(x=>x.id===id);
      if(!entry) return;
      if(entry.startDate === iso) return;
      entry.startDate = iso;
      await saveScheduleEntry(entry);
      sdRenderAll();
      showToast(`${entry.building} 일정을 ${iso}로 이동했습니다`);
    });
    grid.appendChild(div);
  });
}
$('prevMonthBtn').onclick = ()=>{ calMonth--; if(calMonth<0){calMonth=11;calYear--;} renderCalendar(); };
$('nextMonthBtn').onclick = ()=>{ calMonth++; if(calMonth>11){calMonth=0;calYear++;} renderCalendar(); };

// ---- [v78] 월간 일정 A4 가로 인쇄 (v64에서 이식) ----
// 화면(모바일)에는 그대로 두고, 별도 창에 인쇄 전용 HTML을 만들어 그 창에서만 인쇄한다.
// 이렇게 분리한 이유: 화면용 CSS(드래그, 버튼, 좁은 셀)를 인쇄에 그대로 쓰면 A4 한 장에 안 맞고
// 버튼·배너 같은 화면 UI까지 인쇄돼버림. 인쇄 전용 문서는 완전히 새로 짠 단순 표(table)라
// 프린터/브라우저별 레이아웃 흔들림도 적다.
function _printEsc(s){
  return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function buildPrintCalendarHtml(){
  const y = calYear, m = calMonth;
  const companyName = (TENANT_FILES[CURRENT_TENANT_CODE] || {}).name || '참소방';
  const monthLabel = `${y}년 ${pad2(m+1)}월`;
  const firstDay = new Date(y, m, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(y, m+1, 0).getDate();
  const daysInPrevMonth = new Date(y, m, 0).getDate();
  const cells = [];
  for(let i=0;i<startOffset;i++) cells.push({ d: daysInPrevMonth-startOffset+1+i, out:true, month: m-1 });
  for(let d=1; d<=daysInMonth; d++) cells.push({ d, out:false, month: m });
  while(cells.length % 7 !== 0) cells.push({ d: cells.length - (startOffset+daysInMonth) + 1, out:true, month: m+1 });

  const monthPrefix = `${y}-${pad2(m+1)}`;
  const inMonth = scheduleEntries.filter(e=>e.startDate.startsWith(monthPrefix));
  const cntAll = inMonth.length;
  const cntJonghap = inMonth.filter(e=>e.type==='종합점검').length;
  const cntJakdong = inMonth.filter(e=>e.type==='작동점검').length;

  let rowsHtml = '';
  const totalRows = cells.length / 7;
  for(let r=0; r<totalRows; r++){
    rowsHtml += '<tr>';
    for(let c=0; c<7; c++){
      const cell = cells[r*7+c];
      let yy = y, mm = cell.month;
      if(mm < 0){ yy -= 1; mm = 11; }
      if(mm > 11){ yy += 1; mm = 0; }
      const iso = `${yy}-${pad2(mm+1)}-${pad2(cell.d)}`;
      const dayEntries = scheduleEntries.filter(e=>e.startDate===iso).sort((a,b)=> a.building < b.building ? -1 : 1);
      const dowClass = c===0 ? 'sun' : c===6 ? 'sat' : '';
      const outClass = cell.out ? 'out' : '';
      const todayClass = (iso === toISO(new Date())) ? 'today' : '';
      const chips = dayEntries.map(e=>{
        const cls = e.type==='종합점검' ? 'jonghap' : 'jakdong';
        const durLabel = e.duration>1 ? ` (${e.duration}일)` : '';
        return `<div class="pchip ${cls}">${_printEsc(e.building)}${durLabel}</div>`;
      }).join('');
      rowsHtml += `<td class="${dowClass} ${outClass} ${todayClass}"><div class="dnum">${cell.d}</div>${chips}</td>`;
    }
    rowsHtml += '</tr>';
  }

  const dowHeaderHtml = DOW_KR.map((d,i)=>`<th class="${i===0?'sun':i===6?'sat':''}">${d}</th>`).join('');
  const printedAt = new Date().toLocaleString('ko-KR');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${_printEsc(companyName)} ${_printEsc(monthLabel)} 점검 일정표</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Malgun Gothic','Apple SD Gothic Neo',sans-serif; margin:0; padding:0; color:#1a1a1a; }
  .sheet { padding: 6mm 8mm; }
  .p-header { display:flex; justify-content:space-between; align-items:flex-end; border-bottom:3px solid #222; padding-bottom:8px; margin-bottom:10px; }
  .p-company { font-size:15px; font-weight:700; color:#444; }
  .p-title { font-size:26px; font-weight:800; margin-top:2px; }
  .p-summary { text-align:right; font-size:12.5px; color:#333; line-height:1.6; }
  .p-summary b { font-size:14px; }
  table.p-cal { width:100%; border-collapse:collapse; table-layout:fixed; }
  table.p-cal th { border:1px solid #999; background:#f2f3f5; padding:6px 0; font-size:13px; font-weight:700; }
  table.p-cal th.sun { color:#c0392b; }
  table.p-cal th.sat { color:#2f6fed; }
  table.p-cal td { border:1px solid #bbb; vertical-align:top; height:26mm; padding:3px 4px; font-size:10.5px; }
  table.p-cal td.out { background:#fafafa; color:#bbb; }
  table.p-cal td.sun .dnum { color:#c0392b; }
  table.p-cal td.sat .dnum { color:#2f6fed; }
  table.p-cal td.today { background:#eef3ff; }
  .dnum { font-weight:800; font-size:12.5px; margin-bottom:2px; }
  .pchip { font-size:9px; padding:1.5px 3px; border-radius:3px; margin-bottom:1.5px; font-weight:600; line-height:1.35; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
  .pchip.jonghap { background:#e0f5e8; color:#0d5c33; border:1px solid #b9e4cc; }
  .pchip.jakdong { background:#fbe7e7; color:#8f2323; border:1px solid #f0c2c2; }
  .p-legend { display:flex; gap:16px; margin-top:8px; font-size:11px; color:#555; align-items:center; }
  .p-legend .dot { display:inline-block; width:9px; height:9px; border-radius:2px; margin-right:4px; vertical-align:middle; }
  .p-footer { margin-top:8px; font-size:9.5px; color:#999; text-align:right; }
  .p-toolbar { text-align:center; margin:10px 0; }
  .p-toolbar button { padding:8px 18px; font-size:13px; border-radius:8px; border:1px solid #999; background:#fff; cursor:pointer; margin:0 4px; }
  @media print { .p-toolbar { display:none; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
<div class="p-toolbar">
  <button onclick="window.print()">🖨️ 인쇄</button>
  <button onclick="window.close()">닫기</button>
</div>
<div class="sheet">
  <div class="p-header">
    <div>
      <div class="p-company">${_printEsc(companyName)}</div>
      <div class="p-title">${_printEsc(monthLabel)} 점검 일정표</div>
    </div>
    <div class="p-summary">
      전체 <b>${cntAll}</b>건 · 종합점검 <b>${cntJonghap}</b>건 · 작동점검 <b>${cntJakdong}</b>건
    </div>
  </div>
  <table class="p-cal">
    <thead><tr>${dowHeaderHtml}</tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div class="p-legend">
    <span><span class="dot" style="background:#b9e4cc;"></span>종합점검</span>
    <span><span class="dot" style="background:#f0c2c2;"></span>작동점검</span>
  </div>
  <div class="p-footer">출력: ${_printEsc(printedAt)}</div>
</div>
</body>
</html>`;
}
function printMonthlyCalendar(){
  const html = buildPrintCalendarHtml();
  const win = window.open('', '_blank', 'width=1200,height=850');
  if(!win){ showToast('팝업이 차단되어 인쇄 화면을 열 수 없습니다 — 브라우저 팝업 차단을 해제해주세요'); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
$('printCalBtn').onclick = printMonthlyCalendar;

// ---- 요약 카드 + 진척률 카드 ----
function renderSummary(){
  const monthPrefix = `${calYear}-${pad2(calMonth+1)}`;
  const inMonth = scheduleEntries.filter(e=>e.startDate.startsWith(monthPrefix));
  $('sumAll').textContent = inMonth.length + '건';
  $('sumJonghap').textContent = inMonth.filter(e=>e.type==='종합점검').length + '건';
  $('sumJakdong').textContent = inMonth.filter(e=>e.type==='작동점검').length + '건';
  renderProgressCard(inMonth);
}
function renderProgressCard(entries){
  const el = $('progressCard');
  if(!entries.length){ el.innerHTML = `<div style="color:var(--muted);font-size:13px;">이 달에는 일정이 없습니다.</div>`; return; }
  const counts = {}; STATUS_STAGES.forEach(s=>counts[s.key]=0);
  entries.forEach(e=> counts[e.status||'wait']++ );
  const total = entries.length;
  const closedCount = counts['closed']||0;
  const bar = STATUS_STAGES.map(s=>{
    const pct = total ? (counts[s.key]/total*100) : 0;
    return pct ? `<div class="seg" style="width:${pct}%;background:${s.color};" title="${s.label} ${counts[s.key]}건"></div>` : '';
  }).join('');
  const legend = STATUS_STAGES.map(s=>`<span><span class="dot" style="background:${s.color};"></span>${s.label} ${counts[s.key]}</span>`).join('');
  el.innerHTML = `
    <div class="progress-summary">이 달 진척률 — 최종검사종료 ${closedCount}/${total}건 (${total?Math.round(closedCount/total*100):0}%)</div>
    <div class="progress-bar">${bar}</div>
    <div class="progress-legend">${legend}</div>`;
}

// ---- 주간 TODO ----
let weekOffset = 0;
function weekStart(offset){
  const t = new Date();
  const dow = t.getDay();
  const mondayDiff = (dow===0 ? -6 : 1-dow);
  return new Date(t.getFullYear(), t.getMonth(), t.getDate()+mondayDiff+offset*7);
}
function renderWeekTodo(){
  const monday = weekStart(weekOffset);
  const days = [...Array(7)].map((_,i)=>{ const d=new Date(monday); d.setDate(monday.getDate()+i); return d; });
  $('weekTitle').textContent = `${weekOffset===0?'이번 주 ':''}TODO (${toISO(days[0]).slice(5)} ~ ${toISO(days[6]).slice(5)})`;
  const body = $('weekBody'); body.innerHTML='';
  let anyItem = false;
  days.forEach(d=>{
    const iso = toISO(d);
    // [v49] entriesOnDate(기간 겹침 전체)로 뽑으면 여러 날짜짜리 일정(예: 중산현대아파트 2일)이
    // 그 기간의 날마다 중복으로 나타났었다. 목록에는 "시작일에만 1번" 나오게 하고(기간은 옆에 표기),
    // 한도(용량) 체크만 그 날 실제로 겹치는 전체 일정 기준(entriesOnDate)으로 그대로 계산한다.
    const items = scheduleEntries.filter(e=>e.startDate===iso);
    if(!items.length) return;
    anyItem = true;
    const cap = capacityForDate(iso);
    const block = document.createElement('div'); block.className='week-day-block';
    const head = document.createElement('div'); head.className='week-day-head';
    head.innerHTML = `<span>${pad2(d.getMonth()+1)}/${pad2(d.getDate())} (${DOW_KR[d.getDay()]})</span>
      <span class="cap ${cap.overJonghap||cap.overJakdong?'over':''}">종합 ${cap.jonghap.toLocaleString()}/${LIMIT.종합점검.toLocaleString()} · 작동 ${cap.jakdong.toLocaleString()}/${LIMIT.작동점검.toLocaleString()} ${(cap.overJonghap||cap.overJakdong)?'⚠초과':''}</span>`;
    block.appendChild(head);
    items.forEach(e=>{
      const row = document.createElement('div'); row.className='week-item';
      const st = statusStage(e.status||'wait');
      let warn = '';
      const daysSinceEnd = Math.round((fromISO(toISO(new Date())) - fromISO(scheduleEntryEndDate(e))) / 86400000);
      if(e.status==='reviewed' && daysSinceEnd > 10) warn = `<span class="overdue-warn">⚠ 송부 지연 ${daysSinceEnd}일</span>`;
      if(e.status==='sent_client' && e.statusChangedAt && Math.round((Date.now()-e.statusChangedAt)/86400000) > 5){
        warn = `<span class="overdue-warn">⚠ 제출 지연 ${Math.round((Date.now()-e.statusChangedAt)/86400000)}일</span>`;
      }
      row.innerHTML = `<span class="tag ${e.type==='종합점검'?'jonghap':'jakdong'}">${e.type==='종합점검'?'종합':'작동'}</span>
        <span class="nm">${e.building}${e.duration>1?` (${e.duration}일)`:''}</span><span class="meta">${e.district?e.district+' · ':''}${e.team||''}</span>
        <span class="status-badge" style="background:${st.bg};color:${st.color};">${st.label}</span>${warn}`;
      row.onclick = ()=> openEditModal(e);
      block.appendChild(row);
    });
    body.appendChild(block);
  });
  if(!anyItem) body.innerHTML = `<div class="week-empty">이 주에는 등록된 일정이 없습니다.</div>`;
}
$('prevWeekBtn').onclick = ()=>{ weekOffset--; renderWeekTodo(); };
$('nextWeekBtn').onclick = ()=>{ weekOffset++; renderWeekTodo(); };

// ---- 클릭 수정 모달 ----
let modalEntry = null;
function openEditModal(entry){
  modalEntry = entry;
  $('modalTitle').textContent = '일정 수정';
  $('fBuilding').value = entry.building;
  $('fType').value = entry.type;
  $('fTeam').value = entry.team||'';
  $('fStart').value = entry.startDate;
  $('fDuration').value = entry.duration||1;
  $('fArea').value = entry.area||'';
  $('fDistrict').value = entry.district||'';
  $('fNote').value = entry.note||'';
  $('fStatus').value = entry.status||'wait';
  $('modalDeleteBtn').style.display = 'block';
  $('modalOverlay').classList.add('show');
}
function openNewModal(iso){
  modalEntry = null;
  $('modalTitle').textContent = '새 일정 추가';
  $('fBuilding').value = '';
  $('fType').value = '종합점검';
  $('fTeam').value = '점검1팀';
  $('fStart').value = iso;
  $('fDuration').value = 1;
  $('fArea').value = '';
  $('fDistrict').value = '';
  $('fNote').value = '';
  $('fStatus').value = 'wait';
  $('modalDeleteBtn').style.display = 'none';
  $('modalOverlay').classList.add('show');
}
function closeModal(){ $('modalOverlay').classList.remove('show'); modalEntry=null; }
$('modalCancelBtn').onclick = closeModal;
$('modalOverlay').addEventListener('click', e=>{ if(e.target.id==='modalOverlay') closeModal(); });
$('modalSaveBtn').onclick = async ()=>{
  const building = $('fBuilding').value.trim();
  if(!building){ showToast('대상물명을 입력해주세요'); return; }
  const entry = modalEntry || { id: 'sch_' + Date.now() + '_' + Math.random().toString(36).slice(2,7) };
  entry.building = building;
  entry.type = $('fType').value;
  entry.team = $('fTeam').value.trim();
  entry.startDate = $('fStart').value;
  entry.duration = Math.max(1, Number($('fDuration').value)||1);
  entry.area = Number($('fArea').value)||0;
  entry.district = $('fDistrict').value.trim();
  entry.note = $('fNote').value.trim();
  const newStatus = $('fStatus').value;
  if(newStatus !== entry.status) entry.statusChangedAt = Date.now();
  entry.status = newStatus;
  if(!modalEntry) scheduleEntries.push(entry);
  await saveScheduleEntry(entry);
  closeModal();
  sdRenderAll();
  showToast('저장했습니다 (팀원과 공유됨)');
};
$('modalDeleteBtn').onclick = async ()=>{
  if(!modalEntry) return;
  if(!confirm(`"${modalEntry.building}" 일정을 삭제할까요?`)) return;
  scheduleEntries = scheduleEntries.filter(e=>e.id!==modalEntry.id);
  await removeScheduleEntry(modalEntry.id);
  closeModal();
  sdRenderAll();
  showToast('삭제했습니다');
};
// [v48] 이제 같은 파일이므로 새 창을 열 필요 없이, 이 화면(현장테스트)의 기존 startInspection()을
// 바로 호출해서 그 대상물 점검으로 곧장 넘어간다.
$('modalStartBtn').onclick = ()=>{
  const name = $('fBuilding').value.trim();
  if(!name){ showToast('대상물명을 입력해주세요'); return; }
  closeModal();
  startInspection(name);
};
$('addEntryBtn').onclick = ()=> openNewModal(toISO(new Date()));

// ---- 한도 설정 ----
// [v51] 일자별 한도(LIMIT)는 이제 화면에 노출하지 않고 코드 안 고정값(종합 10,000㎡/일, 작동 12,500㎡/일)만 쓴다.
// (사용자가 이미 다 아는 값이라 UI로 보여줄 필요가 없다는 요청 반영 — 필요해지면 이 LIMIT 값만 고치면 됨)

// ---- 전체 다시 그리기 ----
function sdRenderAll(){
  renderDow();
  renderCalendar();
  renderSummary();
  renderWeekTodo();
}
function populateStatusSelect(){
  $('fStatus').innerHTML = STATUS_STAGES.map(s=>`<option value="${s.key}">${s.label}</option>`).join('');
}
populateStatusSelect();

// ---------------- 초기화 ----------------
// [v40] 하단에 현재 어느 업체 데이터로 실행 중인지 표시(여러 업체 코드로 접속을 나눠 쓰게 될 때 헷갈리지 않도록)
if($('tenantLabel')) $('tenantLabel').textContent = (TENANT_FILES[CURRENT_TENANT_CODE]||{}).name || CURRENT_TENANT_CODE;
// [v37] "새 일정 추가" 폼의 대상물명 자동완성 - 마스터 DB(203개) 이름 전체를 미리 채워둔다.
// [v49] 대상물 마스터DB(203개) 파일이 실제로 로드됐는지 눈에 보이게 확인.
// 이게 실패하면 화면상으로는 "소방시설명이 전체목록으로 다 나옴"/"대상물 상세보기가 빈 화면"처럼
// 보여서 원인을 알기 어려우므로, 파일명을 직접 알려주는 배너를 띄운다.
(function checkMasterDbLoaded(){
  const el = $('masterDbWarning'); if(!el) return;
  const expectedFile = (TENANT_FILES[CURRENT_TENANT_CODE]||{}).file || '(알 수 없음)';
  if(typeof BUILDINGS_MASTER === 'undefined' || !BUILDINGS_MASTER || !BUILDINGS_MASTER.data){
    el.style.display = 'block';
    el.textContent = `⚠ 대상물 마스터DB 파일을 불러오지 못했습니다 — "${expectedFile}" 파일이 이 html과 정확히 같은 폴더에 있는지 확인해주세요. (이 상태에서는 소방시설명이 전체목록으로 나오고, 대상물 상세보기도 비어있게 표시됩니다)`;
  }
})();
(function populateMasterBuildingDatalist(){
  const dl = $('masterBuildingNames'); if(!dl || typeof BUILDINGS_MASTER === 'undefined' || !BUILDINGS_MASTER || !BUILDINGS_MASTER.data) return;
  Object.keys(BUILDINGS_MASTER.data).forEach(n=>{
    const o = document.createElement('option'); o.value = n; dl.appendChild(o);
  });
})();
renderHome();
updateSyncBanner();
uiPrefsReady.then(()=>{
  renderHome(); // 팀 공유 저장소에서 불러온 수기 일정(customBuildings)을 반영해 다시 그림
  renderLocationSelectors();
  renderDefectChips();
  // [v47] 일정관리 대시보드(캘린더)에서 "점검 시작 →" 버튼으로 넘어올 때 쓰는 링크 파라미터.
  // 예: v47.html?start=울산여고 — 대시보드의 "대상물 점검 컨셉"은 그대로 이 화면(v46/v47)에
  // 위임하고, 대시보드 자신은 일정만 관리한다.
  const _startName = new URLSearchParams(location.search).get('start');
  if(_startName) startInspection(_startName);
});
loadTags();
loadOtherTags();
loadDefectEntries();
loadInspectorName();
loadPhotoEntries();
loadScheduleEntries(); // [v47] 대시보드 일정 로드 — 완료되면 홈이면 자동으로 다시 그림
loadConstructionEntries();
setHeader();
