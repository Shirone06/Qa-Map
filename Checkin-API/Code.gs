/****************************************************************
 * ระบบเช็คอินพนักงานนอกสถานที่ — Google Apps Script (API เท่านั้น)
 *
 * สคริปต์นี้ทำหน้าที่เป็น "API" อย่างเดียว ไม่ได้ serve หน้าเว็บ
 * หน้าเว็บอยู่บน GitHub Pages (โฟลเดอร์ docs/) เพื่อให้ GPS ทำงานได้
 * เต็มที่ — ไม่ติดข้อจำกัด iframe ของ Apps Script Web App
 *
 * วิธีติดตั้ง: ดู README.md ในโฟลเดอร์เดียวกัน
 ****************************************************************/

// ===================== ตั้งค่า =====================

/** ไอดีของ Google Sheet — เว้นว่างไว้แล้วรัน setup() ระบบจะสร้างให้ใหม่ */
var SPREADSHEET_ID = '';

/** รหัสผ่านสำหรับหน้า Dashboard และหน้าจัดการหน่วยงาน (เปลี่ยนก่อนใช้จริง!) */
var ADMIN_PIN = 'admin1234';

/** โฟลเดอร์ Drive เก็บรูป — เว้นว่างไว้ ระบบจะสร้าง/หาโฟลเดอร์ชื่อด้านล่างให้เอง */
var PHOTO_FOLDER_ID   = '';
var PHOTO_FOLDER_NAME = 'เช็คอินพนักงาน - รูปภาพ';

/** ความแม่นยำ GPS ที่ยอมรับได้ (เมตร) — ค่าที่แย่กว่านี้จะไม่รับเช็คอิน */
var MAX_ACCURACY_M = 150;

/** รัศมีเริ่มต้น (เมตร) เมื่อไม่ได้ระบุในแท็บ Locations */
var DEFAULT_RADIUS_M = 200;

/**
 * โหมดตรวจพื้นที่
 *   'strict'   = ต้อง (ระยะห่าง <= รัศมี) เท่านั้น
 *   'tolerant' = ผ่อนผันด้วยค่าความคลาดเคลื่อน GPS: (ระยะห่าง - ความแม่นยำ) <= รัศมี
 * ถ้าพนักงานบ่นว่าอยู่หน้างานจริงแต่เช็คอินไม่ได้ ให้ลองเปลี่ยนเป็น 'tolerant'
 */
var GEOFENCE_MODE = 'strict';

var TZ = 'Asia/Bangkok';

// ชื่อแท็บ
var SH_EMP = 'Employees';
var SH_LOC = 'Locations';
var SH_LOG = 'CheckLog';

// หัวคอลัมน์ (ลำดับสลับได้ ระบบอ่านจากชื่อหัวคอลัมน์)
var HEAD_EMP = ['รหัสพนักงาน', 'ชื่อ-นามสกุล', 'ตำแหน่ง', 'สถานะ'];
var HEAD_LOC = ['รหัสหน่วยงาน', 'ชื่อหน่วยงาน', 'ละติจูด', 'ลองจิจูด', 'รัศมี(ม.)', 'ที่อยู่/หมายเหตุ', 'สถานะ'];
var HEAD_LOG = [
  'Log ID', 'วันที่', 'รหัสพนักงาน', 'ชื่อพนักงาน', 'รหัสหน่วยงาน', 'หน่วยงาน',
  'เวลาเข้า', 'ละติจูดเข้า', 'ลองจิจูดเข้า', 'ความแม่นยำเข้า(ม.)', 'ระยะห่างเข้า(ม.)', 'รูปเช็คอิน',
  'เวลาออก', 'ละติจูดออก', 'ลองจิจูดออก', 'ความแม่นยำออก(ม.)', 'ระยะห่างออก(ม.)', 'รูปเช็คเอาท์',
  'ระยะเวลา(นาที)', 'หมายเหตุ', 'สถานะ', 'เข้าเมื่อ', 'ออกเมื่อ'
];

var ST_OPEN = 'กำลังปฏิบัติงาน';
var ST_DONE = 'เสร็จสิ้น';


// ===================== จุดรับ request =====================

/**
 * อ่านข้อมูล (GET) — รองรับ JSONP ผ่านพารามิเตอร์ callback
 * เหตุที่ใช้ JSONP: หน้าเว็บอยู่คนละโดเมน (GitHub Pages) การอ่านผ่าน JSONP
 * ทำงานได้ทุกเบราว์เซอร์โดยไม่ต้องพึ่ง CORS
 */
