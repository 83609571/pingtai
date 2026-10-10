# 赣鄱智轨 · L3 智能体层

> 江西省通勤-旅游复合轨道交通网络 · 枢纽拥堵治理智能体
> Planner-Executor-Critic 状态机 · 9 工具 · 9 护栏 · 零第三方依赖

## 快速开始

```bash
# 离线模式（默认，无需 API Key，0.23s 完成全链路）
python3 run_agent.py --scenario holiday --hub 南昌站

# 接入 DS4.1-Flash（DeepSeek V3）
export DS41_API_KEY=sk-xxx
export DS41_MODEL=deepseek-chat
python3 run_agent.py --provider deepseek --scenario holiday --hub 南昌站

# 前端
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000/
```

## 目录结构

```
agent/           L3 智能体层核心包（2856 行，纯 Python 标准库）
  agent_loop.py    Planner-Executor-Critic 主循环 + Critic 打分
  guardrail.py     9 条护栏规则（GR-01~GR-09）+ validate + repair
  tools.py         9 个 Function-Calling 工具 + 三段留痕
  llm_client.py    可插拔 LLM 客户端 + 离线确定性规划器
  trace.py         结构化证据链记录器
  schemas.py       数据契约 + 参数钳制 + 决策文档组装
  sim_adapter.py   L2 双引擎适配（TranStar 探针 + 自研三层饱和度假真）
  data_layer.py    L1 统一数据源（34 站契约）
  report.py        L5 Markdown 治理报告生成

run_agent.py     CLI 入口
api_server.py    在线 API 服务（纯标准库 HTTP：GET / 健康检查、GET /decision 取最近决策、POST /run 现场运行；单飞锁 + 120s 超时）
tests/           测试脚本
  mock_openai_server.py     三模式 mock 服务器（mock-error/empty/unsafe）
  adversarial_guardrail.py  对抗护栏确定性测试（三段留痕证据）
tools/
  trace_stats.py            trace 统计提取脚本
  dev/_probe_llm.py         开发辅助：LLM 密钥连通性探测（内部工具，打包时排除）

data/            数据 + 决策 JSON
  flow_holiday.json         节假日客流（34 站）
  flow_weekday.json         工作日客流（34 站）
  agent_decision_holiday.json   节假日决策文档
  agent_decision_weekday.json   工作日决策文档
  agent_decision.json           默认决策文档（兼容）

output/          运行产物（证据留痕）
  trace/          每次运行的完整工具调用证据链
  sim_results/    每次仿真的完整结果
  治理方案报告.md   L5 Markdown 治理报告

js/              前端（index.html / bmap.html 共用）
  agent-decision.js   决策面板（数据驱动 · 支持双决策切换）
css/             样式
lib/             ECharts 库

评估与提升/       内部评估文档 + 演示脚本 + 答辩问答库（打包时排除，不进交付包）
run_ds41_tests.sh  DS4.1-Flash 真实模型测试脚本（密钥就绪后执行）
start-server.bat / .sh / .command  本地预览启动（Win / macOS·Linux；须 http:// 访问，file:// 直开会因 CORS 拦截 data/*.json；macOS 首次需 chmod +x start-server.command）
sim/passenger_flow_sim.py         客流仿真脚本（34 站数据唯一来源；--check 校验输出与 data/ 一致）
```

## 关键设计

- **模型提方案、确定性系统做判定**：LLM 只负责方案构思与自然语言解释；打分、护栏、仿真全部是可复算的确定性代码
- **护栏三段留痕**：requested（原始请求）→ normalized_to（钳制）→ repaired_to（修复后执行），完整可审计
- **降级保护**：API 故障/空回复/越界参数三种异常均自动降级到确定性补齐，输出与 local 基线一致
- **trace 自证来源**：文件名嵌入 provider（`*_deepseek_trace.json`），不覆盖

## 环境变量

| 变量 | 用途 | 默认值 |
|---|---|---|
| `DS41_API_KEY` | DeepSeek 密钥 | 无（回落 local） |
| `DS41_MODEL` | 模型 ID | `deepseek-chat` |
| `DS41_BASE_URL` | API 端点 | `https://api.deepseek.com/v1` |
| `OPENAI_API_KEY` | OpenAI 兼容密钥（mock 测试用） | 无 |
| `OPENAI_BASE_URL` | OpenAI 端点 | `https://api.openai.com/v1` |
| `TRANSTAR_HOME` | TranStar 引擎目录 | 无（用自研引擎） |
