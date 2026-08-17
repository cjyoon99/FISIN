// ============================================================
// building-detail.js
// 대상물 상세보기 + 현장 수정 + 변경이력 (원본 1899~2621줄)
// ※ E단계 모듈화(V77) 시 원본 v76 단일 파일에서 그대로 잘라낸 것으로,
//   전역 스코프를 그대로 사용하며 기존 함수 간 참조 관계는 100% 동일합니다.
// ============================================================
// ================= 대상물 상세보기 =================
// index.html(혁신소방 점검대장, 실제 운영중인 리더)의 FAC_TREE·tBasic/tFac/tExt/tSpec/tDef 렌더 함수와
// 데이터 셰이프(연도별 압축키 대신 여기선 대상물당 최신 1건만 사용)를 그대로 가져와 "동일한 모양과 타입"으로 반영.
// 실제 서비스에서는 buildings/facility_status/building_extinguishers/building_equipment_specs 등 DB에서 조회
// (참소방_SaaS_DB스키마_V09 §6 API 스펙 참고). 프로토타입 단계라 7개 대상물만 실제 엑셀 기반 샘플로 제공.
const FAC_TREE=[
  {big:'소화설비',icon:'🧯',mids:[
    {mid:'소화기구 및 자동소화장치',items:['분말소화기','CO2/하론소화기(청정)','자동확산소화기','K급소화기','상업용자동소화기','주거용주방자동소화장치','상업용주방자동소화장치','캐비닛형자동소화장치','가스·분말·고체자동소화장치']},
    {mid:'수계소화설비',items:['옥내소화전설비','스프링클러설비','간이스프링클러설비','화재조기진압용스프링클러설비','물분무소화설비','미분무소화설비','포소화설비']},
    {mid:'가스계·분말 소화설비',items:['이산화탄소소화설비','할론소화설비','할로겐화합물 및 불활성기체소화설비','분말소화설비','강화액소화설비','고체에어로졸소화설비']},
    {mid:'옥외소화전',items:['옥외소화전설비']},
  ]},
  {big:'경보설비',icon:'🔔',mids:[{mid:'',items:['단독경보형감지기','비상경보설비','자동화재탐지설비','시각경보기','비상방송설비','통합감시시설','자동화재속보설비','누전경보기','가스누설경보기']}]},
  {big:'피난구조설비',icon:'🚪',mids:[
    {mid:'피난기구',items:['공기안전매트','피난사다리','완강기','간이완강기','미끄럼대','구조대','다수인피난장비','승강식피난기·하향식피난구용내림식사다리','피난교','피난용트랩']},
    {mid:'인명구조기구',items:['인명구조기구','방열복/방화복','공기호흡기','인공소생기']},
    {mid:'유도등 및 유도표지',items:['유도등','피난구유도등','통로유도등','객석유도등','유도표지','피난유도선']},
    {mid:'비상조명',items:['비상조명등','휴대용비상조명등']},
  ]},
  {big:'소화용수설비',icon:'💧',mids:[{mid:'',items:['상수도소화용수설비','소화수조','저수조']}]},
  {big:'소화활동설비',icon:'🚒',mids:[
    {mid:'제연설비',items:['제연설비']},
    {mid:'연결설비',items:['연결송수관설비','연결살수설비']},
    {mid:'기타 활동설비',items:['비상콘센트설비','무선통신보조설비','연소방지설비']},
  ]},
  {big:'기타',icon:'🏗️',mids:[{mid:'',items:['방화문','방화셔터','비상구','피난통로','방염']}]},
];
const MULTI_ITEMS=['소화기또는자동확산소화기','간이스프링클러설비','비상경보설비또는자동화재탐지설비','가스누설경보기','피난기구','피난유도선','유도등·유도표지또는비상조명등','휴대용비상조명','방화문','비상구(비상탈출구)','영업장내부피난통로','영상음향차단장치','누전차단기','창문','피난안내도·피난안내영상물','방염물품'];

// [v60] 하드코딩된 7개 대상물(골드프라자·화정초등학교·꽃바위유치원·내황초등학교·고헌중학교·중앙중학교·복산나이스)의
// 손큐레이션 데이터는 마스터DB(V08~)가 더 완전해져서 더 이상 불필요 — 삭제함. 이제 전 대상물이
// ensureMasterDataFor()를 통해 BUILDINGS_MASTER에서 균일하게 채워진다.
const BUILDING_PROFILES = {};

