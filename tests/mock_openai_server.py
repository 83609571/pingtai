#!/usr/bin/env python3
"""Mock OpenAI 兼容服务器 · DS4.1-Flash 协议验证用

三种对抗模式（通过 OPENAI_MODEL 环境变量选择）：
  mock-error  → HTTP 500，验证 API 故障降级
  mock-empty  → 200 + 纯文本，无 tool_calls，验证空回复降级
  mock-unsafe → 第一轮返回 run_simulation 调用（越界参数 headway=2/cars=20/demand=3.0），
                后续轮返回空，验证护栏三段留痕闭环

用法：
  python3 tests/mock_openai_server.py            # 默认端口 8799
  python3 tests/mock_openai_server.py 9000       # 自定义端口

然后在另一个终端：
  export OPENAI_API_KEY=test-key
  export OPENAI_BASE_URL=http://127.0.0.1:8799/v1
  export OPENAI_MODEL=mock-unsafe
  python3 run_agent.py --provider openai --scenario holiday
"""
from __future__ import annotations

import json
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8799

# ---- 越界参数：发车间隔 2min + 编组 20辆 + 需求乘子 3.0 ----
# 触发 GR-01(headway<4) + GR-03(cars∉{2,4,6,8}) + GR-06(demand>2.0) + GR-09(配车不足)
UNSAFE_TOOL_CALLS = [{
    "id": "call_0",
    "type": "function",
    "function": {
        "name": "run_simulation",
        "arguments": json.dumps({
            "sim_engine": "auto",
            "config_json": {
                "scenario": "holiday",
                "headway_min": 2.0,
                "formation_cars": 20,
                "limit_level": 0,
                "demand_mult": 3.0
            },
            "hub": "南昌站"
        }, ensure_ascii=False)
    }
}]


def _make_response(model: str, content: str, tool_calls=None) -> dict:
    msg = {"role": "assistant", "content": content}
    if tool_calls:
        msg["tool_calls"] = tool_calls
    return {
        "id": f"chatcmpl-mock-{int(time.time())}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [{
            "index": 0,
            "message": msg,
            "finish_reason": "tool_calls" if tool_calls else "stop"
        }],
        "usage": {"prompt_tokens": 80, "completion_tokens": 40, "total_tokens": 120}
    }


class MockHandler(BaseHTTPRequestHandler):
    """处理 POST /v1/chat/completions 请求。"""

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b""
        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            payload = {}

        model = payload.get("model", "")
        messages = payload.get("messages", [])

        # 统计 tool 角色消息数 → 判断第几轮
        tool_msg_count = sum(1 for m in messages if m.get("role") == "tool")

        if model == "mock-error":
            self._send_json(
                {"error": {"message": "mock internal server error",
                           "type": "server_error", "code": "internal_error"}},
                status=500,
            )
            return

        if model == "mock-empty":
            self._send_json(_make_response(
                model, "作为AI助手，我无法直接执行仿真操作，建议提供更详细的需求描述。"
            ))
            return

        if model == "mock-unsafe":
            if tool_msg_count == 0:
                # 第一轮：下发越界参数，触发护栏
                self._send_json(_make_response(
                    model, "为极限测试护栏安全机制，直接下发极端参数组合。", UNSAFE_TOOL_CALLS
                ))
            else:
                # 后续轮：返回空，触发确定性补齐
                self._send_json(_make_response(
                    model, "参数已下发，等待系统处理结果。"
                ))
            return

        # 默认：返回空回复
        self._send_json(_make_response(model, "mock default response"))

    def do_GET(self):
        if "/models" in self.path:
            self._send_json({"object": "list", "data": [
                {"id": m, "object": "model"} for m in
                ("mock-error", "mock-empty", "mock-unsafe")
            ]})
        else:
            self.send_response(404)
            self.end_headers()

    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        # 简洁日志：只显示路径和状态码
        sys.stderr.write(f"  [mock] {self.command} {self.path} → {args[1] if len(args) > 1 else '?'}\n")


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), MockHandler)
    print(f"Mock OpenAI server on http://127.0.0.1:{PORT}/v1")
    print(f"  模式: mock-error(500) / mock-empty(空回复) / mock-unsafe(越界参数)")
    print(f"  用法: OPENAI_BASE_URL=http://127.0.0.1:{PORT}/v1 OPENAI_MODEL=mock-unsafe")
    print(f"  Ctrl+C 停止\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n正在关闭...")
        server.shutdown()


if __name__ == "__main__":
    main()