function doGet(e) {
  var p  = (e && e.parameter) || {};
  var cb = p.callback || '';
  try {
    return jsonOut_(route_(p.action, p, null), cb);
  } catch (err) {
    return jsonOut_({ ok: false, error: err.message }, cb);
  }
}

/**
 * เขียนข้อมูล (POST) — body เป็น JSON ส่งมาแบบ Content-Type: text/plain
 * เพื่อให้เป็น "simple request" ไม่ต้องมี CORS preflight
 */
function doPost(e) {
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) body = JSON.parse(e.postData.contents);
    return jsonOut_(route_(body.action, body, body), '');
  } catch (err) {
    return jsonOut_({ ok: false, error: err.message }, '');
  }
}

/** แจกงานตาม action */
function route_(action, p, body) {
  switch (action) {
    case 'ping':        return { ok: true, time: nowStr_('dd/MM/yyyy HH:mm:ss'), mode: GEOFENCE_MODE };
    case 'bootstrap':   return apiBootstrap_(p.code);
    case 'locations':   return { ok: true, locations: readLocations_(true) };
    case 'checkin':     return apiCheckin_(body);
    case 'checkout':    return apiCheckout_(body);
    case 'dashboard':   return apiDashboard_(p);
    case 'adminLoad':   return apiAdminLoad_(p);
    case 'adminSaveLocation':   return apiAdminSaveLocation_(body);
    case 'adminDeleteLocation': return apiAdminDeleteLocation_(body);
    case 'adminSaveEmployee':   return apiAdminSaveEmployee_(body);
    default: throw new Error('ไม่รู้จักคำสั่ง: ' + (action || '(ว่าง)'));
  }
}

function jsonOut_(obj, callback) {
  var text = JSON.stringify(obj);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + text + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(text)
    .setMimeType(ContentService.MimeType.JSON);
}


// ===================== API: พนักงาน =====================

/**
 * เปิดแอพครั้งแรก / ใส่รหัสพนักงาน
 * คืน: ข้อมูลพนักงาน + รายชื่อหน่วยงาน + รายการที่ยังเช็คอินค้างอยู่
 */
function apiBootstrap_(code) {
  code = normCode_(code);
  if (!code) throw new Error('กรุณากรอกรหัสพนักงาน');

  var emp = findEmployee_(code);
  if (!emp)             throw new Error('ไม่พบรหัสพนักงาน "' + code + '" ในระบบ');
  if (!emp.active)      throw new Error('รหัสพนักงาน "' + code + '" ถูกระงับการใช้งาน');

  return {
    ok: true,
    employee:  emp,
    locations: readLocations_(true),
    open:      findOpenLogs_(code),
    config:    { maxAccuracy: MAX_ACCURACY_M, mode: GEOFENCE_MODE }
  };
}

/** เช็คอิน — ตรวจพื้นที่ฝั่งเซิร์ฟเวอร์อีกชั้น (กันแก้ไขฝั่งหน้าเว็บ) */
function apiCheckin_(d) {
  d = d || {};
  var emp = requireEmployee_(d.empCode);
  var loc = requireLocation_(d.locationId);
  var fix = requireFix_(d);

  if (!d.photo || !d.photo.data) throw new Error('กรุณาแนบรูปถ่ายตอนเช็คอิน');

  // กันเช็คอินซ้ำที่เดิมทั้งที่ยังไม่ได้เช็คเอาท์
  var open = findOpenLogs_(emp.code);
  for (var i = 0; i < open.length; i++) {
    if (open[i].locationId === loc.id) {
      throw new Error('คุณเช็คอินที่ "' + loc.name + '" ค้างไว้อยู่แล้ว (เวลา ' + open[i].timeIn + ') กรุณาเช็คเอาท์ก่อน');
    }
  }

  var judge = judgeFence_(fix, loc);
  if (!judge.inside) {
    throw new Error('คุณอยู่ห่างจาก "' + loc.name + '" ประมาณ ' + fmtDist_(judge.distance) +
                    ' (อนุญาตไม่เกิน ' + loc.radius + ' ม.) จึงยังเช็คอินไม่ได้');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet_(SH_LOG);
    var idx   = headerIndex_(sheet, HEAD_LOG);
    var now   = new Date();
    var logId = nextLogId_(sheet, idx, now);

    var photoUrl = savePhoto_(d.photo, logId + '_IN');

    var row = new Array(sheet.getLastColumn() || HEAD_LOG.length).fill('');
    put_(row, idx, 'Log ID',            logId);
    put_(row, idx, 'วันที่',             fmt_(now, 'dd/MM/yyyy'));
    put_(row, idx, 'รหัสพนักงาน',        emp.code);
    put_(row, idx, 'ชื่อพนักงาน',        emp.name);
    put_(row, idx, 'รหัสหน่วยงาน',       loc.id);
    put_(row, idx, 'หน่วยงาน',          loc.name);
    put_(row, idx, 'เวลาเข้า',           fmt_(now, 'HH:mm'));
    put_(row, idx, 'ละติจูดเข้า',        fix.lat);
    put_(row, idx, 'ลองจิจูดเข้า',       fix.lng);
    put_(row, idx, 'ความแม่นยำเข้า(ม.)', Math.round(fix.accuracy));
    put_(row, idx, 'ระยะห่างเข้า(ม.)',   Math.round(judge.distance));
    put_(row, idx, 'รูปเช็คอิน',         photoUrl);
    put_(row, idx, 'หมายเหตุ',           String(d.note || '').trim());
    put_(row, idx, 'สถานะ',              ST_OPEN);
    put_(row, idx, 'เข้าเมื่อ',           now.toISOString());

    sheet.appendRow(row);

    return {
      ok: true, logId: logId, timeIn: fmt_(now, 'HH:mm'), date: fmt_(now, 'dd/MM/yyyy'),
      location: loc.name, distance: Math.round(judge.distance), photo: photoUrl
    };
  } finally {
    lock.releaseLock();
  }
}

