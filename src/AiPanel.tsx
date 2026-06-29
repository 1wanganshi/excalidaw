import { useMemo, useState } from "react";
import { createDefaultPrompt, getNextPromptName } from "./storage";
import { POSTER_THEME_ORDER, POSTER_THEMES } from "./poster/themes";
import {
  generateImagePrompt,
  splitContentIntoFourParts,
  type ManuscriptItemStatus,
} from "./manuscript";
import type { LogicExportMode } from "./logic/types";
import type {
  AiImageRequest,
  AiImageResult,
  AiModelConfig,
  AiSettings,
  ImageAspectRatio,
  ImageResolution,
  InsertedAiImage,
  PosterTheme,
  PromptPreset,
} from "./types";

type AiMode = "image" | "logic" | "manuscript";

type ManuscriptItem = {
  index: 0 | 1 | 2 | 3;
  text: string;
  prompt: string;
  result?: AiImageResult;
  elementId?: string;
  status: ManuscriptItemStatus;
  error?: string;
};

type LogicGenerateRequest = {
  original: string;
  theme: PosterTheme;
  export: LogicExportMode;
  model?: AiModelConfig;
  useAiLayout?: boolean;
  intent?: string;
};

type AiPanelProps = {
  settings: AiSettings;
  onSettingsChange: (settings: AiSettings) => void;
  onGenerateImage: (request: AiImageRequest, onProgress: (message: string) => void) => Promise<AiImageResult>;
  onGenerateLogic: (
    request: LogicGenerateRequest,
    onProgress: (message: string) => void,
  ) => Promise<void>;
  onInsertImage: (result: AiImageResult) => Promise<InsertedAiImage | null>;
  onInsertImages: (results: AiImageResult[]) => Promise<InsertedAiImage[]>;
  onInsertManuscriptAt: (
    index: number,
    total: number,
    result: AiImageResult,
  ) => Promise<InsertedAiImage | null>;
  onReplaceImage: (elementId: string, result: AiImageResult) => Promise<boolean>;
  onFocusImage: (elementId: string) => void;
};

const aspectRatioOptions: ImageAspectRatio[] = ["1:1", "9:16", "16:9", "3:4", "4:3", "2:3", "3:2"];
const resolutionOptions: Array<{ value: ImageResolution; label: string }> = [
  { value: "1k", label: "1K" },
  { value: "2k", label: "2K" },
  { value: "4k", label: "4K" },
];

function getPromptName(prompt: PromptPreset, index: number) {
  return prompt.name.trim() || `提示词${index + 1}`;
}

function renderManuscriptStatus(status: ManuscriptItemStatus): string {
  switch (status) {
    case "pending":
      return "待生成";
    case "generating":
      return "生成中...";
    case "ready":
      return "已生成";
    case "inserted":
      return "已入画布";
    case "error":
      return "失败";
    default:
      return "";
  }
}

