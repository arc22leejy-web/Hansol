/**
 * 인하대학교 X 한솔아카데미 동계특강 신청 → 구글 시트 저장
 *
 * [설정 방법]
 * 1. 구글 시트를 새로 만들고, 메뉴에서 확장 프로그램 → Apps Script 를 엽니다.
 * 2. 기본으로 있는 코드를 지우고 이 파일 내용을 전부 붙여넣은 뒤 저장합니다.
 * 3. 위쪽 함수 목록에서 setup 을 고르고 ▶실행 → 권한 허용. ("신청목록" 시트와 머리글이 만들어집니다)
 * 4. 오른쪽 위 배포 → 새 배포 → 유형: 웹 앱
 *      - 실행 계정: 나
 *      - 액세스 권한: 모든 사용자
 *    배포 후 나오는 웹 앱 URL(…/exec)을 복사합니다.
 * 5. index.html 의 SHEET_ENDPOINT = "" 따옴표 안에 그 URL을 붙여넣습니다.
 *
 * ※ 이 코드를 고친 뒤에는 배포 → 배포 관리 → 수정(연필) → 버전: 새 버전 으로 다시 배포해야 반영됩니다.
 * ※ 가격을 바꾸면 index.html 의 가격표와 아래 PRICES 를 둘 다 고쳐 주세요. (시트 금액은 아래 표 기준으로 계산됩니다)
 */

var SHEET_NAME = '신청목록';
var HEADERS = ['신청일시', '이름', '생년월일', '연락처', '한솔 아이디',
  '건축기사', '건축설비기사', '건설안전기사', '산업안전기사',
  '정가 합계', '결제 금액', '할인액', '배송 필요',
  '우편번호', '주소', '상세주소', '중복 의심', '입금 확인'];

// [정가, 할인가] · w=필기, p=실기, both=필/실기 패키지
var SUBJECT_ORDER = ['arch', 'equip', 'csafe', 'isafe'];
var PRICES = {
  arch: {
    offline: { both: [825000, 500000], w: [480000, 300000], p: [345000, 200000] },
    online:  { both: [520100, 410000], w: [401500, 210000], p: [307700, 200000] },
    book:    { w: [135000, 108000], p: [53000, 42400] }
  },
  equip: {
    online:  { both: [454500, 386325], w: [292300, 248455], p: [273100, 232135] },
    book:    { w: [47000, 37600], p: [59000, 47200] }
  },
  csafe: {
    online:  { both: [403000, 342550], w: [235600, 200260], p: [197400, 167790] },
    book:    { w: [84000, 67200], p: [86000, 68800] }
  },
  isafe: {
    online:  { both: [403900, 343315], w: [236500, 201025], p: [197400, 167790] },
    book:    { w: [85000, 68000], p: [86000, 68800] }
  }
};
var MODE_LABEL = { offline: '오프라인', online: '온라인', book: '교재' };
var SCOPE_LABEL = { both: '필/실기', w: '필기', p: '실기' };

/** 선택 내용을 검증하고 금액을 계산합니다. (금액은 신청자가 보낸 값이 아니라 여기서 다시 계산)
 *  items[과목] = { w: 필기 형태, p: 실기 형태 } · 형태는 none | offline | online | book */