// 과거 불량 이력(실시결과점검표분석_20260624 5.불량 및 조치사항 시트, 전 연도) — 대상물당 최신 회차만 반영했던 BUILDING_PROFILES와 별개로
// 여러 해에 걸친 이력을 그대로 보존. '없음/해당없음/이상없음'은 혁신소방_점검대장_지침_v5 저장 규칙대로 제외, 연도 내림차순 정렬.
// 앞으로 현장에서 새로 기록되는 불량내역(defectEntries)과 항목·코드 체계가 완전히 일치하지는 않을 수 있음(과거엔 점검번호 체계, 현재는 자유 입력) — 그 차이를 감수하고 과거 이력 자체의 가치를 위해 함께 표시.
const PAST_DEFECTS = {
  '화정초등학교': [{year:'26년',equip:'소화설비',code:'2-H-013',content:'옥내소화전 충압펌프 OFF 스위치 점등 불량(펌프실) => 조치완료',status:'조치완료'},{year:'26년',equip:'피난구조설비',code:'21-A-001',content:'중앙계단 앞 피난구유도등 설치불량(본관 4층) => 조치완료',status:'조치완료'},{year:'25년',equip:'소화설비',code:'1-A-008',content:'자동확산소화기 내용연수 초과(조리실, 보일러실)',status:'조치완료'},{year:'25년',equip:'소화설비',code:'15-G-002',content:'소화전 발신기 불량(별관동 3층 북쪽, 1층 남쪽)',status:'조치완료'},{year:'25년',equip:'경보설비',code:'19-A-002',content:'가스누설경보기 전원불량(본관동 1층 급식소내 보일러실)',status:'조치완료'}],
  '꽃바위유치원': [{year:'25년',equip:'피난구조설비',code:'22-A-002',content:'1층 당직실 내 수신기 상부 비상조명등 점등불량',status:'조치완료'},{year:'24년',equip:'소화설비',code:'3-H-002',content:'스프링클러헤드 벽면 밀착설치(햇살반)',status:'조치완료'},{year:'24년',equip:'경보설비',code:'15-D-006',content:'감지기 미설치(푸른반,협의회실)',status:'조치완료'},{year:'24년',equip:'경보설비',code:'21-A-003',content:'유도등 미설치(열매반앞,조리장후문)',status:'조치완료'},{year:'24년',equip:'피난구조설비',code:'21-A-004',content:'유도등 예비전원불량(1층e/v계단)',status:'조치완료'}],
  '내황초등학교': [{year:'26년',equip:'소화설비',code:'2-B-005',content:'옥상수조 표지 탈락',status:'조치완료'},{year:'26년',equip:'소화설비',code:'21-A-002',content:'식당 내 피난구유도등 점등불량',status:'조치완료'},{year:'25년',equip:'소화설비',code:'1-A-008',content:'분말소화기 내용연수초과(1층 문서고)',status:'조치완료'},{year:'25년',equip:'소화설비',code:'15-D-009',content:'감지기 작동불량(1-4반)',status:'조치완료'},{year:'25년',equip:'경보설비',code:'15-E-002',content:'경종 작동불량(강당동 2층 체육관 내 좌측)',status:'조치완료'},{year:'24년',equip:'소화설비',code:'2-B-005',content:'고가수조표지 탈락(옥상)',status:'조치완료'},{year:'24년',equip:'소화설비',code:'15-D-009',content:'감지기 작동불량(5-3앞복도)',status:'조치완료'},{year:'24년',equip:'경보설비',code:'15-E-002',content:'경종 작동불량(본관1층중앙)',status:'조치완료'}],
  '고헌중학교': [{year:'26년',equip:'소화설비',code:'9-G-022',content:'필로티주차장 입구 우측 이산화탄소설비(호스릴) 위치표시등 파손',status:'조치완료'},{year:'26년',equip:'소화설비',code:'15-D-009',content:'후관동 옥상층 B-2소화전 쪽 옥상층 계단감지기 탈락',status:'조치완료'},{year:'26년',equip:'경보설비',code:'15-D-009',content:'후관동 1층 교직원 여자 화장실 앞 연기감지기 불량',status:'조치완료'},{year:'26년',equip:'피난구조설비',code:'21-A-004',content:'본관동 4층 E/V 앞(1-7반 앞) 피난구 유도등 예비전원불량',status:'조치완료'},{year:'26년',equip:'소화활동설비',code:'31-A-001',content:'본관동 2층 교과실 앞 중앙계단 방화문 도어릴리즈 불량',status:'조치완료'},{year:'26년',equip:'소화활동설비',code:'31-A-001',content:'본관동 4층 우측복도 계단 방화문 도어릴리즈 불량',status:'조치완료'},{year:'26년',equip:'기타',code:'31-A-001',content:'후관동 3층 중앙계단 방화문 도어릴리즈 불량',status:'조치완료'},{year:'26년',equip:'기타',code:'31-A-001',content:'후관동 3층 중앙계단 방화문 도어릴리즈 불량',status:'조치완료'},{year:'25년',equip:'소화설비',code:'2-C-008',content:'소화전 기동램프 작동불량(체육관동 2층)',status:'조치완료'},{year:'25년',equip:'피난구조설비',code:'21-A-001',content:'피난구 유도등 점등불량(B동 4층 피난계단 중앙)',status:'조치완료'},{year:'24년',equip:'소화설비',code:'1-A-008',content:'분말소화기 내용연수초과(분리수거장)',status:'조치완료'},{year:'24년',equip:'소화설비',code:'15-E-002',content:'경종 작동불량(체육2-1앞,본관지하)',status:'조치완료'},{year:'24년',equip:'경보설비',code:'15-G-002',content:'발신기 작동불량(본관지하)',status:'조치완료'},{year:'24년',equip:'경보설비',code:'15-F-002',content:'시각경보기 작동불량(강당)',status:'조치완료'},{year:'24년',equip:'피난구조설비',code:'21-A-002',content:'유도등 작동불량(급식소옥외계단,남학생탈의실옆)',status:'조치완료'}],
  '중앙중학교': [{year:'26년',equip:'소화설비',code:'1-A-008',content:'별관동 1층 식당 보일러실 자동확산소화기 내용연수초과',status:'조치완료'},{year:'26년',equip:'소화설비',code:'15-F-002',content:'체육관 안 남쪽 발신기 위 시각경보기 파손',status:'조치완료'},{year:'26년',equip:'경보설비',code:'15-F-002',content:'체육관 안 북쪽 발신기 위 시각경보기 파손',status:'조치완료'},{year:'26년',equip:'경보설비',code:'15-G-002',content:'별관동 1층 식당안 동편 발신기 불량',status:'조치완료'},{year:'26년',equip:'경보설비',code:'21-A-002',content:'본관 중앙계단 계단통로유도등 점등불량',status:'조치완료'},{year:'26년',equip:'경보설비',code:'21-A-001',content:'본관 3층 2-2반, 2-3반 사이 복도통로유도등 파손',status:'조치완료'},{year:'26년',equip:'피난구조설비',code:'21-A-003',content:'본관동 3층 2-9반 앞 피난구유도등 예비전원 불량',status:'조치완료'},{year:'26년',equip:'피난구조설비',code:'21-A-001',content:'본관동 2층 1-7반 옆 복도통로유도등 파손',status:'조치완료'},{year:'25년',equip:'소화설비',code:'15-G-002',content:'발신기불량(별관동3F서편,별관2층동, 별관3층동)',status:'조치완료'},{year:'25년',equip:'경보설비',code:'15-E-002',content:'경종불량(별관동2F 별관2층동, 별관동3F 별관3층동)',status:'조치완료'},{year:'25년',equip:'경보설비',code:'21-A-001',content:'유도등 불량(별관동3F 주계단 입구 , 본관동3F 2-9반 앞 , 본관동1F 진',status:'조치완료'},{year:'25년',equip:'소화설비',code:'15-E-002',content:'경종 작동불량(본관4층서편)',status:'조치완료'},{year:'25년',equip:'경보설비',code:'15-G-002',content:'발신기 작동불량(본관2층서편)',status:'조치완료'},{year:'25년',equip:'피난구조설비',code:'21-A-002',content:'유도등점등불량(1-5옆복도,2-8옆복도)',status:'조치완료'},{year:'24년',equip:'소화설비',code:'15-E-002',content:'경종 작동불량(본관4층서편)',status:'조치완료'},{year:'24년',equip:'경보설비',code:'15-G-002',content:'발신기 작동불량(본관2층서편)',status:'조치완료'},{year:'24년',equip:'피난구조설비',code:'21-A-002',content:'유도등점등불량(1-5옆복도,2-8옆복도)',status:'조치완료'}],
  '복산나이스': [{year:'26년',equip:'소화설비',code:'3-D-003',content:'4층 유수검지장치실 표지 불량',status:'조치완료'},{year:'26년',equip:'소화설비',code:'15-E-002',content:'주계단 경종선로불량(E/V측 1번 소화전)',status:'조치완료'},{year:'26년',equip:'경보설비',code:'15-F-002',content:'4층 보조계단쪽 소화전 위 시각경보기 작동불량',status:'조치완료'},{year:'26년',equip:'경보설비',code:'15-D-006',content:'2층 냉장고 옆 약품보관실 출입구 감지기 미설치',status:'조치완료'},{year:'26년',equip:'피난구조설비',code:'21-A-002',content:'3층 냉온풍기 옆 거실통로유도등 점등불량',status:'조치완료'},{year:'25년',equip:'피난구조설비',code:'21-A-001',content:'2층 주계단 측 출입구 앞 거실통로유도등 조도불량 -> 조치완료',status:'조치완료'}]
};

