// ============================================================
// router-schedule-core.js
// 라우터/헤더 + 일정관리 날짜 유틸 + 점검세션 (원본 1730~1898줄)
// ※ E단계 모듈화(V77) 시 원본 v76 단일 파일에서 그대로 잘라낸 것으로,
//   전역 스코프를 그대로 사용하며 기존 함수 간 참조 관계는 100% 동일합니다.
// ============================================================
// ---------------- 라우터 / 헤더 ----------------
// 혁신소방 2026년 7월 실제 점검 일정 (실시결과점검표분석_20260418_1914.xlsx 기준 대상물)
// ---------------- [v47] 일정관리 대시보드 연동 ----------------
// 대시보드(혁신소방_일정관리대시보드)가 같은 팀 공유 저장소(shared:true)의 'schedule:' 접두어 아래에
// 저장해둔 일정을 이 화면(홈)에서도 그대로 읽어와, "이번주 TODO"가 대시보드와 항상 같은 데이터를 본다.
function pad2(n){ return String(n).padStart(2,'0'); }
function toISO(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function fromISO(s){ const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); }
function addDays(iso, n){ const d = fromISO(iso); d.setDate(d.getDate()+n); return toISO(d); }
function scheduleEntryEndDate(e){ return addDays(e.startDate, (e.duration||1)-1); }
function weekMondayOf(offset){
  const t = new Date();
  const dow = t.getDay();
  const mondayDiff = (dow===0 ? -6 : 1-dow);
  return new Date(t.getFullYear(), t.getMonth(), t.getDate()+mondayDiff+(offset||0)*7);
}
// 7단계 진척 상태 — 화면 배지/셀렉트박스에서 공통으로 쓰는 정의(대시보드와 동일 값 사용, 파일이 달라 중복 정의).
const STATUS_STAGES = [
  { key:'wait',         label:'미점검',            color:'#b3261e', bg:'#fdecea' },
  { key:'field_done',   label:'점검완료',          color:'#8a6d00', bg:'#fff7d6' },
  { key:'reviewed',     label:'보고서 검수완료',   color:'#6b3d20', bg:'#f1e3da' },
  { key:'sent_client',  label:'관계인 송부',       color:'#2f6fed', bg:'#e7eefc' },
  { key:'submitted_fd', label:'소방서 제출확인',   color:'#7b2fed', bg:'#efe6fc' },
  { key:'fixing',       label:'불량수정공사',      color:'#c9701a', bg:'#fdecd6' },
  { key:'closed',       label:'최종검사종료',      color:'#1fae6a', bg:'#e4f6ec' },
];
function statusStage(key){ return STATUS_STAGES.find(s=>s.key===key) || STATUS_STAGES[0]; }

let scheduleEntries = [];
async function loadScheduleEntries(){
  const list = await storageGetMany('schedule:', true);
  if(backendOnline){ scheduleEntries = list; lsCacheSet('schedule', scheduleEntries); }
  else scheduleEntries = lsCacheGet('schedule') || scheduleEntries; // [v65] 오프라인이면 캐시 유지(비우지 않음)
  if(currentView==='home') renderHome();
}
async function saveScheduleEntry(entry){
  const res = await storageSet('schedule:'+entry.id, JSON.stringify(entry), true);
  if(!res && !navigator.onLine) showToast('오프라인 - 이 기기에 저장됨(연결되면 자동 동기화)');
}