/** เช็คเอาท์ — ไม่บังคับว่าต้องอยู่ในรัศมี และไม่บังคับแนบรูป แต่บันทึกพิกัดไว้เสมอ */
function apiCheckout_(d) {
  d = d || {};
  var emp = requireEmployee_(d.empCode);
  if (!d.logId) throw new Error('ไม่พบรายการที่ต้องการเช็คเอาท์');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet_(SH_LOG);
    var idx   = headerIndex_(sheet, HEAD_LOG);
    var found = findLogRow_(sheet, idx, d.logId);
    if (!found)                              throw new Error('ไม่พบรายการ ' + d.logId);
    if (get_(found.row, idx, 'รหัสพนักงาน') !== emp.code) throw new Error('รายการนี้ไม่ใช่ของคุณ');
    if (get_(found.row, idx, 'เวลาออก'))     throw new Error('รายการนี้เช็คเอาท์ไปแล้ว');

    var now = new Date();
    var row = found.row;

    // พิกัดตอนออก: มีก็บันทึก ไม่มีก็ผ่านได้ (บางที่สัญญาณไม่ถึง)
    if (isNum_(d.lat) && isNum_(d.lng)) {
      var loc = findLocation_(get_(row, idx, 'รหัสหน่วยงาน'));
      put_(row, idx, 'ละติจูดออก',        Number(d.lat));
      put_(row, idx, 'ลองจิจูดออก',       Number(d.lng));
      put_(row, idx, 'ความแม่นยำออก(ม.)', isNum_(d.accuracy) ? Math.round(d.accuracy) : '');
      if (loc) {
        put_(row, idx, 'ระยะห่างออก(ม.)',
             Math.round(haversine_(Number(d.lat), Number(d.lng), loc.lat, loc.lng)));
      }
    }

    if (d.photo && d.photo.data) {
      put_(row, idx, 'รูปเช็คเอาท์', savePhoto_(d.photo, get_(row, idx, 'Log ID') + '_OUT'));
    }

    var startIso = get_(row, idx, 'เข้าเมื่อ');
    var minutes  = '';
    if (startIso) {
      var start = new Date(startIso);
      if (!isNaN(start.getTime())) minutes = Math.round((now - start) / 60000);
    }

    var note = String(d.note || '').trim();
    if (note) {
      var old = get_(row, idx, 'หมายเหตุ');
      put_(row, idx, 'หมายเหตุ', old ? (old + ' | ' + note) : note);
    }

    put_(row, idx, 'เวลาออก',        fmt_(now, 'HH:mm'));
    put_(row, idx, 'ระยะเวลา(นาที)', minutes);
    put_(row, idx, 'สถานะ',          ST_DONE);
    put_(row, idx, 'ออกเมื่อ',        now.toISOString());

    sheet.getRange(found.rowNum, 1, 1, row.length).setValues([row]);

    return {
      ok: true, logId: d.logId, timeOut: fmt_(now, 'HH:mm'),
      minutes: minutes, duration: fmtDur_(minutes)
    };
  } finally {
    lock.releaseLock();
  }
}


