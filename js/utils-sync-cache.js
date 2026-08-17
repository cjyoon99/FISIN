// ============================================================
// utils-sync-cache.js
// 공통 유틸 + 오프라인 대비 쓰기 동기화 큐 + 로컬 캐시 (원본 854~1081줄)
// ※ E단계 모듈화(V77) 시 원본 v76 단일 파일에서 그대로 잘라낸 것으로,
//   전역 스코프를 그대로 사용하며 기존 함수 간 참조 관계는 100% 동일합니다.
// ============================================================
// ---------------- 공통 유틸 ----------------
function $(id){ return document.getElementById(id); }
function showToast(msg){
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 1600);
}
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwM0P12cGqIMO3GeuRX5A9gjIzUxVD_n9PPNiZ5YD0gT0JE4set7ADKdwHzgBr7dKqn/exec';

// [v25] 배너가 실제 통신 성공/실패를 반영하도록, 마지막 호출 결과를 기억해둔다.
let backendOnline = null; // null=아직 확인 전, true=연결됨, false=실패

// ================= [v65] 오프라인 대비 — 쓰기 동기화 큐 =================
// 현장에서 인터넷이 자주 끊기는데, 지금까지는 저장 요청이 실패해도 조용히 사라졌다(에러 토스트도 없이).
// 이제부터는: set/delete/deleteMany가 네트워크 실패로 못 나가면 로컬(localStorage)에 큐로 쌓아두고,
// (1) 온라인으로 돌아오는 순간, (2) 20초마다 자동으로, (3) "지금 동기화" 버튼으로 수동으로
// 다시 순서대로 보낸다. 각 항목은 성공할 때까지 큐에 남아있으므로 데이터 유실이 없다.
// 단, ui_prefs처럼 "원격값을 다시 읽어와 병합한 뒤 저장"하는 항목은 실패 시점의 스냅샷을 그대로
// 재전송하면 그 사이 팀원이 추가한 내용을 덮어쓸 위험이 있어, 큐에 넣지 않고 대신 재시도 시
// saveUiPrefsDebounced()를 다시 통째로 실행해(병합을 새로 함) 안전하게 처리한다.
const SYNC_QUEUE_KEY = 'fis_sync_queue_v1';
const WRITE_ACTIONS = new Set(['set','delete','deleteMany']);
function loadSyncQueue(){
  try{ const v = JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY)||'[]'); return Array.isArray(v)?v:[]; }
  catch(e){ return []; }
}
let syncQueue = loadSyncQueue();
function persistSyncQueue(){ try{ localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(syncQueue)); }catch(e){} }
function queuePendingCount(){ return syncQueue.length + (pendingUiPrefsSync?1:0); }
function enqueueWrite(payload){
  syncQueue.push({ payload, ts: Date.now() });
  persistSyncQueue();
  updateSyncBanner();
}
let pendingUiPrefsSync = (localStorage.getItem('fis_pending_ui_prefs_sync')==='1');
function markUiPrefsPending(v){
  pendingUiPrefsSync = v;
  try{ localStorage.setItem('fis_pending_ui_prefs_sync', v?'1':'0'); }catch(e){}
  updateSyncBanner();
}