function tBasic(r){
  const sections=[
    {items:[['대상물용도',r.usage,false],['소재지',r.address,true],
             ['점검기간',r.period,true],['총점검일수',r.pm,false]]},
    {group:'전자우편 및 관할서', items:[
      ['전자우편 송달 동의 여부',r.email_consent,false],['전자우편주소',r.email,true],['관할소방서명',r.jurisdiction,false]]},
    {group:'소방안전관리', items:[['소방안전관리등급',r.mgr_grade,false],['최근교육이수일',r.last_edu_date,false]]},
    {group:'소방관리', items:[['소방계획서 작성여부',r.fire_written,false],['보관여부',r.fire_kept,false],
     ['작동기능점검 여부',r.self_check_work,false],['종합점검 여부',r.self_check_full,false],
     ['소방안전교육',r.edu_safety,false],['소방훈련',r.edu_drill,false]]},
    {group:'화재보험', items:[['가입여부',r.ins_join,false],['보험사',r.ins_company,false],['가입기간',r.ins_period,true]]},
    {items:[['다중이용업소 갯수',r.multi_use_count,false]]},
    {group:'건축정보', items:[
      ['건축허가일',r.build_permit_date,false],['사용승인일',r.use_approval_date,false],
      ['연면적',r.floor_area,false],['건축면적',r.build_area,false],['세대수',r.households,false],
      ['층수',r.floors,false],['높이',r.height,false],['건물동수',r.buildings,false],
      ['건축구조',r.structure,true],['지붕구조',r.roof,false],['경사로',r.ramp,false],
      ['계단종류',r.stair_type,false],['계단수',r.stair_count,false]]},
  ];
  function rowHTML(l,v,w){
    if(l==='소재지'&&v){
      const q=encodeURIComponent(v);
      const kakao=`https://map.kakao.com/?q=${q}`;
      const tmap=`tmap://search?name=${q}`;
      const tmapFallback=`https://tmap.life/${q}`;
      return`<div class="ir wide"><div class="il">📍 소재지</div><div class="iv">${v}<div class="map-btns"><a class="map-btn kakao" href="${kakao}" target="_blank" rel="noopener">🗺 카카오맵</a><a class="map-btn tmap" href="${tmap}" onclick="setTimeout(()=>{window.location.href='${tmapFallback}'},1500)" rel="noopener">🗺 티맵</a></div></div></div>`;
    }
    return`<div class="ir${w?' wide':''}"><div class="il">${l}</div><div class="iv">${v}</div></div>`;
  }
  const title = r.name ? `<div class="ir wide"><div class="il">대상물명칭</div><div class="iv">${r.name}</div></div>` : '';
  let body='';
  sections.forEach(sec=>{
    const rowsHtml = sec.items.filter(([,v])=>v).map(([l,v,w])=>rowHTML(l,v,w)).join('');
    if(!rowsHtml) return; // [v61] 그룹 안에 실제로 보여줄 값이 하나도 없으면 그룹 헤더 자체를 안 띄운다(빈 헤더 방지)
    if(sec.group) body += `<div class="ig-group-hd">${sec.group}</div>`;
    body += rowsHtml;
  });
  return`<div class="ig">${title}${body}</div>`;
}
function tFac(r){
  const fac=r.facility||{};
  const mfac=r.multi_facility||{};
  let html='';
  const covered = new Set();
  for(const {big,icon,mids} of FAC_TREE){
    mids.forEach(({items})=>items.forEach(k=>covered.add(k)));
    if(!mids.some(({items})=>items.some(k=>fac[k])))continue;
    html+=`<div class="fac-big"><div class="fac-big-hd"><span class="fac-big-icon">${icon}</span><span class="fac-big-name">${big}</span></div><div class="fac-big-body">`;
    for(const {mid,items} of mids){
      const vis=items.filter(k=>fac[k]);if(!vis.length)continue;
      html+=`<div class="fac-mid">${mid?`<div class="fac-mid-hd">${mid}</div>`:''}<div class="fac-items">`;
      vis.forEach(k=>{html+=`<div class="fi"><span class="fn">${k}</span><span class="fok">○</span></div>`;});
      html+=`</div></div>`;
    }
    html+=`</div></div>`;
  }
  const mvis=MULTI_ITEMS.filter(k=>mfac[k]);
  MULTI_ITEMS.forEach(k=>covered.add(k));
  if(mvis.length){
    html+=`<div class="fac-big"><div class="fac-big-hd"><span class="fac-big-icon">🏪</span><span class="fac-big-name">다중이용업소</span></div><div class="fac-big-body"><div class="fac-mid"><div class="fac-items">`;
    mvis.forEach(k=>{html+=`<div class="fi"><span class="fn">${k}</span><span class="fok">○</span></div>`;});
    html+=`</div></div></div></div>`;
  }
  // [v61] 소방시설 유무현황(Sheet2)엔 있지만 FAC_TREE/MULTI_ITEMS 분류표에 아직 없는 설비명도
  // 빠짐없이 보여준다(예: 마스터DB가 새 대분류·세분화된 컬럼명으로 뽑아온 경우).
  const uncovered = Object.keys(fac).filter(k=>fac[k] && !covered.has(k));
  if(uncovered.length){
    html+=`<div class="fac-big"><div class="fac-big-hd"><span class="fac-big-icon">🧩</span><span class="fac-big-name">기타 보유 설비</span></div><div class="fac-big-body"><div class="fac-mid"><div class="fac-items">`;
    uncovered.forEach(k=>{html+=`<div class="fi"><span class="fn">${k}</span><span class="fok">○</span></div>`;});
    html+=`</div></div></div></div>`;
  }
  return html||'<p class="empty">소방시설 정보 없음</p>';
}
function tExt(r){
  const e=r.extinguisher||{};
  const sections=[
    {group:'소화기', items:[['분말소화기',e['분말소화기'],false],['소화기 기타(CO2, 할론, 강화액, K급 등)',e['소화기기타'],false]]},
    {group:'간이소화용구', items:[['투척용',e['투척용'],false],['간이소화용구 기타(에어로졸식,소공간용,마른모래, 팽창질석, 팽창진주암)',e['간이소화용구기타'],false]]},
    {group:'자동소화장치 등', items:[['자동확산소화기',e['자동확산소화기'],false],['자동소화장치(주거용,상업용 주방)',e['자동소화장치'],false]]},
    {group:'비고',items:[['비고',e['비고'],true]]},
  ];
  let body='';
  sections.forEach(sec=>{
    const rowsHtml = sec.items.filter(([,v])=>v).map(([l,v,w])=>
      `<div class="ir${w?' wide':''}"><div class="il">${l}</div><div class="iv">${v}</div></div>`).join('');
    if(!rowsHtml) return; // 그룹 안에 실제 값이 하나도 없으면 그룹 헤더 자체를 안 띄운다
    if(sec.group) body += `<div class="ig-group-hd">${sec.group}</div>`;
    body += rowsHtml;
  });
  return body ? `<div class="ig">${body}</div>` : '<p class="empty">소화기구 정보 없음</p>';
}
function tSpec(r){
  const spec=r.spec||{};
  // [v58] 상세사양(Sheet4)엔 없지만 실제 보유중인 설비(소방시설현황 체크값)는 빠짐없이 보여준다.
  const specMids = new Set();
  Object.values(spec).forEach(mids=>Object.keys(mids).forEach(m=>{ if(m) specMids.add(m); }));
  const fac = r.facility||{};
  const uncovered = Object.keys(fac).filter(name=>{
    if(!fac[name]) return false;
    for(const m of specMids){ if(m!=='_' && m!=='기타' && (m.includes(name) || name.includes(m))) return false; }
    return true;
  });
  const hasSpec = spec && Object.keys(spec).length;
  if(!hasSpec && !uncovered.length) return '<p class="empty">기기사양 정보 없음</p>';
  let html='';
  for(const [big,mids] of Object.entries(spec)){
    const entries=Object.entries(mids);if(!entries.length)continue;
    html+=`<div class="spec-big"><div class="spec-big-hd">⚙️ ${big}</div><div class="spec-big-body">`;
    for(const [mid,items] of entries){
      if(!items||!items.length)continue;
      html+=`<div class="spec-mid-block">`;
      if(mid&&mid!=='_'&&mid!=='기타')html+=`<div class="spec-mid-hd">${mid}</div>`;
      html+=`<div class="spec-items">${items.map(it=>`<div class="si${(it.vl||'').length>14?' wide':''}"><div class="si-l">${it.lb||''}</div><div class="si-v">${it.vl||''}</div></div>`).join('')}</div></div>`;
    }
    html+=`</div></div>`;
  }
  if(uncovered.length){
    html+=`<div class="spec-big"><div class="spec-big-hd">⚙️ 기타 보유 설비</div><div class="spec-big-body"><div class="spec-mid-block"><div class="spec-items">${uncovered.map(n=>`<div class="si"><div class="si-l">${n}</div><div class="si-v">상세 사양 미기재 (현장 확인 필요)</div></div>`).join('')}</div></div></div></div>`;
  }
  return html||'<p class="empty">기기사양 정보 없음</p>';
}
function tDef(r){
  if(!r.defects||!r.defects.length)return'<p class="empty">✅ 불량사항 없음</p>';
  return r.defects.map(df=>`<div class="di"><div class="di-top"><span class="dc2">${df.code||''}</span><span class="de2">${df.equip||''}</span><span class="ds s${df.status||'조치대기'}">${df.status||'조치대기'}</span></div><div class="dct">${df.content||''}</div></div>`).join('');
}