// ===================== API: หัวหน้า / แอดมิน =====================

/** ข้อมูลสำหรับหน้า Dashboard */
function apiDashboard_(p) {
  requirePin_(p && p.pin);

  var sheet = getSheet_(SH_LOG);
  var idx   = headerIndex_(sheet, HEAD_LOG);
  var last  = sheet.getLastRow();
  var rows  = [];

  if (last > 1) {
    var values = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
    var from = p.from || '';   // yyyy-MM-dd
    var to   = p.to   || '';

    for (var i = 0; i < values.length; i++) {
      var r = values[i];
      var logId = get_(r, idx, 'Log ID');
      if (!logId) continue;

      var iso  = String(get_(r, idx, 'เข้าเมื่อ') || '');
      var day  = iso ? iso.substring(0, 10) : isoFromThaiDate_(get_(r, idx, 'วันที่'));
      if (from && day && day < from) continue;
      if (to   && day && day > to)   continue;

      rows.push({
        logId:       logId,
        day:         day,
        date:        String(get_(r, idx, 'วันที่')),
        empCode:     String(get_(r, idx, 'รหัสพนักงาน')),
        empName:     String(get_(r, idx, 'ชื่อพนักงาน')),
        locationId:  String(get_(r, idx, 'รหัสหน่วยงาน')),
        location:    String(get_(r, idx, 'หน่วยงาน')),
        timeIn:      String(get_(r, idx, 'เวลาเข้า')),
        latIn:       numOrNull_(get_(r, idx, 'ละติจูดเข้า')),
        lngIn:       numOrNull_(get_(r, idx, 'ลองจิจูดเข้า')),
        accIn:       numOrNull_(get_(r, idx, 'ความแม่นยำเข้า(ม.)')),
        distIn:      numOrNull_(get_(r, idx, 'ระยะห่างเข้า(ม.)')),
        photoIn:     String(get_(r, idx, 'รูปเช็คอิน')),
        timeOut:     String(get_(r, idx, 'เวลาออก')),
        latOut:      numOrNull_(get_(r, idx, 'ละติจูดออก')),
        lngOut:      numOrNull_(get_(r, idx, 'ลองจิจูดออก')),
        distOut:     numOrNull_(get_(r, idx, 'ระยะห่างออก(ม.)')),
        photoOut:    String(get_(r, idx, 'รูปเช็คเอาท์')),
        minutes:     numOrNull_(get_(r, idx, 'ระยะเวลา(นาที)')),
        note:        String(get_(r, idx, 'หมายเหตุ')),
        status:      String(get_(r, idx, 'สถานะ')),
        startIso:    iso
      });
    }
  }

  rows.sort(function (a, b) { return (b.startIso || '').localeCompare(a.startIso || ''); });

  return {
    ok: true,
    rows: rows,
    locations: readLocations_(false),
    employees: readEmployees_(),
    today: nowStr_('yyyy-MM-dd'),
    fetchedAt: nowStr_('dd/MM/yyyy HH:mm:ss')
  };
}

/** ข้อมูลสำหรับหน้าจัดการหน่วยงาน/พนักงาน */
function apiAdminLoad_(p) {
  requirePin_(p && p.pin);
  return { ok: true, locations: readLocations_(false), employees: readEmployees_() };
}

/** เพิ่ม/แก้ไขหน่วยงาน (ปักหมุดจากแผนที่) */
function apiAdminSaveLocation_(d) {
  requirePin_(d && d.pin);
  var loc = (d && d.location) || {};
  var name = String(loc.name || '').trim();
  if (!name)                        throw new Error('กรุณากรอกชื่อหน่วยงาน');
  if (!isNum_(loc.lat) || !isNum_(loc.lng)) throw new Error('กรุณาปักหมุดตำแหน่งบนแผนที่');

  var radius = isNum_(loc.radius) ? Math.round(Number(loc.radius)) : DEFAULT_RADIUS_M;
  if (radius < 20)    radius = 20;
  if (radius > 20000) radius = 20000;

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet_(SH_LOC);
    var idx   = headerIndex_(sheet, HEAD_LOC);
    var last  = sheet.getLastRow();
    var id    = String(loc.id || '').trim();
    var rowNum = 0;

    if (id && last > 1) {
      var ids = sheet.getRange(2, idx['รหัสหน่วยงาน'] + 1, last - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]).trim() === id) { rowNum = i + 2; break; }
      }
    }
    if (!id) id = nextLocId_(sheet, idx);

    var row = new Array(sheet.getLastColumn() || HEAD_LOC.length).fill('');
    if (rowNum) row = sheet.getRange(rowNum, 1, 1, row.length).getValues()[0];

    put_(row, idx, 'รหัสหน่วยงาน',    id);
    put_(row, idx, 'ชื่อหน่วยงาน',     name);
    put_(row, idx, 'ละติจูด',         Number(loc.lat));
    put_(row, idx, 'ลองจิจูด',        Number(loc.lng));
    put_(row, idx, 'รัศมี(ม.)',       radius);
    put_(row, idx, 'ที่อยู่/หมายเหตุ', String(loc.address || '').trim());
    put_(row, idx, 'สถานะ',          loc.active === false ? 'ปิด' : 'ใช้งาน');

    if (rowNum) sheet.getRange(rowNum, 1, 1, row.length).setValues([row]);
    else        sheet.appendRow(row);

    return { ok: true, id: id, locations: readLocations_(false) };
  } finally {
    lock.releaseLock();
  }
}

