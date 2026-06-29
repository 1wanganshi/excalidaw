#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import base64
import json
import mimetypes
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin

try:
    import requests
except ImportError:
    print("缺少 requests，请先安装：pip install requests", file=sys.stderr)
    sys.exit(1)


DEFAULT_TIMEOUT = 180


def ensure_dir(path: Path):
    path.mkdir(parents=True, exist_ok=True)


def read_json(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, data):
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def write_text(path: Path, text: str):
    with path.open("w", encoding="utf-8") as f:
        f.write(text)


def mask_key(key: str) -> str:
    if not key:
        return "<空>"
    if len(key) <= 10:
        return key[:2] + "***"
    return key[:6] + "***" + key[-4:]


def normalize_base_url(base_url: str) -> str:
    return base_url.rstrip("/") + "/"


def build_headers(api_key: str) -> dict:
    return {
        "Authorization": f"Bearer {api_key}",
    }


def decode_base64_image(data_str: str) -> bytes:
    if "," in data_str and data_str.strip().startswith("data:"):
        data_str = data_str.split(",", 1)[1]
    return base64.b64decode(data_str)


def save_image_bytes(image_bytes: bytes, output_path: Path):
    with output_path.open("wb") as f:
        f.write(image_bytes)


def download_url_image(url: str, output_path: Path, timeout: int):
    resp = requests.get(url, timeout=timeout)
    resp.raise_for_status()
    save_image_bytes(resp.content, output_path)


def guess_ext_from_content_type(content_type: str) -> str:
    if not content_type:
        return ".png"
    ext = mimetypes.guess_extension(content_type.split(";")[0].strip())
    return ext or ".png"


def save_response_image(item, output_path: Path, timeout: int):
    if isinstance(item, str):
        save_image_bytes(decode_base64_image(item), output_path)
        return "b64_string"

    if not isinstance(item, dict):
        raise ValueError(f"无法识别的图片响应结构: {type(item)}")

    if item.get("b64_json"):
        save_image_bytes(decode_base64_image(item["b64_json"]), output_path)
        return "b64_json"

    if item.get("url"):
        download_url_image(item["url"], output_path, timeout)
        return "url"

    if item.get("data") and isinstance(item["data"], str):
        save_image_bytes(decode_base64_image(item["data"]), output_path)
        return "data"

    raise ValueError(f"响应中未找到可保存的图片字段: {item}")


def extract_data_items(resp_json):
    if isinstance(resp_json, dict):
        if isinstance(resp_json.get("data"), list):
            return resp_json["data"]
        if resp_json.get("b64_json") or resp_json.get("url"):
            return [resp_json]
    if isinstance(resp_json, list):
        return resp_json
    raise ValueError("接口响应中没有可识别的图片数据")


def post_generation(api, job, timeout):
    endpoint = urljoin(normalize_base_url(api["base_url"]), "images/generations")
    payload = {
        "model": api["model"],
        "prompt": job["prompt"],
        "size": job.get("size", "1024x1024"),
        "background": job.get("background", "auto"),
    }
    if job.get("quality"):
        payload["quality"] = job["quality"]
    if job.get("n"):
        payload["n"] = job["n"]

    resp = requests.post(
        endpoint,
        headers={**build_headers(api["api_key"]), "Content-Type": "application/json"},
        json=payload,
        timeout=timeout,
    )
    return endpoint, payload, resp


def post_edit(api, job, reference_images, timeout):
    endpoint = urljoin(normalize_base_url(api["base_url"]), "images/edits")
    data = {
        "model": api["model"],
        "prompt": job["prompt"],
        "size": job.get("size", "1024x1024"),
        "background": job.get("background", "auto"),
    }
    if job.get("quality"):
        data["quality"] = job["quality"]
    if job.get("n"):
        data["n"] = str(job["n"])

    files = []
    handles = []
    try:
        for img_path in reference_images:
            p = Path(img_path)
            if not p.exists():
                raise FileNotFoundError(f"参考图不存在: {img_path}")
            mime = mimetypes.guess_type(str(p))[0] or "application/octet-stream"
            fh = p.open("rb")
            handles.append(fh)
            files.append(("image", (p.name, fh, mime)))

        resp = requests.post(
            endpoint,
            headers=build_headers(api["api_key"]),
            data=data,
            files=files,
            timeout=timeout,
        )
        return endpoint, data, resp
    finally:
        for fh in handles:
            try:
                fh.close()
            except Exception:
                pass


def save_prompts(task, prompts_dir: Path):
    ensure_dir(prompts_dir)
    saved = []
    for idx, job in enumerate(task.get("jobs", []), start=1):
        file_name = f"{idx:02d}_{job['name']}.txt".replace("/", "_")
        path = prompts_dir / file_name
        write_text(path, job["prompt"])
        saved.append(str(path))
    return saved


