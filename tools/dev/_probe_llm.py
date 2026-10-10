# -*- coding: utf-8 -*-
"""临时探测脚本：验证 DeepSeek / GLM 密钥连通性并找出可用模型 id（不打印密钥）"""
import os
import sys

# 位置：tools/dev/ —— 上溯三级到项目根，才能导入 agent 包
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from agent.llm_client import OpenAICompatClient  # noqa: E402

DS_KEY = os.environ.get("DS41_API_KEY", "")
GLM_KEY = os.environ.get("GLM_API_KEY", "")

DS_CANDIDATES = ["deepseek-chat", "deepseek-reasoner", "DeepSeek-V4.1-Flash"]
GLM_CANDIDATES = ["glm-4-plus", "glm-4-flash", "glm-4.5", "glm-4.5-flash",
                  "GLM5.3-Flash", "glm-5"]

def probe(name, base_url, key, models):
    print(f"\n===== {name} =====")
    if not key:
        print("  密钥为空，跳过")
        return
    for m in models:
        c = OpenAICompatClient(base_url, key, m, name=name, timeout=30)
        r = c.probe()
        if r["ok"]:
            print(f"  [OK]   {m}")
        else:
            err = r.get("error", "")[:90]
            print(f"  [FAIL] {m}  -> {err}")

probe("DeepSeek (api.deepseek.com)", "https://api.deepseek.com/v1", DS_KEY, DS_CANDIDATES)
probe("GLM (open.bigmodel.cn)", "https://open.bigmodel.cn/api/paas/v4", GLM_KEY, GLM_CANDIDATES)
