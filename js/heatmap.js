/* ======================================================================
 * 模块二 · 通勤-旅游客流叠加热力（百度 MapV GL）
 * ----------------------------------------------------------------------
 * 职责：在 3D 地图上叠加客流热力图层，支持工作日/周末节假日切换。
 *       数据来自 web/data/flow_weekday.json / flow_holiday.json（由
 *       sim/passenger_flow_sim.py 生成）。
 * 自包含：自己动态加载 MapVGL（百度数据可视化库），加载失败则退回
 *        BMapGL.Circle 气泡热力，保证一定有渲染。
 * 不破坏模块一：不复用其覆盖物，仅读 window.GanpoMap.map 实例。
 * ====================================================================== */
(function () {
  'use strict';

  // ★ 已修正 CDN 地址 ★
  // 原地址 mapvgl@1.0.30 是错误的：mapvgl 的版本号是 "1.0.0-beta.x" 格式，
  // 根本不存在 1.0.30，因此该地址长期返回 404，导致热力图一直静默退回到
  // Circle 气泡模式（外观与真热力完全不同）。现改用真实存在的版本 + 双 CDN 兜底。
  var MAPVGL_URL = 'https://cdn.jsdelivr.net/npm/mapvgl@1.0.0-beta.199/dist/mapvgl.min.js';
  var MAPVGL_FALLBACK = 'https://unpkg.com/mapvgl@1.0.0-beta.199/dist/mapvgl.min.js';
  var DATA_FILES = {
    weekday: 'data/flow_weekday.json',
    holiday: 'data/flow_holiday.json'
  };

  var state = {
    map: null,
    view: null,            // mapvgl.View
    heatLayer: null,       // mapvgl.HeatmapLayer（注意大小写）
    circles: [],           // Circle 回退覆盖物
    current: 'weekday',
    // ★ 默认关闭 ★
    // 客流热力是独立模块，不再开机就铺满全屏：
    // 只有点导航「客流热力」才显示，再点一次关闭。
    // 这样它不会在打开「应急演示」等其它模块时"顺带出现"。
    enabled: false,
    cache: {}              // {weekday: data, holiday: data}
  };

  // —— 颜色工具 ——
  function hexToRgb(h) {
    h = h.replace('#', '');
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
  }
  function mixColor(a, b, t) {
    var ca = hexToRgb(a), cb = hexToRgb(b);
    var r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
    var g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
    var bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }
  function intensityColor(t) {
    // 黄(弱) → 白(中) → 红(强)：三色系，大面积柔和叠加更容易连成一片
    if (t < 0.55) return mixColor('#ffcc00', '#ffffff', t / 0.55);
    return mixColor('#ffffff', '#ff2d3f', (t - 0.55) / 0.45);
  }

  // —— 工具栏 ——
  function buildToolbar() {
    if (document.getElementById('heatmap-toolbar')) return;
    var tb = document.createElement('div');
    tb.id = 'heatmap-toolbar';
    tb.className = 'toolbar';
    // ★ 已删除「显示 / 隐藏热力」按钮 ★
    // 原因：它与顶部导航的「客流热力」模块按钮功能完全重叠 —— 两处都能切换显隐，
    //       却各自维护状态，反复点击后互相"打架"（点导航反而把热力关掉）。
    // 现在显隐统一交给导航「客流热力」按钮（见 app.js 的 toggleHeat）。
    // 本工具栏只负责"场景切换"这一件事。
    tb.innerHTML =
      '<button data-scenario="weekday" class="active">工作日活动模式</button>' +
      '<button data-scenario="holiday">周末节假日模式</button>';
    document.getElementById('app').appendChild(tb);
    tb.addEventListener('click', function (e) {
      var btn = e.target;
      if (!btn.tagName || btn.tagName.toLowerCase() !== 'button') return;
      if (btn.id === 'heatmap-toggle') {
        state.enabled = !state.enabled;
        btn.classList.toggle('active', state.enabled);
        btn.textContent = state.enabled ? '隐藏热力' : '显示热力';
        applyVisibility();
        return;
      }
      var sc = btn.getAttribute('data-scenario');
      if (!sc) return;
      state.current = sc;
      tb.querySelectorAll('button[data-scenario]').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-scenario') === sc);
      });
      render();
    });
  }

  // 统一显隐入口：只有这里改 state.enabled，避免多处状态漂移
  function applyVisibility() {
    if (state.heatLayer) {
      try { state.heatLayer.setOptions({ visible: state.enabled }); } catch (e) {}
    }
    state.circles.forEach(function (c) {
      try { state.map.addOverlay(c); } catch (e) {}
      try { c.setVisible ? c.setVisible(state.enabled) : null; } catch (e) {}
    });
    if (!state.enabled) {
      state.circles.forEach(function (c) { try { state.map.removeOverlay(c); } catch (e) {} });
      if (state.heatLayer) { try { state.heatLayer.hide(); } catch (e) {} }
    } else {
      if (state.heatLayer) { try { state.heatLayer.show(); } catch (e) {} }
      state.circles.forEach(function (c) { try { state.map.addOverlay(c); } catch (e) {} });
    }
  }

  // —— 加载数据 ——
  function loadJSON(name) {
    return fetch(DATA_FILES[name]).then(function (r) { return r.json(); });
  }

  // —— MapVGL 真热力 ——
  function renderMapvgl(points) {
    clearCircles();
    if (state.heatLayer) {
      try {
        var data = points.map(function (p) {
          return { geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { count: p.count } };
        });
        state.heatLayer.setData(data);
        return;
      } catch (e) { /* 回退 */ }
    }
    try {
      state.view = new mapvgl.View({ map: state.map });
      // ★ 类名修正：原为 mapvgl.HeatMapLayer（大写 M）—— 实测该类不存在，
      //   mapvgl 只导出 HeatmapLayer（小写 m）。写错后构造时抛 TypeError，
      //   被下方 catch 静默吾掉，表现为“点了热力开关但地图上什么都没有”。
      //   这里同时保留两个类名探测，避免不同 mapvgl 版本再次出现同类问题。
      state.heatLayer = new (mapvgl.HeatmapLayer || mapvgl.HeatMapLayer)({
        size: 2200,          // 原 900 → 放大热力扩散半径，相邻点交融成片
        max: 40000,
        gradient: { 0.2: '#ffcc00', 0.55: '#ffffff', 1.0: '#ff2d3f' }   // 黄→白→红
      });
      state.view.addLayer(state.heatLayer);
      var data2 = points.map(function (p) {
        return { geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { count: p.count } };
      });
      state.heatLayer.setData(data2);
    } catch (e) {
      console.warn('[赣鄱智轨] MapVGL 热力初始化失败，回退到 Circle 气泡热力', e);
      renderCircles(points);
    }
  }

  // —— Circle 气泡热力回退 ——
  function renderCircles(points) {
    clearCircles();
    var max = Math.max.apply(null, points.map(function (p) { return p.count; })) || 1;
    points.forEach(function (p) {
      var pt = new BMapGL.Point(p.lng, p.lat);
      var t = Math.min(1, p.count / max);
      // 半径按强度，单位米 —— 放大后相邻圆互相覆盖，形成连片热区
      var radius = 4200 + t * 11000;
      var c = new BMapGL.Circle(pt, radius, {
        fillColor: intensityColor(t),
        fillOpacity: 0.32,
        strokeColor: 'transparent',
        strokeWeight: 0,
        strokeOpacity: 0
      });
      state.map.addOverlay(c);
      state.circles.push(c);
    });
  }
  function clearCircles() {
    state.circles.forEach(function (c) { try { state.map.removeOverlay(c); } catch (e) {} });
    state.circles = [];
  }

  // —— 渲染当前场景 ——
  function render() {
    var name = state.current;
    var data = state.cache[name];
    if (!data) return;
    var points = data.heatmap_points || [];
    if (window.mapvgl && state.map) {
      renderMapvgl(points);
    } else if (state.map) {
      renderCircles(points);
    }
    updateSidePanel(data);
    applyVisibility();   // 依开关状态决定显隐（默认关闭 → 渲染完立即收起）
  }

  function updateSidePanel(data) {
    var side = document.getElementById('side-panel');
    if (!side) return;
    var top3 = (data.stations || []).slice().sort(function (a, b) { return b.flow - a.flow; }).slice(0, 3);
    var label = data.scenario === 'weekday' ? '工作日（通勤走廊集中）' : '周末/节假日（旅游扩散）';
    // 侧栏与热力同生共死：热力关着时不弹客流信息面板
    side.style.display = state.enabled ? 'block' : 'none';
    side.innerHTML =
      '<span class="close" onclick="this.parentElement.style.display=\'none\'">✕</span>' +
      '<h3>客流热力 · ' + label + '</h3>' +
      '<div class="row">单位：<b>' + (data.unit || '人次/日') + '</b></div>' +
      '<div class="row">客流 Top3：</div>' +
      top3.map(function (s) {
        return '<div class="row">· ' + s.name + ' <b>' + s.flow.toLocaleString() + '</b></div>';
      }).join('') +
      '<div class="row" style="font-size:11px;color:#5a8ab0;border:none;margin-top:6px">' + (data.source_note || '') + '</div>';
  }

  // —— 启动 ——
  function start() {
    state.map = (window.GanpoMap && window.GanpoMap.map) || null;
    if (!state.map) return;
    buildToolbar();
    // 并行：加载两份数据 + 动态加载 mapvgl
    var dp = Promise.all([loadJSON('weekday'), loadJSON('holiday')]).then(function (arr) {
      state.cache.weekday = arr[0];
      state.cache.holiday = arr[1];
    });
    ensureMapvgl().then(function () {
      dp.then(render);
    });
    // 数据先到也先渲染（circle 回退）
    dp.then(function () { if (!window.mapvgl) render(); });
  }

  // 依次尝试多个 CDN，任一成功即返回；全部失败才退回 Circle 气泡
  function ensureMapvgl() {
    return new Promise(function (resolve) {
      if (window.mapvgl) return resolve();
      var urls = [MAPVGL_URL, MAPVGL_FALLBACK];
      function tryNext(i) {
        if (i >= urls.length) {
          console.warn('[赣鄱智轨] MapVGL 所有 CDN 均加载失败，热力退回 Circle 气泡');
          return resolve();
        }
        var s = document.createElement('script');
        s.src = urls[i];
        s.onload = function () {
          if (window.mapvgl) {
            console.log('[赣鄱智轨] MapVGL 加载成功：' + urls[i]);
            resolve();
          } else {
            tryNext(i + 1);   // 脚本 200 但内容异常时也继续尝试下一个
          }
        };
        s.onerror = function () { tryNext(i + 1); };
        document.head.appendChild(s);
      }
      tryNext(0);
    });
  }

  // 等地图就绪
  window.addEventListener('ganpo:mapready', start);

  // 暴露给 Step9 模块导航
  window.GanpoHeatmap = {
    show: function () { state.enabled = true; applyVisibility(); },
    hide: function () { state.enabled = false; applyVisibility(); },
    isOn: function () { return state.enabled; },
    // 单一切换入口：返回切换后的状态，供导航「客流热力」按钮同步高亮
    toggle: function () { state.enabled = !state.enabled; applyVisibility(); return state.enabled; },
    setScenario: function (s) { if (DATA_FILES[s]) { state.current = s; render(); } }
  };
})();
