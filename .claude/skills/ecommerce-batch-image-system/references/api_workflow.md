# API 工作流说明

## 默认接口配置
- Base URL: `https://www.geeknow.top/v1`
- 模型: `gpt-image-2`

## 设计原则
1. 不在技能文件中硬编码 API Key。
2. 运行时从任务 JSON 或环境变量读取 key。
3. 有参考图时优先尝试编辑接口。
4. 编辑接口失败时，记录错误并可选择退回纯生成接口。
5. 所有生成结果默认保存到 Windows 桌面。

## 支持的两种模式

### 1. 文生图
适用条件：
- 用户未提供参考图
- 或接口不支持编辑模式

优先端点：
- `POST {base_url}/images/generations`

推荐请求体：
```json
{
  "model": "gpt-image-2",
  "prompt": "高密度长 prompt",
  "size": "1024x1024",
  "background": "auto"
}
```

### 2. 参考图图生图
适用条件：
- 用户提供 1 张或多张参考图

优先端点：
- `POST {base_url}/images/edits`

推荐 multipart 字段：
- `model`
- `prompt`
- `size`
- `background`
- `image`（可重复）

## 批量任务流程
1. 解析用户需求
2. 生成图组任务清单
3. 为每个任务装配单图长 prompt
4. 将所有 prompt 落地到 `prompts/`
5. 写入 `task.json`
6. 调用脚本批量请求 API
7. 将 base64 或 URL 结果保存到 `images/`
8. 写入 `run_log.json`
9. 生成 `summary.md`

## 建议 task.json 结构
```json
{
  "api": {
    "base_url": "https://www.geeknow.top/v1",
    "api_key": "<运行时注入>",
    "model": "gpt-image-2"
  },
  "output_dir": "C:/Users/Lenovo/Desktop/电商批量生图输出/2026-04-23_153000",
  "reference_images": [
    "C:/path/a.png",
    "C:/path/b.jpg"
  ],
  "product": {
    "name": "产品名",
    "category": "品类",
    "selling_points": ["卖点1", "卖点2"],
    "target_users": "目标人群",
    "price_band": "中端",
    "channels": ["淘宝主图", "详情页", "小红书"],
    "style": "清透极简 + 专业质感"
  },
  "mode": "标准版",
  "jobs": [
    {
      "name": "正面主图",
      "file_name": "01_正面主图.png",
      "prompt": "完整长 prompt",
      "size": "1024x1024",
      "background": "auto",
      "quality": "high",
      "orientation": "square",
      "use_reference": true
    }
  ]
}
```

## 错误处理建议
- `401/403`：API Key 无效或权限不足
- `404`：兼容端点不存在，检查 `/images/generations` 或 `/images/edits`
- `429`：频率限制，降低并发或重试
- `5xx`：服务端波动，保留日志后重试
- 返回非 base64 且无 URL：将原始响应记录到日志供排查

## 实施建议
- 单次批量任务建议串行或小并发，避免接口限流
- 先生成主图组，再扩展详情图组
- 有参考图时优先保一致性，不要一开始就追求强特效