const SAMPLE_BUILDINGS = [
  {name:'화정초등학교', sub:'종합점검 · 07-20 예정'},
  {name:'꽃바위유치원', sub:'작동점검 · 07-20 예정'},
  {name:'내황초등학교', sub:'작동점검 · 07-21 예정'},
  {name:'㈜용산(울산공장·연암)', sub:'작동점검 · 07-22 예정'},
  {name:'복산나이스', sub:'작동점검 · 07-22 예정'},
  {name:'고헌중학교', sub:'작동점검 · 07-23 예정'},
  {name:'중앙중학교', sub:'작동점검 · 07-24 예정'}
];
// [v47] 위 SAMPLE_BUILDINGS는 화정초~중앙중학교 현장테스트용 하드코딩 목록으로, 그 테스트는
// 완료되었다. 이제 홈 화면은 이 목록을 직접 보여주지 않고(코드는 참고용으로 남겨둠),
// 아래 renderHome()에서 scheduleEntries(대시보드 일정) 기반으로 다시 만든다.
let currentBuilding = '';
// [v31] 점검회차 개념 — 대상물+날짜+점검종류로 고유id를 만들어, 그날 그 대상물에 기록하는
// 불량내역/사진/공사사진에 함께 태깅한다. 나중에 "이번 달 작동점검분만 모아보기" 같은 취합이
// 가능해지도록 하는 최소 스키마(정식 DB의 inspection_records 개념을 프로토타입에 반영한 것).
let currentInspectionType = '';
let currentInspectionDate = '';
let currentInspectionId = '';
function todayStr(){
  const d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
// 대상물이 정해질 때(startInspection) 호출 — 오늘 이미 골라둔 점검종류가 있으면 그대로 이어쓰고,
// 날짜가 바뀌었으면(새 방문) 다시 고르도록 비워둔다(강제는 아니고, 배지의 "선택"을 눌러야 함).
function ensureInspectionSession(building){
  const sess = uiPrefs.inspectionSession[building];
  const today = todayStr();
  if(sess && sess.date === today){
    currentInspectionType = sess.type;
    currentInspectionDate = sess.date;
    currentInspectionId = sess.id;
  } else {
    currentInspectionType = '';
    currentInspectionDate = '';
    currentInspectionId = '';
  }
  renderInspectionBadge();
}
function renderInspectionBadge(){
  const el = $('inspectionBadge');
  if(!el) return;
  if(currentView === 'home' || currentView === 'schedule' || !currentBuilding){ el.style.display = 'none'; return; }
  el.style.display = 'flex';
  if(currentInspectionType){
    el.innerHTML = `<span>🗂 점검종류: <b>${currentInspectionType}</b> (${currentInspectionDate})</span><span class="chg" id="inspectionChangeBtn">변경</span>`;
  } else {
    el.innerHTML = `<span>⚠️ 점검종류가 아직 선택되지 않았습니다</span><span class="chg" id="inspectionChangeBtn">선택</span>`;
  }
  $('inspectionChangeBtn').onclick = openInspectionTypeOverlay;
}
function openInspectionTypeOverlay(){ $('inspectionTypeOverlay').classList.add('show'); }
$('inspectionTypeCloseBtn').onclick = ()=> $('inspectionTypeOverlay').classList.remove('show');
$('inspectionTypeOverlay').onclick = (e)=>{ if(e.target.id==='inspectionTypeOverlay') $('inspectionTypeOverlay').classList.remove('show'); };
$('inspectionTypeChips').querySelectorAll('.chip').forEach(el=>{
  el.onclick = ()=>{
    if(!currentBuilding){ showToast('대상물을 먼저 선택해주세요'); return; }
    const type = el.dataset.type;
    const date = todayStr();
    currentInspectionType = type;
    currentInspectionDate = date;
    currentInspectionId = `${currentBuilding}__${date}__${type}`;
    uiPrefs.inspectionSession[currentBuilding] = { type, date, id: currentInspectionId };
    saveUiPrefsDebounced();
    $('inspectionTypeOverlay').classList.remove('show');
    renderInspectionBadge();
    showToast(`점검종류: ${type}로 설정했습니다`);
  };
});
let currentView = 'home';

function setHeader(){
  const titles = { home:['혁신소방 현장테스트','홈'], defect:[currentBuilding||'(대상물 미선택)','🛠 불량내역 입력'], photolog:[currentBuilding||'(대상물 미선택)','📷 점검·공사 사진대장'], buildingdetail:[currentBuilding||'(대상물 미선택)','🏢 대상물 상세보기'], schedule:['소방점검 일정 대시보드','📅 월간 달력 · 드래그로 날짜 변경'], settings:['설정','⚙️ 오프라인 데이터 관리'] };
  $('headerTitle').textContent = titles[currentView][0];
  $('headerSub').textContent = titles[currentView][1];
  const icons = $('headerIcons');
  icons.innerHTML = '';
  // [v66] 설정 화면 아이콘 — 어느 화면에서든 항상 보이게(설정 화면 자체를 볼 땐 중복 방지로 숨김).
  if(currentView !== 'settings'){
    const gear = document.createElement('button');
    gear.className = 'icon-btn'; gear.textContent = '⚙️'; gear.title='설정';
    gear.onclick = ()=> goTo('settings');
    icons.appendChild(gear);
  }
  // [v48] 일정 대시보드로 바로 가는 📅 아이콘 — 대시보드 자체를 보고 있을 땐 안 보여줌(중복 방지).
  if(currentView !== 'schedule'){
    const cal = document.createElement('button');
    cal.className = 'icon-btn accent'; cal.textContent = '📅'; cal.title='일정 대시보드';
    cal.onclick = ()=> goTo('schedule');
    icons.appendChild(cal);
  }
  if(currentView !== 'home'){
    const home = document.createElement('button');
    home.className = 'icon-btn'; home.textContent = '🏠'; home.title='홈으로';
    home.onclick = ()=> goTo('home');
    icons.appendChild(home);
    const menu = document.createElement('button');
    menu.className = 'icon-btn accent'; menu.textContent = '⊞'; menu.title='빠른 전환';
    menu.onclick = openQuickMenu;
    icons.appendChild(menu);
  }
  renderInspectionBadge();
}

function goTo(view){
  currentView = view;
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  $('view-'+view).classList.add('active');
  setHeader();
  window.scrollTo(0,0);
  if(view==='defect') loadDefectEntries();
  else if(view==='photolog'){ loadPhotoEntries(); loadConstructionEntries(); }
  else if(view==='buildingdetail') Promise.all([loadDefectEntries(), loadBuildingEdits(currentBuilding)]).then(renderBuildingDetail);
  else if(view==='schedule') loadScheduleEntries().then(sdRenderAll);
  else if(view==='settings') renderCacheInfo();
}

function openQuickMenu(){
  document.querySelectorAll('.qitem[data-target]').forEach(el=>{
    el.classList.toggle('active', el.dataset.target === currentView);
  });
  $('quickOverlay').classList.add('show');
}
$('sheetClose').onclick = ()=> $('quickOverlay').classList.remove('show');
$('quickOverlay').onclick = (e)=>{ if(e.target.id==='quickOverlay') $('quickOverlay').classList.remove('show'); };
document.querySelectorAll('.qitem[data-target]').forEach(el=>{
  el.onclick = ()=>{ $('quickOverlay').classList.remove('show'); goTo(el.dataset.target); };
});