async function callAppsScript(payload, opts){
  opts = opts || {};
  try{
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // CORS 프리플라이트 회피용
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    backendOnline = true;
    updateSyncBanner();
    return data;
  }catch(e){
    console.error('구글 백엔드 호출 실패', e);
    backendOnline = false;
    if(!opts.noQueue && payload && WRITE_ACTIONS.has(payload.action) && payload.key !== 'ui_prefs'){
      enqueueWrite(payload);
    }
    updateSyncBanner();
    return null;
  }
}
// 큐에 쌓인 쓰기 요청을 순서대로 다시 보낸다. 도중에 또 실패하면(여전히 오프라인) 남은 항목은
// 그대로 큐에 남겨두고 멈춘다 — 다음 기회(온라인 이벤트/주기 타이머/수동 버튼)에 이어서 재시도.
let syncFlushing = false;
async function flushSyncQueue(manual){
  if(syncFlushing) return { done:0, remain:syncQueue.length };
  syncFlushing = true;
  let done = 0;
  try{
    if(pendingUiPrefsSync){
      markUiPrefsPending(false); // 먼저 내려두고, 실패하면 saveUiPrefsDebounced가 다시 세운다
      saveUiPrefsDebounced();
    }
    while(syncQueue.length){
      const item = syncQueue[0];
      const table = supabaseTableFor(item.payload.key) ||
                    ((item.payload.keys && item.payload.keys.length) ? supabaseTableFor(item.payload.keys[0]) : null);
      const res = table
        ? await supabaseWrite(item.payload)
        : await callAppsScript(item.payload, { noQueue:true });
      if(res){ syncQueue.shift(); persistSyncQueue(); done++; updateSyncBanner(); }
      else break; // 아직 오프라인 — 여기서 멈추고 다음 기회에 이어서
    }
  } finally { syncFlushing = false; }
  if(manual) showToast(syncQueue.length ? `${done}건 동기화, ${syncQueue.length}건 대기중(오프라인)` : (done ? `${done}건 동기화 완료` : '동기화 대기 항목 없음'));
  return { done, remain: syncQueue.length };
}
window.addEventListener('online', ()=>{ backendOnline=null; updateSyncBanner(); flushSyncQueue(false); });
setInterval(()=>{ if(navigator.onLine!==false && (syncQueue.length||pendingUiPrefsSync)) flushSyncQueue(false); }, 20000);

// [v65] 읽기 캐시 — 서버에서 성공적으로 받아온 데이터는 로컬에도 저장해두고, 다음에 오프라인이라
// 서버 요청이 실패하면(화면이 텅 비지 않도록) 이 캐시로 대신 채운다("이번 주 대상물 준비"로 미리
// 받아둔 데이터도 여기에 쌓인다).
// [v66] 캐시에 저장 시각을 같이 기록해두고, 30일 지난 건 자동으로 무시(다음 조회 시 삭제)한다.
// 캐시가 "언제 받은 데이터인지 모른 채 계속 상주"하는 문제를 막기 위함.
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30일
function lsCacheGet(key){
  try{
    const raw = localStorage.getItem('fis_cache_'+key);
    if(raw == null) return null;
    const wrapper = JSON.parse(raw);
    if(wrapper && typeof wrapper === 'object' && 'ts' in wrapper && 'v' in wrapper){
      if(Date.now() - wrapper.ts > CACHE_MAX_AGE_MS){
        localStorage.removeItem('fis_cache_'+key); // 30일 지남 — 폐기
        return null;
      }
      return wrapper.v;
    }
    return wrapper; // [구버전 호환] 타임스탬프 없이 저장된 예전 캐시는 그냥 값으로 취급
  }catch(e){ return null; }
}
function lsCacheSet(key, value){
  try{ localStorage.setItem('fis_cache_'+key, JSON.stringify({ ts: Date.now(), v: value })); }catch(e){}
}
// 오프라인 캐시 전체 현황(개수/가장 오래된 항목) 계산 — 설정 화면에 표시용
function getCacheInfo(){
  let count = 0, oldest = null;
  for(let i=0; i<localStorage.length; i++){
    const k = localStorage.key(i);
    if(!k || k.indexOf('fis_cache_') !== 0) continue;
    count++;
    try{
      const w = JSON.parse(localStorage.getItem(k));
      const ts = (w && typeof w === 'object' && 'ts' in w) ? w.ts : null;
      if(ts && (oldest === null || ts < oldest)) oldest = ts;
    }catch(e){}
  }
  return { count, oldest };
}
// 30일 지난 캐시를 한 번에 정리(앱 시작 시 자동 실행)
function cleanupExpiredCache(){
  const toRemove = [];
  for(let i=0; i<localStorage.length; i++){
    const k = localStorage.key(i);
    if(!k || k.indexOf('fis_cache_') !== 0) continue;
    try{
      const w = JSON.parse(localStorage.getItem(k));
      const ts = (w && typeof w === 'object' && 'ts' in w) ? w.ts : null;
      if(ts != null && Date.now() - ts > CACHE_MAX_AGE_MS) toRemove.push(k);
    }catch(e){}
  }
  toRemove.forEach(k=>localStorage.removeItem(k));
  if(toRemove.length) console.log('[캐시정리] 30일 지난 오프라인 캐시 ' + toRemove.length + '건 삭제');
}
cleanupExpiredCache(); // 앱 시작 시 한 번 정리
function clearAllOfflineCache(){
  const toRemove = [];
  for(let i=0; i<localStorage.length; i++){
    const k = localStorage.key(i);
    if(k && k.indexOf('fis_cache_') === 0) toRemove.push(k);
  }
  toRemove.forEach(k=>localStorage.removeItem(k));
  return toRemove.length;
}
function renderCacheInfo(){
  const el = $('cacheInfoStatus'); if(!el) return;
  const { count, oldest } = getCacheInfo();
  if(!count){ el.textContent = '저장된 오프라인 캐시 없음'; return; }
  const days = oldest ? Math.floor((Date.now()-oldest)/(24*60*60*1000)) : null;
  el.textContent = `오프라인 캐시 ${count}건 저장됨` + (days!=null ? ` (가장 오래된 것: ${days}일 전)` : '') + ' — 30일 지나면 자동 삭제';
}
document.addEventListener('DOMContentLoaded', renderCacheInfo);
renderCacheInfo();
$('clearCacheBtn').onclick = ()=>{
  const { count } = getCacheInfo();
  if(!count){ showToast('지울 오프라인 캐시가 없습니다'); return; }
  if(!confirm(`오프라인 캐시 ${count}건을 지우시겠습니까?\n(서버에 이미 저장된 데이터는 지워지지 않고, 이 기기에 임시로 받아둔 사본만 지워집니다. 아직 동기화 안 된 입력 대기 항목은 지워지지 않습니다.)`)) return;
  const n = clearAllOfflineCache();
  renderCacheInfo();
  showToast(`오프라인 캐시 ${n}건 비웠습니다`);
};

