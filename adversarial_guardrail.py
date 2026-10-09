#!/usr/bin/env python3
"""对抗护栏测试 · 确定性三段留痕证据

直接调用 guardrail.validate() / schemas.normalize_config() / guardrail.repair()，
不经过 LLM，确定性产出 requested → normalized_to → repaired_to 三段证据。

三组越界参数：
  1. headway=2 / cars=20 / demand=3.0  → GR-01 + GR-03 + GR-06 (+ GR-09)
  2. headway=8 / cars=8 / fleet=480    → GR-09 (配车不足)
  3. headway=35 / cars=5 / limit=5 / demand=0.3 → GR-02 + GR-03 + GR-04 + GR-06

输出: output/trace/adversarial_guardrail_evidence.json
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

from agent import guardrail as G
from agent import schemas as S

RULE_FIELDS = ("headway_min", "formation_cars", "limit_level", "demand_mult")

TEST_CASES = [
    {
        "name": "极限越界：超短发车间隔 + 超长编组 + 超高需求乘子",
        "params": {
            "scenario": "holiday",
            "headway_min": 2.0,
            "formation_cars": 20,
            "limit_level": 0,
            "demand_mult": 3.0,
        },
        "expect_rules": ["GR-01", "GR-03", "GR-06"],
    },
    {
        "name": "配车不足：8min 高密度运营未增购车辆",
        "params": {
            "scenario": "holiday",
            "headway_min": 8.0,
            "formation_cars": 8,
            "limit_level": 1,
            "demand_mult": 1.0,
            "fleet_limit": 480,
        },
        "expect_rules": ["GR-09"],
    },
    {
        "name": "多规则触发：超长发车间隔 + 非法编组 + 非法限流等级 + 超低需求",
        "params": {
            "scenario": "holiday",
            "headway_min": 35.0,
            "formation_cars": 5,
            "limit_level": 5,
            "demand_mult": 0.3,
        },
        "expect_rules": ["GR-02", "GR-03", "GR-04", "GR-06"],
    },
]


def _vals(cfg: dict) -> dict:
    """提取四个规则相关字段的值。"""
    return {f: cfg.get(f) for f in RULE_FIELDS}


def run() -> int:
    results = []

    for tc in TEST_CASES:
        params = dict(tc["params"])

        # Stage 1: validate（对原始参数校验，不做钳制）
        g = G.validate(params)

        # Stage 2: normalize_config（静默钳制到合法域）
        norm_cfg, norm_record = S.normalize_config(params)

        # Stage 3: repair（迭代修正至可执行）
        rep = G.repair(params)

        requested = _vals(params)
        normalized_to = _vals(norm_cfg)
        repaired_to = _vals(rep.get("effective") or {})
        violations = [v.get("id") for v in g.get("violations", [])]
        expected = set(tc["expect_rules"])
        actual = set(violations)
        hit_all = expected.issubset(actual)

        results.append({
            "test_case": tc["name"],
            "expected_rules": tc["expect_rules"],
            "actual_violations": violations,
            "all_expected_triggered": hit_all,
            "guardrail_passed": g.get("passed"),
            "intercepted": not g.get("passed"),
            "three_stage_evidence": {
                "requested": requested,
                "normalized_to": normalized_to,
                "normalized_record": norm_record,
                "repaired_to": repaired_to,
                "repair_rounds": rep.get("rounds", 0),
            },
        })

    evidence = {
        "evidence_type": "adversarial_guardrail_test",
        "generated_at": S.now_iso(),
        "description": (
            "确定性直接调用护栏模块（guardrail.validate + schemas.normalize_config + "
            "guardrail.repair），验证越界参数的三段留痕：requested → normalized_to → repaired_to。"
            "不经过 LLM，结果完全可复现。"
        ),
        "test_cases": results,
        "all_passed": all(r["all_expected_triggered"] for r in results),
    }

    out_dir = os.path.join(ROOT, "output", "trace")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "adversarial_guardrail_evidence.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(evidence, f, ensure_ascii=False, indent=2)

    # ---- 打印摘要 ----
    print("=" * 70)
    print("对抗护栏测试 · 三段留痕证据")
    print("=" * 70)
    for r in results:
        mark = "✅" if r["all_expected_triggered"] else "❌"
        print(f"\n{mark} {r['test_case']}")
        print(f"   预期规则:  {r['expected_rules']}")
        print(f"   实际触发:  {r['actual_violations']}")
        ev = r["three_stage_evidence"]
        print(f"   requested  → {ev['requested']}")
        print(f"   normalized → {ev['normalized_to']}")
        print(f"   repaired   → {ev['repaired_to']}  (修复 {ev['repair_rounds']} 轮)")
    all_ok = evidence["all_passed"]
    print(f"\n{'✅' if all_ok else '❌'} 全部测试通过: {all_ok}")
    print(f"📄 证据文件: {out_path}")
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(run())
