/* ======================================================================
 * 模块一 · 线网一张图（百度地图 JSAPI GL 基座）
 * ----------------------------------------------------------------------
 * 职责：初始化 3D 地图底座 + 通勤(蓝)/旅游(绿)线路 + 站点 Marker +
 *       点击 InfoWindow。暴露 window.GanpoMap 供后续模块(热力/列车/
 *       智能体面板/应急)复用地图实例与覆盖物。
 * 依赖：先加载 config.js（window.GanpoConfig），再由 index.html 动态
 *       注入百度地图 JSAPI GL（&ak=...），加载完成后回调 initMap()。
 * ====================================================================== */
(function () {
  'use strict';

  // 生成彩色圆点图标（SVG data URL），按线路类型染色
  function dotIcon(color) {
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18">' +
      '<circle cx="9" cy="9" r="6" fill="' + color + '" stroke="#ffffff" stroke-width="2"/>' +
      '</svg>';
    var url = 'data:image/svg+xml;base64,' + btoa(svg);
    // BMapGL.Icon(图片地址, 尺寸)；尺寸对象用 BMapGL.Size
    try {
      return new BMapGL.Icon(url, new BMapGL.Size(18, 18));
    } catch (e) {
      return null; // 退回默认红色 pin
    }
  }

  // 创建带样式的站点名 Label
  function makeLabel(name, pt, color) {
    try {
      var label = new BMapGL.Label(name, { position: pt });
      label.setStyle({
        color: '#fff',
        background: 'rgba(0,20,40,0.75)',
        border: '1px solid ' + color,
        padding: '2px 6px',
        fontSize: '11px',
        fontFamily: 'Microsoft YaHei, sans-serif',
        borderRadius: '3px',
        marginLeft: '-24px',
        marginTop: '-26px',
        whiteSpace: 'nowrap'
      });
      return label;
    } catch (e) {
      return null;
    }
  }

  // InfoWindow 内容
  function stationInfoHTML(s) {
    var typeName = s.type === 'commuter' ? '通勤层' : '旅游层';
    var typeColor = s.type === 'commuter' ? GanpoConfig.COLOR.commuter : GanpoConfig.COLOR.tourism;
    return '' +
      '<div style="font-family:Microsoft YaHei,sans-serif;min-width:200px;padding:4px 2px">' +
        '<h3 style="color:' + GanpoConfig.COLOR.accent + ';margin:0 0 8px;font-size:15px">' + s.name + '</h3>' +
        '<div style="font-size:12px;line-height:1.8;color:#d0e6f5">' +
          '日均客流：<b style="color:' + GanpoConfig.COLOR.accent + '">' + s.dailyFlow + '</b><br>' +
          '接驳方式：' + s.transfer + '<br>' +
          '周边景区：' + s.scenic + '<br>' +
          '线路类型：<b style="color:' + typeColor + '">' + typeName + '</b>' +
        '</div>' +
      '</div>';
  }

  // 齿轨爬坡段 InfoWindow 内容（依《以轨代巴》方案 5.2）
  function slopeInfoHTML(sg) {
    return '' +
      '<div style="font-family:Microsoft YaHei,sans-serif;min-width:230px;padding:4px 2px">' +
        '<h3 style="color:#ff8800;margin:0 0 8px;font-size:15px">⚙ ' + sg.name + '</h3>' +
        '<div style="font-size:12px;line-height:1.8;color:#d0e6f5">' +
          '爬坡坡度：<b style="color:#ff8800">' + sg.grade + '</b><br>' +
          '制式：' + sg.system + '<br>' +
          '借鉴案例：' + sg.ref + '<br>' +
          '技术要点：' + sg.note +
        '</div>' +
      '</div>';
  }

  window.initMap = function () {
    if (!window.BMapGL) {
      // ★ 降级保护 ★
      // 百度地图脚本未能加载时（AK 失效 / 白名单未放行当前域名 / 当日配额用尽 / 网络受限），
      // 不再只给一段冷冰冰的报错，而是直接给出可继续观看的入口：
      // 零 AK 版 index.html 不依赖百度地图，六大模块内容完全一致。
      // 这样"无论评委用什么网络、AK 是否可用"，都一定能看到这套内容。
      console.error('[赣鄱智轨] BMapGL 未加载：请检查 js/local-ak.js 是否已配置 AK（或 URL 带 ?ak=）、' +
                'referer 白名单是否包含当前域名与端口、当日配额是否用尽。');
      var box = document.getElementById('map_container');
      if (box) {
        box.innerHTML =
          '<div style="padding:70px 30px;color:#7ab8e0;font-family:Microsoft YaHei;text-align:center;line-height:1.95">' +
            '<h2 style="color:#00d4ff;margin-bottom:16px">百度底图暂时不可用</h2>' +
            '<p style="color:#a0c8e0">页面其余功能与数据均正常。<br>' +
            '可切换到<b style="color:#ffffff">零 AK 版</b>继续查看，六大模块完全一致。</p>' +
            '<p style="margin:26px 0">' +
              '<a href="index.html" style="display:inline-block;padding:13px 34px;background:#00d4ff;color:#001020;' +
              'border-radius:6px;text-decoration:none;font-weight:bold;font-size:15px">前往零 AK 版 →</a>' +
            '</p>' +
            '<p style="font-size:12px;color:#5a8ab0">可能原因：AK 未生效 / referer 白名单未包含当前域名 / 当日配额用尽 / 网络受限</p>' +
            '<p style="font-size:12px;color:#3a6a90">建议在百度控制台把 referer 白名单设为' +
              '<b>实际部署的域名/地址</b>（如 <code>localhost:8000</code>、<code>127.0.0.1:8000</code>）；' +
              '<b>不要设为 <code>*</code></b> —— 通配白名单配合已公开的 AK 等同于把配额敞开给任何人盗刷。</p>' +
          '</div>';
      }
      return;
    }

    var C = GanpoConfig;
    var map = new BMapGL.Map('map_container');

    // ==== 视野收束：只要江西省，不要周边省份 ====
    // 江西省实际地理范围约 经度 113.6~118.5、纬度 24.5~30.1
    var JX_MIN = new BMapGL.Point(113.5, 24.4);
    var JX_MAX = new BMapGL.Point(118.6, 30.2);
    var JX_CENTER = new BMapGL.Point(115.95, 27.35);

    map.enableScrollWheelZoom(true);
    map.enableDragging(true);

    // 3D 倾斜视角（原 55° 过斜，斜看会露出大片邻省；收到 35° 仍然立体但更聚焦）
    try {
      map.setHeading(30);   // 水平旋转角
      map.setTilt(35);      // 俯仰角
    } catch (e) {}

    // 先给一个近似值，再用 setViewport 按屏幕尺寸自适应，让省界刚好铺满视口
    map.centerAndZoom(JX_CENTER, 9);
    try { map.setViewport([JX_MIN, JX_MAX]); } catch (e) { map.setZoom(9); }

    // 缩放限位：7（略小于全省）~ 13（城区细节）
    // 防止滚轮缩到全国（<7）或放大到街道（>13）而丢失"江西全省"这个主体
    try { map.setMinZoom(7); map.setMaxZoom(13); } catch (e) {}

    // 拖拽回弹：把地图中心锁在江西省范围内，拖不出去
    function clampCenter() {
      try {
        var c = map.getCenter();
        var lng = Math.min(118.3, Math.max(113.7, c.lng));
        var lat = Math.min(29.9, Math.max(24.7, c.lat));
        if (Math.abs(lng - c.lng) > 1e-6 || Math.abs(lat - c.lat) > 1e-6) {
          map.panTo(new BMapGL.Point(lng, lat));
        }
      } catch (e) {}
    }
    map.addEventListener('dragend', clampCenter);

    // 江西省界高亮描边（强化"只关注江西"的视觉边界）
    try {
      var bd = new BMapGL.Boundary();
      bd.get('江西省', function (rs) {
        try {
          if (!rs || !rs.boundaries || !rs.boundaries.length) return;
          var pts = rs.boundaries[0].split(';').map(function (p) {
            var xy = p.split(',');
            return new BMapGL.Point(parseFloat(xy[0]), parseFloat(xy[1]));
          });
          map.addOverlay(new BMapGL.Polyline(pts, {
            strokeColor: '#00d4ff',
            strokeWeight: 2,
            strokeOpacity: 0.8
          }));
        } catch (e) {}
      });
    } catch (e) {}

    // —— 江西省 11 个设区市行政区划边界（市级划分）——
    // 百度 Boundary 按行政区名取边界；并发请求过多会触发限流 →
    // 改为「串行 + 间隔 180ms」逐个获取，逐个绘制。
    // 样式用低饱和青蓝细虚线：只作"市级划分"的地理参照，不与黄/红主色线网争焦点。
    (function cityBoundaries() {
      var CITIES = ['南昌市', '九江市', '景德镇市', '萍乡市', '新余市', '鹰潭市',
                    '赣州市', '吉安市', '宜春市', '抚州市', '上饶市'];
      var CITY_STYLE = {
        strokeColor: '#4fa8d8',
        strokeWeight: 1.3,
        strokeOpacity: 0.75,
        strokeStyle: 'dashed',
        strokeDashArray: [7, 6]
      };
      var idx = 0, done = 0;

      function next() {
        if (idx >= CITIES.length) {
          console.log('[赣鄱智轨] 市级行政区划边界已绘制：' + done + '/' + CITIES.length + ' 个设区市');
          return;
        }
        var name = CITIES[idx++];
        try {
          new BMapGL.Boundary().get(name, function (rs) {
            try {
              if (rs && rs.boundaries && rs.boundaries.length) {
                rs.boundaries.forEach(function (bd) {
                  var cpts = bd.split(';').map(function (s) {
                    var xy = s.split(',');
                    return new BMapGL.Point(parseFloat(xy[0]), parseFloat(xy[1]));
                  });
                  if (cpts.length > 1) map.addOverlay(new BMapGL.Polyline(cpts, CITY_STYLE));
                });
                done++;
              }
            } catch (e) {}
            setTimeout(next, 180);   // 串行节流，避开百度限流
          });
        } catch (e) { setTimeout(next, 180); }
      }
      next();
    })();

    // —— 百度实时路况（流量信息）——
    // ★ 默认关闭：路况图层是密集的红/黄/绿路网，与线网色系（通勤黄 / 旅游红）
    //   严重冲突，全部铺开会把线网整个"淹掉"。改为按需开启，
    //   由工具栏「显示实时路况」按钮控制，做"公路拥堵 vs 轨道准点"对比时再打开。
    var trafficLayer = null, trafficOn = false;
    try {
      trafficLayer = new BMapGL.TrafficLayer();
      window._trafficLayer = trafficLayer;
    } catch (e) {
      console.warn('[赣鄱智轨] 当前百度地图版本不支持路况图层');
    }

    window.toggleTraffic = function (force) {
      if (!trafficLayer) return false;
      var on = (typeof force === 'boolean') ? force : !trafficOn;
      try {
        if (on) map.addTileLayer(trafficLayer);
        else map.removeTileLayer(trafficLayer);
        trafficOn = on;
      } catch (e) { return false; }
      return on;
    };

    // 工具栏按钮（等工具栏容器就绪后再插入）
    setTimeout(function () {
      if (document.getElementById('traffic-btn')) return;
      var tb = document.querySelector('.toolbar') || document.getElementById('heatmap-toolbar');
      if (!tb) return;
      var b = document.createElement('button');
      b.id = 'traffic-btn';
      b.textContent = '显示实时路况';
      b.onclick = function () {
        var on = window.toggleTraffic();
        b.classList.toggle('active', on);
        b.textContent = on ? '隐藏实时路况' : '显示实时路况';
      };
      tb.appendChild(b);
    }, 1000);

    // —— 省外遮罩：只保留江西省，省外用与背景同色的多边形盖住 ——
    // （百度 Polygon 不支持"挖洞"，故用 4 个矩形覆盖江西包围盒以外的全部区域）
    (function provinceMask() {
      var BOX = { minLng: 113.45, maxLng: 118.65, minLat: 24.35, maxLat: 30.25 };
      var rects = [
        // 上（北）
        [[-180, BOX.maxLat], [180, BOX.maxLat], [180, 85], [-180, 85]],
        // 下（南）
        [[-180, -85], [180, -85], [180, BOX.minLat], [-180, BOX.minLat]],
        // 左（西）
        [[-180, BOX.minLat], [BOX.minLng, BOX.minLat], [BOX.minLng, BOX.maxLat], [-180, BOX.maxLat]],
        // 右（东）
        [[BOX.maxLng, BOX.minLat], [180, BOX.minLat], [180, BOX.maxLat], [BOX.maxLng, BOX.maxLat]]
      ];
      rects.forEach(function (path) {
        try {
          map.addOverlay(new BMapGL.Polygon(
            path.map(function (p) { return new BMapGL.Point(p[0], p[1]); }),
            {
              strokeColor: 'transparent', strokeWeight: 0, strokeOpacity: 0,
              fillColor: '#0a1628', fillOpacity: 0.96
            }
          ));
        } catch (e) {}
      });
      console.log('[赣鄱智轨] 省外遮罩已启用：仅显示江西省');
    })();

    // 暗色底图
    try { map.setMapStyleV2(C.DARK_STYLE); } catch (e) {}

    var overlays = {
      commuterLines: [],   // Polyline 数组
      tourismLines:  [],
      stationMarkers: [],  // Marker 数组
      stationLabels:  []   // Label 数组
    };

    // —— 分层显隐管理（「通勤层」「旅游层」两个可自主选择的模块开关）——
    // 每一层的所有覆盖物（线路 / 站点 / 大巴点）都登记进 layerObjects，
    // 切换时统一 add / remove，保证「线、站、大巴」三者永远同进同出 ——
    // 因此"两层都不选"时，大巴会随线路一起消失，不会出现线没了白点还在飘。
    var LAYERS = { commuter: true, tourism: true };
    var layerObjects = { commuter: [], tourism: [] };
    var stationObjects = [];   // { mk, lb, layers:[...] }（换乘站可同时属两层）
    function reg(obj, layer) { (layerObjects[layer] = layerObjects[layer] || []).push(obj); }

    // —— 通勤层线路（黄）——
    C.commuterLines.forEach(function (line) {
      var pts = line.coords.map(function (c) { return new BMapGL.Point(c[0], c[1]); });
      var pl = new BMapGL.Polyline(pts, {
        strokeColor: C.COLOR.commuter,
        strokeWeight: 4,          // 线宽 6 → 4：整体收细，减少对站名/热力的遮挡
        strokeOpacity: 0.9
      });
      map.addOverlay(pl);
      overlays.commuterLines.push(pl);
      reg(pl, 'commuter');
    });

    // —— 旅游层线路（红）——
    C.tourismLines.forEach(function (line) {
      var pts = line.coords.map(function (c) { return new BMapGL.Point(c[0], c[1]); });
      var pl = new BMapGL.Polyline(pts, {
        strokeColor: C.COLOR.tourism,
        strokeWeight: 4,          // 线宽 6 → 4：与通勤层保持一致
        strokeOpacity: 0.9
      });
      map.addOverlay(pl);
      overlays.tourismLines.push(pl);
      reg(pl, 'tourism');
    });

    // —— 站点标注：圆点 + 中文站名（一站一标，与线网一一对应）——
    // 同名站点（如南昌站同时属于昌九/昌抚/梅岭等多条线）先经 allStations() 去重，
    // 保证同一站点只出现一个圆点 + 一个名称标签，不会叠成重影。
    // 配色沿用分层口径：通勤站黄点、旅游站红点，与所属线路同色。
    // 先统计每个站名归属哪些层（换乘站如南昌站可同时属于通勤层与旅游层）
    var stLayerMap = {};
    function markStation(name, layer) {
      stLayerMap[name] = stLayerMap[name] || {};
      stLayerMap[name][layer] = true;
    }
    C.commuterLines.forEach(function (l) {
      (l.stations || []).forEach(function (s) { markStation(s.name, 'commuter'); });
    });
    C.tourismLines.forEach(function (l) {
      (l.stations || []).forEach(function (s) { markStation(s.name, 'tourism'); });
    });

    var stAll = C.allStations();
    stAll.forEach(function (s) {
      if (!s.coord) return;
      var spt = new BMapGL.Point(s.coord[0], s.coord[1]);
      var scol = s.type === 'commuter' ? C.COLOR.commuter : C.COLOR.tourism;
      var owners = Object.keys(stLayerMap[s.name] || { commuter: true });

      // ① 圆点（点击弹站点信息）
      var smk = null;
      try {
        var sic = dotIcon(scol);
        smk = sic ? new BMapGL.Marker(spt, { icon: sic }) : new BMapGL.Marker(spt);
      } catch (e) { smk = null; }
      if (smk) {
        map.addOverlay(smk);
        overlays.stationMarkers.push(smk);
        smk.addEventListener('click', function () {
          var iw = new BMapGL.InfoWindow(stationInfoHTML(s), { width: 280 });
          map.openInfoWindow(iw, spt);
        });
      }

      // ② 站名标签
      var slb = makeLabel(s.name, spt, scol);
      if (slb) { map.addOverlay(slb); overlays.stationLabels.push(slb); }

      // ③ 登记分层归属：所属层中"任一可见"，该站就显示
      stationObjects.push({ mk: smk, lb: slb, layers: owners });
    });
    console.log('[赣鄱智轨] 站点标注完成：' + stAll.length + ' 个站点（同名已去重）');

    // —— 齿轨爬坡段（依《以轨代巴》方案 5.2）：橙色标记 + 闪烁 + 点击弹技术参数 ——
    var slopePls = [];
    (C.SLOPE_SEGMENTS || []).forEach(function (sg) {
      var pl = new BMapGL.Polyline(
        sg.coords.map(function (c) { return new BMapGL.Point(c[0], c[1]); }),
        // 齿轨段保持"比主线粗一档"，主线收细到 4 后仍能一眼识别（7 → 5）
        { strokeColor: '#ff8800', strokeWeight: 5, strokeOpacity: 0.95 }
      );
      map.addOverlay(pl);
      slopePls.push(pl);
      pl.addEventListener('click', function () {
        var iw = new BMapGL.InfoWindow(slopeInfoHTML(sg), { width: 300 });
        map.openInfoWindow(iw, new BMapGL.Point(sg.coords[0][0], sg.coords[0][1]));
      });
      // 段中点标注名称
      var mid = sg.coords[Math.floor(sg.coords.length / 2)];
      var lb = makeLabel('⚙ ' + sg.name, new BMapGL.Point(mid[0], mid[1]), '#ff8800');
      if (lb) map.addOverlay(lb);
    });
    // 闪烁：1s 一次透明度脉动
    if (window._slopeBlinkTimer) clearInterval(window._slopeBlinkTimer);
    window._slopePls = slopePls;              // 供“制式分段”图层压暗/恢复
    window._slopeBlinkPaused = false;
    var slopeBright = true;
    window._slopeBlinkTimer = setInterval(function () {
      if (window._slopeBlinkPaused) return;   // 制式分段开启时暂停，由该图层接管齿轨显示
      slopeBright = !slopeBright;
      slopePls.forEach(function (p) {
        try { p.setStrokeOpacity(slopeBright ? 0.95 : 0.22); } catch (e) {}
      });
    }, 1000);

    // —— 原大巴通行：白点沿「公路绕行走向」移动，与轨道线形成对比 ——
    // 数据：C.BUS_ROUTES（8 条公路走向，弯绕多、里程长）
    // 表现：白点匀速慢行（260ms/帧），速度显著低于列车（65ms/帧）。
    //       同屏即可看出「公路绕远 + 慢」 vs 「轨道直达 + 快」。
    (function busAnim() {
      var routes = C.BUS_ROUTES || [];
      if (!routes.length) return;

      // 白点图标（白心 + 浅蓝描边，与彩色站点明确区分）
      function busIcon() {
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14">' +
          '<circle cx="7" cy="7" r="5" fill="#ffffff" stroke="#8fd0ff" stroke-width="2"/></svg>';
        try {
          return new BMapGL.Icon('data:image/svg+xml;base64,' + btoa(svg), new BMapGL.Size(14, 14));
        } catch (e) { return null; }
      }

      // 折线插值：每段 n 份 → 平滑点列
      function interp(path, n) {
        var out = [];
        for (var i = 0; i < path.length - 1; i++) {
          var a = path[i], b = path[i + 1];
          for (var j = 0; j < n; j++) {
            var t = j / n;
            out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
          }
        }
        out.push(path[path.length - 1]);
        return out;
      }

      var buses = [];
      routes.forEach(function (r, idx) {
        if (!r.road || r.road.length < 2) return;
        var pts = interp(r.road, 22);
        var mk = null;
        try {
          var ic = busIcon();
          mk = ic ? new BMapGL.Marker(new BMapGL.Point(pts[0][0], pts[0][1]), { icon: ic })
                  : new BMapGL.Marker(new BMapGL.Point(pts[0][0], pts[0][1]));
          map.addOverlay(mk);
        } catch (e) { mk = null; }
        if (!mk) return;
        // 登记到所属层：大巴点随该层开关一起显隐
        reg(mk, r.layer || 'tourism');
        buses.push({
          mk: mk, pts: pts,
          layer: r.layer || 'tourism',
          // 错峰起步，避免白点同时从起点涌出
          i: Math.floor(pts.length * idx / routes.length),
          label: r.from + '→' + r.to
        });
      });

      if (!buses.length) return;
      if (window._busTimer) clearInterval(window._busTimer);
      window._busTimer = setInterval(function () {
        buses.forEach(function (b) {
          b.i++;
          if (b.i >= b.pts.length) b.i = 0;
          var p = b.pts[b.i];
          try { b.mk.setPosition(new BMapGL.Point(p[0], p[1])); } catch (e) {}
        });
      }, 260);

      // 点击白点 → 说明这是「原大巴绕行」
      buses.forEach(function (b) {
        try {
          b.mk.addEventListener('click', function () {
            var iw = new BMapGL.InfoWindow(
              '<div style="font-family:Microsoft YaHei;font-size:12px;line-height:1.8;color:#d0e6f5;min-width:190px">' +
                '<h3 style="color:#ffffff;margin:0 0 6px;font-size:14px">🚌 原大巴绕行 · ' + b.label + '</h3>' +
                '白色圆点沿<b>现有公路走向</b>移动（含盘山绕行段）。<br>' +
                '与同屏轨道线对比：公路<b>绕远 + 受路况影响</b>，轨道<b>短捷 + 时间确定</b>。' +
              '</div>', { width: 250 });
            map.openInfoWindow(iw, b.mk.getPosition());
          });
        } catch (e) {}
      });

      console.log('[赣鄱智轨] 原大巴通行点动画已启动：' + buses.length + ' 条公路走向');
    })();

    // 站点显隐重算：所属层中"任一可见"即显示，
    // 避免换乘站（如南昌站同属通勤层与旅游层）因关掉一层而消失。
    function refreshStations() {
      stationObjects.forEach(function (st) {
        var on = (st.layers || []).some(function (l) { return LAYERS[l]; });
        if (st.mk) { try { on ? map.addOverlay(st.mk) : map.removeOverlay(st.mk); } catch (e) {} }
        if (st.lb) { try { on ? map.addOverlay(st.lb) : map.removeOverlay(st.lb); } catch (e) {} }
      });
    }

    // 暴露给后续模块
    window.GanpoMap = {
      map: map,
      overlays: overlays,
      config: C,

      // —— 分层显隐（导航「通勤层」「旅游层」两个模块开关调用）——
      // 一次性切换该层的：线路 + 站点 + 大巴点。
      // 两层都关闭 → 线路、站点、大巴全部消失
      // （大巴点也登记在 layerObjects 中，所以"不选模块时大巴一同消失"自动成立）。
      setLayer: function (layer, on) {
        if (!(layer in LAYERS)) return false;
        LAYERS[layer] = !!on;
        (layerObjects[layer] || []).forEach(function (o) {
          try { LAYERS[layer] ? map.addOverlay(o) : map.removeOverlay(o); } catch (e) {}
        });
        refreshStations();
        console.log('[赣鄱智轨] ' + (layer === 'commuter' ? '通勤层' : '旅游层') +
                    ' → ' + (LAYERS[layer] ? '显示' : '隐藏'));
        return LAYERS[layer];
      },
      getLayer: function (layer) { return !!LAYERS[layer]; },
      getLayers: function () { return { commuter: LAYERS.commuter, tourism: LAYERS.tourism }; },

      // 工具：按线路名找 Polyline（应急改线/高亮用）
      findLine: function (name) {
        var all = overlays.commuterLines.concat(overlays.tourismLines);
        // 注意：Polyline 本身没存 name，这里按索引与 config 顺序一致
        var idx = -1, pool = null;
        C.commuterLines.forEach(function (l, i) { if (l.name === name) { idx = i; pool = 'commuter'; } });
        C.tourismLines.forEach(function (l, i) { if (l.name === name) { idx = i; pool = 'tourism'; } });
        if (pool === 'commuter') return overlays.commuterLines[idx];
        if (pool === 'tourism')  return overlays.tourismLines[idx];
        return null;
      },
      // 工具：把 [lng,lat] 数组转 Point 数组
      toPoints: function (coords) {
        return coords.map(function (c) { return new BMapGL.Point(c[0], c[1]); });
      }
    };

    // 通知其他模块：地图就绪
    window.dispatchEvent(new CustomEvent('ganpo:mapready', { detail: window.GanpoMap }));
    console.log('[赣鄱智轨] 模块一·线网一张图 已就绪');
  };
})();
