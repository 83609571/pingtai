/* ======================================================================
 * 制式分段图层 · 全线轨道制式地图表达（依《全线轨道制式分段适配详细说明》）
 * ----------------------------------------------------------------------
 * 一键切换的"制式视图"，与常规配色（通勤黄 / 旅游红 / 齿轨橙）明确区分：
 *   · 标准轮轨    —— 蓝色实线（通勤层全线 + 旅游层平缓段）
 *   · 跨座式单轨  —— 紫色实线（旅游层山地段）
 *   · 齿轨段      —— 玫红闪烁粗线（仅三处：三清山 / 大觉山 / 庐山秀峰—三叠泉）
 *   · 换乘/制式转换节点 —— 白色圆圈（8 处衔接点）
 *   · 景区集散中心 —— 绿色三角（庐山 / 三清山 / 大觉山 / 婺源）
 *   · 新增站点    —— 白色方块 + 站名（放大到 10 级后显示站名，避免堆叠）
 *
 * 机制：开启时把原线透明度压暗，并按"制式分段"叠加新配色；关闭即恢复。
 * 同时新增两段文字稿中的平面几何：庐山南麓观光环（含秀峰—三叠泉齿轨段）
 * 与昌九 / 昌抚 / 环庐山 / 大觉山走廊的新增站点。
 * 几何全部读自 GanpoConfig（站点坐标 2026-09-26 已按实地位置校准），
 * 本模块不复制任何坐标常量（新增站点除外，见各条目注释）。
 * ====================================================================== */