function computeOrder(items) {
  var out = { labels: {}, list: 0, sale: 0, ship: false, count: 0 };
  SUBJECT_ORDER.forEach(function (id) {
    var it = items && items[id];
    if (!it) return;
    var w = it.w || 'none', p = it.p || 'none';
    [w, p].forEach(function (m, i) {
      if (m !== 'none' && !(PRICES[id][m] && PRICES[id][m][i ? 'p' : 'w'])) throw new Error('선택할 수 없는 항목이 포함되어 있습니다.');
    });
    if (w === 'none' && p === 'none') return;
    if ((w === 'offline' && p === 'online') || (w === 'online' && p === 'offline')) throw new Error('한 과목에서 오프라인과 온라인은 함께 신청할 수 없습니다.');
    var label;
    if (w === p && (w === 'offline' || w === 'online')) {   // 같은 강의 형태로 필기+실기 → 패키지 가격
      var t = PRICES[id][w].both;
      out.list += t[0]; out.sale += t[1];
      label = MODE_LABEL[w] + ' 필/실기';
    } else {
      var parts = [];
      [['w', w], ['p', p]].forEach(function (x) {
        if (x[1] === 'none') return;
        var price = PRICES[id][x[1]][x[0]];
        out.list += price[0]; out.sale += price[1];
        parts.push(SCOPE_LABEL[x[0]] + ' ' + MODE_LABEL[x[1]]);
      });
      label = parts.join(' + ');
    }
    if ((w !== 'none' && w !== 'offline') || (p !== 'none' && p !== 'offline')) out.ship = true;  // 온라인·교재는 택배
    out.labels[id] = label;
    out.count++;
  });
  return out;
}

function clean(v, max) {
  var s = String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
  return /^[=+\-@]/.test(s) ? "'" + s : s;            // 수식으로 해석되지 않게
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var d = JSON.parse(e.postData.contents);
    if (d.website) return json({ ok: true });         // 자동 입력 봇 차단용 숨은 칸

    var name = clean(d.name, 20), birth = clean(d.birth, 10), phone = clean(d.phone, 13), hid = clean(d.hansolId, 40);
    if (name.length < 2) throw new Error('이름을 확인해 주세요.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) throw new Error('생년월일을 확인해 주세요.');
    if (!/^01\d-\d{3,4}-\d{4}$/.test(phone)) throw new Error('연락처를 확인해 주세요.');
    if (hid.length < 2) throw new Error('한솔아카데미 아이디를 확인해 주세요.');
    if (d.consent !== true) throw new Error('개인정보 수집 · 이용 동의가 필요합니다.');

    var order = computeOrder(d.items);
    if (!order.count) throw new Error('신청할 강의 또는 교재를 선택해 주세요.');

    // 주소는 신청 형태와 관계없이 모두 받습니다.
    var zip = clean(d.zip, 5), addr = clean(d.addr, 120), addr2 = clean(d.addr2, 80);
    if (!/^\d{5}$/.test(zip) || addr.length < 5) throw new Error('주소를 확인해 주세요.');

    lock.waitLock(20000);
    var sheet = getSheet();
    var last = sheet.getLastRow();
    var dup = '';
    if (last > 1) {
      var rows = sheet.getRange(2, 2, last - 1, 3).getValues();   // 이름, 생년월일, 연락처
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i][0]).trim() === name && String(rows[i][2]).trim() === phone) { dup = '중복 의심'; break; }
      }
    }
    var row = [
      Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'),
      name, birth, phone, hid,
      order.labels.arch || '', order.labels.equip || '', order.labels.csafe || '', order.labels.isafe || '',
      order.list, order.sale, order.list - order.sale,
      order.ship ? '필요' : '불필요',
      zip, addr, addr2, dup, false
    ];
    var r = last + 1;
    sheet.getRange(r, 1, 1, 9).setNumberFormat('@');
    sheet.getRange(r, 13, 1, 5).setNumberFormat('@');
    sheet.getRange(r, 10, 1, 3).setNumberFormat('#,##0');
    sheet.getRange(r, 1, 1, row.length).setValues([row]);
    sheet.getRange(r, 18).insertCheckboxes();
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function doGet() {
  return json({ ok: true, message: '신청 접수 주소가 정상 동작 중입니다.' });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
      .setFontWeight('bold').setBackground('#12306e').setFontColor('#ffffff').setHorizontalAlignment('center');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 150); sheet.setColumnWidth(4, 120);
    sheet.setColumnWidths(6, 4, 140); sheet.setColumnWidth(15, 280); sheet.setColumnWidth(16, 160);
  }
  return sheet;
}

/** 처음 한 번 실행: 시트와 머리글을 만듭니다. */
function setup() {
  getSheet();
}
