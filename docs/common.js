/****************************************************************
 * โค้ดที่ใช้ร่วมกันทุกหน้า — เรียก API, จับ GPS, จัดการรูป
 ****************************************************************/

// ===================== เรียก API =====================

/**
 * อ่านข้อมูล — ใช้ JSONP เพราะหน้าเว็บอยู่คนละโดเมนกับ Apps Script
 * วิธีนี้ทำงานได้ทุกเบราว์เซอร์โดยไม่ต้องพึ่ง CORS
 */
function apiGet(params) {
  return new Promise(function (resolve, reject) {
    if (!API_URL || API_URL.indexOf('http') !== 0) {
      return reject(new Error('ยังไม่ได้ตั้งค่า API_URL ในไฟล์ config.js'));
    }

    var cbName = 'jsonp_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
    var script = document.createElement('script');
    var timer  = setTimeout(function () {
      done(); reject(new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ (หมดเวลา) — ตรวจสอบสัญญาณอินเทอร์เน็ต'));
    }, 30000);

    function done() {
      clearTimeout(timer);
      try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    window[cbName] = function (res) {
      done();
      if (!res)             reject(new Error('เซิร์ฟเวอร์ไม่ตอบข้อมูล'));
      else if (!res.ok)     reject(new Error(res.error || 'เกิดข้อผิดพลาด'));
      else                  resolve(res);
    };

    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');

    script.src = API_URL + '?' + qs + '&callback=' + cbName;
    script.onerror = function () {
      done(); reject(new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ — ตรวจสอบ API_URL และการ deploy'));
    };
    document.head.appendChild(script);
  });
}

/**
 * บันทึกข้อมูล — POST แบบ text/plain เพื่อให้เป็น simple request
 * (ถ้าใช้ application/json เบราว์เซอร์จะยิง preflight ซึ่ง Apps Script ไม่รองรับ)
 */
function apiPost(body) {
  if (!API_URL || API_URL.indexOf('http') !== 0) {
    return Promise.reject(new Error('ยังไม่ได้ตั้งค่า API_URL ในไฟล์ config.js'));
  }
  return fetch(API_URL, {
    method:   'POST',
    headers:  { 'Content-Type': 'text/plain;charset=utf-8' },
    body:     JSON.stringify(body),
    redirect: 'follow'
  })
  .then(function (r) { return r.text(); })
  .then(function (text) {
    var res;
    try { res = JSON.parse(text); }
    catch (e) { throw new Error('เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ — ตรวจสอบสิทธิ์การเข้าถึง Web App'); }
    if (!res.ok) throw new Error(res.error || 'บันทึกไม่สำเร็จ');
    return res;
  })
  .catch(function (e) {
    if (e instanceof TypeError) throw new Error('ส่งข้อมูลไม่สำเร็จ — ตรวจสอบสัญญาณอินเทอร์เน็ต');
    throw e;
  });
}


// ===================== ตรวจสภาพเบราว์เซอร์ =====================

var UA = navigator.userAgent || '';

var Env = {
  isIOS:     /iPad|iPhone|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
  isAndroid: /Android/i.test(UA),
  isLine:    /Line\//i.test(UA),
  isFB:      /FBAN|FBAV|FB_IAB/i.test(UA),
  isIG:      /Instagram/i.test(UA),
  isWeChat:  /MicroMessenger/i.test(UA),
  isTikTok:  /TikTok|BytedanceWebview/i.test(UA),
  isSecure:  window.isSecureContext !== false,
  hasGeo:    'geolocation' in navigator,
  standalone: window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
};

/** เบราว์เซอร์ในแอพ (LINE/Facebook/IG) มักบล็อกการขอตำแหน่ง */
Env.isInApp = Env.isLine || Env.isFB || Env.isIG || Env.isWeChat || Env.isTikTok;

Env.appName = Env.isLine   ? 'LINE'
            : Env.isFB     ? 'Facebook'
            : Env.isIG     ? 'Instagram'
            : Env.isWeChat ? 'WeChat'
            : Env.isTikTok ? 'TikTok' : 'แอพนี้';


// ===================== จับพิกัด GPS =====================

/**
 * เฝ้าดูตำแหน่งต่อเนื่องด้วย watchPosition (ไม่ใช่ getCurrentPosition ครั้งเดียว)
 * เพราะ GPS มือถือต้องใช้เวลาจับดาวเทียม ค่าแรกๆ มักคลาดเคลื่อนมาก
 * แล้วจะแม่นขึ้นเรื่อยๆ ภายใน 10-30 วินาที
 */
var Geo = {
  watchId: null,
  fix: null,        // { lat, lng, acc, at }
  error: null,
  startedAt: 0,
  onChange: null,

  start: function (onChange) {
    this.onChange = onChange;
    this.error = null;
    // ล้างพิกัดเก่าทิ้งเสมอ — ถ้าพนักงานย้ายไซต์งานแล้วเปิดหน้าเช็คอินใหม่
    // ค่าเดิมจะทำให้คำนวณระยะห่างจากที่เก่า และเช็คอินผิดที่ได้
    this.fix = null;
    this.startedAt = Date.now();

    if (!Env.hasGeo) {
      this.error = { code: 0, text: 'เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง', help: 'กรุณาเปิดด้วย Chrome หรือ Safari รุ่นล่าสุด' };
      this._fire(); return;
    }
    if (!Env.isSecure) {
      this.error = { code: 0, text: 'หน้าเว็บนี้ไม่ปลอดภัย (ไม่ใช่ HTTPS)', help: 'ต้องเปิดผ่าน https:// เท่านั้น จึงจะขอตำแหน่งได้' };
      this._fire(); return;
    }

    this.stop();
    var self = this;
    this.watchId = navigator.geolocation.watchPosition(
      function (pos) {
        var f = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          acc: pos.coords.accuracy || 9999,
          at:  Date.now()
        };
        // เก็บค่าที่แม่นที่สุด แต่ถ้าค่าเดิมเก่าเกิน 20 วิ ให้ใช้ค่าใหม่แทน
        if (!self.fix || f.acc <= self.fix.acc || (f.at - self.fix.at) > 20000) self.fix = f;
        self.error = null;
        self._fire();
      },
      function (err) {
        self.error = geoErrorInfo(err);
        self._fire();
      },
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }
    );
  },

  stop: function () {
    if (this.watchId != null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  },

  /** เริ่มจับใหม่ทั้งหมด (ปุ่ม "ลองอีกครั้ง") */
  restart: function () {
    this.fix = null;
    this.start(this.onChange);
  },

  /** ค่าที่แม่นพอจะใช้ตัดสินใจได้แล้วหรือยัง */
  isGood: function () { return !!this.fix && this.fix.acc <= GOOD_ACCURACY_M; },
  isUsable: function () { return !!this.fix && this.fix.acc <= MAX_ACCURACY_M; },
  elapsed: function () { return Math.round((Date.now() - this.startedAt) / 1000); },
  /** อายุของพิกัดล่าสุด (วินาที) — watchPosition จะยิงค่าใหม่เมื่อมีการเคลื่อนที่ */
  fixAge: function () { return this.fix ? Math.round((Date.now() - this.fix.at) / 1000) : -1; },

  _fire: function () { if (this.onChange) this.onChange(this); }
};

/** แปลง error ของ Geolocation เป็นข้อความไทย + วิธีแก้ตามอุปกรณ์ */
function geoErrorInfo(err) {
  var code = err && err.code;

  if (code === 1) {  // PERMISSION_DENIED
    var help = Env.isIOS
      ? 'ไปที่ ตั้งค่า → ความเป็นส่วนตัว → บริการหาตำแหน่ง → เปิด แล้วเลื่อนหา Safari/Chrome ตั้งเป็น "ขณะใช้แอพ" จากนั้นกลับมารีเฟรชหน้านี้'
      : 'แตะไอคอน 🔒 ข้าง URL → สิทธิ์ → ตำแหน่ง → อนุญาต จากนั้นรีเฟรชหน้านี้';
    return { code: 1, text: 'ยังไม่ได้อนุญาตให้ใช้ตำแหน่ง', help: help };
  }
  if (code === 2) {  // POSITION_UNAVAILABLE
    return {
      code: 2,
      text: 'หาตำแหน่งไม่พบ',
      help: 'ตรวจสอบว่าเปิด GPS/บริการหาตำแหน่งของเครื่องแล้ว และลองออกไปที่โล่งนอกอาคาร'
    };
  }
  if (code === 3) {  // TIMEOUT
    return {
      code: 3,
      text: 'ค้นหาตำแหน่งนานเกินไป',
      help: 'สัญญาณ GPS อาจถูกบัง ลองออกไปที่โล่งหรือใกล้หน้าต่าง แล้วกด "ลองอีกครั้ง"'
    };
  }
  return { code: 0, text: 'ระบุตำแหน่งไม่สำเร็จ', help: (err && err.message) || 'กรุณาลองใหม่อีกครั้ง' };
}


// ===================== คำนวณระยะทาง =====================

/** ระยะทางระหว่าง 2 พิกัด (เมตร) — สูตร Haversine */
function distanceM(lat1, lng1, lat2, lng2) {
  var R = 6371000, toRad = Math.PI / 180;
  var dLat = (lat2 - lat1) * toRad;
  var dLng = (lng2 - lng1) * toRad;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
          Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtDist(m) {
  if (m == null || !isFinite(m)) return '-';
  return (m >= 1000) ? (m / 1000).toFixed(2) + ' กม.' : Math.round(m) + ' ม.';
}

function fmtDur(min) {
  if (min == null || !isFinite(min)) return '-';
  var h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? (h + ' ชม. ' + m + ' นาที') : (m + ' นาที');
}


// ===================== รูปภาพ =====================

/**
 * ย่อรูป + ประทับข้อมูลกำกับ (วันเวลา/สถานที่/พิกัด) ลงบนรูป
 * คืน { name, mimeType, data(base64), preview(dataURL) }
 */
function preparePhoto(file, stamp) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onerror = function () { reject(new Error('อ่านไฟล์รูปไม่สำเร็จ')); };
    reader.onload = function (ev) {
      var img = new Image();
      img.onerror = function () { reject(new Error('ไฟล์นี้ไม่ใช่รูปภาพที่รองรับ')); };
      img.onload = function () {
        var w = img.width, h = img.height, MAX = PHOTO_MAX_PX;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else       { w = Math.round(w * MAX / h); h = MAX; }
        }

        var cv  = document.createElement('canvas');
        cv.width = w; cv.height = h;
        var ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        if (stamp && stamp.length) drawStamp(ctx, w, h, stamp);

        var dataUrl = cv.toDataURL('image/jpeg', PHOTO_QUALITY);
        resolve({
          name:     'photo.jpg',
          mimeType: 'image/jpeg',
          data:     dataUrl.split(',')[1],
          preview:  dataUrl
        });
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/** แถบข้อมูลกำกับมุมล่างของรูป — ใช้เป็นหลักฐานประกอบ */
function drawStamp(ctx, w, h, lines) {
  var size = Math.max(13, Math.round(w / 42));
  var pad  = Math.round(size * 0.7);
  var lineH = Math.round(size * 1.45);
  var boxH = lines.length * lineH + pad * 2;

  ctx.fillStyle = 'rgba(0,0,0,0.58)';
  ctx.fillRect(0, h - boxH, w, boxH);

  ctx.fillStyle = '#ffffff';
  ctx.font = size + 'px "Sarabun", "Segoe UI", sans-serif';
  ctx.textBaseline = 'top';
  for (var i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], pad, h - boxH + pad + i * lineH);
  }
}


// ===================== ตัวช่วยทั่วไป =====================

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

function todayISO() {
  var d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function nowText() {
  var d = new Date();
  return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear() +
         ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

/** ลิงก์ Drive → ลิงก์รูปย่อ ใช้แสดงใน <img> ได้ */
function driveThumb(url) {
  if (!url) return '';
  var m = String(url).match(/[-\w]{25,}/);
  return m ? 'https://drive.google.com/thumbnail?id=' + m[0] + '&sz=w600' : '';
}

var store = {
  get: function (k, d) {
    try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; }
  },
  set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del: function (k)    { try { localStorage.removeItem(k); } catch (e) {} }
};