def generate_summary(task, results, summary_path: Path):
    product = task.get("product", {})
    ok_count = sum(1 for x in results if x.get("status") == "success")
    fail_count = sum(1 for x in results if x.get("status") == "failed")
    lines = [
        "# 批量生图任务摘要",
        "",
        f"- 产品：{product.get('name', '未填写')}",
        f"- 品类：{product.get('category', '未填写')}",
        f"- 输出模式：{task.get('mode', '标准版')}",
        f"- 参考图数量：{len(task.get('reference_images', []))}",
        f"- 任务总数：{len(task.get('jobs', []))}",
        f"- 成功：{ok_count}",
        f"- 失败：{fail_count}",
        "",
        "## 任务结果",
        "",
    ]
    for item in results:
        lines.extend([
            f"### {item.get('job_name', '未命名任务')}",
            f"- 状态：{item.get('status')}",
            f"- 输出文件：{item.get('output_file', '')}",
            f"- 端点：{item.get('endpoint', '')}",
            f"- 是否参考图：{'是' if item.get('used_reference') else '否'}",
            f"- 备注：{item.get('message', '')}",
            "",
        ])
    write_text(summary_path, "\n".join(lines))


def run_task(task_path: Path, timeout: int, delay: float):
    task = read_json(task_path)
    api = task.get("api", {})
    output_dir = Path(task["output_dir"])
    prompts_dir = output_dir / "prompts"
    images_dir = output_dir / "images"
    ensure_dir(output_dir)
    ensure_dir(prompts_dir)
    ensure_dir(images_dir)

    save_prompts(task, prompts_dir)

    api_key = api.get("api_key") or os.environ.get("OPENAI_API_KEY") or os.environ.get("GEEKNOW_API_KEY")
    if not api_key:
        raise ValueError("未提供 API Key，请在 task.json 中填写 api.api_key 或设置环境变量 OPENAI_API_KEY / GEEKNOW_API_KEY")
    api["api_key"] = api_key

    run_log = {
        "started_at": datetime.now().isoformat(),
        "api": {
            "base_url": api.get("base_url"),
            "model": api.get("model"),
            "api_key_masked": mask_key(api_key),
        },
        "output_dir": str(output_dir),
        "results": [],
    }

    reference_images = task.get("reference_images", [])

    for index, job in enumerate(task.get("jobs", []), start=1):
        result = {
            "index": index,
            "job_name": job.get("name"),
            "file_name": job.get("file_name"),
            "used_reference": False,
            "status": "failed",
            "message": "",
        }
        output_path = images_dir / job.get("file_name", f"{index:02d}.png")
        result["output_file"] = str(output_path)

        try:
            use_reference = bool(job.get("use_reference")) and bool(reference_images)
            resp = None
            payload = None
            endpoint = None

            if use_reference:
                result["used_reference"] = True
                try:
                    endpoint, payload, resp = post_edit(api, job, reference_images, timeout)
                except Exception as edit_exc:
                    result["message"] = f"参考图编辑请求失败，回退到文生图：{edit_exc}"
                    result["used_reference"] = False
                    endpoint, payload, resp = post_generation(api, job, timeout)
            else:
                endpoint, payload, resp = post_generation(api, job, timeout)

            result["endpoint"] = endpoint
            result["request_payload"] = payload
            result["status_code"] = resp.status_code
            text_preview = resp.text[:1000] if resp.text else ""
            result["response_preview"] = text_preview
            resp.raise_for_status()

            content_type = resp.headers.get("Content-Type", "")
            content_type_lower = content_type.lower()
            if "application/json" in content_type_lower or text_preview.strip().startswith("{"):
                resp_json = resp.json()
                data_items = extract_data_items(resp_json)
                source_type = save_response_image(data_items[0], output_path, timeout)
                result["image_source"] = source_type
            else:
                if not content_type_lower.startswith("image/"):
                    raise ValueError(
                        f"接口返回的不是图片，已拒绝保存到 images 目录。"
                        f"Content-Type={content_type or '<空>'}；响应预览：{text_preview[:300]}"
                    )
                ext = guess_ext_from_content_type(content_type)
                if output_path.suffix.lower() != ext:
                    output_path = output_path.with_suffix(ext)
                    result["output_file"] = str(output_path)
                save_image_bytes(resp.content, output_path)
                result["image_source"] = "binary"

            result["status"] = "success"
            if not result["message"]:
                result["message"] = "生成成功"
        except Exception as exc:
            result["status"] = "failed"
            result["message"] = str(exc)

        run_log["results"].append(result)
        write_json(output_dir / "run_log.json", run_log)
        if delay > 0:
            time.sleep(delay)

    run_log["finished_at"] = datetime.now().isoformat()
    write_json(output_dir / "run_log.json", run_log)
    generate_summary(task, run_log["results"], output_dir / "summary.md")
    return run_log


def main():
    parser = argparse.ArgumentParser(description="电商批量生图执行脚本")
    parser.add_argument("--task", required=True, help="task.json 路径")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT, help="单次请求超时秒数")
    parser.add_argument("--delay", type=float, default=0.5, help="每个任务之间的等待秒数")
    args = parser.parse_args()

    task_path = Path(args.task)
    if not task_path.exists():
        raise FileNotFoundError(f"任务文件不存在: {task_path}")

    run_log = run_task(task_path, timeout=args.timeout, delay=args.delay)
    success_count = sum(1 for x in run_log["results"] if x.get("status") == "success")
    fail_count = sum(1 for x in run_log["results"] if x.get("status") == "failed")
    print(json.dumps({
        "status": "done",
        "output_dir": run_log["output_dir"],
        "success": success_count,
        "failed": fail_count,
        "model": run_log["api"]["model"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