export default function AiPanel({
  settings,
  onSettingsChange,
  onGenerateImage,
  onGenerateLogic,
  onInsertImage,
  onInsertImages,
  onInsertManuscriptAt,
  onReplaceImage,
  onFocusImage,
}: AiPanelProps) {
  const [mode, setMode] = useState<AiMode>("image");
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageAspectRatio, setImageAspectRatio] = useState<ImageAspectRatio>("1:1");
  const [imageResolution, setImageResolution] = useState<ImageResolution>("1k");
  const [posterTheme, setPosterTheme] = useState<PosterTheme>("whiteboard");
  const [logicOriginal, setLogicOriginal] = useState("");
  const [logicExport, setLogicExport] = useState<LogicExportMode>("lecture");
  const [logicUseAi, setLogicUseAi] = useState(true);
  const [logicIntent, setLogicIntent] = useState("");
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingText, setEditingText] = useState("");
  const [progress, setProgress] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [lastImageResult, setLastImageResult] = useState<AiImageResult | null>(null);
  // 四张手稿图相关状态（跳转按钮已迁移到白板右下角浮层，由 App 持有）
  const [manuscriptText, setManuscriptText] = useState("");
  const [manuscriptItems, setManuscriptItems] = useState<ManuscriptItem[]>([]);

  const selectedImageModel = useMemo(
    () => settings.imageModels.find((model) => model.id === settings.selectedImageModelId) ?? settings.imageModels[0],
    [settings.imageModels, settings.selectedImageModelId],
  );
  const selectedLanguageModel = useMemo(
    () =>
      settings.languageModels.find((model) => model.id === settings.selectedLanguageModelId) ??
      settings.languageModels[0],
    [settings.languageModels, settings.selectedLanguageModelId],
  );

  const updateSettings = (next: AiSettings) => onSettingsChange(next);

  const appendProgress = (message: string) => {
    setProgress((current) => [...current, message]);
  };

  const saveImagePrompt = () => {
    const trimmed = imagePrompt.trim();

    if (!trimmed) {
      appendProgress("请先填写要保存的图片提示词。");
      return;
    }

    const prompt = createDefaultPrompt(settings.imagePrompts.length + 1);
    updateSettings({
      ...settings,
      imagePrompts: [
        ...settings.imagePrompts,
        { ...prompt, name: getNextPromptName(settings.imagePrompts), prompt: trimmed },
      ],
    });
    setImagePrompt("");
  };

  const startEditPrompt = (prompt: PromptPreset, index: number) => {
    setEditingPromptId(prompt.id);
    setEditingName(getPromptName(prompt, index));
    setEditingText(prompt.prompt);
  };

  const commitEditPrompt = () => {
    if (!editingPromptId) {
      return;
    }

    updateSettings({
      ...settings,
      imagePrompts: settings.imagePrompts.map((prompt, index) =>
        prompt.id === editingPromptId
          ? {
              ...prompt,
              name: editingName.trim() || `提示词${index + 1}`,
              prompt: editingText.trim(),
            }
          : prompt,
      ),
    });
    setEditingPromptId(null);
  };

  const deletePrompt = (promptId: string) => {
    updateSettings({
      ...settings,
      imagePrompts: settings.imagePrompts.filter((prompt) => prompt.id !== promptId),
    });
  };

  const generate = async () => {
    const selectedModel = mode === "image" || mode === "manuscript" ? selectedImageModel : selectedLanguageModel;
    const imagePromptText = imagePrompt.trim();

    if (mode !== "logic" && !selectedModel) {
      appendProgress("请先在设置中新增生图大模型。");
      return;
    }

    if (mode === "image" && !imagePromptText) {
      appendProgress("请先填写图片提示词。");
      return;
    }

    if (mode === "manuscript" && !manuscriptText.trim()) {
      appendProgress("请输入要生成图片的内容。");
      return;
    }

    if (mode === "logic" && !logicOriginal.trim()) {
      appendProgress("请先粘贴内容原文。");
      return;
    }

    if (mode === "logic" && logicUseAi && logicExport === "lecture" && !selectedModel) {
      appendProgress("已开启 AI 辅助布局，请先在设置中新增语言大模型；或关闭 AI 辅助。");
      return;
    }

    setIsGenerating(true);
    setProgress([]);
    setLastImageResult(null);
    if (mode === "manuscript") {
      setManuscriptItems([]);
    }
    appendProgress(
      mode === "manuscript"
        ? "准备四张手稿图生成..."
        : mode === "image"
          ? "准备图片生成请求..."
          : "准备白板长图生成...",
    );

    try {
      if (mode === "image") {
        appendProgress(`已选择比例 ${imageAspectRatio}，清晰度 ${imageResolution.toUpperCase()}。`);
        const result = await onGenerateImage(
          {
            model: selectedModel,
            prompt: imagePromptText,
            aspectRatio: imageAspectRatio,
            resolution: imageResolution,
          },
          appendProgress,
        );
        setLastImageResult(result);
        appendProgress("图片已生成，正在按原始比例放入画布...");
        await onInsertImage(result);
        appendProgress("图片已按原始比例放入画布。");
      } else if (mode === "manuscript") {
        await runManuscriptGeneration(selectedModel!);
      } else if (mode === "logic") {
        await onGenerateLogic(
          {
            original: logicOriginal,
            theme: posterTheme,
            export: logicExport,
            model: selectedModel,
            useAiLayout: logicUseAi && logicExport === "lecture",
            intent: logicIntent,
          },
          appendProgress,
        );
      }
    } catch (error) {
      appendProgress(error instanceof Error ? error.message : "生成失败。");
    } finally {
      setIsGenerating(false);
    }
  };

  // 拆分原文 -> 顺序生成 4 张 9:16 手稿图 -> 每张生成完立刻入画布（流式），不再等 4 张齐
  const runManuscriptGeneration = async (selectedModel: AiModelConfig) => {
    appendProgress("正在拆分为 4 段...");
    const parts = splitContentIntoFourParts(manuscriptText);
    appendProgress(`已拆分完成：${parts.map((part) => part.length).join(" / ")} 字。`);

    const initialItems: ManuscriptItem[] = parts.map((text, index) => ({
      index: index as 0 | 1 | 2 | 3,
      text,
      prompt: generateImagePrompt(text, index),
      status: "pending",
    }));
    setManuscriptItems(initialItems);

    const workingItems = [...initialItems];
    const total = workingItems.length;
    let hasFailure = false;

    for (let i = 0; i < total; i += 1) {
      workingItems[i] = { ...workingItems[i], status: "generating" };
      setManuscriptItems([...workingItems]);
      appendProgress(`正在生成第 ${i + 1}/${total} 张手稿图...`);

      try {
        const result = await onGenerateImage(
          {
            model: selectedModel,
            prompt: workingItems[i].prompt,
            aspectRatio: "9:16",
            resolution: imageResolution,
          },
          appendProgress,
        );
        // 生成完立刻插入到画布的对应槽位
        const meta = await onInsertManuscriptAt(i, total, result);
        workingItems[i] = {
          ...workingItems[i],
          status: meta ? "inserted" : "ready",
          result,
          elementId: meta?.elementId,
        };
        setManuscriptItems([...workingItems]);
        appendProgress(`第 ${i + 1}/${total} 张已放入画布。`);
      } catch (error) {
        hasFailure = true;
        const message = error instanceof Error ? error.message : "生图失败。";
        workingItems[i] = { ...workingItems[i], status: "error", error: message };
        setManuscriptItems([...workingItems]);
        appendProgress(`第 ${i + 1} 张生成失败：${message}`);
      }
    }

    if (hasFailure) {
      appendProgress("部分图片生成失败，可点击对应段的「重新生成这张」或下方「重试失败项」继续。");
    } else {
      appendProgress(`${total} 张手稿图已全部放入画布。点击白板右下角的 1/2/3/4 可定位查看。`);
    }
  };

  // 仅供"重试失败项"复用：逐张走流式插入。
  const _legacyUnused = async () => {
    // 旧的 4 张统一插入路径已弃用。引用 onInsertImages 以避免 unused-prop 提示。
    void onInsertImages;
  };
  void _legacyUnused;

  // 只重生 status === "error" 的项。重生成功后若 4 张齐了则统一插入。
  const retryManuscriptFailures = async () => {
    if (!selectedImageModel || manuscriptItems.length === 0) return;
    setIsGenerating(true);
    try {
      const workingItems = [...manuscriptItems];
      for (let i = 0; i < workingItems.length; i += 1) {
        if (workingItems[i].status !== "error") continue;
        workingItems[i] = { ...workingItems[i], status: "generating", error: undefined };
        setManuscriptItems([...workingItems]);
        appendProgress(`正在重试第 ${i + 1}/${workingItems.length} 张...`);
        try {
          const result = await onGenerateImage(
            {
              model: selectedImageModel,
              prompt: workingItems[i].prompt,
              aspectRatio: "9:16",
              resolution: imageResolution,
            },
            appendProgress,
          );
          // 流式插入：已有 elementId 的话替换素材，没有的话往原槽位插一张
          let meta: { elementId: string } | null = null;
          if (workingItems[i].elementId) {
            const ok = await onReplaceImage(workingItems[i].elementId!, result);
            meta = ok ? { elementId: workingItems[i].elementId! } : null;
          } else {
            meta = await onInsertManuscriptAt(i, workingItems.length, result);
          }
          workingItems[i] = {
            ...workingItems[i],
            status: meta ? "inserted" : "ready",
            result,
            elementId: meta?.elementId ?? workingItems[i].elementId,
          };
          setManuscriptItems([...workingItems]);
          appendProgress(`第 ${i + 1} 张已重生并放入画布。`);
        } catch (error) {
          const message = error instanceof Error ? error.message : "生图失败。";
          workingItems[i] = { ...workingItems[i], status: "error", error: message };
          setManuscriptItems([...workingItems]);
          appendProgress(`第 ${i + 1} 张重试失败：${message}`);
        }
      }

      if (workingItems.every((item) => !!item.elementId)) {
        appendProgress(`${workingItems.length} 张手稿图已全部放入画布。`);
      }
    } catch (error) {
      appendProgress(error instanceof Error ? error.message : "重试失败。");
    } finally {
      setIsGenerating(false);
    }
  };

  const hasManuscriptFailure = manuscriptItems.some((item) => item.status === "error");
  const manuscriptInsertedCount = manuscriptItems.filter((item) => !!item.elementId).length;

  // 单张重生：用相同的 prompt 重新生图，并替换画布上对应 image element 的素材。
  const regenerateOne = async (index: 0 | 1 | 2 | 3) => {
    if (!selectedImageModel) {
      appendProgress("请先在设置中新增生图大模型。");
      return;
    }
    const item = manuscriptItems[index];
    if (!item || !item.elementId) {
      appendProgress(`第 ${index + 1} 张还未入画布，无法重生。`);
      return;
    }
    setIsGenerating(true);
    try {
      const working = [...manuscriptItems];
      working[index] = { ...working[index], status: "generating", error: undefined };
      setManuscriptItems(working);
      appendProgress(`正在重新生成第 ${index + 1} 张...`);
      try {
        const result = await onGenerateImage(
          {
            model: selectedImageModel,
            prompt: working[index].prompt,
            aspectRatio: "9:16",
            resolution: imageResolution,
          },
          appendProgress,
        );
        const ok = await onReplaceImage(working[index].elementId!, result);
        working[index] = {
          ...working[index],
          status: ok ? "inserted" : "ready",
          result,
        };
        setManuscriptItems([...working]);
        appendProgress(ok ? `第 ${index + 1} 张已替换。` : `第 ${index + 1} 张替换失败：找不到画布元素。`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "生图失败。";
        working[index] = { ...working[index], status: "error", error: message };
        setManuscriptItems([...working]);
        appendProgress(`第 ${index + 1} 张重生失败：${message}`);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <aside className="ai-panel">
      <div className="segmented panel-mode panel-mode-three">
        <button className={mode === "image" ? "active" : ""} type="button" onClick={() => setMode("image")}>
          AI生图
        </button>
        <button className={mode === "logic" ? "active" : ""} type="button" onClick={() => setMode("logic")}>
          白板长图
        </button>
        <button className={mode === "manuscript" ? "active" : ""} type="button" onClick={() => setMode("manuscript")}>
          四张手稿图
        </button>
      </div>

      {mode === "logic" ? (
        <div className="panel-section">
          <label>
            语言模型（AI 辅助布局）
            <select
              value={selectedLanguageModel?.id ?? ""}
              onChange={(event) =>
                updateSettings({ ...settings, selectedLanguageModelId: event.target.value })
              }
            >
              {settings.languageModels.length === 0 ? (
                <option value="">请先在设置中新增语言模型</option>
              ) : (
                settings.languageModels.map((model, index) => (
                  <option key={model.id} value={model.id}>
                    {model.name || `语言模型${index + 1}`}
                  </option>
                ))
              )}
            </select>
          </label>
          <label className="fidelity-toggle-row">
            <input
              type="checkbox"
              checked={logicUseAi}
              onChange={(event) => setLogicUseAi(event.target.checked)}
            />
            <span>AI 辅助布局（选 pattern + 分组，原文仍 100% 本地注入）</span>
          </label>
        </div>
      ) : (
        <div className="panel-section">
          <label>
            生图模型
            <select
              value={selectedImageModel?.id ?? ""}
              onChange={(event) =>
                updateSettings({ ...settings, selectedImageModelId: event.target.value })
              }
            >
              {settings.imageModels.length === 0 ? (
                <option value="">未配置</option>
              ) : null}
              {settings.imageModels.map((model, index) => (
                <option key={model.id} value={model.id}>
                  {model.name || `生图模型${index + 1}`}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {mode === "logic" ? (
        <>
          <div className="panel-section">
            <label>
              导出形态
              <select value={logicExport} onChange={(event) => setLogicExport(event.target.value as LogicExportMode)}>
                <option value="lecture">讲义长图（整句原文 + 条件箭头）</option>
                <option value="mindmap">逻辑导图（关键词链 + 条件箭头）</option>
              </select>
            </label>
          </div>
          <div className="panel-section">
            <label>
              设计主题
            </label>
            <div className="theme-cards">
              {POSTER_THEME_ORDER.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={posterTheme === id ? "theme-card active" : "theme-card"}
                  onClick={() => setPosterTheme(id)}
                >
                  <span className="theme-card-swatch" style={{ background: POSTER_THEMES[id].paper, borderColor: POSTER_THEMES[id].red }} />
                  <span className="theme-card-info">
                    <span className="theme-card-name">{POSTER_THEMES[id].label}</span>
                    <span className="theme-card-desc">{POSTER_THEMES[id].description}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="panel-section">
            <label>
              内容原文
              <textarea
                value={logicOriginal}
                placeholder="粘贴口播稿或讲义原文。本地切句保真；开启 AI 辅助时，模型负责选章节与 pattern，文字仍从原文注入。"
                onChange={(event) => setLogicOriginal(event.target.value)}
                rows={12}
              />
            </label>
          </div>
          <div className="panel-section">
            <label>
              布局意图（可选）
              <textarea
                value={logicIntent}
                placeholder="例如：引子要抓痛点 / 三步方案各用步骤框 / 对比句要醒目 / 公式链横向展示"
                onChange={(event) => setLogicIntent(event.target.value)}
                rows={3}
              />
            </label>
          </div>
        </>
      ) : null}

      {mode === "manuscript" ? (
        <>
          <div className="panel-section">
            <label>
              手稿原文
              <textarea
                value={manuscriptText}
                placeholder="粘贴一段长文本。点击「生成四张手稿图」后，系统会自动拆成 4 段，分别生成 9:16 手稿风格图片，并按 1/2/3/4 顺序放入白板。"
                onChange={(event) => setManuscriptText(event.target.value)}
                rows={14}
              />
            </label>
          </div>

          <div className="panel-section">
            <label>
              清晰度
              <select
                value={imageResolution}
                onChange={(event) => setImageResolution(event.target.value as ImageResolution)}
              >
                {resolutionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="empty-settings" style={{ marginTop: 8 }}>
              提示：系统会强制使用 9:16 竖版手稿风格，并在提示词中要求逐字呈现原文，但能否完全无遗漏取决于图片模型本身的文字渲染能力。
            </p>
          </div>

          {manuscriptItems.length > 0 ? (
            <>
              <div className="panel-section manuscript-item-list">
                {manuscriptItems.map((item) => (
                  <div className="manuscript-item" key={item.index}>
                    <div className="manuscript-item-header">
                      <span>
                        第 {item.index + 1} 段 · {item.text.length} 字
                      </span>
                      <span>{renderManuscriptStatus(item.status)}</span>
                    </div>
                    {item.status === "error" && item.error ? (
                      <div className="manuscript-item-error">{item.error}</div>
                    ) : null}
                    {item.elementId ? (
                      <div className="manuscript-item-actions">
                        <button
                          type="button"
                          onClick={() => regenerateOne(item.index)}
                          disabled={isGenerating}
                          title={`字数 ${item.text.length}，重新让 AI 画一张替换`}
                        >
                          {isGenerating && item.status === "generating" ? "生成中..." : "重新生成这张"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>

              {hasManuscriptFailure && manuscriptInsertedCount === 0 ? (
                <div className="panel-section">
                  <button
                    className="primary-button full-width-button"
                    type="button"
                    onClick={retryManuscriptFailures}
                    disabled={isGenerating}
                  >
                    {isGenerating ? "生成中..." : "重试失败项"}
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
        </>
      ) : mode === "image" ? (
        <>
          <div className="panel-section">
            <label>
              图片提示词
              <textarea
                value={imagePrompt}
                placeholder="描述要生成的图片，例如：高级感产品海报、暖色摄影灯光、干净背景、主体突出。"
                onChange={(event) => setImagePrompt(event.target.value)}
              />
            </label>
            <div className="prompt-actions">
              <button type="button" onClick={saveImagePrompt}>
                保存提示词
              </button>
            </div>
          </div>

          <div className="panel-section">
            <label>
              尺寸比例
              <select
                value={imageAspectRatio}
                onChange={(event) => setImageAspectRatio(event.target.value as ImageAspectRatio)}
              >
                {aspectRatioOptions.map((ratio) => (
                  <option key={ratio} value={ratio}>
                    {ratio}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="panel-section">
            <label>
              清晰度
              <select
                value={imageResolution}
                onChange={(event) => setImageResolution(event.target.value as ImageResolution)}
              >
                {resolutionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="panel-section prompt-list">
            {settings.imagePrompts.length === 0 ? <p className="empty-settings">还没有保存的图片提示词。</p> : null}
            {settings.imagePrompts.map((prompt, index) => (
              <div className="prompt-row" key={prompt.id}>
                {editingPromptId === prompt.id ? (
                  <div className="prompt-edit">
                    <input value={editingName} onChange={(event) => setEditingName(event.target.value)} />
                    <textarea value={editingText} onChange={(event) => setEditingText(event.target.value)} />
                    <div>
                      <button type="button" onClick={commitEditPrompt}>
                        保存
                      </button>
                      <button type="button" onClick={() => setEditingPromptId(null)}>
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button className="prompt-title" type="button" onClick={() => setImagePrompt(prompt.prompt)}>
                      {getPromptName(prompt, index)}
                    </button>
                    <button type="button" onClick={() => startEditPrompt(prompt, index)}>
                      编辑
                    </button>
                    <button type="button" onClick={() => deletePrompt(prompt.id)}>
                      删除
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </>
      ) : null}

      <div className="panel-section">
        <button className="primary-button full-width-button" type="button" onClick={generate} disabled={isGenerating}>
          {isGenerating
            ? "生成中..."
            : mode === "image"
              ? "生成图片"
              : mode === "manuscript"
                ? "生成四张手稿图"
                : logicExport === "lecture"
                  ? "生成讲义长图"
                  : "生成逻辑导图"}
        </button>
      </div>

      <div className="panel-section progress-box">
        <h3>
          {mode === "image"
            ? "图片生成进度"
            : mode === "manuscript"
              ? "四张手稿图生成进度"
              : "白板长图生成进度"}
        </h3>
        {progress.length === 0 ? <p>等待开始。</p> : progress.map((item, index) => <p key={`${item}-${index}`}>{item}</p>)}
      </div>

      {lastImageResult ? (
        <div className="panel-section result-box">
          <img src={lastImageResult.dataUrl} alt="AI generated result" />
        </div>
      ) : null}
    </aside>
  );
}
