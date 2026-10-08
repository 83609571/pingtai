/* ======================================================================
 * 路段流量 · 拥挤度图层（区段断面客流着色 + 站点/新增站点客流标注）
 * ----------------------------------------------------------------------
 * 职责（依用户需求 4）：
 *   ① 各路段流量拥挤程度 —— 把 flow_*.json 的 37 个物理区段断面客流
 *      按占全网最大断面的比例分为四档（拥挤/偏挤/适中/畅通）着色，
 *      点击区段弹断面客流明细；放大到 10 级后显示区段流量数字。
 *   ② 站点客流数字 —— 每个站点（35 个）标注客流（人次/日）；
 *   ③ 新增公交站点客人数量 —— 22 个新增站点（□，与 js/system-lines.js
 *      的 NEW_STATIONS 同源）标注推演客流，点击可查看推演公式。
 *
 * 数据唯一真源：data/flow_{holiday|weekday}.json（stations + segments，
 *   仿真推演值，锚定公开统计，见文件内 source_note / real_anchors）。
 *   新增站点客流为「邻近主站客流 × 折算系数」的确定性推演（△标记，
 *   公式在点击弹窗与面板说明中公开，可复核）。
 * ====================================================================== */
(function () {
  'use strict';

  var SCEN = {
    holiday: 'data/flow_holiday.json',
    weekday: 'data/flow_weekday.json'
  };
  var SCEN_LABEL = { holiday: '节假日', weekday: '工作日' };

  // —— 新增站点（坐标与 js/system-lines.js NEW_STATIONS 保持一致）——
  // [站名, lng, lat, 所属走廊, 折算系数]：系数用于「邻近主站客流 × 系数」推演
  var NEW_STATIONS = [
    // 昌九通勤线新增
    ['乐化站', 115.88, 28.83, '昌九通勤线', 0.15],
    ['德安站', 116.00, 29.48, '昌九通勤线', 0.15],
    // 昌抚通勤线新增
    ['向塘站', 115.93, 28.56, '昌抚通勤线', 0.15],
    ['凤凰沟景区站', 116.00, 28.48, '昌抚通勤线', 0.10],
    ['李渡站', 116.18, 28.26, '昌抚通勤线', 0.15],
    ['云山站', 116.25, 28.10, '昌抚通勤线', 0.10],
    ['温泉站', 116.29, 28.03, '昌抚通勤线', 0.10],
    ['抚州北站', 116.33, 27.98, '昌抚通勤线', 0.15],
    // 环庐山南麓观光环新增
    ['庐山索道下站', 115.88, 29.51, '环庐山旅游线', 0.12],
    ['桃花源站', 115.87, 29.485, '环庐山旅游线', 0.10],
    ['东林大佛站', 115.845, 29.475, '环庐山旅游线', 0.10],
    ['庐山温泉站', 115.835, 29.455, '环庐山旅游线', 0.10],
    ['归宗景区站', 115.855, 29.44, '环庐山旅游线', 0.10],
    ['秀峰站', 115.89, 29.45, '环庐山旅游线', 0.12],
    ['太乙村站', 115.92, 29.47, '环庐山旅游线', 0.08],
    ['观音桥站', 115.95, 29.49, '环庐山旅游线', 0.08],
    ['白鹿洞书院站', 115.99, 29.51, '环庐山旅游线', 0.10],
    ['三叠泉站', 116.02, 29.54, '环庐山旅游线', 0.12],
    ['庐山北门站', 116.03, 29.58, '环庐山旅游线', 0.12],
    // 大觉山悬崖动车段特色站点
    ['云门站', 117.065, 27.705, '大觉山旅游支线', 0.10],
    ['仙踪站', 117.055, 27.725, '大觉山旅游支线', 0.10],
    ['揽月站', 117.045, 27.75, '大觉山旅游支线', 0.08],
    ['蝶恋花站', 117.035, 27.772, '大觉山旅游支线', 0.08]
  ];

  var state = {
    map: null, on: false, built: false, scen: 'holiday',
    cache: {},              // { holiday: json, weekday: json }
    overlays: [],           // 本图层全部覆盖物
    segLabels: [],          // 区段流量标签（按缩放级别显隐）
    zoom: 8
  };

  // —— 工具 ——
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtFlow(v) {
    if (v == null || isNaN(v)) return '—';
    var x = Number(v);
    if (x >= 10000) return (x / 10000).toFixed(1).replace(/\.0$/, '') + '万';
    return Math.round(x).toLocaleString();
  }
  function P(c) { return new BMapGL.Point(c[0], c[1]); }
  function add(o) { try { state.map.addOverlay(o); state.overlays.push(o); } catch (e) {} }
  function clearOverlays() {
    state.overlays.forEach(function (o) { try { state.map.removeOverlay(o); } catch (e) {} });
    state.overlays = []; state.segLabels = [];
  }

  // 拥挤度四档（按占全网最大断面客流的比例）
  function levelOf(ratio) {
    if (ratio >= 0.75) return { k: '拥挤', c: '#ff3344' };
    if (ratio >= 0.50) return { k: '偏挤', c: '#ff8800' };
    if (ratio >= 0.30) return { k: '适中', c: '#ffcc00' };
    return { k: '畅通', c: '#00ff88' };
  }

  function mkLabel(html, coord, borderColor, mLeft, mTop, fontSize) {
    try {
      var lb = new BMapGL.Label(html, { position: P(coord) });
      lb.setStyle({
        color: '#eaf6ff', background: 'rgba(0,14,30,0.9)',
        border: '1px solid ' + (borderColor || '#1a4a7c'), padding: '1px 6px',
        fontSize: (fontSize || 9.5) + 'px', fontFamily: 'Microsoft YaHei, sans-serif',
        borderRadius: '8px', marginLeft: (mLeft || 0) + 'px', marginTop: (mTop || 0) + 'px',
        whiteSpace: 'nowrap', lineHeight: '1.5'
      });
      return lb;
    } catch (e) { return null; }
  }

  function flowData() { return state.cache[state.scen] || null; }

  // —— 新增站点推演客流：邻近主站客流 × 折算系数（四舍五入到 50）——
  function estNewStation(s, stMap) {
    var best = null, bestD = Infinity;
    Object.keys(stMap).forEach(function (n) {
      var st = stMap[n]; if (!st.lng || !st.lat) return;
      var d = Math.pow(st.lng - s[1], 2) + Math.pow(st.lat - s[2], 2);
      if (d < bestD) { bestD = d; best = st; }
    });
    if (!best) return { est: null, ref: null };
    var est = Math.max(50, Math.round(best.flow * s[4] / 50) * 50);
    return { est: est, ref: best };
  }

  // ====================================================================
  // 绘制
  // ====================================================================
  function draw() {
    clearOverlays();
    if (!state.on || !state.map || !window.BMapGL) return;
    var d = flowData();
    if (!d || !d.segments || !d.stations) return;

    // 站点坐标表（flow 文件自带 lng/lat）
    var stMap = {};
    d.stations.forEach(function (s) { stMap[s.name] = s; });

    // 全网最大断面 / 最大站点客流（分档基准）
    var maxSeg = 0, maxSt = 0;
    d.segments.forEach(function (s) { if (s.flow > maxSeg) maxSeg = s.flow; });
    d.stations.forEach(function (s) { if (s.flow > maxSt) maxSt = s.flow; });

    // ① 区段着色线 + 点击明细（放大到 10 级后显示流量数字）
    d.segments.forEach(function (sg) {
      var a = stMap[sg.from], b = stMap[sg.to];
      if (!a || !b) return;
      var ratio = maxSeg ? sg.flow / maxSeg : 0;
      var lv = levelOf(ratio);
      var pts = [P([a.lng, a.lat]), P([b.lng, b.lat])];
      var pl = new BMapGL.Polyline(pts, {
        strokeColor: lv.c, strokeWeight: Math.round(4 + ratio * 5),
        strokeOpacity: 0.95
      });
      add(pl);
      (function (sg, lv, ratio) {
        try {
          pl.addEventListener('click', function () {
            var iw = new BMapGL.InfoWindow(
              '<div style="font-family:Microsoft YaHei;font-size:12px;line-height:1.9;color:#d0e6f5;min-width:220px">' +
                '<h3 style="color:' + lv.c + ';margin:0 0 6px;font-size:14px">' + esc(sg.from) + ' → ' + esc(sg.to) + '</h3>' +
                '线路：<b>' + esc(sg.line) + '</b>（' + (sg.type === 'commuter' ? '通勤' : '旅游') + '）<br>' +
                '断面客流：<b style="color:' + lv.c + '">' + Number(sg.flow).toLocaleString() + ' 人次/日</b><br>' +
                '占全网最大断面：' + (ratio * 100).toFixed(0) + '% · 档位 <b style="color:' + lv.c + '">' + lv.k + '</b><br>' +
                '<span style="font-size:10px;color:#5a8ab0">场景：' + SCEN_LABEL[state.scen] +
                ' · 仿真推演（锚定公开统计，见 flow_' + state.scen + '.json）</span>' +
              '</div>', { width: 280 });
            state.map.openInfoWindow(iw, P([(a.lng + b.lng) / 2, (a.lat + b.lat) / 2]));
          });
        } catch (e) {}
      })(sg, lv, ratio);

      // 区段流量数字（缩放门控：≥10 级显示，避免全省视图堆叠）
      var lb = mkLabel('▸ ' + fmtFlow(sg.flow), [(a.lng + b.lng) / 2, (a.lat + b.lat) / 2], lv.c, -26, -9, 9.5);
      if (lb) {
        lb.setStyle({ color: lv.c, background: 'rgba(0,14,30,0.78)' });
        state.segLabels.push({ lb: lb, added: false });
        add(lb);
        state.segLabels[state.segLabels.length - 1].added = true;
      }
    });
    applySegLabelGating();

    // ② 站点客流数字（35 站；放在站名标签下方，不与站名重叠）
    d.stations.forEach(function (s) {
      if (s.lng == null || s.lat == null) return;
      var ratio = maxSt ? s.flow / maxSt : 0;
      var lv = levelOf(ratio);
      var lb = mkLabel(fmtFlow(s.flow), [s.lng, s.lat], lv.c, -14, 12, 9.5);
      if (lb) { lb.setStyle({ color: lv.c }); add(lb); }
    });

    // ③ 新增站点（□ 白色方块）+ 推演客流数字
    var sqIcon = null;
    try {
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12">' +
        '<rect x="1" y="1" width="10" height="10" fill="#ffffff" stroke="#0a1628" stroke-width="1"/></svg>';
      sqIcon = new BMapGL.Icon('data:image/svg+xml;base64,' + btoa(svg), new BMapGL.Size(12, 12));
    } catch (e) {}
    NEW_STATIONS.forEach(function (s) {
      var est = estNewStation(s, stMap);
      var col = '#a8c8e8';
      try {
        var mk = sqIcon ? new BMapGL.Marker(new BMapGL.Point(s[1], s[2]), { icon: sqIcon })
                        : new BMapGL.Marker(new BMapGL.Point(s[1], s[2]));
        add(mk);
        (function (s, est) {
          try {
            mk.addEventListener('click', function () {
              var iw = new BMapGL.InfoWindow(
                '<div style="font-family:Microsoft YaHei;font-size:12px;line-height:1.9;color:#d0e6f5;min-width:230px">' +
                  '<h3 style="color:#ffffff;margin:0 0 6px;font-size:14px">□ ' + esc(s[0]) + '（新增站点）</h3>' +
                  '所属走廊：' + esc(s[3]) + '<br>' +
                  '推演客流：<b style="color:#ffcc00">≈ ' + (est.est != null ? est.est.toLocaleString() : '—') + ' 人次/日</b> △<br>' +
                  '推演口径：邻近主站 ' + esc(est.ref ? est.ref.name : '—') +
                  '（' + (est.ref ? est.ref.flow.toLocaleString() : '—') + ' 人次/日）× 折算系数 ' + s[4] +
                  '，四舍五入到 50<br>' +
                  '<span style="font-size:10px;color:#5a8ab0">新增站点暂无独立客流仿真，数值仅供规模量级参考（' +
                  SCEN_LABEL[state.scen] + '场景）</span>' +
                '</div>', { width: 300 });
              state.map.openInfoWindow(iw, new BMapGL.Point(s[1], s[2]));
            });
          } catch (e) {}
        })(s, est);
      } catch (e) {}
      if (est.est != null) {
        var lb = mkLabel('□ ' + fmtFlow(est.est), [s[1], s[2]], '#8fb8dc', -20, 12, 9.5);
        if (lb) { lb.setStyle({ color: '#c6dcee', borderStyle: 'dashed' }); add(lb); }
      }
    });

    console.log('[赣鄱智轨] 路段流量图层已绘制：区段 ' + d.segments.length + ' 条 · 站点 ' +
      d.stations.length + ' 个 · 新增站点 ' + NEW_STATIONS.length + ' 个 · 场景=' + SCEN_LABEL[state.scen]);
  }

  // 区段流量数字按缩放级别显隐（≥10 级显示）
  function applySegLabelGating() {
    var show = state.zoom >= 10;
    state.segLabels.forEach(function (g) {
      try {
        if (show && !g.added) { state.map.addOverlay(g.lb); g.added = true; }
        else if (!show && g.added) { state.map.removeOverlay(g.lb); g.added = false; }
      } catch (e) {}
    });
  }

  // ====================================================================
  // 面板（右上）
  // ====================================================================
  function injectStyle() {
    if (document.getElementById('fl-style')) return;
    var st = document.createElement('style');
    st.id = 'fl-style';
    st.textContent = [
      '#flow-panel{position:absolute;top:70px;right:20px;z-index:9;width:250px;max-width:calc(100vw - 40px);',
      'background:rgba(0,14,30,.94);border:1px solid #1a4a7c;border-radius:8px;padding:9px 11px;',
      'color:#d0e6f5;font-size:12px;font-family:inherit;display:none;}',
      '#flow-panel .fl-head{display:flex;align-items:center;gap:8px;}',
      '#flow-panel .fl-title{color:#00d4ff;font-size:13px;font-weight:bold;}',
      '#flow-panel .fl-sub{font-size:10px;color:#5a8ab0;font-weight:normal;}',
      '#flow-panel .fl-close{margin-left:auto;cursor:pointer;color:#5a8ab0;font-size:13px;}',
      '#flow-panel .fl-close:hover{color:#ff5566;}',
      '#flow-panel .fl-ctrl{display:flex;gap:4px;align-items:center;margin:8px 0 6px;}',
      '#flow-panel .fl-ctrl label{font-size:10px;color:#5a8ab0;}',
      '#flow-panel .fl-btn{background:rgba(0,30,60,.7);border:1px solid #1a3a5c;color:#7ab8e0;',
      'padding:3px 10px;border-radius:3px;cursor:pointer;font-size:11px;font-family:inherit;}',
      '#flow-panel .fl-btn:hover{border-color:#00d4ff;color:#00d4ff;}',
      '#flow-panel .fl-btn.active{background:#00d4ff;color:#001020;border-color:#00d4ff;font-weight:bold;}',
      '#flow-panel .fl-legend{display:flex;flex-direction:column;gap:3px;font-size:10px;color:#7ab8e0;',
      'border-top:1px solid #12293f;padding-top:7px;}',
      '#flow-panel .fl-legend i{display:inline-block;width:16px;height:7px;border-radius:2px;margin-right:6px;vertical-align:0;}',
      '#flow-panel .fl-note{font-size:9.5px;color:#3a6a90;margin-top:6px;line-height:1.65;}'
    ].join('');
    document.head.appendChild(st);
  }

  function ensurePanel() {
    if (state.built && document.getElementById('flow-panel')) return document.getElementById('flow-panel');
    injectStyle();
    var box = document.createElement('div');
    box.id = 'flow-panel';
    box.innerHTML =
      '<div class="fl-head">' +
        '<span class="fl-title">路段流量 · 拥挤度</span>' +
        '<span class="fl-sub">断面客流 + 站点客流</span>' +
        '<span class="fl-close" id="fl-close" title="关闭（可点工具栏「路段流量·拥挤度」重开）">✕</span>' +
      '</div>' +
      '<div class="fl-ctrl"><label>场景</label>' +
        '<button class="fl-btn" data-scen="holiday">节假日</button>' +
        '<button class="fl-btn" data-scen="weekday">工作日</button>' +
      '</div>' +
      '<div class="fl-legend">' +
        '<span><i style="background:#ff3344"></i>拥挤 · ≥75% 最大断面</span>' +
        '<span><i style="background:#ff8800"></i>偏挤 · 50–75%</span>' +
        '<span><i style="background:#ffcc00"></i>适中 · 30–50%</span>' +
        '<span><i style="background:#00ff88"></i>畅通 · &lt;30%</span>' +
        '<span><i style="background:#fff;border-radius:1px;width:9px;height:9px"></i>□ 新增站点 · 虚线框数字为推演客流</span>' +
      '</div>' +
      '<div class="fl-note">区段颜色 = 断面客流占全网最大断面比例；放大到 10 级显示区段流量数字。' +
        '数据：flow_' + state.scen + '.json（仿真推演，锚定公开统计）；新增站点客流 △ = 邻近主站 × 折算系数，点击可查公式。</div>';
    document.getElementById('app').appendChild(box);
    document.getElementById('fl-close').onclick = function () { setOn(false); };
    box.querySelectorAll('.fl-btn[data-scen]').forEach(function (b) {
      b.onclick = function () { setScenario(b.getAttribute('data-scen')); };
    });
    state.built = true;
    return box;
  }

  function syncPanel() {
    var box = document.getElementById('flow-panel');
    if (!box) return;
    box.querySelectorAll('.fl-btn[data-scen]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-scen') === state.scen);
    });
    var note = box.querySelector('.fl-note');
    if (note) {
      note.innerHTML = '区段颜色 = 断面客流占全网最大断面比例；放大到 10 级显示区段流量数字。' +
        '数据：flow_' + esc(state.scen) + '.json（仿真推演，锚定公开统计）；新增站点客流 △ = 邻近主站 × 折算系数，点击可查公式。';
    }
  }

  // ====================================================================
  // 数据 / 开关
  // ====================================================================
  function ensureData(scen, cb) {
    if (state.cache[scen]) { cb && cb(); return; }
    fetch(SCEN[scen] + '?t=' + Date.now())
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { state.cache[scen] = j; cb && cb(); })
      .catch(function (e) {
        console.warn('[赣鄱智轨] 路段流量：取数失败 ' + e);
        var box = document.getElementById('flow-panel');
        if (box) box.querySelector('.fl-note').innerHTML =
          '未取到 <code>flow_' + esc(scen) + '.json</code>，请确认文件已随包部署。';
      });
  }

  function setScenario(scen) {
    if (!SCEN[scen]) return;
    state.scen = scen;
    syncPanel();
    ensureData(scen, function () { if (state.on) draw(); });
  }

  function setOn(on) {
    state.on = !!on;
    var b = document.getElementById('flow-btn');
    if (b) {
      b.classList.toggle('active', state.on);
      b.textContent = state.on ? '路段流量·开启中' : '路段流量·拥挤度';
    }
    var box = state.built ? document.getElementById('flow-panel') : null;
    if (state.on) {
      ensurePanel();
      box = document.getElementById('flow-panel');
      if (box) box.style.display = 'block';
      syncPanel();
      ensureData(state.scen, draw);
    } else {
      clearOverlays();
      if (box) box.style.display = 'none';
    }
  }

  function buildButton(retries) {
    if (document.getElementById('flow-btn')) return;
    var tb = document.getElementById('heatmap-toolbar') || document.querySelector('.toolbar');
    if (!tb) {
      if ((retries || 0) < 20) setTimeout(function () { buildButton((retries || 0) + 1); }, 400);
      return;
    }
    var b = document.createElement('button');
    b.id = 'flow-btn';
    b.textContent = '路段流量·拥挤度';
    b.title = '按断面客流给各路段着色（拥挤/偏挤/适中/畅通），标注站点客流与新增站点推演客流；放大后显示区段流量数字';
    b.onclick = function () { setOn(!state.on); };
    tb.appendChild(b);
  }

  // —— 启动 ——
  window.addEventListener('ganpo:mapready', function () {
    state.map = (window.GanpoMap && window.GanpoMap.map) || null;
    try { state.zoom = state.map.getZoom(); } catch (e) {}
    try {
      state.map.addEventListener('zoomend', function () {
        try { state.zoom = state.map.getZoom(); } catch (e) {}
        if (state.on) applySegLabelGating();
      });
    } catch (e) {}
    buildButton();
  });

  setTimeout(function () {
    if (!state.map && window.GanpoMap && window.GanpoMap.map) {
      state.map = window.GanpoMap.map;
      try { state.zoom = state.map.getZoom(); } catch (e) {}
      buildButton();
    }
  }, 2500);

  window.GanpoFlowLayer = {
    toggle: function () { setOn(!state.on); },
    show: function () { setOn(true); },
    hide: function () { setOn(false); },
    setScenario: setScenario,
    state: state
  };
})();