// ================= 대상물 상세보기 — 현장 수정 + 변경이력 =================
// BUILDING_PROFILES(관리업체 콘솔 기본값)는 그대로 두고, 그 위에 현장에서 고친 값(BUILDING_EDITS)을 덮어써서 보여준다.
// 저장할 때마다 "무엇을 무엇에서 무엇으로 바꿨는지"를 통째로 이력에 남기고(필드별이 아니라 저장 단위),
// 되돌리기도 값을 지우는 게 아니라 새 이력으로 남겨서 — 뭐가 왜 이렇게 됐는지 항상 나중에 추적 가능하게 함.
let BUILDING_EDITS = {}; // { [building]: {basic:{}, facility:{}, multi_facility:{}, extinguisher:{}, spec:{'big|mid|lb':vl}} }
let bdEditMode = null; // null | 'basic' | 'facility' | 'extinguisher' | 'spec'

async function loadBuildingEdits(building){
  const res = await storageGet('building_edits:'+building, true);
  if(backendOnline){ BUILDING_EDITS[building] = (res && res.value) ? JSON.parse(res.value) : {}; lsCacheSet('bedit:'+building, BUILDING_EDITS[building]); }
  else BUILDING_EDITS[building] = lsCacheGet('bedit:'+building) || BUILDING_EDITS[building] || {};
}
async function persistBuildingEdits(building){
  const res = await storageSet('building_edits:'+building, JSON.stringify(BUILDING_EDITS[building]||{}), true);
  lsCacheSet('bedit:'+building, BUILDING_EDITS[building]||{}); // [v65] 오프라인이든 아니든 로컬에도 항상 반영
  if(!res && !navigator.onLine) showToast('오프라인 - 이 기기에 저장됨(연결되면 자동 동기화)');
}
async function appendBuildingHistory(building, tab, tabLabel, changes){
  const entry = { ts: Date.now(), inspector: inspectorName||'', building, tab, tabLabel, changes };
  await storageSet('building_history:'+building+':'+entry.ts, JSON.stringify(entry), true);
  return entry;
}
async function loadBuildingHistoryList(building){
  const list = await storageGetMany('building_history:'+building+':', true);
  if(backendOnline){ const sorted = list.sort((a,b)=>b.ts-a.ts); lsCacheSet('bhist:'+building, sorted); return sorted; }
  return lsCacheGet('bhist:'+building) || [];
}

function getMergedProfile(building){
  const base = BUILDING_PROFILES[building];
  if(!base) return null;
  const edits = BUILDING_EDITS[building] || {};
  const merged = JSON.parse(JSON.stringify(base));
  Object.assign(merged, edits.basic||{});
  merged.facility = Object.assign({}, merged.facility, edits.facility||{});
  merged.multi_facility = Object.assign({}, merged.multi_facility, edits.multi_facility||{});
  merged.extinguisher = Object.assign({}, merged.extinguisher, edits.extinguisher||{});
  if(edits.spec){
    merged.spec = merged.spec || {};
    for(const key in edits.spec){
      const [big,mid,lb] = key.split('|');
      if(!merged.spec[big]) merged.spec[big] = {};
      if(!merged.spec[big][mid]) merged.spec[big][mid] = [];
      const items = merged.spec[big][mid];
      const found = items.find(it=>it.lb===lb);
      if(found) found.vl = edits.spec[key];
      else items.push({lb, vl: edits.spec[key]});
    }
  }
  return merged;
}

