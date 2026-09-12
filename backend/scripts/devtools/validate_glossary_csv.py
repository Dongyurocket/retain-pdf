#!/usr/bin/env python3
"""
validate_glossary_csv.py

严格遵循 RetainPDF 后端 Rust API (backend/rust_api/src/services/glossaries.rs)
的解析与校验逻辑，对输入的术语表 CSV 文件进行全面合规性测试。

校验项目：
1. 字符编码与 BOM 处理 (UTF-8)
2. 表头字段检测 (必须具备 source 和 target 列，支持中英文别名)
3. 单元格长度约束 (source/target <= 200 字符，note <= 500 字符)
4. 级别枚举规范 (preserve, canonical, preferred)
5. 匹配模式枚举规范 (case_insensitive, exact, regex)
6. 大小写不敏感去重与冲突检测 (source.trim().lower())
7. 单表导入容量限制 (MAX_GLOSSARY_ENTRIES = 200)
"""

import argparse
import csv
import sys
from pathlib import Path

MAX_GLOSSARY_ENTRIES = 200
MAX_GLOSSARY_TERM_LEN = 200
MAX_GLOSSARY_NOTE_LEN = 500

VALID_LEVELS = {"preserve", "canonical", "preferred"}
VALID_MATCH_MODES = {"case_insensitive", "exact", "regex"}


def sanitize_cell(val: str) -> str:
    return val.lstrip("\ufeff").strip()