/** ปิดใช้งานหน่วยงาน (ไม่ลบทิ้ง เพื่อให้ประวัติเดิมยังอ่านได้) */
function apiAdminDeleteLocation_(d) {
  requirePin_(d && d.pin);
  var id = String((d && d.id) || '').trim();
  if (!id) throw new Error('ไม่พบรหัสหน่วยงาน');

  var sheet = getSheet_(SH_LOC);
  var idx   = headerIndex_(sheet, HEAD_LOC);
  var last  = sheet.getLastRow();
  if (last < 2) throw new Error('ไม่พบหน่วยงานนี้');

  var ids = sheet.getRange(2, idx['รหัสหน่วยงาน'] + 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === id) {
      sheet.getRange(i + 2, idx['สถานะ'] + 1).setValue('ปิด');
      return { ok: true, locations: readLocations_(false) };
    }
  }
  throw new Error('ไม่พบหน่วยงานนี้');
}

/** เพิ่ม/แก้ไขพนักงาน */
function apiAdminSaveEmployee_(d) {
  requirePin_(d && d.pin);
  var e    = (d && d.employee) || {};
  var code = normCode_(e.code);
  var name = String(e.name || '').trim();
  if (!code) throw new Error('กรุณากรอกรหัสพนักงาน');
  if (!name) throw new Error('กรุณากรอกชื่อพนักงาน');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet_(SH_EMP);
    var idx   = headerIndex_(sheet, HEAD_EMP);
    var last  = sheet.getLastRow();
    var rowNum = 0;

    if (last > 1) {
      var codes = sheet.getRange(2, idx['รหัสพนักงาน'] + 1, last - 1, 1).getValues();
      for (var i = 0; i < codes.length; i++) {
        if (normCode_(codes[i][0]) === code) { rowNum = i + 2; break; }
      }
    }

    var row = new Array(sheet.getLastColumn() || HEAD_EMP.length).fill('');
    if (rowNum) row = sheet.getRange(rowNum, 1, 1, row.length).getValues()[0];

    put_(row, idx, 'รหัสพนักงาน',  code);
    put_(row, idx, 'ชื่อ-นามสกุล', name);
    put_(row, idx, 'ตำแหน่ง',      String(e.position || '').trim());
    put_(row, idx, 'สถานะ',        e.active === false ? 'พ้นสภาพ' : 'ใช้งาน');

    if (rowNum) sheet.getRange(rowNum, 1, 1, row.length).setValues([row]);
    else        sheet.appendRow(row);

    return { ok: true, employees: readEmployees_() };
  } finally {
    lock.releaseLock();
  }
}


// ===================== อ่านข้อมูลจากชีต =====================

function readEmployees_() {
  var sheet = getSheet_(SH_EMP);
  var idx   = headerIndex_(sheet, HEAD_EMP);
  var last  = sheet.getLastRow();
  if (last < 2) return [];

  var values = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var code = normCode_(get_(values[i], idx, 'รหัสพนักงาน'));
    if (!code) continue;
    out.push({
      code:     code,
      name:     String(get_(values[i], idx, 'ชื่อ-นามสกุล')).trim(),
      position: String(get_(values[i], idx, 'ตำแหน่ง')).trim(),
      active:   isActive_(get_(values[i], idx, 'สถานะ'))
    });
  }
  return out;
}

function findEmployee_(code) {
  code = normCode_(code);
  var list = readEmployees_();
  for (var i = 0; i < list.length; i++) if (list[i].code === code) return list[i];
  return null;
}

