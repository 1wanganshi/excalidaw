import argparse
import base64
import json
import os
from pathlib import Path

import requests


def join_url(base_url: str, path: str) -> str:
    return base_url.rstrip("/") + "/" + path.lstrip("/")


def save_image_from_item(item: dict, output: Path) -> bool:
    if "b64_json" in item and item["b64_json"]:
        output.write_bytes(base64.b64decode(item["b64_json"]))
        return True
    return False


def run_images_mode(base_url: str, api_key: str, model: str, prompt: str, size: str, output: Path):
    url = join_url(base_url, "/v1/images/generations")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "prompt": prompt,
        "size": size,
    }

    resp = requests.post(url, headers=headers, json=payload, timeout=180)
    return resp


def run_chat_mode(base_url: str, api_key: str, model: str, prompt: str):
    url = join_url(base_url, "/v1/chat/completions")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": f"请生成图片：{prompt}",
            }
        ],
    }

    resp = requests.post(url, headers=headers, json=payload, timeout=180)
    return resp


def main():
    parser = argparse.ArgumentParser(description="通过 OpenAI 兼容接口生成图片")
    parser.add_argument("--base-url", required=True, help="例如 https://www.geeknow.top")
    parser.add_argument("--model", default="gpt-image-2")
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--size", default="1024x1024")
    parser.add_argument("--endpoint-mode", choices=["images", "chat"], default="images")
    parser.add_argument("--output", default="output.png")
    parser.add_argument("--dump-json", default="last_response.json")
    args = parser.parse_args()

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit("缺少环境变量 OPENAI_API_KEY")

    output = Path(args.output)
    dump_json = Path(args.dump_json)

    if args.endpoint_mode == "images":
        resp = run_images_mode(args.base_url, api_key, args.model, args.prompt, args.size, output)
    else:
        resp = run_chat_mode(args.base_url, api_key, args.model, args.prompt)

    print("status:", resp.status_code)
    print("content-type:", resp.headers.get("content-type"))

    text = resp.text
    dump_json.write_text(text, encoding="utf-8")
    print(f"原始响应已保存到: {dump_json}")

    resp.raise_for_status()

    data = resp.json()

    if isinstance(data, dict) and "data" in data and isinstance(data["data"], list) and data["data"]:
        first = data["data"][0]
        if save_image_from_item(first, output):
            print(f"图片已保存到: {output}")
            return
        if "url" in first:
            print("图片地址:", first["url"])
            return

    print("未识别到标准图片结果，请检查 last_response.json")
    print(json.dumps(data, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
