#!/usr/bin/env python3
"""Trace 统计提取脚本

从 agent trace JSON 文件中提取关键指标：
  - LLM 调用次数、总 LLM 耗时
  - 工具调用次数、失败次数、已用工具集
  - 轮次数、Critic verdict 序列
  - 总事件数、总耗时

用法：
  python3 tools/trace_stats.py                          # 处理全部 trace
  python3 tools/trace_stats.py output/trace/xxx.json     # 单个文件
  python3 tools/trace_stats.py output/trace/             # 目录下全部
"""
from __future__ import annotations

import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def stats_from_trace(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        doc = json.load(f)

    events = doc.get("events", [])
    meta = doc.get("meta", {})
    engine = meta.get("engine", {})

    llm_calls = [e for e in events if e.get("kind") == "llm_call"]
    tool_calls = [e for e in events if e.get("kind") == "tool_call"]
    critic_events = [e for e in events if e.get("kind") == "critic"]
    phase_events = [e for e in events if e.get("kind") == "phase"]

    # 轮次数：从 phase 事件 round_N 提取最大 N
    rounds = set()
    for e in phase_events:
        name = e.get("name", "")
        if name.startswith("round_"):
            try:
                rounds.add(int(name.split("_")[1]))
            except (ValueError, IndexError):
                pass

    llm_duration = sum(e.get("duration_ms", 0) for e in llm_calls)
    verdicts = [e.get("verdict") for e in critic_events]
    failed = sum(1 for e in tool_calls if not e.get("ok", True))
    tools_used = sorted({e.get("tool") for e in tool_calls if e.get("tool")})

    # token usage（当前 trace 不记录 usage，但预留兼容）
    total_tokens = 0
    for e in llm_calls:
        usage = e.get("usage")
        if isinstance(usage, dict):
            total_tokens += usage.get("total_tokens", 0)

    return {
        "file": os.path.basename(path),
        "scenario": meta.get("scenario"),
        "hub": meta.get("hub"),
        "provider": engine.get("provider"),
        "model": engine.get("model"),
        "mode": engine.get("mode"),
        "total_events": doc.get("total_events"),
        "total_duration_ms": doc.get("total_duration_ms"),
        "llm_calls": len(llm_calls),
        "llm_duration_ms": llm_duration,
        "token_usage": total_tokens if total_tokens else None,
        "rounds": max(rounds) if rounds else 0,
        "tool_calls": len(tool_calls),
        "failed_tool_calls": failed,
        "tools_used": tools_used,
        "critic_verdicts": verdicts,
    }


def main() -> int:
    if len(sys.argv) < 2:
        trace_dir = os.path.join(ROOT, "output", "trace")
        paths = sorted(glob.glob(os.path.join(trace_dir, "*.json")))
    else:
        paths = []
        for arg in sys.argv[1:]:
            if os.path.isdir(arg):
                paths.extend(sorted(glob.glob(os.path.join(arg, "*.json"))))
            elif os.path.isfile(arg):
                paths.append(arg)

    if not paths:
        print("未找到 trace 文件。")
        return 1

    results = []
    for p in paths:
        try:
            results.append(stats_from_trace(p))
        except Exception as e:
            print(f"  ! 读取失败 {p}: {e}")

    # 汇总表
    hdr = f"{'file':<55} {'prov':<10} {'mode':<6} {'evts':>4} {'llm':>4} {'tool':>5} {'fl':>3} {'dur':>7} {'rnd':>3}"
    print(hdr)
    print("-" * len(hdr))
    for r in results:
        prov = str(r['provider'] or '?')
        mode = str(r['mode'] or '?')
        dur = r['total_duration_ms'] if r['total_duration_ms'] is not None else 0
        evts = r['total_events'] if r['total_events'] is not None else 0
        print(f"{r['file']:<55} {prov:<10} {mode:<6} "
              f"{evts:>4} {r['llm_calls']:>4} {r['tool_calls']:>5} "
              f"{r['failed_tool_calls']:>3} {dur:>5}ms {r['rounds']:>3}")
        if r["critic_verdicts"]:
            print(f"   {'':<55} critic: {' → '.join(r['critic_verdicts'])}")

    # JSON 输出
    out_path = os.path.join(ROOT, "output", "trace_stats.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"\n📄 JSON: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