function requireEmployee_(code) {
  var emp = findEmployee_(code);
  if (!emp)        throw new Error('ไม่พบรหัสพนักงานในระบบ');
  if (!emp.active) throw new Error('รหัสพนักงานนี้ถูกระงับการใช้งาน');
  return emp;
}

function readLocations_(activeOnly) {
  var sheet = getSheet_(SH_LOC);
  var idx   = headerIndex_(sheet, HEAD_LOC);
  var last  = sheet.getLastRow();
  if (last < 2) return [];

  var values = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var r    = values[i];
    var id   = String(get_(r, idx, 'รหัสหน่วยงาน')).trim();
    var name = String(get_(r, idx, 'ชื่อหน่วยงาน')).trim();
    var lat  = Number(get_(r, idx, 'ละติจูด'));
    var lng  = Number(get_(r, idx, 'ลองจิจูด'));
    if (!id || !name || !isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) continue;

    var active = isActive_(get_(r, idx, 'สถานะ'));
    if (activeOnly && !active) continue;

    var radius = Number(get_(r, idx, 'รัศมี(ม.)'));
    out.push({
      id: id, name: name, lat: lat, lng: lng,
      radius:  (isFinite(radius) && radius > 0) ? Math.round(radius) : DEFAULT_RADIUS_M,
      address: String(get_(r, idx, 'ที่อยู่/หมายเหตุ')).trim(),
      active:  active
    });
  }
  out.sort(function (a, b) { return a.name.localeCompare(b.name, 'th'); });
  return out;
}

function findLocation_(id) {
  id = String(id || '').trim();
  var list = readLocations_(false);
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

function requireLocation_(id) {
  var loc = findLocation_(id);
  if (!loc)        throw new Error('ไม่พบหน่วยงานที่เลือก');
  if (!loc.active) throw new Error('หน่วยงาน "' + loc.name + '" ถูกปิดการใช้งานแล้ว');
  return loc;
}

/** รายการที่เช็คอินแล้วแต่ยังไม่เช็คเอาท์ ของพนักงานคนนี้ */
function findOpenLogs_(empCode) {
  empCode = normCode_(empCode);
  var sheet = getSheet_(SH_LOG);
  var idx   = headerIndex_(sheet, HEAD_LOG);
  var last  = sheet.getLastRow();
  if (last < 2) return [];

  var values = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    if (normCode_(get_(r, idx, 'รหัสพนักงาน')) !== empCode) continue;
    if (String(get_(r, idx, 'เวลาออก')).trim()) continue;
    var logId = String(get_(r, idx, 'Log ID')).trim();
    if (!logId) continue;

    out.push({
      logId:      logId,
      date:       String(get_(r, idx, 'วันที่')),
      timeIn:     String(get_(r, idx, 'เวลาเข้า')),
      locationId: String(get_(r, idx, 'รหัสหน่วยงาน')),
      location:   String(get_(r, idx, 'หน่วยงาน')),
      photoIn:    String(get_(r, idx, 'รูปเช็คอิน')),
      startIso:   String(get_(r, idx, 'เข้าเมื่อ'))
    });
  }
  out.sort(function (a, b) { return (b.startIso || '').localeCompare(a.startIso || ''); });
  return out;
}

function findLogRow_(sheet, idx, logId) {
  var last = sheet.getLastRow();
  if (last < 2) return null;
  var col = idx['Log ID'] + 1;
  var ids = sheet.getRange(2, col, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(logId).trim()) {
      return { rowNum: i + 2, row: sheet.getRange(i + 2, 1, 1, sheet.getLastColumn()).getValues()[0] };
    }
  }
  return null;
}


// ===================== พื้นที่ / ระยะทาง =====================