(function () {
  'use strict';

  var COL = { rail: '#4d7fff', mono: '#b06bff', rack: '#ff3d9a', hub: '#00b050', node: '#ffffff' };
  var state = { on: false, map: null, built: false, recolor: [], added: [], gated: [], rackPls: [], timer: null, bright: true };

  // —— 新增站点（依文字稿"站点更新"；坐标为依地名的近似值，便于后续精调）——
  var NEW_STATIONS = [
    // 昌九通勤线新增
    ['乐化站', 115.88, 28.83], ['德安站', 116.00, 29.48],
    // 昌抚通勤线新增
    ['向塘站', 115.93, 28.56], ['凤凰沟景区站', 116.00, 28.48], ['李渡站', 116.18, 28.26],
    ['云山站', 116.25, 28.10], ['温泉站', 116.29, 28.03], ['抚州北站', 116.33, 27.98],
    // 环庐山南麓观光环新增
    ['庐山索道下站', 115.88, 29.51], ['桃花源站', 115.87, 29.485], ['东林大佛站', 115.845, 29.475],
    ['庐山温泉站', 115.835, 29.455], ['归宗景区站', 115.855, 29.44], ['秀峰站', 115.89, 29.45],
    ['太乙村站', 115.92, 29.47], ['观音桥站', 115.95, 29.49], ['白鹿洞书院站', 115.99, 29.51],
    ['三叠泉站', 116.02, 29.54], ['庐山北门站', 116.03, 29.58],
    // 大觉山悬崖动车段特色站点
    ['云门站', 117.065, 27.705], ['仙踪站', 117.055, 27.725], ['揽月站', 117.045, 27.75], ['蝶恋花站', 117.035, 27.772]
  ];

  // —— 换乘 / 制式转换节点 ——
  // [名称, lng, lat, 类型, 标注文案]（站名已在站点标注出现的用短文案，避免双标签堆叠）
  var NODES = [
    ['庐山站', 115.85, 29.55, '换乘节点', '○ 换乘节点'],
    ['抚州站', 116.36, 27.95, '换乘节点', '○ 换乘节点'],
    ['上饶站', 117.97, 28.45, '换乘节点', '○ 换乘节点'],
    ['灵山', 117.95, 28.62, '制式转换', '○ 灵山 · 制式转换'],
    ['资溪站', 117.07, 27.70, '制式转换', '○ 制式转换'],
    ['庐山索道下站', 115.88, 29.51, '制式转换', '○ 制式转换'],
    ['秀峰站', 115.89, 29.45, '制式转换', '○ 制式转换'],
    ['三叠泉站', 116.02, 29.54, '制式转换', '○ 制式转换']
  ];

  // —— 景区集散中心 ——
  var HUBS = [
    ['庐山', 115.87, 29.49], ['三清山', 118.06, 28.91], ['大觉山', 117.03, 27.78], ['婺源', 117.86, 29.25]
  ];

  // —— 工具 ——
  function findLine(name) {
    var C = window.GanpoConfig, pool = (C.commuterLines || []).concat(C.tourismLines || []);
    for (var i = 0; i < pool.length; i++) { if (pool[i].name === name) return pool[i]; }
    return null;
  }
  function P(c) { return new BMapGL.Point(c[0], c[1]); }
  function interp(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
  function add(o) { try { state.map.addOverlay(o); state.added.push(o); } catch (e) {} }

  function mkLabel(html, coord, cls, mTop) {
    try {
      var lb = new BMapGL.Label(html, { position: P(coord) });
      lb.setStyle({
        color: '#eaf6ff', background: 'rgba(10,18,32,0.92)',
        border: '1px solid ' + cls, padding: '2px 7px', fontSize: '10.5px',
        fontFamily: 'Microsoft YaHei, sans-serif', borderRadius: '3px',
        marginLeft: '-52px', marginTop: (mTop == null ? -30 : mTop) + 'px', whiteSpace: 'nowrap'
      });
      return lb;
    } catch (e) { return null; }
  }

  // 放大后才显示的细标注（用 add/remove 控制，不依赖 hide API）
  function gateLabel(html, coord, cls, mTop) {
    var lb = mkLabel(html, coord, cls, mTop);
    if (lb) state.gated.push({ lb: lb, added: false });
    return lb;
  }

  function lineStyle(cls) {
    if (cls === 'rack') return { color: COL.rack, weight: 7, opacity: 1 };
    if (cls === 'mono') return { color: COL.mono, weight: 5, opacity: 0.96 };
    return { color: COL.rail, weight: 5, opacity: 0.96 };
  }

  function drawSeg(coords, cls) {
    if (!coords || coords.length < 2) return null;
    var st = lineStyle(cls);
    var pl = new BMapGL.Polyline(coords.map(P), {
      strokeColor: st.color, strokeWeight: st.weight, strokeOpacity: st.opacity
    });
    add(pl);
    if (cls === 'rack') state.rackPls.push(pl);
    return pl;
  }

  // —— 主绘制 ——
  function draw() {
    clearOverlays();
    var C = window.GanpoConfig;

    // ① 通勤层：全线标准轮轨（蓝）
    (C.commuterLines || []).forEach(function (ln) { drawSeg(ln.coords, 'rail'); });

    // ② 旅游层：分段制式（紫=单轨 / 蓝=轮轨）
    (C.tourismLines || []).forEach(function (ln) {
      var c = ln.coords;
      if (ln.name === '赣东北环线·上饶婺源段') {
        var lingshan = [117.95, 28.62];      // 灵山（上饶—婺源区间转换点）
        drawSeg([c[0], lingshan], 'mono');
        drawSeg([lingshan, c[c.length - 1]], 'rail');
      } else if (ln.name === '赣东北环线·三清山龙虎山段') {
        drawSeg([c[0], c[1]], 'mono');       // 三清山—龙虎山
        drawSeg([c[1], c[2]], 'rail');       // 龙虎山—上饶
      } else if (ln.name === '环庐山旅游线') {
        drawSeg([c[0], c[1]], 'rail');       // 九江—庐山
        drawSeg([c[1], c[2]], 'mono');       // 庐山—西海（山地）
        drawSeg(c.slice(2), 'rail');         // 西海—九江
      } else if (ln.name === '大觉山旅游支线') {
        drawSeg([c[0], c[1]], 'rail');       // 抚州—资溪
        drawSeg([c[1], c[2]], 'rack');       // 资溪—大觉山（齿轨）
      } else if (ln.name === '赣西红色旅游线') {
        drawSeg([c[0], c[1]], 'rail');       // 吉安—井冈山
        drawSeg([c[1], c[2]], 'mono');       // 井冈山—明月山
        drawSeg(c.slice(2), 'rail');         // 明月山—安源—吉安
      } else if (ln.name === '赣东古韵旅游线') {
        drawSeg([c[0], c[1]], 'mono');       // 景德镇—瑶里
        drawSeg([c[1], c[2]], 'rail');       // 瑶里—龟峰
        drawSeg(c.slice(2), 'rail');         // 龟峰—上清—景德镇
      } else if (ln.name === '赣南客家旅游线') {
        drawSeg(c, 'rail');
      } else {
        drawSeg(c, 'rail');                  // 梅岭等
      }
    });

    // ③ 齿轨段（三处）：三清山沿用现有陡坡段几何；大觉山由支段本体表达；庐山见南麓观光环
    (C.SLOPE_SEGMENTS || []).forEach(function (sg) {
      if (sg.name === '庐山陡坡段' || sg.name === '大觉山齿轨段') return;
      drawSeg(sg.coords, 'rack');
    });

    // ④ 庐山南麓观光环（文字稿 2.1 新增几何；含秀峰—三叠泉齿轨段）
    (function () {
      var chain = [
        [115.85, 29.55], [115.88, 29.51], [115.87, 29.485], [115.845, 29.475],
        [115.835, 29.455], [115.855, 29.44], [115.89, 29.45], [115.92, 29.47],
        [115.95, 29.49], [115.99, 29.51], [116.02, 29.54], [116.03, 29.58]
      ];
      // 庐山站—索道下站：轮轨；索道下站—秀峰：单轨；秀峰—三叠泉：齿轨；三叠泉—北门：轮轨
      drawSeg([chain[0], chain[1]], 'rail');
      drawSeg([chain[1], chain[2], chain[3], chain[4], chain[5], chain[6]], 'mono');
      drawSeg([chain[6], chain[7], chain[8], chain[9], chain[10]], 'rack');
      drawSeg([chain[10], chain[11]], 'rail');
    })();

    // ⑤ 新增站点（方块）
    var sqIcon = null;
    try {
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12">' +
        '<rect x="2" y="2" width="8" height="8" fill="#eef4fb" stroke="#0a1628" stroke-width="1.6"/></svg>';
      sqIcon = new BMapGL.Icon('data:image/svg+xml;base64,' + btoa(svg), new BMapGL.Size(12, 12));
    } catch (e) {}
    NEW_STATIONS.forEach(function (s) {
      try {
        var mk = sqIcon ? new BMapGL.Marker(new BMapGL.Point(s[1], s[2]), { icon: sqIcon })
                        : new BMapGL.Marker(new BMapGL.Point(s[1], s[2]));
        add(mk);
        gateLabel('□ ' + s[0], [s[1], s[2]], 'rgba(238,244,251,.7)', -14);
      } catch (e) {}
    });

    // ⑥ 换乘 / 制式转换节点（白圈）
    NODES.forEach(function (n) {
      try {
        var ring = new BMapGL.Circle(new BMapGL.Point(n[1], n[2]), 4200, {
          strokeColor: '#ffffff', strokeWeight: 2.2, strokeOpacity: 0.95,
          fillColor: '#ffffff', fillOpacity: 0.12
        });
        add(ring);
        gateLabel(n[4] || ('○ ' + n[0] + ' · ' + n[3]), [n[1], n[2]], 'rgba(255,255,255,.75)', -32);
      } catch (e) {}
    });

    // ⑦ 景区集散中心（绿三角，常显标注）
    var triIcon = null;
    try {
      var svg2 = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="14">' +
        '<polygon points="8,1 15,13 1,13" fill="#00b050" stroke="#ffffff" stroke-width="1.4"/></svg>';
      triIcon = new BMapGL.Icon('data:image/svg+xml;base64,' + btoa(svg2), new BMapGL.Size(16, 14));
    } catch (e) {}
    HUBS.forEach(function (h) {
      try {
        var mk = triIcon ? new BMapGL.Marker(new BMapGL.Point(h[1], h[2]), { icon: triIcon })
                         : new BMapGL.Marker(new BMapGL.Point(h[1], h[2]));
        add(mk);
        var lb = mkLabel('▲ 景区集散 · ' + h[0], [h[1], h[2]], 'rgba(0,176,80,.85)', -24);
        if (lb) add(lb);
      } catch (e) {}
    });

    syncLabels();
    startBlink();
    console.log('[赣鄱智轨] 制式分段图层已绘制：线段+新增站点 ' + NEW_STATIONS.length +
      ' 个 / 转换节点 ' + NODES.length + ' 个 / 景区集散 ' + HUBS.length + ' 个');
  }

  function clearOverlays() {
    state.added.forEach(function (o) { try { state.map.removeOverlay(o); } catch (e) {} });
    state.gated.forEach(function (g) { if (g.added) { try { state.map.removeOverlay(g.lb); } catch (e) {} } });
    state.added = []; state.gated = []; state.rackPls = [];
    stopBlink();
  }

  function startBlink() {
    stopBlink();
    if (!state.rackPls.length) return;
    state.bright = true;
    state.timer = setInterval(function () {
      state.bright = !state.bright;
      state.rackPls.forEach(function (p) {
        try { p.setStrokeOpacity(state.bright ? 1 : 0.32); } catch (e) {}
      });
    }, 900);
  }
  function stopBlink() { if (state.timer) { clearInterval(state.timer); state.timer = null; } }

  // 放大到 10 级后再显示细标注（避免与既有站名、彼此重叠）
  function syncLabels() {
    if (!state.map) return;
    var show = false;
    try { show = state.map.getZoom() >= 10; } catch (e) {}
    state.gated.forEach(function (g) {
      try {
        if (show && !g.added) { state.map.addOverlay(g.lb); g.added = true; }
        else if (!show && g.added) { state.map.removeOverlay(g.lb); g.added = false; }
      } catch (e) {}
    });
  }

  // —— 开启 / 关闭 ——
  function dimOriginals() {
    var g = window.GanpoMap; if (!g) return;
    state.recolor = [];
    g.overlays.commuterLines.concat(g.overlays.tourismLines).forEach(function (pl) {
      try { state.recolor.push([pl, pl.getStrokeOpacity ? pl.getStrokeOpacity() : 0.9]); pl.setStrokeOpacity(0.12); } catch (e) {}
    });
    // 压暗原橙色齿轨段（由本图层玫红色替代）
    try {
      window._slopeBlinkPaused = true;
      (window._slopePls || []).forEach(function (p) { try { p.setStrokeOpacity(0.05); } catch (e) {} });
    } catch (e) {}
  }
  function restoreOriginals() {
    state.recolor.forEach(function (pair) { try { pair[0].setStrokeOpacity(pair[1] || 0.9); } catch (e) {} });
    state.recolor = [];
    try {
      window._slopeBlinkPaused = false;
      (window._slopePls || []).forEach(function (p) { try { p.setStrokeOpacity(0.95); } catch (e) {} });
    } catch (e) {}
  }

  function setMode(on) {
    state.on = !!on;
    var btn = document.getElementById('system-lines-btn');
    if (btn) { btn.classList.toggle('active', state.on); btn.textContent = state.on ? '制式分段·开启中' : '制式分段'; }
    var box = ensurePanel();
    if (state.on) {
      if (!state.map) return;
      dimOriginals();
      draw();
      if (box) box.style.display = 'block';
    } else {
      clearOverlays();
      restoreOriginals();
      if (box) box.style.display = 'none';
    }
  }

  // —— 图例面板 ——
  function ensurePanel() {
    if (state.built && document.getElementById('syl-panel')) return document.getElementById('syl-panel');
    injectStyle();
    var box = document.createElement('div');
    box.id = 'syl-panel';
    box.innerHTML =
      '<div class="syl-h">制式分段 · 轨道制式一览' +
        '<span class="syl-sub">依《全线轨道制式分段适配详细说明》</span>' +
        '<span class="syl-close" id="syl-close" title="关闭（可点工具栏按钮重开）">✕</span></div>' +
      '<div class="syl-rows">' +
        '<span><i style="background:#4d7fff"></i>标准轮轨（通勤层全线 + 旅游层平缓段）</span>' +
        '<span><i style="background:#b06bff"></i>跨座式单轨（旅游层山地段）</span>' +
        '<span><i style="background:#ff3d9a"></i>齿轨段 · 闪烁（仅三处：三清山 / 大觉山 / 庐山）</span>' +
        '<span><i class="sq"></i>新增站点（放大后显示站名）</span>' +
        '<span><i class="rg"></i>换乘 / 制式转换节点</span>' +
        '<span><i class="tri"></i>景区集散中心</span>' +
      '</div>' +
      '<div class="syl-note">与常规配色（黄/红/橙）明确区分；关闭本图层即恢复原配色。</div>';
    document.getElementById('app').appendChild(box);
    document.getElementById('syl-close').onclick = function () { setMode(false); };
    state.built = true;
    return box;
  }

  function injectStyle() {
    if (document.getElementById('syl-style')) return;
    var st = document.createElement('style');
    st.id = 'syl-style';
    st.textContent = [
      '#syl-panel{position:absolute;bottom:20px;left:50%;transform:translateX(-50%);z-index:9;',
      'width:480px;max-width:calc(100vw - 40px);background:rgba(0,14,30,.93);border:1px solid #1a4a7c;',
      'border-radius:8px;padding:9px 12px;color:#d0e6f5;font-size:11.5px;font-family:inherit;display:none;}',
      '#syl-panel .syl-h{color:#00d4ff;font-size:12.5px;font-weight:bold;display:flex;align-items:center;gap:8px;}',
      '#syl-panel .syl-sub{color:#5a8ab0;font-size:9.5px;font-weight:normal;}',
      '#syl-panel .syl-close{margin-left:auto;cursor:pointer;color:#5a8ab0;font-size:12px;}',
      '#syl-panel .syl-close:hover{color:#ff5566;}',
      '#syl-panel .syl-rows{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:7px;font-size:11px;color:#c6d3e2;}',
      '#syl-panel .syl-rows span{white-space:nowrap;}',
      '#syl-panel .syl-rows i{display:inline-block;width:16px;height:6px;border-radius:2px;margin-right:5px;vertical-align:1px;}',
      '#syl-panel .syl-rows i.sq{width:9px;height:9px;border:1px solid #fff;background:#eef4fb;border-radius:1px;}',
      '#syl-panel .syl-rows i.rg{width:10px;height:10px;border:2px solid #fff;background:transparent;border-radius:50%;}',
      '#syl-panel .syl-rows i.tri{width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;',
      'border-bottom:9px solid #00b050;background:transparent;border-radius:0;}',
      '#syl-panel .syl-note{font-size:9.5px;color:#3a6a90;margin-top:6px;}'
    ].join('');
    document.head.appendChild(st);
  }

  // —— 工具栏按钮 ——
  function buildButton(retries) {
    if (document.getElementById('system-lines-btn')) return;
    var tb = document.getElementById('heatmap-toolbar') || document.querySelector('.toolbar');
    if (!tb) {
      if ((retries || 0) < 20) setTimeout(function () { buildButton((retries || 0) + 1); }, 400);
      return;
    }
    var b = document.createElement('button');
    b.id = 'system-lines-btn';
    b.textContent = '制式分段';
    b.title = '一键切换"轨道制式"视图：蓝=标准轮轨 / 紫=跨座式单轨 / 玫=齿轨段（仅三处）；含新增站点、转换节点、景区集散中心';
    b.onclick = function () { setMode(!state.on); };
    tb.appendChild(b);
  }

  // —— 启动 ——
  window.addEventListener('ganpo:mapready', function () {
    state.map = (window.GanpoMap && window.GanpoMap.map) || null;
    buildButton();
    if (state.map) {
      state.map.addEventListener('zoomend', syncLabels);
    }
  });

  setTimeout(function () {
    if (!state.map && window.GanpoMap && window.GanpoMap.map) {
      state.map = window.GanpoMap.map;
      buildButton();
      try { state.map.addEventListener('zoomend', syncLabels); } catch (e) {}
    }
  }, 2500);

  window.GanpoSystemLines = {
    toggle: function () { setMode(!state.on); },
    show: function () { setMode(true); },
    hide: function () { setMode(false); },
    state: state
  };
})();