// 사진 필드는 이미 base64(data:image/...)이면 그대로 쓰고,
// 팀 공유 저장소로 바뀐 뒤 생긴 구글드라이브 링크(thumbnail?id=...)라면
// Apps Script를 거쳐 base64로 다시 받아온다(브라우저에서 드라이브를 직접 fetch하면
// CORS로 막히기 때문에 서버를 한 번 거쳐야 함). 같은 사진을 여러 번 받아오지
// 않도록 파일ID 기준으로 캐시해둔다.
const _photoBase64Cache = {};
async function resolvePhotoToBase64(photoValue){
  if(!photoValue) return null;
  if(photoValue.indexOf('data:image') === 0) return photoValue; // 이미 base64
  // [V67] Supabase Storage 공개 URL — 직접 fetch해서 base64로 변환(공개 버킷이라 CORS 허용됨)
  if(photoValue.indexOf(SUPABASE_URL) === 0){
    if(_photoBase64Cache[photoValue]) return _photoBase64Cache[photoValue];
    try{
      const res = await fetch(photoValue);
      const blob = await res.blob();
      const dataUrl = await new Promise((resolve, reject)=>{
        const reader = new FileReader();
        reader.onload = ()=>resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      _photoBase64Cache[photoValue] = dataUrl;
      return dataUrl;
    }catch(e){ console.error('Storage 사진 변환 실패', e); return null; }
  }
  const m = photoValue.match(/[?&]id=([^&]+)/);
  const fileId = m ? m[1] : null;
  if(!fileId) return null; // 알 수 없는 형식이면 이미지 없이 진행(캡션은 유지)
  if(_photoBase64Cache[fileId]) return _photoBase64Cache[fileId];
  const res = await callAppsScript({ action:'getPhotoBase64', fileId });
  const dataUrl = (res && res.dataUrl) || null;
  if(dataUrl) _photoBase64Cache[fileId] = dataUrl;
  return dataUrl;
}

// [v33] 엑셀 등 결과 파일을 저장할 때, 가능하면 공유 시트를 띄워 그 자리에서 "Excel에서 열기" 등으로
// 바로 이어지게 하고, 지원하지 않는 환경(주로 PC 브라우저)에서는 기존처럼 파일 다운로드로 대신한다.
async function shareOrDownloadBlob(blob, filename, shareTitle){
  try{
    const file = new File([blob], filename, { type: blob.type });
    if(navigator.canShare && navigator.canShare({ files:[file] })){
      await navigator.share({ files:[file], title: shareTitle || filename });
      return true;
    }
  }catch(e){
    if(e && e.name === 'AbortError') return true; // 사용자가 공유창을 취소한 것 — 다운로드로 재시도하지 않음
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return false;
}

