#!/usr/bin/env node
/* 赣鄱智轨 · 平台 UI 回归测试（puppeteer-core + 本机 Edge 无头）
 * 覆盖两条实测项：
 *   A. 大巴白点随层联动（工单 W-09：两层全关后大巴消失）
 *   B. 模块导航面板互斥（差距分析 1.3：换乘/优化面板不同屏共叠）
 * 运行前置：
 *   1) 已启动本地预览服务（start-server.bat / .sh，默认 8000 端口）
 *   2) npm i puppeteer-core（无浏览器下载，直接驱动本机 Edge）
 *   3) NODE_PATH 指向 puppeteer-core 所在 node_modules（或与本脚本同目录安装）
 * 用法：node tests/ui_check.js
 * 产物：评估与提升/验证截图_20261010/*.png + ui_check_result.json；退出码 0=全部通过
 */
'use strict';
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = path.resolve(__dirname, '..');
const OUT = path.join(BASE, '评估与提升', '验证截图_20261010');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,900'],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  const results = [];
  const assert = (name, cond, detail) => {
    results.push({ name, pass: !!cond, detail: detail || '' });
    console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : ''));
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // busDot 系列长度：优先 window.chart，兜底 echarts.getInstanceByDom 遍历
  const busLen = () => page.evaluate(() => {
    let c = window.chart || null;
    if (!c && window.echarts) {
      for (const el of document.querySelectorAll('div')) {
        const inst = window.echarts.getInstanceByDom(el);
        if (inst) { c = inst; break; }
      }
    }
    if (!c || !c.getOption) return -1;
    const s = (c.getOption().series || []).find((x) => x.id === 'busDot');
    return s ? (s.data ? s.data.length : -1) : -1;
  });
  const disp = (sel) => page.evaluate((s) => {
    const el = document.getElementById(s);
    return el ? el.style.display : null;
  }, sel);

  await page.goto('http://localhost:8000/index.html', { waitUntil: 'load', timeout: 30000 });
  await sleep(3000);
  assert('页面加载 chart 就绪', await page.evaluate(() => !!window.chart || !!(window.echarts && document.querySelector('.echarts-for-react, #main, #map'))));
  await page.screenshot({ path: path.join(OUT, '01_初始状态_大巴移动.png') });

  // ---------- A. 大巴白点随层联动 ----------
  const len0 = await busLen();
  assert('A1 初始大巴白点在图', len0 > 0, 'busDot.data.length=' + len0);
  await page.click('#btn-layer-commuter');
  await page.click('#btn-layer-tourism');
  await sleep(400);
  const len1 = await busLen();
  assert('A2 两层全关后大巴消失', len1 === 0, 'busDot.data.length=' + len1);
  await page.screenshot({ path: path.join(OUT, '02_两层全关_大巴消失.png') });
  await page.click('#btn-layer-commuter');
  await page.click('#btn-layer-tourism');
  await sleep(400);
  const len2 = await busLen();
  assert('A3 重开两层大巴恢复移动', len2 > 0, 'busDot.data.length=' + len2);
  await page.screenshot({ path: path.join(OUT, '03_两层恢复_大巴回归.png') });

  // ---------- B. 模块导航面板互斥 ----------
  await page.click('#btn-transfer');
  await sleep(250);
  assert('B1 打开换乘面板', (await disp('transfer-panel')) === 'block');
  await page.screenshot({ path: path.join(OUT, '04_换乘面板打开.png') });
  await page.click('#module-nav button[data-mod="agent"]');
  await sleep(250);
  assert('B2 切到智能体后换乘面板自动收起', (await disp('transfer-panel')) === 'none');
  await page.click('#module-nav button[data-mod="optimize"]');
  await sleep(250);
  assert('B3 切到优化后换乘面板仍收起', (await disp('transfer-panel')) === 'none');
  const optOpen = await page.evaluate(() => {
    const p = document.getElementById('optimize-panel');
    return !!p && p.style.display === 'block';
  });
  assert('B4 优化面板打开', optOpen);
  await page.screenshot({ path: path.join(OUT, '05_优化面板_换乘已收起.png') });
  await page.click('#module-nav button[data-mod="transfer"]');
  await sleep(250);
  assert('B5 切到换乘时换乘面板打开', (await disp('transfer-panel')) === 'block');
  const optClosed = await page.evaluate(() => {
    const p = document.getElementById('optimize-panel');
    return !p || p.style.display !== 'block';
  });
  assert('B6 同时优化面板已收起（互斥成立）', optClosed);
  await page.screenshot({ path: path.join(OUT, '06_切回换乘_优化已收起.png') });

  // ---------- C. 最终平台状态：智能体面板 + 真实决策数据 ----------
  await page.click('#module-nav button[data-mod="agent"]');
  await sleep(800);
  assert('C1 智能体决策文档经 HTTP 加载', await page.evaluate(() => !!window.__GANPO_DECISION__));
  await page.screenshot({ path: path.join(OUT, '07_最终平台状态_智能体面板.png') });

  const pass = results.filter((r) => r.pass).length;
  console.log('\n== 结果: ' + pass + '/' + results.length + ' 通过 ==');
  fs.writeFileSync(path.join(OUT, 'ui_check_result.json'), JSON.stringify(results, null, 2));
  await browser.close();
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error('[ERROR]', e.message); process.exit(2); });
