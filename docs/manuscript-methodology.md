# 手稿绘图方法论 v1.0

Excalidaw「手稿绘图」模块的设计依据。详见对话定稿。

## 五条宪法

1. **原文主权** — 展示文字来自用户输入切片，模型不参与写字
2. **句子为索引** — 按句末标点切分，100% 门禁
3. **逻辑优先于皮肤** — 先认关系，再选画法
4. **有顺序才画箭** — 默认无箭，检测到逻辑顺序才导出箭头
5. **标题定场** — 顶部标题，不默认三圆圈总览

## 四层架构

- **L1 原文层** — 切句、校验、`start/end` 索引
- **L2 逻辑层** — `LogicManuscriptIR`：节点、边、链型
- **L3 表达层** — 标题、条件箭头、红字/红线/框/✘✓、字号
- **L4 交付层** — 讲义长图 / 逻辑导图

## 两种导出

| 导出 | 说明 |
|------|------|
| `lecture` | 整句原文竖排 + 条件箭头 |
| `mindmap` | 关键词链横排 + 条件箭头 |

## 链型（节选）

顺序链、枢纽放射、扇出否定、二元分叉、步骤清单、回环、过渡钩、对照旁挂。

## 代码映射

```
src/logic/types.ts          — IR 类型
src/logic/splitSentences.ts — 句子切分
src/logic/recognize.ts      — 角色、边、链、强调
src/logic/buildIr.ts        — 构建 IR
src/logic/validate.ts       — 原文门禁
src/logic/layoutLecture.ts  — 讲义长图
src/logic/layoutMindmap.ts  — 逻辑导图
src/logic/render.ts         — 渲染入口
```

## UI

AI 助手 → **手稿绘图** → 选导出形态 → 粘贴原文 → 生成。

- **讲义长图**默认开启「AI 辅助布局」：需配置语言模型；模型只选章节与 pattern，不改写原文。
- 关闭 AI 辅助或 AI 失败时，回退本地规则 + V2 渲染。

## 混合架构（0.2.23+）

```
原文 → 本地切句(s0,s1…) + 逻辑链提示
         ↓
     [可选] AI 布局导演 → { titleRef, overview, sections[].patterns[] }
         ↓
     本地 resolve：句子 ID → 原文注入 → PosterDocumentV2
         ↓
     layoutV2 渲染（scene / contrast / case_box / …）
```
