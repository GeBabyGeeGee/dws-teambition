#!/usr/bin/env python3
"""
Teambition 任务依赖批量创建模块

通过 Teambition 内部 API (POST /api/dependencies) 批量创建任务依赖关系。
支持组内顺序依赖和跨组关键节点依赖。

用法:
    python create_dependencies.py --project-id <pid> --stage-ids <s1,s2,s3,s4>

依赖定义在脚本中的 CHAINS 和 CROSS 数据结构中，可按需修改。

依赖类型: finish_start (前置任务完成后，后置任务才能开始)
"""

import json, subprocess, sys, argparse

BB = r"C:\Users\John\AppData\Roaming\npm\bb-browser.cmd"


def bb_eval(js_code: str, timeout: int = 120) -> str:
    """在浏览器上下文中执行 JavaScript 并返回结果。"""
    proc = subprocess.run(
        [BB, "eval", js_code],
        capture_output=True, text=True, timeout=timeout, encoding="utf-8",
    )
    if proc.returncode != 0:
        print(f"[bb-browser error] {proc.stderr}", file=sys.stderr)
    return proc.stdout.strip()


def create_dependencies(
    project_id: str,
    stage_ids: list[str],
    chains: dict[str, list[int]],
    cross: list[tuple[int, int]],
) -> dict:
    """
    批量创建任务依赖关系。

    Args:
        project_id: Teambition 项目 ID
        stage_ids: 阶段 ID 列表（用于查询所有任务）
        chains: 组内顺序依赖 {组名: [任务编号列表]}
        cross: 跨组依赖 [(前置任务编号, 后置任务编号), ...]

    Returns:
        {"created": N, "failed": N, "total": N}
    """
    # 构建 JS：查询所有任务 → 创建依赖
    stages_json = json.dumps(stage_ids)
    chains_json = json.dumps(chains, ensure_ascii=False)
    cross_json = json.dumps(cross)

    js_code = f"""(async () => {{
  const PID = "{project_id}";
  const stages = {stages_json};
  const chains = {chains_json};
  const cross = {cross_json};

  // 1. Query all tasks and build num→id map
  const byNum = {{}};
  for (const sid of stages) {{
    const r = await fetch("https://www.teambition.com/api/tasks?_projectId=" + PID + "&_stageId=" + sid + "&limit=200");
    const tasks = await r.json();
    if (!Array.isArray(tasks)) continue;
    for (const t of tasks) {{
      const m = t.content.match(/\\[(\\d+)\\]/);
      if (m) byNum[parseInt(m[1])] = t._id;
    }}
  }}

  // 2. Create dependencies
  let created = 0, failed = 0;
  const body = {{ kind: "finish_start" }};

  // Sequential within groups
  for (const [group, nums] of Object.entries(chains)) {{
    for (let i = 1; i < nums.length; i++) {{
      const fromId = byNum[nums[i - 1]];
      const toId = byNum[nums[i]];
      if (fromId && toId) {{
        body._fromId = fromId;
        body._toId = toId;
        const r = await fetch("https://www.teambition.com/api/dependencies", {{
          method: "POST",
          headers: {{ "Content-Type": "application/json" }},
          body: JSON.stringify(body),
        }});
        if (r.ok) created++; else failed++;
      }}
    }}
  }}

  // Cross-group
  for (const [from, to] of cross) {{
    const fromId = byNum[from];
    const toId = byNum[to];
    if (fromId && toId) {{
      body._fromId = fromId;
      body._toId = toId;
      const r = await fetch("https://www.teambition.com/api/dependencies", {{
        method: "POST",
        headers: {{ "Content-Type": "application/json" }},
        body: JSON.stringify(body),
      }});
      if (r.ok) created++; else failed++;
    }}
  }}

  return JSON.stringify({{ created, failed, total: created + failed }});
}})()"""

    print(f"[*] Creating dependencies in project {project_id} ...")
    result = bb_eval(js_code, timeout=300)
    try:
        return json.loads(result)
    except json.JSONDecodeError:
        return {"error": "parse_failed", "raw": result[:500]}


# ============================================================
# BM318 项目依赖定义（可复用于其他项目）
# ============================================================

# 四个阶段 ID（需根据实际项目替换）
BM318_STAGES = [
    "69fd39bc378cadfc7c399136",  # 需求与设计评审
    "69fd39bc378cadfc7c39945b",  # 设计验证
    "69fd39bc378cadfc7c399667",  # 系统验证
    "69fd39bc378cadfc7c39999a",  # 量产交付
]

BM318_PROJECT_ID = "69fd39bc389ccdef3cc27964"

# 各组内顺序依赖（前一个任务完成 → 后一个任务开始）
BM318_CHAINS = {
    "P1_塑胶件": [1, 2, 3, 4, 5],
    "P2_镜片":   [6, 7, 8, 9, 10, 11, 12, 13],
    "P3_五金件": [14, 15, 16],
    "P4_硅胶件": [17, 18, 19, 20],
    "P5_BOM":    [21, 22, 23, 24],
    "P6_包装":   [25, 26, 27, 28, 29],
    "P7_物料T0": [30, 31, 32, 33],
    "P8_文档测试":[34, 35, 36, 37, 38, 39],
    "P9_T1验证": [40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51,
                  52, 53, 54, 55, 56, 57],
    "P10_T2量产":[58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70],
}

# 跨组关键依赖（上游完成 → 下游启动）
BM318_CROSS = [
    (5, 30),   # 塑胶件完成 → 物料齐套
    (13, 30),  # 镜片完成 → 物料齐套
    (20, 30),  # 硅胶完成 → 物料齐套
    (24, 30),  # BOM完成 → 物料齐套
    (33, 34),  # T0总结 → 设计文档
    (39, 40),  # 整机测试 → T1需求
    (57, 58),  # T1结束 → T2试产
]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Teambition 任务依赖批量创建")
    parser.add_argument("--project-id", default=BM318_PROJECT_ID)
    parser.add_argument("--stage-ids", nargs="*", default=BM318_STAGES)
    parser.add_argument("--dry-run", action="store_true", help="仅打印依赖计划，不执行")
    args = parser.parse_args()

    if args.dry_run:
        print("=== 组内顺序依赖 ===")
        total_seq = 0
        for name, nums in BM318_CHAINS.items():
            deps = [(nums[i - 1], nums[i]) for i in range(1, len(nums))]
            total_seq += len(deps)
            print(f"  {name}: {deps}")
        print(f"\n=== 跨组依赖 ({len(BM318_CROSS)} 条) ===")
        for f, t in BM318_CROSS:
            print(f"  [{f:02d}] → [{t:02d}]")
        print(f"\n总计: {total_seq} 组内 + {len(BM318_CROSS)} 跨组 = {total_seq + len(BM318_CROSS)} 条")
    else:
        result = create_dependencies(
            args.project_id, args.stage_ids, BM318_CHAINS, BM318_CROSS
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