/** ระยะทางระหว่าง 2 พิกัด (เมตร) — สูตร Haversine */
function haversine_(lat1, lng1, lat2, lng2) {
  var R = 6371000, toRad = Math.PI / 180;
  var dLat = (lat2 - lat1) * toRad;
  var dLng = (lng2 - lng1) * toRad;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
          Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function judgeFence_(fix, loc) {
  var distance = haversine_(fix.lat, fix.lng, loc.lat, loc.lng);
  var effective = (GEOFENCE_MODE === 'tolerant')
    ? Math.max(0, distance - fix.accuracy)
    : distance;
  return { distance: distance, inside: effective <= loc.radius };
}

function requireFix_(d) {
  if (!isNum_(d.lat) || !isNum_(d.lng)) throw new Error('ไม่ได้รับพิกัด GPS กรุณาลองใหม่');
  var acc = isNum_(d.accuracy) ? Number(d.accuracy) : 9999;
  if (acc > MAX_ACCURACY_M) {
    throw new Error('สัญญาณ GPS ยังไม่แม่นพอ (คลาดเคลื่อน ±' + Math.round(acc) +
                    ' ม. ต้องไม่เกิน ±' + MAX_ACCURACY_M + ' ม.) กรุณาออกไปที่โล่งแล้วลองใหม่');
  }
  return { lat: Number(d.lat), lng: Number(d.lng), accuracy: acc };
}


// ===================== รูปภาพ =====================

/** อัปโหลดรูป base64 ขึ้น Drive แล้วคืนลิงก์ */
function savePhoto_(photo, baseName) {
  var bytes  = Utilities.base64Decode(photo.data);
  var name   = baseName + '.jpg';
  var blob   = Utilities.newBlob(bytes, photo.mimeType || 'image/jpeg', name);
  var folder = getPhotoFolder_();
  var file   = folder.createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) { /* องค์กรจำกัดการแชร์: ลิงก์ยังใช้ได้ภายในองค์กร */ }
  return 'https://drive.google.com/open?id=' + file.getId();
}

/** โฟลเดอร์รูป แยกโฟลเดอร์ย่อยรายเดือน */
function getPhotoFolder_() {
  var root;
  if (PHOTO_FOLDER_ID) {
    root = DriveApp.getFolderById(PHOTO_FOLDER_ID);
  } else {
    var it = DriveApp.getFoldersByName(PHOTO_FOLDER_NAME);
    root = it.hasNext() ? it.next() : DriveApp.createFolder(PHOTO_FOLDER_NAME);
  }
  var monthName = nowStr_('yyyy-MM');
  var sub = root.getFoldersByName(monthName);
  return sub.hasNext() ? sub.next() : root.createFolder(monthName);
}


// ===================== ตัวช่วยชีต =====================

function getSS_() {
  if (!SPREADSHEET_ID) {
    throw new Error('ยังไม่ได้ตั้งค่า SPREADSHEET_ID — กรุณารันฟังก์ชัน setup() ก่อน');
  }
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getSheet_(name) {
  var sheet = getSS_().getSheetByName(name);
  if (!sheet) throw new Error('ไม่พบแท็บชื่อ "' + name + '" — กรุณารันฟังก์ชัน setup()');
  return sheet;
}

/** แผนที่ชื่อหัวคอลัมน์ → index (เริ่มที่ 0) */
function headerIndex_(sheet, expected) {
  var lastCol = sheet.getLastColumn();
  if (!lastCol) throw new Error('แท็บ "' + sheet.getName() + '" ยังไม่มีหัวคอลัมน์');

  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var idx = {};
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i]).trim();
    if (h && !(h in idx)) idx[h] = i;
  }
  for (var j = 0; j < expected.length; j++) {
    if (!(expected[j] in idx)) {
      throw new Error('แท็บ "' + sheet.getName() + '" ไม่มีคอลัมน์ "' + expected[j] + '"');
    }
  }
  return idx;
}

function get_(row, idx, header) {
  var i = idx[header];
  return (i == null || i >= row.length) ? '' : row[i];
}

function put_(row, idx, header, value) {
  var i = idx[header];
  if (i == null) return;
  while (row.length <= i) row.push('');
  row[i] = value;
}

/** Log ID รูปแบบ CHK-yyyyMMdd-001 (ไล่เลขใหม่ทุกวัน) */
function nextLogId_(sheet, idx, now) {
  var prefix = 'CHK-' + fmt_(now, 'yyyyMMdd') + '-';
  var last   = sheet.getLastRow();
  var max    = 0;
  if (last > 1) {
    var ids = sheet.getRange(2, idx['Log ID'] + 1, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      var s = String(ids[i][0]).trim();
      if (s.indexOf(prefix) === 0) {
        var n = parseInt(s.substring(prefix.length), 10);
        if (n > max) max = n;
      }
    }
  }
  return prefix + ('00' + (max + 1)).slice(-3);
}

/** รหัสหน่วยงานรูปแบบ LOC-001 */
function nextLocId_(sheet, idx) {
  var last = sheet.getLastRow();
  var max  = 0;
  if (last > 1) {
    var ids = sheet.getRange(2, idx['รหัสหน่วยงาน'] + 1, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      var m = String(ids[i][0]).trim().match(/^LOC-(\d+)$/);
      if (m && +m[1] > max) max = +m[1];
    }
  }
  return 'LOC-' + ('00' + (max + 1)).slice(-3);
}