const BASIC_FIELD_DEFS = [
  ['대상물명칭','name'],['대상물용도','usage'],['소재지','address'],
  ['점검기간','period'],['총점검일수','pm'],
  ['전자우편 송달 동의 여부','email_consent'],['전자우편주소','email'],['관할소방서명','jurisdiction'],
  ['소방안전관리등급','mgr_grade'],
  ['최근교육이수일','last_edu_date'],
  ['소방계획서 작성여부','fire_written'],['소방계획서 보관여부','fire_kept'],
  ['자체점검(전년도) 작동기능점검 여부','self_check_work'],['자체점검(전년도) 종합점검 여부','self_check_full'],
  ['교육훈련 소방안전교육','edu_safety'],['교육훈련 소방훈련','edu_drill'],
  ['화재보험 가입여부','ins_join'],['화재보험 보험사','ins_company'],['화재보험 가입기간','ins_period'],
  ['다중이용업소 갯수','multi_use_count'],
  ['건축허가일','build_permit_date'],['사용승인일','use_approval_date'],
  ['연면적','floor_area'],['건축면적','build_area'],['세대수','households'],
  ['층수','floors'],['높이','height'],['건물동수','buildings'],['건축구조','structure'],
  ['지붕구조','roof'],['경사로','ramp'],['계단종류','stair_type'],['계단수','stair_count'],
];
function esc_(v){ return (v===undefined||v===null?'':String(v)).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

function eBasic(r){
  return `<div class="ig">${BASIC_FIELD_DEFS.map(([label,key])=>
    `<div class="ir"><div class="il">${label}</div><textarea class="e-input" data-field="${key}" rows="1">${esc_(r[key])}</textarea></div>`
  ).join('')}</div>`;
}
function eFac(r){
  const fac = r.facility||{}, mfac = r.multi_facility||{};
  let html='';
  for(const {big,icon,mids} of FAC_TREE){
    html+=`<div class="fac-big"><div class="fac-big-hd"><span class="fac-big-icon">${icon}</span><span class="fac-big-name">${big}</span></div><div class="fac-big-body">`;
    for(const {mid,items} of mids){
      html+=`<div class="fac-mid">${mid?`<div class="fac-mid-hd">${mid}</div>`:''}<div class="fac-items">`;
      items.forEach(k=>{
        html+=`<label class="fi" style="cursor:pointer;"><span class="fn">${k}</span><input type="checkbox" class="e-fac-check" data-group="facility" data-field="${esc_(k)}" ${fac[k]?'checked':''}></label>`;
      });
      html+=`</div></div>`;
    }
    html+=`</div></div>`;
  }
  html+=`<div class="fac-big"><div class="fac-big-hd"><span class="fac-big-icon">🏪</span><span class="fac-big-name">다중이용업소</span></div><div class="fac-big-body"><div class="fac-mid"><div class="fac-items">`;
  MULTI_ITEMS.forEach(k=>{
    html+=`<label class="fi" style="cursor:pointer;"><span class="fn">${k}</span><input type="checkbox" class="e-fac-check" data-group="multi_facility" data-field="${esc_(k)}" ${mfac[k]?'checked':''}></label>`;
  });
  html+=`</div></div></div></div>`;
  return html;
}
const EXT_FIELD_DEFS = [
  ['소화기', [['분말소화기','분말소화기'],['소화기 기타','소화기기타']]],
  ['간이소화용구', [['투척용','투척용'],['간이소화용구 기타','간이소화용구기타']]],
  [null, [['자동확산소화기','자동확산소화기'],['자동소화장치','자동소화장치']]],
  [null, [['비고','비고']]],
];
function eExt(r){
  const e = r.extinguisher||{};
  let html='';
  EXT_FIELD_DEFS.forEach(([group,fields])=>{
    if(group) html += `<div class="ig-group-hd">${group}</div>`;
    fields.forEach(([label,key])=>{
      html += `<div class="ir"><div class="il">${label}</div><textarea class="e-input" rows="1" data-field="${esc_(key)}">${esc_(e[key])}</textarea></div>`;
    });
  });
  return `<div class="ig">${html}</div>`;
}
function eSpec(r){
  const spec = r.spec||{};
  if(!Object.keys(spec).length) return '<p class="empty">등록된 기기사양이 없습니다.</p>';
  let html='';
  for(const [big,mids] of Object.entries(spec)){
    const entries = Object.entries(mids); if(!entries.length) continue;
    html+=`<div class="spec-big"><div class="spec-big-hd">⚙️ ${big}</div><div class="spec-big-body">`;
    for(const [mid,items] of entries){
      if(!items||!items.length) continue;
      html+=`<div class="spec-mid-block">`;
      if(mid && mid!=='_' && mid!=='기타') html+=`<div class="spec-mid-hd">${mid}</div>`;
      html+=`<div class="spec-items">${items.map(it=>
        `<div class="si wide"><div class="si-l">${it.lb||''}</div><textarea class="e-input" rows="1" data-field="${esc_(big)}|${esc_(mid)}|${esc_(it.lb)}">${esc_(it.vl)}</textarea></div>`
      ).join('')}</div></div>`;
    }
    html+=`</div></div>`;
  }
  return html;
}

const BD_TAB_LABEL = { basic:'기준정보', facility:'소방시설현황', extinguisher:'소화기구', spec:'기기사양' };
function updateBdToolbar(){
  const tab = currentBdTab;
  const editable = ['basic','facility','extinguisher','spec'].includes(tab);
  $('bdToolbar').style.display = editable ? '' : 'none';
  $('bdEditBtn').style.display = (editable && bdEditMode!==tab) ? '' : 'none';
  $('bdSaveBtn').style.display = (bdEditMode===tab) ? '' : 'none';
  $('bdCancelBtn').style.display = (bdEditMode===tab) ? '' : 'none';
  $('bdHistoryBtn').style.display = editable ? '' : 'none';
}

$('bdEditBtn').onclick = ()=>{
  bdEditMode = currentBdTab;
  renderBdActiveTab();
  updateBdToolbar();
};
$('bdCancelBtn').onclick = ()=>{
  bdEditMode = null;
  renderBdActiveTab();
  updateBdToolbar();
};
$('bdSaveBtn').onclick = async ()=>{
  const tab = bdEditMode;
  const profile = getMergedProfile(currentBuilding);
  if(!profile) return;
  const panel = $('dpanel-'+tab);
  const changes = [];
  const newEdits = { basic:{}, facility:{}, multi_facility:{}, extinguisher:{}, spec:{} };

  if(tab==='basic'){
    panel.querySelectorAll('.e-input[data-field]').forEach(inp=>{
      const key = inp.dataset.field, oldV = profile[key]||'', newV = inp.value.trim();
      if(newV !== oldV){
        const label = (BASIC_FIELD_DEFS.find(([,k])=>k===key)||[key])[0];
        changes.push({field:key, label, old:oldV, new:newV});
        newEdits.basic[key] = newV;
      }
    });
  } else if(tab==='facility'){
    panel.querySelectorAll('.e-fac-check[data-field]').forEach(chk=>{
      const group = chk.dataset.group, key = chk.dataset.field;
      const oldV = !!(profile[group]||{})[key], newV = chk.checked;
      if(newV !== oldV){
        changes.push({field:key, label:key, old:oldV?'설치':'미설치', new:newV?'설치':'미설치'});
        newEdits[group][key] = newV;
      }
    });
  } else if(tab==='extinguisher'){
    panel.querySelectorAll('.e-input[data-field]').forEach(inp=>{
      const key = inp.dataset.field, oldV = (profile.extinguisher||{})[key]||'', newV = inp.value.trim();
      if(newV !== oldV){
        changes.push({field:key, label:key, old:oldV, new:newV});
        newEdits.extinguisher[key] = newV;
      }
    });
  } else if(tab==='spec'){
    panel.querySelectorAll('.e-input[data-field]').forEach(inp=>{
      const key = inp.dataset.field; // "big|mid|lb"
      const [big,mid,lb] = key.split('|');
      const oldV = ((profile.spec[big]||{})[mid]||[]).find(it=>it.lb===lb)?.vl || '';
      const newV = inp.value.trim();
      if(newV !== oldV){
        changes.push({field:key, label:`${mid&&mid!=='_'?mid+' ':''}${lb}`, old:oldV, new:newV});
        newEdits.spec[key] = newV;
      }
    });
  }

  if(!changes.length){ showToast('바뀐 내용이 없습니다'); bdEditMode=null; renderBdActiveTab(); updateBdToolbar(); return; }

  const summary = changes.map(c=>`· ${c.label}: ${c.old||'(비어있음)'} → ${c.new||'(비어있음)'}`).join('\n');
  if(!confirm(`${BD_TAB_LABEL[tab]} ${changes.length}개 항목이 바뀝니다.\n\n${summary}\n\n저장할까요? (변경이력에 기록됩니다)`)) return;

  BUILDING_EDITS[currentBuilding] = BUILDING_EDITS[currentBuilding] || {};
  const cur = BUILDING_EDITS[currentBuilding];
  cur.basic = Object.assign({}, cur.basic, newEdits.basic);
  cur.facility = Object.assign({}, cur.facility, newEdits.facility);
  cur.multi_facility = Object.assign({}, cur.multi_facility, newEdits.multi_facility);
  cur.extinguisher = Object.assign({}, cur.extinguisher, newEdits.extinguisher);
  cur.spec = Object.assign({}, cur.spec, newEdits.spec);
  await persistBuildingEdits(currentBuilding);
  await appendBuildingHistory(currentBuilding, tab, BD_TAB_LABEL[tab], changes);

  bdEditMode = null;
  renderBuildingDetail();
  updateBdToolbar();
  showToast('저장했습니다 (변경이력에 기록됨)');
};

$('bdHistoryBtn').onclick = async ()=>{
  showToast('이력 불러오는 중...');
  const list = await loadBuildingHistoryList(currentBuilding);
  const el = $('bdHistoryList');
  if(!list.length){
    el.innerHTML = '<p class="empty">아직 변경 이력이 없습니다.</p>';
  } else {
    el.innerHTML = list.map(h=>`
      <div class="di">
        <div class="di-top"><span class="de2">${h.tabLabel||h.tab}</span><span class="dc2">${h.inspector||'담당자 미상'}</span><span class="ds" style="margin-left:auto;background:#eef2fa;color:#1c3d6e;">${fmtEntryDateTime(h.ts)}</span></div>
        <div class="dct">${(h.changes||[]).map(c=>`${c.label}: ${c.old||'(비어있음)'} → ${c.new||'(비어있음)'}`).join('<br>')}</div>
        <button type="button" class="btn-secondary" style="margin-top:8px;" data-restore-ts="${h.ts}">↩ 이 변경 되돌리기</button>
      </div>`).join('');
    el.querySelectorAll('[data-restore-ts]').forEach(btn=>{
      btn.onclick = ()=> restoreBuildingHistoryEntry(list.find(h=>String(h.ts)===btn.dataset.restoreTs));
    });
  }
  $('bdHistoryOverlay').classList.add('show');
};
$('bdHistoryCloseBtn').onclick = ()=> $('bdHistoryOverlay').classList.remove('show');
$('bdHistoryOverlay').onclick = (e)=>{ if(e.target.id==='bdHistoryOverlay') $('bdHistoryOverlay').classList.remove('show'); };

// 되돌리기: 값을 지우는 게 아니라, 그 시점의 old값으로 다시 되돌리는 "새 저장"을 하나 더 남긴다(이력은 절대 삭제 안 함).
async function restoreBuildingHistoryEntry(entry){
  if(!entry) return;
  if(!confirm(`"${entry.tabLabel}"을(를) 이 시점 이전 값으로 되돌릴까요? (되돌리기도 새 이력으로 남습니다)`)) return;
  const tab = entry.tab;
  BUILDING_EDITS[currentBuilding] = BUILDING_EDITS[currentBuilding] || {};
  const cur = BUILDING_EDITS[currentBuilding];
  const restoreChanges = [];
  if(tab==='basic'){
    cur.basic = cur.basic || {};
    entry.changes.forEach(c=>{ cur.basic[c.field] = c.old; restoreChanges.push({field:c.field, label:c.label, old:c.new, new:c.old}); });
  } else if(tab==='facility'){
    cur.facility = cur.facility || {}; cur.multi_facility = cur.multi_facility || {};
    entry.changes.forEach(c=>{
      const wasInstalled = c.old==='설치';
      // facility/multi_facility 구분은 저장 안 해뒀으므로 우선 facility에 우선 적용(다중이용업소는 이름으로 유추)
      const group = MULTI_ITEMS.includes(c.field) ? cur.multi_facility : cur.facility;
      group[c.field] = wasInstalled;
      restoreChanges.push({field:c.field, label:c.label, old:c.new, new:c.old});
    });
  } else if(tab==='extinguisher'){
    cur.extinguisher = cur.extinguisher || {};
    entry.changes.forEach(c=>{ cur.extinguisher[c.field] = c.old; restoreChanges.push({field:c.field, label:c.label, old:c.new, new:c.old}); });
  } else if(tab==='spec'){
    cur.spec = cur.spec || {};
    entry.changes.forEach(c=>{ cur.spec[c.field] = c.old; restoreChanges.push({field:c.field, label:c.label, old:c.new, new:c.old}); });
  }
  await persistBuildingEdits(currentBuilding);
  await appendBuildingHistory(currentBuilding, tab, BD_TAB_LABEL[tab]+' (되돌리기)', restoreChanges);
  showToast('되돌렸습니다 (이력에 기록됨)');
  $('bdHistoryBtn').onclick(); // 이력 목록 새로고침
  renderBuildingDetail();
};

function autoGrowTextareas(container){
  container.querySelectorAll('textarea.e-input').forEach(t=>{
    t.style.height = 'auto';
    t.style.height = t.scrollHeight + 'px';
    if(!t._autoGrowBound){
      t.addEventListener('input', ()=>{ t.style.height='auto'; t.style.height = t.scrollHeight+'px'; });
      t._autoGrowBound = true;
    }
  });
}

function renderBdActiveTab(){
  const profile = getMergedProfile(currentBuilding);
  const tab = currentBdTab;
  if(!profile){
    if(['basic','facility','extinguisher','spec'].includes(tab)) $('dpanel-'+tab).innerHTML = `<p class="empty">등록된 정보가 없습니다.</p>`;
    return;
  }
  if(tab==='basic') $('dpanel-basic').innerHTML = bdEditMode==='basic' ? eBasic(profile) : tBasic(profile);
  else if(tab==='facility') $('dpanel-facility').innerHTML = bdEditMode==='facility' ? eFac(profile) : tFac(profile);
  else if(tab==='extinguisher') $('dpanel-extinguisher').innerHTML = bdEditMode==='extinguisher' ? eExt(profile) : tExt(profile);
  else if(tab==='spec') $('dpanel-spec').innerHTML = bdEditMode==='spec' ? eSpec(profile) : tSpec(profile);
  if(bdEditMode===tab) autoGrowTextareas($('dpanel-'+tab));
}

let currentBdTab = 'basic';

function renderBuildingDetail(){
  const profile = getMergedProfile(currentBuilding);
  $('bdName').textContent = currentBuilding || '(대상물 미선택)';
  $('bdSub').textContent = profile
    ? [profile.usage, profile.floors, profile.address].filter(Boolean).join(' · ')
    : '등록된 기준정보가 없습니다 · 관리업체 콘솔에서 등록 후 표시됩니다';

  // 불량사항 탭 = ① 현장에서 실시간 기록된 신규 항목(defectEntries) + ② 과거 점검 이력(PAST_DEFECTS)을 함께 표시.
  // 두 출처는 항목 체계가 다를 수 있어(과거=점검번호 체계, 신규=자유입력) 완전히 일치하진 않지만,
  // 과거 이력 자체의 가치를 위해 손실 없이 그대로 병합한다 — 최신(신규 기록)이 위, 과거가 아래.
  const liveDefects = defectEntries.filter(e=>e.building===currentBuilding).slice().reverse().slice(0,10)
    .map(e=>({equip:e.equip||'(설비 미선택)', code:'현장 신규', content:e.defectContent||'', status:e.action||'조치대기'}));
  const pastDefects = getPastDefectsFor(currentBuilding)
    .map(d=>({equip:d.equip, code:`${d.year} 이력 · ${d.code||''}`.replace(/\s*·\s*$/,''), content:d.content, status:d.status}));
  const r = {...(profile||{}), defects: [...liveDefects, ...pastDefects]};

  bdEditMode = null;
  $('dpanel-basic').innerHTML = profile ? tBasic(r) : `<p class="empty">기준정보가 아직 등록되지 않았습니다.</p>`;
  $('dpanel-facility').innerHTML = profile ? tFac(r) : `<p class="empty">등록된 소방시설현황이 없습니다.</p>`;
  $('dpanel-extinguisher').innerHTML = profile ? tExt(r) : `<p class="empty">등록된 소화기구 정보가 없습니다.</p>`;
  $('dpanel-spec').innerHTML = profile ? tSpec(r) : `<p class="empty">등록된 기기사양이 없습니다.</p>`;
  $('dpanel-defect').innerHTML = tDef(r);
  updateBdToolbar();
}

document.querySelectorAll('#bdTabBar .dtab').forEach(el=>{
  el.onclick = ()=>{
    if(bdEditMode){ if(!confirm('저장하지 않은 수정 내용이 사라집니다. 계속할까요?')) return; bdEditMode=null; }
    document.querySelectorAll('#bdTabBar .dtab').forEach(t=>t.classList.remove('on'));
    el.classList.add('on');
    document.querySelectorAll('.dpanel').forEach(p=>p.classList.remove('active'));
    $('dpanel-'+el.dataset.dtab).classList.add('active');
    currentBdTab = el.dataset.dtab;
    renderBdActiveTab();
    updateBdToolbar();
  };
});

// sub 문구("종합점검 · 07-20 예정" 등)에서 월-일을 뽑아 정렬키로 사용. 날짜가 없으면 맨 뒤로.
function buildingSortKey(sub){
  const m = (sub||'').match(/(\d{2})-(\d{2})/);
  return m ? (m[1]+m[2]) : '99999';
}
// [v47] 일정 연동 홈 섹션 — 오늘 이미 시작된(startDate<=오늘) 대상물 중 '최종검사종료'가 아닌 것만 보여준다.
// 아직 시작일이 안 된 일정은 안 보이다가(하루하루 지나면서 하나씩 나타남), 상태를 '최종검사종료'로
// 바꾸면 다음 렌더부터 목록에서 사라진다(진행중 대상물만 계속 눈에 보이게).
// [v49] "하루하루 지나면서 나타난다"는 원래 요구를, 실제로는 이번 주 전체를 한눈에 봐야 하는
// 현장 상황에 맞춰 "이번 주(월~일) 안에 속하는 일정 전체"로 바꿨다(완료 처리해야 사라짐은 그대로 유지).
// [v53] 홈 화면 전용 주간 이동 오프셋(대시보드의 weekOffset과는 별개 — 화면이 서로 다른 주를 봐도 안 섞이게).
let homeWeekOffset = 0;
function activeScheduleForHome(){
  const monday = weekMondayOf(homeWeekOffset);
  const sunday = new Date(monday); sunday.setDate(monday.getDate()+6);
  const weekStartIso = toISO(monday), weekEndIso = toISO(sunday);
  return scheduleEntries
    .filter(e => (e.status||'wait') !== 'closed' && e.startDate <= weekEndIso && scheduleEntryEndDate(e) >= weekStartIso)
    .sort((a,b)=> a.startDate<b.startDate?-1:(a.startDate>b.startDate?1:0));
}
function renderProgressBar(entries, containerId){
  const el = $(containerId);
  if(!entries.length){ el.innerHTML = `<div style="color:var(--muted);font-size:12.5px;">표시할 일정이 없습니다.</div>`; return; }
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
    <div class="progress-summary">진척률 — 최종검사종료 ${closedCount}/${total}건 (${total?Math.round(closedCount/total*100):0}%)</div>
    <div class="progress-bar">${bar}</div>
    <div class="progress-legend">${legend}</div>`;
}
function renderScheduleHome(){
  const activeEntries = activeScheduleForHome();
  const monday = weekMondayOf(homeWeekOffset);
  const sunday = new Date(monday); sunday.setDate(monday.getDate()+6);
  const rangeLabel = `${toISO(monday).slice(5)} ~ ${toISO(sunday).slice(5)}`;
  $('homeWeekTitle').textContent = homeWeekOffset===0
    ? `이번 주 진행중 대상물 (${rangeLabel})`
    : `${homeWeekOffset>0?homeWeekOffset+'주 후':(-homeWeekOffset)+'주 전'} 진행중 대상물 (${rangeLabel})`;
  renderProgressBar(activeEntries, 'scheduleProgressCard');
  const list = $('scheduleHomeList'); list.innerHTML='';
  if(!activeEntries.length){
    list.innerHTML = `<div class="home-item" style="justify-content:center;color:var(--muted);">${homeWeekOffset===0?'이번':'그'} 주(월~일)엔 일정이 없습니다.<br>일정관리 대시보드에서 엑셀 업로드 또는 새 일정을 등록해주세요.</div>`;
    return;
  }
  const todayIso = toISO(new Date());
  activeEntries.forEach(e=>{
    const st = statusStage(e.status||'wait');
    const daysSinceEnd = Math.round((fromISO(todayIso) - fromISO(scheduleEntryEndDate(e))) / 86400000);
    let warn = '';
    if(e.status==='reviewed' && daysSinceEnd > 10) warn = `<span class="overdue-warn">⚠ 송부 지연(점검 후 ${daysSinceEnd}일)</span>`;
    if(e.status==='sent_client' && e.statusChangedAt){
      const daysSinceSent = Math.round((Date.now()-e.statusChangedAt)/86400000);
      if(daysSinceSent > 5) warn = `<span class="overdue-warn">⚠ 제출 지연(송부 후 ${daysSinceSent}일)</span>`;
    }
    const div = document.createElement('div');
    div.className = 'home-item';
    div.style.flexWrap = 'wrap';
    div.innerHTML = `
      <div style="flex:1;min-width:0;">
        <div class="name">${e.building}</div>
        <div class="sub">${e.type||''} · ${e.startDate}${e.duration>1?`~${scheduleEntryEndDate(e)}`:''} · ${e.district?e.district+' · ':''}${e.team||''}</div>
        <span class="status-badge" style="background:${st.bg};color:${st.color};">${st.label}</span>${warn}
        <br>
        <select class="status-select" data-id="${e.id}">
          ${STATUS_STAGES.map(s=>`<option value="${s.key}" ${s.key===(e.status||'wait')?'selected':''}>${s.label}</option>`).join('')}
        </select>
      </div>
      <button class="btn-secondary start-btn" style="width:auto;margin:0;padding:10px 16px;flex-shrink:0;">점검 시작</button>`;
    div.querySelector('.start-btn').onclick = ()=> startInspection(e.building);
    div.querySelector('.status-select').onchange = async (ev)=>{
      const newStatus = ev.target.value;
      if(newStatus !== e.status) e.statusChangedAt = Date.now();
      e.status = newStatus;
      await saveScheduleEntry(e);
      renderScheduleHome();
      showToast(`${e.building} 진척상태: ${statusStage(newStatus).label}`);
    };
    list.appendChild(div);
  });
}
$('homeWeekPrevBtn').onclick = ()=>{ homeWeekOffset--; renderScheduleHome(); };
$('homeWeekNextBtn').onclick = ()=>{ homeWeekOffset++; renderScheduleHome(); };
$('homeWeekTodayBtn').onclick = ()=>{ homeWeekOffset=0; renderScheduleHome(); };
function renderHome(){
  renderScheduleHome();
  const list = $('homeList'); list.innerHTML='';
  const customList = Object.entries(uiPrefs.customBuildings||{}).map(([id,b])=>({id, name:b.name, sub:b.sub, custom:true}));
  // [v47] SAMPLE_BUILDINGS(화정초~중앙중학교 하드코딩)는 현장테스트가 끝났으므로 더는 홈에 표시하지 않는다.
  // 수기로 추가한(customBuildings) 목록만 이 영역에 남긴다.
  const all = customList.sort((a,b)=> buildingSortKey(a.sub).localeCompare(buildingSortKey(b.sub)));
  all.forEach(b=>{
    const div = document.createElement('div');
    div.className = 'home-item';
    div.innerHTML = `<div><div class="name">${b.name}</div><div class="sub">${b.sub}</div></div>
      <div style="display:flex;align-items:center;gap:2px;">
        <button class="btn-secondary start-btn" style="width:auto;margin:0;padding:10px 16px;">점검 시작</button>
        ${b.custom ? `<span class="del-building-btn" style="color:var(--muted);font-size:20px;padding:6px 8px;cursor:pointer;">✕</span>` : ''}
      </div>`;
    div.querySelector('.start-btn').onclick = ()=> startInspection(b.name);
    if(b.custom){
      div.querySelector('.del-building-btn').onclick = ()=>{
        if(!confirm(`"${b.name}" 일정을 목록에서 삭제할까요? (다른 팀원 화면에서도 함께 삭제됩니다)`)) return;
        delete uiPrefs.customBuildings[b.id];
        uiPrefs.customBuildingsDeleted = [...new Set([...(uiPrefs.customBuildingsDeleted||[]), b.id])];
        saveUiPrefsDebounced();
        renderHome();
      };
    }
    list.appendChild(div);
  });
}
// ================= [v65] "이번 주 대상물 준비" — 오프라인 대비 일괄 프리페치 =================
// 인터넷이 끊기기 전에 이번 주 일정에 있는 대상물들의 데이터를 미리 받아 로컬(localStorage)에
// 캐시해둔다. 팀 공용 데이터(불량기록/공사기록/사진/일정/ui_prefs)는 원래도 전체를 한 번에 받아오는
// 구조라 한 번씩만 새로고침하면 되고, 대상물별 데이터(기준정보 수정본·변경이력)만 대상물마다 따로
// 받아야 한다. 다 받아두면, 현장에서 인터넷이 끊겨도 화면 조회는 그대로 되고(캐시로 폴백),
// 새로 입력하는 내용은 동기화 큐에 쌓였다가 연결되는 대로 자동 업로드된다.
async function prefetchThisWeek(){
  const btn = $('prefetchWeekBtn'); const statusEl = $('prefetchStatus');
  const targets = [...new Set(activeScheduleForHome().map(e=>e.building))];
  if(!targets.length){ showToast('이번 주 일정에 등록된 대상물이 없습니다'); return; }
  btn.disabled = true; btn.textContent = '📥 준비 중...';
  try{
    statusEl.textContent = '팀 공용 데이터(불량기록·공사기록·사진·일정) 받는 중...';
    await Promise.all([loadUiPrefs(), loadScheduleEntries(), loadDefectEntries(), loadConstructionEntries(), loadPhotoEntries()]);
    for(let i=0;i<targets.length;i++){
      const b = targets[i];
      statusEl.textContent = `대상물별 데이터 받는 중... (${i+1}/${targets.length}) ${b}`;
      ensureMasterDataFor(b); // 정적 마스터DB 기준정보/설비목록/구조는 이미 파일에 내장되어 있어 네트워크 불필요
      await Promise.all([ loadBuildingEdits(b), loadBuildingHistoryList(b) ]);
    }
    const okAll = backendOnline === true;
    statusEl.textContent = okAll
      ? `✅ ${targets.length}개 대상물 준비 완료 (${new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})} 기준) — 이제 오프라인에서도 조회·입력 가능합니다`
      : `⚠ 일부만 받아졌을 수 있습니다(연결 불안정) — 연결 상태 좋을 때 다시 눌러주세요`;
    showToast(okAll ? '이번 주 대상물 준비 완료' : '연결이 불안정해 일부만 받아졌습니다');
  } finally {
    btn.disabled = false; btn.textContent = '📥 이번 주 대상물 오프라인 준비(미리 받아두기)';
  }
}
$('prefetchWeekBtn').onclick = prefetchThisWeek;
async function startInspection(name){
  currentBuilding = name;
  ensureMasterDataFor(name); // [v37] 이름이 대상물 마스터 DB(203개)에 있으면 기준정보/설비목록/동층구조 자동 채움
  await uiPrefsReady;
  applyLocationOverrides(name);
  applyLocationRenames(name); // [v20] 저장된 동/층 오탈자 수정 이력을 반영한 뒤 화면을 그림
  applyStructureOverride(name); // [v44] 저장된 동/층 구조 전체 편집본이 있으면 최종적으로 그것으로 교체
  renderLocationSelectors();
  ensureInspectionSession(name); // [v31] 오늘 이미 골라둔 점검종류가 있으면 이어쓰고, 없으면 배지에서 선택 유도
  $('detailLocation').value=''; // [v21] 대상물이 바뀌면 상세위치도 초기화(다른 건물의 위치가 남아있으면 안 되므로)
  renderDefectChips();
  loadTags(); // [v14] 대상물이 바뀌면 그 대상물의 설치 설비 기준으로 사진대장 태그를 다시 계산
  renderConstructionEntries(); // [v27] 공사 사진대장도 대상물별로 구분되므로, 대상물이 바뀌면 다시 그림
  showToast(name + ' 점검 시작');
  // 예전엔 곧장 사진대장(photolog)으로 이동했는데, 이제 대상물만 정하고 어디로 갈지는
  // 4-block(빠른 전환) 화면에서 직접 고르도록 함. 여기서 고른 화면에서도 언제든 ⊞(빠른 전환)을
  // 다시 눌러 같은 4-block으로 돌아와 다른 아이콘으로 바꿔 이동할 수 있음.
  openQuickMenu();
}
$('customStartBtn').onclick = ()=>{
  const v = $('customBuildingInput').value.trim();
  if(!v){ showToast('대상물명을 입력해주세요'); return; }
  startInspection(v);
};
$('goConstructionBtn').onclick = ()=> goTo('photolog');

// [v37] 수기 일정 추가 — 일정관리 기능이 완성되기 전까지, 다음 주 점검 예정 대상물을
// "화정초등학교"처럼 홈 목록에 직접 등록해두고 매번 이름을 다시 입력하지 않게 함.
// 팀 공유 저장소(ui_prefs.customBuildings)에 저장되어 팀원 화면에도 함께 나타난다.
$('addScheduleBtn').onclick = ()=>{
  const f = $('addScheduleForm');
  f.style.display = (f.style.display==='none' ? 'block' : 'none');
};
$('cancelAddBuildingBtn').onclick = ()=>{
  $('addScheduleForm').style.display='none';
  $('newBuildingName').value=''; $('newBuildingDate').value='';
};
$('confirmAddBuildingBtn').onclick = ()=>{
  const name = $('newBuildingName').value.trim();
  const type = $('newBuildingType').value;
  const dateVal = $('newBuildingDate').value; // yyyy-mm-dd
  if(!name){ showToast('대상물명을 입력해주세요'); return; }
  const foundInDb = ensureMasterDataFor(name); // [v37] DB(203개)에 있는 이름이면 기준정보/설비목록 자동 연동
  let sub = type;
  if(dateVal){
    const parts = dateVal.split('-');
    sub += ` · ${parts[1]}-${parts[2]} 예정`;
  } else {
    sub += ' · 예정일 미정';
  }
  const id = 'cb_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
  uiPrefs.customBuildings = uiPrefs.customBuildings || {};
  uiPrefs.customBuildings[id] = { name, sub };
  saveUiPrefsDebounced();
  renderHome();
  $('newBuildingName').value=''; $('newBuildingDate').value='';
  $('addScheduleForm').style.display='none';
  showToast(foundInDb ? name + ' 일정 추가 (DB 정보 자동 연동됨)' : name + ' 일정 추가 (DB에 없어 설비목록은 임시 전체목록)');
};

