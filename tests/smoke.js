// 오르내림 캘린더 화면 점검
// 실행: node tests/smoke.js   (Playwright와 Chromium이 필요해요: npm i -g playwright && npx playwright install chromium)
// 외부 네트워크(Firebase, 글꼴, 날씨)는 막고, 테스트용 일정을 넣어 주요 화면이 오류 없이 열리는지 확인해요.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '..');
const types = {'.html':'text/html; charset=utf-8', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css',
  '.png':'image/png', '.jpeg':'image/jpeg', '.webp':'image/webp', '.webmanifest':'application/manifest+json'};

function serve() {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.join(root, pathname === '/' ? 'index.html' : pathname);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {'content-type': types[path.extname(file)] || 'application/octet-stream'});
    fs.createReadStream(file).pipe(response);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// 테스트용 일정 (오늘 기준 날짜로 만들어 언제 돌려도 같은 모양이 되게 함)
function seed() {
  const shift = days => {
    const date = new Date(today + 'T00:00:00');
    date.setDate(date.getDate() + days);
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  };
  const mk = (id, name, offset, status, category, extra = {}) => ({id, name, start: shift(offset), end: shift(offset), status, category,
    certificationType: 'classic', gear: [], certified: [], notice: '', ...extra});
  return [
    mk('p1', '북한산 백운대', 4, 'planned', 'club-hike', {region: '서울 강북', people: 6, host: '민지', type: '당일치기'}),
    mk('p2', '을지로 노포 먹벙', 8, 'planned', 'food', {region: '서울 중구'}),
    {...mk('p3', '지리산 1박', 17, 'planned', 'backpacking', {region: '경남 산청', type: '1박 2일'}), end: shift(18)},
    mk('p4', '한강 피크닉', 10, 'planned', 'play'),
    mk('d1', '가야산', -17, 'done', 'club-hike', {region: '경남 합천', certified: ['가야산']}),
    mk('d2', '관악산', -10, 'done', 'personal', {region: '서울 관악', certified: ['관악산'], notice: '공지',
      gear: [{label: '물', checked: true}, {label: '모자', checked: false}, {label: '장갑', checked: true}]}),
    mk('d3', '가야산', -40, 'done', 'personal', {region: '충남 예산', certified: ['가야산']}),
  ];
}

const results = [];
function check(name, ok, detail = '') {
  results.push({name, ok: Boolean(ok), detail});
}

// 보이는 드롭다운의 선택된 글자가 칸 안에 다 들어가는지
async function truncatedSelects(page, scope = 'body') {
  return page.evaluate(scope => {
    const canvas = document.createElement('canvas').getContext('2d');
    return [...document.querySelector(scope).querySelectorAll('select')].filter(select => select.offsetParent && select.selectedOptions[0])
      .filter(select => {
        const style = getComputedStyle(select);
        canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const text = canvas.measureText(select.selectedOptions[0].text).width;
        const room = select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        return text > room + 1;
      }).map(select => select.id || select.name || select.getAttribute('aria-label'));
  }, scope);
}

async function overflowX(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
}