// ===================== ตัวช่วยทั่วไป =====================

function requirePin_(pin) {
  if (String(pin || '') !== ADMIN_PIN) throw new Error('รหัสผ่านไม่ถูกต้อง');
}

/** รหัสพนักงานอาจถูกชีตแปลงเป็นตัวเลข ("0123" → 123) จึงตัดช่องว่างและ .0 ทิ้ง */
function normCode_(v) {
  if (v == null) return '';
  var s = (typeof v === 'number') ? String(Math.round(v)) : String(v).trim();
  return s.replace(/\.0+$/, '');
}

function isActive_(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return true;   // เว้นว่าง = ใช้งานได้
  return !/^(ปิด|ไม่ใช้งาน|พ้นสภาพ|ลาออก|inactive|disabled|no|false|0)$/i.test(s);
}

function isNum_(v)      { return v !== '' && v != null && isFinite(Number(v)); }
function numOrNull_(v)  { return isNum_(v) ? Number(v) : null; }
function fmt_(d, p)     { return Utilities.formatDate(d, TZ, p); }
function nowStr_(p)     { return fmt_(new Date(), p); }

function fmtDist_(m) {
  return (m >= 1000) ? (m / 1000).toFixed(2) + ' กม.' : Math.round(m) + ' ม.';
}

function fmtDur_(min) {
  if (!isNum_(min)) return '';
  var h = Math.floor(min / 60), m = min % 60;
  return h ? (h + ' ชม. ' + m + ' นาที') : (m + ' นาที');
}

/** "dd/MM/yyyy" (ค.ศ. หรือ พ.ศ.) → "yyyy-MM-dd" สำหรับกรองช่วงวัน */
function isoFromThaiDate_(s) {
  var m = String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return '';
  var y = +m[3];
  if (y > 2400) y -= 543;
  return y + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
}


// ===================== ติดตั้งครั้งแรก =====================

/**
 * รันฟังก์ชันนี้ครั้งเดียวตอนติดตั้ง
 * - ถ้า SPREADSHEET_ID ว่าง จะสร้าง Google Sheet ใหม่ให้ แล้วบอกไอดีใน Log
 * - สร้างแท็บ Employees / Locations / CheckLog พร้อมหัวคอลัมน์
 */
function setup() {
  var ss;
  if (SPREADSHEET_ID) {
    ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  } else {
    ss = SpreadsheetApp.create('ระบบเช็คอินพนักงานนอกสถานที่');
    Logger.log('สร้างชีตใหม่แล้ว — คัดลอกไอดีนี้ไปใส่ตัวแปร SPREADSHEET_ID ด้านบน:');
    Logger.log(ss.getId());
  }
  ss.setSpreadsheetTimeZone(TZ);

  ensureSheet_(ss, SH_EMP, HEAD_EMP, [
    ['1001', 'ตัวอย่าง พนักงาน', 'ช่างบริการ', 'ใช้งาน']
  ]);
  ensureSheet_(ss, SH_LOC, HEAD_LOC, [
    ['LOC-001', 'ตัวอย่าง หน่วยงาน', 13.7563, 100.5018, 200, 'แก้พิกัดให้ตรงหน้างานจริง', 'ใช้งาน']
  ]);
  ensureSheet_(ss, SH_LOG, HEAD_LOG, []);

  // ลบแท็บเปล่าที่ Google สร้างมาให้ตอนสร้างไฟล์ใหม่
  var blank = ss.getSheetByName('Sheet1') || ss.getSheetByName('ชีต1');
  if (blank && ss.getSheets().length > 1) ss.deleteSheet(blank);

  Logger.log('ติดตั้งเรียบร้อย: ' + ss.getUrl());
  return ss.getUrl();
}

function ensureSheet_(ss, name, headers, sampleRows) {
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    for (var i = 0; i < sampleRows.length; i++) sheet.appendRow(sampleRows[i]);
  } else {
    // เติมเฉพาะคอลัมน์ที่ยังขาด ไม่แตะข้อมูลเดิม
    var lastCol  = sheet.getLastColumn();
    var existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
      return String(h).trim();
    });
    var missing = headers.filter(function (h) { return existing.indexOf(h) < 0; });
    if (missing.length) {
      sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
    }
  }

  sheet.getRange(1, 1, 1, sheet.getLastColumn())
       .setFontWeight('bold')
       .setBackground('#1F4BB8')
       .setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);
  return sheet;
}