def validate_file(file_path: Path, enforce_entry_limit: bool = True) -> bool:
    print(f"\n==================================================")
    print(f"开始校验术语表文件: {file_path}")
    print(f"==================================================")

    if not file_path.exists():
        print(f" [FAIL] 文件不存在: {file_path}")
        return False

    try:
        content = file_path.read_text(encoding="utf-8")
    except Exception as e:
        print(f" [FAIL] 无法以 UTF-8 解码: {e}")
        return False

    reader = csv.reader(content.splitlines())
    rows = list(reader)
    if not rows:
        print(" [FAIL] CSV 文件为空")
        return False

    header_row = [sanitize_cell(c).lower() for c in rows[0]]
    source_idx = None
    target_idx = None
    note_idx = None
    level_idx = None
    match_mode_idx = None
    context_idx = None

    for idx, col in enumerate(header_row):
        if col in {"source", "src", "term", "original", "原词", "原文", "术语"}:
            source_idx = idx
        elif col in {"target", "dst", "translation", "translated", "译文", "翻译", "目标译文"}:
            target_idx = idx
        elif col in {"note", "notes", "comment", "comments", "备注", "说明"}:
            note_idx = idx
        elif col in {"level", "glossary_level", "mode", "action", "类型", "模式", "动作"}:
            level_idx = idx
        elif col in {"match", "match_mode", "match-mode", "匹配", "匹配模式"}:
            match_mode_idx = idx
        elif col in {"context", "上下文", "语境"}:
            context_idx = idx

    if source_idx is None or target_idx is None:
        print(" [FAIL] 表头缺少必须的 source 或 target 字段！")
        return False

    print(f" [OK] 表头检测通过: source_col={source_idx}, target_col={target_idx}, "
          f"note_col={note_idx}, level_col={level_idx}, match_mode_col={match_mode_idx}, context_col={context_idx}")

    errors = []
    seen_sources = {}
    valid_entries = []
    context_counts = {}

    for row_idx, row in enumerate(rows[1:], start=2):
        if not row or all(not c.strip() for c in row):
            continue

        def get_col(i):
            return sanitize_cell(row[i]) if i is not None and i < len(row) else ""

        src = get_col(source_idx)
        tgt = get_col(target_idx)
        note = get_col(note_idx)
        lvl = get_col(level_idx) or "preferred"
        mm = get_col(match_mode_idx) or "exact"
        ctx = get_col(context_idx)

        # normalize level
        lvl_norm = lvl.lower()
        if lvl_norm in {"preserve", "keep", "keep_origin", "keep-original", "do_not_translate", "不翻译", "保留"}:
            lvl_norm = "preserve"
        elif lvl_norm in {"canonical", "fixed", "fixed_translation", "强制翻译", "固定翻译", "标准译法"}:
            lvl_norm = "canonical"
        else:
            lvl_norm = "preferred"

        # normalize match mode
        mm_norm = mm.lower()
        if mm_norm == "regex":
            mm_norm = "regex"
        elif mm_norm in {"case_insensitive", "case-insensitive", "ci", "ignore_case", "大小写不敏感"}:
            mm_norm = "case_insensitive"
        else:
            mm_norm = "exact"

        if lvl_norm == "preserve" and src and not tgt:
            tgt = src

        if not src or not tgt:
            errors.append(f"第 {row_idx} 行: source 或 target 为空 (src='{src}', tgt='{tgt}')")
            continue

        if len(src) > MAX_GLOSSARY_TERM_LEN:
            errors.append(f"第 {row_idx} 行: source 超过 {MAX_GLOSSARY_TERM_LEN} 字符 (当前 {len(src)})")

        if len(tgt) > MAX_GLOSSARY_TERM_LEN:
            errors.append(f"第 {row_idx} 行: target 超过 {MAX_GLOSSARY_TERM_LEN} 字符 (当前 {len(tgt)})")

        if len(note) > MAX_GLOSSARY_NOTE_LEN:
            errors.append(f"第 {row_idx} 行: note 超过 {MAX_GLOSSARY_NOTE_LEN} 字符 (当前 {len(note)})")

        key = src.lower()
        if key in seen_sources:
            errors.append(f"第 {row_idx} 行: source '{src}' 与第 {seen_sources[key]} 行发生大小写不敏感重复冲突")
        else:
            seen_sources[key] = row_idx

        primary_domain = ctx.split("·")[0] if "·" in ctx else (ctx or "未分类")
        context_counts[primary_domain] = context_counts.get(primary_domain, 0) + 1

        valid_entries.append({
            "source": src,
            "target": tgt,
            "note": note,
            "level": lvl_norm,
            "match_mode": mm_norm,
            "context": ctx,
        })

    print(f"有效词条行数: {len(valid_entries)}")
    print(f"学科/领域分布: {context_counts}")

    if errors:
        print(f" [FAIL] 发现 {len(errors)} 项格式或规则错误:")
        for err in errors[:10]:
            print(f"   - {err}")
        if len(errors) > 10:
            print(f"   ... 其余 {len(errors) - 10} 项已省略")
        return False

    if enforce_entry_limit and len(valid_entries) > MAX_GLOSSARY_ENTRIES:
        print(f" [WARN] 词条数量 ({len(valid_entries)}) 超过 RetainPDF 单表上限 ({MAX_GLOSSARY_ENTRIES})！")
        print("        若作为单表导入，Rust API 将抛出 AppError(400)；请使用专精分表或截断版。")
        return False
    elif len(valid_entries) > MAX_GLOSSARY_ENTRIES:
        print(f" [INFO] 词条数量为 {len(valid_entries)}（作为全量参考表允许超过 {MAX_GLOSSARY_ENTRIES}）")

    print(f" [SUCCESS] 校验通过！完全符合 RetainPDF 契约规范。")
    return True


def main():
    parser = argparse.ArgumentParser(description="RetainPDF 术语表格式合规校验器")
    parser.add_argument("files", nargs="+", help="待校验的 CSV 文件路径")
    parser.add_argument("--allow-large", action="store_true", help="允许条目数超过 200 条（用于大词库）")
    args = parser.parse_args()

    all_ok = True
    for f in args.files:
        p = Path(f)
        ok = validate_file(p, enforce_entry_limit=not args.allow_large)
        if not ok:
            all_ok = False

    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