async function run(browser, base, width) {
  const label = width + 'px';
  const page = await browser.newPage({viewport: {width, height: 900}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource|net::ERR/.test(message.text())) errors.push(message.text()); });
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => typeof render === 'function');
  await page.evaluate(`records = (${seed})(); render();`);

  // 탭 전환
  for (const menu of ['all', 'hike', 'food', 'play']) {
    await page.click(`[data-menu="${menu}"]`);
    const state = await page.evaluate(() => ({
      days: document.querySelectorAll('#calendar .day').length,
      upcoming: !document.querySelector('.upcoming').hidden && document.querySelector('#upcoming-schedule').textContent.trim().length > 0,
    }));
    check(`${label} ${menu} 탭: 달력과 다가오는 일정`, state.days >= 28 && state.upcoming, JSON.stringify(state));
    check(`${label} ${menu} 탭: 가로 넘침 없음`, await overflowX(page) <= 0, `${await overflowX(page)}px`);
    const cut = await truncatedSelects(page);
    check(`${label} ${menu} 탭: 드롭다운 글자 안 잘림`, !cut.length, cut.join(', '));
  }

  // 일정 목록 탭
  await page.click('[data-menu="hike"]');
  for (const view of ['planned', 'certified', 'done']) {
    await page.click(`[data-view="${view}"]`);
    const cards = await page.locator('#records .schedule-card').count();
    check(`${label} 산행 ${view} 목록`, cards > 0, `${cards}장`);
  }

  // 달력 날짜 누르기
  const day = await page.evaluate(() => document.querySelector('#calendar .day.has-event')?.dataset.day);
  if (day) {
    await page.click(`[data-day="${day}"]`);
    check(`${label} 달력 날짜 누르면 그날 일정`, await page.locator('#events .schedule-card:visible').count() > 0);
  }

  // 새 일정 창: 날짜 칸이 서로 겹치지 않음
  await page.click('#add');
  const dates = await page.evaluate(() => {
    const box = name => document.querySelector(`#form [name=${name}]`).getBoundingClientRect();
    const start = box('start'); const end = box('end'); const region = box('region');
    return {gap: end.left - start.right, height: Math.round(start.height), other: Math.round(region.height)};
  });
  check(`${label} 새 일정: 날짜 칸 안 겹침`, dates.gap >= 0 && Math.abs(dates.height - dates.other) <= 2, JSON.stringify(dates));
  check(`${label} 새 일정: 더보기 메뉴 숨김`, await page.evaluate(() => document.querySelector('#more-actions').hidden));
  const cut = await truncatedSelects(page, '#editor');
  check(`${label} 새 일정: 드롭다운 글자 안 잘림`, !cut.length, cut.join(', '));
  await page.evaluate(() => document.querySelector('#editor').close());

  // 완료한 일정 상세: 더보기 메뉴, 칸 요약
  await page.click('[data-view="done"]');
  await page.click('#records [data-record="d2"]');
  await page.waitForTimeout(100);
  const detail = await page.evaluate(() => ({
    more: !document.querySelector('#more-actions').hidden,
    gear: document.querySelector('#schedule-gear [data-section-meta]').textContent,
  }));
  check(`${label} 일정 상세: 더보기 메뉴 보임`, detail.more);
  check(`${label} 일정 상세: 준비물 요약 2/3`, detail.gear === '2/3', detail.gear);
  await page.click('#more-actions summary');
  check(`${label} 일정 상세: 더보기 열림`, await page.evaluate(() => document.querySelector('#more-actions').open));
  await page.click('#editor-title');
  check(`${label} 일정 상세: 바깥 누르면 더보기 닫힘`, !(await page.evaluate(() => document.querySelector('#more-actions').open)));
  await page.click('#more-actions summary');
  await page.keyboard.press('Escape');
  const esc = await page.evaluate(() => [document.querySelector('#more-actions').open, document.querySelector('#editor').open]);
  check(`${label} 일정 상세: Esc는 더보기만 닫음`, !esc[0] && esc[1], JSON.stringify(esc));
  await page.evaluate(() => document.querySelector('#editor').close());

  // 피드: 내 산행 기록
  await page.evaluate(() => { const tab = document.querySelector('#hike-feed-tab'); tab.hidden = false; tab.click(); });
  const feed = await page.evaluate(() => ({
    shown: !document.querySelector('#hike-records').hidden,
    peaks: document.querySelector('.record-peaks-toggle')?.textContent,
    stamps: document.querySelectorAll('.record-stamps li').length,
  }));
  check(`${label} 피드: 산행 기록 보임`, feed.shown, JSON.stringify(feed));
  check(`${label} 피드: 같은 이름 다른 산 구분 (가야산 2곳 + 관악산)`, feed.peaks === '다녀온 산 3곳', feed.peaks);
  check(`${label} 피드: 가로 넘침 없음`, await overflowX(page) <= 0);

  // 지난 일정 완료 처리 안내
  await page.click('[data-menu="all"]');
  await page.evaluate(() => { records.push({...records[0], id: 'past1', name: '지난 산행', start: '2020-05-05', end: '2020-05-05', status: 'planned'}); render(); });
  const pastShown = await page.evaluate(() => !document.querySelector('#past-planned').hidden && document.querySelector('#past-planned').textContent.includes('지난 일정 1개'));
  check(`${label} 지난 일정 안내 보임`, pastShown);
  await page.click('[data-past-toggle]');
  await page.click('[data-past-done="past1"]');
  await page.waitForTimeout(100);
  const past = await page.evaluate(() => ({status: records.find(r => r.id === 'past1').status, hidden: document.querySelector('#past-planned').hidden}));
  check(`${label} 지난 일정 '다녀왔어요'로 완료`, past.status === 'done' && past.hidden, JSON.stringify(past));

  // 로그인 흉내: 닉네임 창
  await page.evaluate(() => {
    sync = {
      observeProfile: (uid, callback) => { setTimeout(() => callback({}), 0); return () => {}; },
      saveProfile: async () => {}, observeGearSets: () => () => {}, saveGearSets: async () => {},
      observeSchedules: (uid, callback) => { setTimeout(() => callback([], false), 0); return () => {}; },
      // 짧은 공유 링크용 저장소 흉내
      shares: {}, failShare: false,
      async createShare(uid, payload) { if (this.failShare) throw new Error('permission-denied'); const id = 'Ab3' + Math.random().toString(36).slice(2, 9).padEnd(7, 'x'); this.shares[id] = payload; return id; },
      async getShare(id) { return this.shares[id] || null; },
      async saveSchedule(uid, record) { this.saved = record; },
    };
    try { localStorage.clear(); } catch {}
    changeAccount({uid: 'smoke', email: 'smoke@example.com'});
  });
  await page.waitForTimeout(100);
  check(`${label} 로그인: 닉네임 창 뜸`, await page.evaluate(() => document.querySelector('#nickname-dialog').open));
  await page.fill('#nickname-input', '점검용');
  await page.click('#nickname-form button[type=submit]');
  check(`${label} 로그인: 닉네임 표시`, (await page.textContent('#nickname-edit')) === '점검용님');

  // 공유: 로그인 상태면 짧은 링크, 받는 쪽은 서버에서 불러와 제목에 닉네임 표시
  const makeLink = () => page.evaluate(async () => {
    showScheduleShare('send', cleanSharedSchedule({id: 'x', name: '북한산(백운대)!', start: '2030-01-01', end: '2030-01-01', category: 'club-hike', gear: []}));
    const note = document.querySelector('#schedule-share-note').textContent;
    document.querySelector('#schedule-share-copy').click();
    for (let i = 0; i < 40 && !document.querySelector('#schedule-share-url').value; i++) await new Promise(resolve => setTimeout(resolve, 25));
    const url = document.querySelector('#schedule-share-url').value;
    document.querySelector('#schedule-share-dialog').close();
    return {note, url};
  });
  const openLink = async url => {
    await page.evaluate(hash => { location.hash = hash; }, url.slice(url.indexOf('#')));
    await page.waitForTimeout(150);
    const title = await page.textContent('#schedule-share-title');
    const name = await page.evaluate(() => document.querySelector('.share-title')?.textContent || '');
    await page.evaluate(() => { document.querySelector('#schedule-share-dialog').close(); history.replaceState(null, '', location.pathname); });
    return {title, name};
  };
  const shared = await page.evaluate(async () => {
    window.sharedArgs = null;
    navigator.share = async args => { window.sharedArgs = args; };
    showScheduleShare('send', cleanSharedSchedule({id: 'x', name: '팔봉산', start: '2030-12-07', end: '2030-12-07', category: 'club-hike', gear: []}));
    const visible = !document.querySelector('#schedule-share-send').hidden;
    await new Promise(resolve => setTimeout(resolve, 50));
    document.querySelector('#schedule-share-send').click();
    for (let i = 0; i < 40 && !window.sharedArgs; i++) await new Promise(resolve => setTimeout(resolve, 25));
    document.querySelector('#schedule-share-dialog').close();
    return {visible, args: window.sharedArgs};
  });
  check(`${label} 공유: 카톡 등으로 보내기 버튼`, shared.visible);
  check(`${label} 공유: 보내는 메시지에 닉네임·일정·짧은 링크`, shared.args?.text?.startsWith('점검용님이 일정을 공유했어요') && shared.args.text.includes('팔봉산') && /#s=[A-Za-z0-9]{10}$/.test(shared.args.url || ''), JSON.stringify(shared.args));
  // 같은 일정을 다시 공유하면 받은 쪽은 업데이트
  const update = await page.evaluate(async () => {
    const source = '11111111-2222-4333-8444-555555555555';
    const base = {name: '팔봉산', start: '2030-12-05', end: '2030-12-06', category: 'club-hike', meetingTime: '08:30', gear: [{label: '물'}, {label: '아이젠'}]};
    const first = await buildShareLink(cleanSharedSchedule(base), source);
    const second = await buildShareLink(cleanSharedSchedule({...base, meetingTime: '08:00'}), source);
    const idOf = link => sync.shares[link.slice(link.indexOf('#s=') + 3)].id;
    const sameId = idOf(first) === idOf(second);
    records = [{...blank(), ...cleanSharedSchedule(base), id: 'shared-' + source, status: 'done', certified: ['팔봉산'],
      gear: [{label: '물', checked: true}, {label: '아이젠', checked: false}]}];
    cloudReady = true;
    showScheduleShare('receive', sharedScheduleFrom(sync.shares[second.slice(second.indexOf('#s=') + 3)]));
    const button = document.querySelector('#schedule-share-save');
    const before = {text: button.textContent, disabled: button.disabled, diff: document.querySelector('#schedule-share-diff').textContent};
    button.click();
    await new Promise(resolve => setTimeout(resolve, 50));
    const saved = sync.saved;
    showScheduleShare('receive', sharedScheduleFrom(sync.shares[second.slice(second.indexOf('#s=') + 3)]));
    const after = {text: button.textContent, disabled: button.disabled};
    document.querySelector('#schedule-share-dialog').close();
    records = [];
    return {sameId, before, saved: saved && {time: saved.meetingTime, status: saved.status, certified: saved.certified, gear: saved.gear}, after};
  });
  check(`${label} 공유: 같은 일정은 다시 공유해도 같은 번호`, update.sameId);
  check(`${label} 공유: 이미 담은 일정이면 업데이트 버튼과 바뀐 내용`, update.before.text === '바뀐 내용으로 업데이트' && !update.before.disabled && update.before.diff.includes('집결 시간') && update.before.diff.includes('08:00'), JSON.stringify(update.before));
  check(`${label} 공유: 업데이트해도 내 완료·인증·준비물 체크 유지`, update.saved?.time === '08:00' && update.saved.status === 'done' && update.saved.certified[0] === '팔봉산' && update.saved.gear[0].checked === true, JSON.stringify(update.saved));
  check(`${label} 공유: 최신이면 버튼 비활성`, update.after.text === '이미 담은 최신 일정이에요' && update.after.disabled, JSON.stringify(update.after));
  const short = await makeLink();
  check(`${label} 공유: 로그인하면 짧은 링크`, /#s=[A-Za-z0-9]{10}$/.test(short.url), short.url.slice(-30));
  check(`${label} 공유: 보내는 창에 닉네임 안내`, short.note.includes('점검용'), short.note);
  const shortOpen = await openLink(short.url);
  check(`${label} 공유: 짧은 링크 열면 제목에 닉네임`, shortOpen.title === '점검용님이 공유한 일정' && shortOpen.name === '북한산(백운대)!', JSON.stringify(shortOpen));
  await page.evaluate(() => { sync.failShare = true; });
  const fallback = await makeLink();
  check(`${label} 공유: 서버 저장 실패하면 긴 링크`, /#s=[A-Za-z0-9_-]{40,}$/.test(fallback.url), fallback.url.slice(-30));
  const fallbackOpen = await openLink(fallback.url);
  check(`${label} 공유: 긴 링크도 열림`, fallbackOpen.title === '점검용님이 공유한 일정', fallbackOpen.title);
  const missing = await page.evaluate(async () => { location.hash = '#s=Zz9Zz9Zz9Z'; await new Promise(r => setTimeout(r, 150)); const t = document.querySelector('#schedule-share-status').textContent; document.querySelector('#schedule-share-dialog').close(); history.replaceState(null, '', location.pathname); return t; });
  check(`${label} 공유: 없는 짧은 링크 안내`, missing.includes('찾을 수 없어요'), missing);

  // 어두운 화면
  await page.evaluate(() => changeAccount(null));
  await page.click('#color-toggle');
  await page.click('[data-menu="all"]');
  check(`${label} 어두운 화면 전환`, await page.evaluate(() => document.documentElement.dataset.color === 'dark'));

  check(`${label} 스크립트 오류 없음`, !errors.length, errors.join(' | '));
  await page.close();
}

// 카카오톡 안에서 공유 링크 열기: Safari로 바로 여는 버튼
async function kakao(browser, base) {
  const context = await browser.newContext({viewport: {width: 390, height: 844},
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.8.0'});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => typeof encodeScheduleShare === 'function');
  const hash = await page.evaluate(() => '#s=' + encodeScheduleShare(cleanSharedSchedule({id: 'x', name: '팔봉산', start: '2030-12-05', end: '2030-12-06', category: 'club-hike', gear: []}), crypto.randomUUID(), '뚜기'));
  await page.goto(base + '/' + hash);
  await page.waitForTimeout(300);
  await page.evaluate(() => { sync = sync || {}; updateScheduleShare(); });
  const state = await page.evaluate(() => {
    const link = document.querySelector('#share-login-help .external-open');
    return {title: document.querySelector('#schedule-share-title').textContent, shown: link && !link.hidden && !document.querySelector('#share-login-help').hidden,
      text: link?.textContent, href: link?.getAttribute('href') || ''};
  });
  check('카카오톡: 공유 창 제목', state.title === '뚜기님이 공유한 일정', state.title);
  check('카카오톡: Safari로 열기 버튼', state.shown && state.text === 'Safari로 열기', JSON.stringify(state));
  check('카카오톡: 바깥 브라우저 주소에 공유 링크 그대로', decodeURIComponent(state.href.split('url=')[1] || '').endsWith(hash), state.href.slice(0, 80));
  check('카카오톡: 스크립트 오류 없음', !errors.length, errors.join(' | '));
  await context.close();
}

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1280]) await run(browser, base, width);
    await kakao(browser, base);
  } catch (error) {
    check('점검 실행', false, error.message.split('\n')[0]);
  } finally {
    await browser.close();
    server.close();
  }
  for (const {name, ok, detail} of results) console.log(`${ok ? '✓' : '✗'} ${name}${!ok && detail ? '  → ' + detail : ''}`);
  const failed = results.filter(result => !result.ok).length;
  console.log(`\n${results.length - failed}/${results.length} 통과`);
  process.exitCode = failed ? 1 : 0;
})();
