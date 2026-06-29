---
name: OpenAI 图片网关出图
description: 通过 OpenAI 兼容接口生成图片。用户提到出图、文生图、海报、封面、头像、提示词生成图片、gpt-image-2、OpenAI 兼容图片接口、/v1/images/generations、图片 API、图像模型接入时，优先使用本技能。也适用于用户想把任意第三方 OpenAI 兼容图片接口包装成统一出图流程的场景。
---

# OpenAI 图片网关出图

用这个技能把任意 **OpenAI 兼容图片接口** 包装成统一出图流程。

## 适用场景

当用户出现下面这些需求时，直接使用本技能：

- “帮我出一张图”
- “用这个 API 出图”
- “帮我接 gpt-image-2”
- “帮我跑通 OpenAI 兼容图片接口”
- “把这个图片接口封装成可复用流程”
- “用 `/v1/images/generations` 出图”
- “改成 `/v1/chat/completions` 包装模式也能出图”

## 安全原则

1. **绝不在技能里硬编码 API key。**
2. API key 必须通过环境变量传入。
3. 如果用户在对话中直接贴出 key，不要重复展示；提醒用户尽快轮换。

默认读取的环境变量名：

- `OPENAI_API_KEY`

如果用户明确要求，也可以改为读取其他环境变量名，但默认先用 `OPENAI_API_KEY`。

## 默认兼容约定

默认参数：

- `base_url`: 用户提供
- `model`: `gpt-image-2`
- `endpoint_mode`: `images`
- `endpoint_path`: `/v1/images/generations`
- `size`: `1024x1024`

其中：

- `endpoint_mode=images` 表示调用图片标准接口
- `endpoint_mode=chat` 表示走 `/v1/chat/completions` 的兼容包装模式

## 工作流程

### 模式 A：标准图片接口

优先尝试：

`POST {base_url}/v1/images/generations`

请求体最小格式：

```json
{
  "model": "gpt-image-2",
  "prompt": "用户提示词",
  "size": "1024x1024"
}
```

### 模式 B：Chat 包装模式

当平台不支持 `/v1/images/generations`，但声明可以通过 `/v1/chat/completions` 包装调用时，使用这个模式。

先按平台兼容文档组织请求。若用户没给文档，使用保守写法：

```json
{
  "model": "gpt-image-2",
  "messages": [
    {
      "role": "user",
      "content": "请生成图片：<用户提示词>"
    }
  ]
}
```

注意：不同平台对 chat 包装模式的字段可能不同。有的平台会返回：

- 图片 URL
- Base64 图片
- 文本中嵌入的图片字段

如果返回结构异常，要把原始 JSON 保存并告诉用户当前平台的具体返回格式。

## 执行要求

当你要帮用户真正跑接口时：

1. 优先生成一个 **本地可运行脚本**，不要把 key 写进脚本。
2. 用环境变量读取 key。
3. 若用户只要求“先跑通”，先提供最小脚本。
4. 若用户要求“封装复用”，再输出一个可配置版本。
5. 若标准接口失败，再切换 chat 包装模式。
6. 不要声称“已成功出图”，除非你真的拿到了成功响应或文件。

## 输出策略

### 用户只想快速出图

直接给：

- 最小可运行 Python 脚本
- 所需环境变量名
- 一条可直接替换的 prompt
- 成功时图片保存位置

### 用户想长期复用

给：

- 可配置脚本
- 支持 `base_url` / `model` / `prompt` / `size` / `endpoint_mode`
- 对常见错误的说明

## 最小 Python 模板

优先参考 `scripts/generate_image.py`。

如果需要，指导用户这样运行：

### PowerShell

```powershell
$env:OPENAI_API_KEY="你的新key"
python scripts/generate_image.py --base-url "https://example.com" --model "gpt-image-2" --prompt "一只白猫坐在窗边" --size "1024x1024"
```

## 故障排查顺序

按下面顺序判断：

1. `base_url` 是否正确
2. 标准接口路径 `/v1/images/generations` 是否可用
3. `model` 是否在该平台启用
4. key 是否有图片权限
5. 返回是 URL 还是 base64
6. 若标准接口失败，尝试 `endpoint_mode=chat`
7. 若仍失败，保留原始响应给用户排查

## 响应风格

- 直接
- 短句
- 不夸大
- 先给能跑的方案，再给增强版

## 成功判定

仅在以下情况之一发生时，才说“出图成功”：

- 已保存图片文件
- 已拿到可访问的图片 URL
- 已拿到明确的 base64 图片数据并完成落盘

否则只能说：

- “接口已发出，但平台返回格式不兼容”
- “请求失败，正在切换模式”
- “当前路径未跑通，需要平台文档或错误响应进一步确认”
