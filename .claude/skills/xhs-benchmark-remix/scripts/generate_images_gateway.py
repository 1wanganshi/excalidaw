import argparse
import base64
import csv
import json
import os
import re
import sys
from pathlib import Path

import requests


def safe_name(text: str) -> str:
    text = re.sub(r"[\\/:*?\"<>|\s]+", "_", text.strip())
    return text[:60] or "image"


def extract_image_from_images_response(data):
    item = (data.get("data") or [{}])[0]
    if item.get("b64_json"):
        return "base64", item["b64_json"]
    if item.get("url"):
        return "url", item["url"]
    return None, None


def extract_image_from_chat_response(data):
    raw = json.dumps(data, ensure_ascii=False)
    m = re.search(r"https?://[^\"'\s]+", raw)
    if m:
        return "url", m.group(0)
    m = re.search(r"data:image/[^;]+;base64,([A-Za-z0-9+/=]+)", raw)
    if m:
        return "base64", m.group(1)
    m = re.search(r"([A-Za-z0-9+/]{1000,}={0,2})", raw)
    if m:
        return "base64", m.group(1)
    return None, raw[:2000]


def save_image(kind, payload, out_path: Path):
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if kind == "base64":
        out_path.write_bytes(base64.b64decode(payload))
        return out_path
    if kind == "url":
        r = requests.get(payload, timeout=120)
        r.raise_for_status()
        out_path.write_bytes(r.content)
        return out_path
    raise ValueError("未知图片类型")


def call_images(base_url, key, model, prompt, size):
    url = base_url.rstrip("/") + "/v1/images/generations"
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    body = {"model": model, "prompt": prompt, "size": size}
    r = requests.post(url, headers=headers, json=body, timeout=300)
    try:
        data = r.json()
    except Exception:
        data = {"status_code": r.status_code, "text": r.text}
    if r.status_code >= 400:
        raise RuntimeError(json.dumps(data, ensure_ascii=False)[:4000])
    return data


def call_chat(base_url, key, model, prompt):
    url = base_url.rstrip("/") + "/v1/chat/completions"
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    body = {"model": model, "messages": [{"role": "user", "content": "请生成图片：" + prompt}]}
    r = requests.post(url, headers=headers, json=body, timeout=300)
    try:
        data = r.json()
    except Exception:
        data = {"status_code": r.status_code, "text": r.text}
    if r.status_code >= 400:
        raise RuntimeError(json.dumps(data, ensure_ascii=False)[:4000])
    return data


def update_publish_sheet(root: Path, results):
    sheet = root / "04_publish_pack" / "publish_sheet.csv"
    if not sheet.exists():
        return
    rows = []
    with sheet.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []
        for row in reader:
            rows.append(row)
    if not fieldnames:
        return
    result_by_note = {r.get("note"): r for r in results}
    for row in rows:
        note_id = row.get("note_id")
        result = result_by_note.get(note_id)
        if not result:
            continue
        if result.get("ok"):
            row["image_generation_status"] = "已生成"
            row["image_folder"] = str(Path(result["file"]).parent)
            row["publish_status"] = "可发布-待人工复核"
        else:
            row["image_generation_status"] = "失败，见错误文件"
            row["publish_status"] = "需补图"
    with sheet.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(description="批量为小红书发布包生成 GPTimage2 封面图")
    parser.add_argument("--root", required=True, help="任务输出根目录，内含 04_publish_pack/note_xxx")
    parser.add_argument("--base-url", default="https://www.geeknow.top")
    parser.add_argument("--model", default="gpt-image-2")
    parser.add_argument("--size", default="1024x1536")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--mode", choices=["auto", "images", "chat"], default="auto")
    parser.add_argument("--original", action="store_true", help="无参考图时按原创封面生成，不声称 image2image")
    parser.add_argument("--update-sheet", action="store_true", help="成功后同步更新 publish_sheet.csv 状态")
    args = parser.parse_args()

    key = os.getenv("GEEKNOW_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not key:
        print("缺少环境变量 GEEKNOW_API_KEY 或 OPENAI_API_KEY", file=sys.stderr)
        sys.exit(2)

    root = Path(args.root)
    packs = sorted((root / "04_publish_pack").glob("note_*"))
    if args.limit:
        packs = packs[:args.limit]

    results = []
    for folder in packs:
        prompt_file = folder / "image_prompt.txt"
        title_file = folder / "title.txt"
        if not prompt_file.exists():
            continue
        title = title_file.read_text(encoding="utf-8").strip() if title_file.exists() else folder.name
        prompt = prompt_file.read_text(encoding="utf-8").strip()
        if args.original:
            prompt = "原创生成一张小红书可直接发布的图文封面，不要引用任何已有图片，不要出现原作者水印。" + prompt
        out_path = folder / "images" / f"{folder.name}_{safe_name(title)}.png"
        raw_path = folder / "images" / f"{folder.name}_raw_response.json"
        folder_result = None

        def record_failure(e1, e2=None):
            err_path = folder / "images" / f"{folder.name}_error.txt"
            err_path.parent.mkdir(parents=True, exist_ok=True)
            msg = f"标准图片接口失败：{e1}\n"
            if e2 is not None:
                msg += f"\nChat包装失败：{e2}\n"
            err_path.write_text(msg, encoding="utf-8")
            return {"note": folder.name, "ok": False, "error_file": str(err_path)}

        try:
            if args.mode in {"auto", "images"}:
                data = call_images(args.base_url, key, args.model, prompt, args.size)
                raw_path.parent.mkdir(parents=True, exist_ok=True)
                raw_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
                kind, payload = extract_image_from_images_response(data)
                if not kind:
                    raise RuntimeError("标准图片接口返回里没有 url 或 b64_json")
                save_image(kind, payload, out_path)
                folder_result = {"note": folder.name, "ok": True, "mode": "images", "file": str(out_path)}
            else:
                raise RuntimeError("跳过标准图片接口")
        except Exception as e1:
            if args.mode == "images":
                folder_result = record_failure(e1)
            else:
                try:
                    data = call_chat(args.base_url, key, args.model, prompt)
                    raw_path.parent.mkdir(parents=True, exist_ok=True)
                    raw_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
                    kind, payload = extract_image_from_chat_response(data)
                    if kind not in {"url", "base64"}:
                        raise RuntimeError("chat 返回里没有可落盘图片：" + str(payload)[:1000])
                    save_image(kind, payload, out_path)
                    folder_result = {"note": folder.name, "ok": True, "mode": "chat", "file": str(out_path)}
                except Exception as e2:
                    folder_result = record_failure(e1, e2)

        results.append(folder_result)
        if folder_result.get("ok"):
            print(f"成功：{folder.name} -> {folder_result['file']}")
        else:
            print(f"失败：{folder.name}，错误已写入 {folder_result.get('error_file')}")

    summary = root / "03_remix" / "image_generation_results.json"
    summary.parent.mkdir(parents=True, exist_ok=True)
    summary.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    if args.update_sheet:
        update_publish_sheet(root, results)
    print("汇总：", summary)
    if not any(r.get("ok") for r in results):
        sys.exit(1)


if __name__ == "__main__":
    main()
