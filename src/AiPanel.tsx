import { useMemo, useState } from "react";
import { createDefaultPrompt, getNextPromptName } from "./storage";
import type {
  AiDiagramRequest,
  AiImageRequest,
  AiImageResult,
  AiSettings,
  DiagramKind,
  ImageAspectRatio,
  ImageResolution,
  PromptPreset,
} from "./types";

type AiMode = "image" | "diagram";

type AiPanelProps = {
  settings: AiSettings;
  onSettingsChange: (settings: AiSettings) => void;
  onGenerateImage: (request: AiImageRequest, onProgress: (message: string) => void) => Promise<AiImageResult>;
  onGenerateDiagram: (request: AiDiagramRequest, onProgress: (message: string) => void) => Promise<void>;
  onInsertImage: (result: AiImageResult) => Promise<void>;
};

const diagramOptions: Array<{ value: DiagramKind; label: string }> = [
  { value: "flowchart", label: "流程图" },
  { value: "fishbone", label: "鱼骨图" },
  { value: "mindmap", label: "思维导图" },
  { value: "architecture", label: "架构图" },
  { value: "timeline", label: "时间线" },
  { value: "custom", label: "自定义" },
];

const aspectRatioOptions: ImageAspectRatio[] = ["1:1", "9:16", "16:9", "3:4", "4:3", "2:3", "3:2"];
const resolutionOptions: Array<{ value: ImageResolution; label: string }> = [
  { value: "1k", label: "1K" },
  { value: "2k", label: "2K" },
  { value: "4k", label: "4K" },
];

function getPromptName(prompt: PromptPreset, index: number) {
  return prompt.name.trim() || `提示词${index + 1}`;
}

export default function AiPanel({
  settings,
  onSettingsChange,
  onGenerateImage,
  onGenerateDiagram,
  onInsertImage,
}: AiPanelProps) {
  const [mode, setMode] = useState<AiMode>("image");
  const [diagramKind, setDiagramKind] = useState<DiagramKind>("flowchart");
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageAspectRatio, setImageAspectRatio] = useState<ImageAspectRatio>("1:1");
  const [imageResolution, setImageResolution] = useState<ImageResolution>("1k");
  const [diagramUserRequirement, setDiagramUserRequirement] = useState("");
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingText, setEditingText] = useState("");
  const [progress, setProgress] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [lastImageResult, setLastImageResult] = useState<AiImageResult | null>(null);

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
    const selectedModel = mode === "image" ? selectedImageModel : selectedLanguageModel;
    const imagePromptText = imagePrompt.trim();
    const requirementText = diagramUserRequirement.trim();

    if (!selectedModel) {
      appendProgress(mode === "image" ? "请先在设置中新增生图大模型。" : "请先在设置中新增语言大模型。");
      return;
    }

    if (mode === "image" && !imagePromptText) {
      appendProgress("请先填写图片提示词。");
      return;
    }

    if (mode === "diagram" && !requirementText) {
      appendProgress("请先填写用户要求。");
      return;
    }

    setIsGenerating(true);
    setProgress([]);
    setLastImageResult(null);
    appendProgress(mode === "image" ? "准备图片生成请求..." : "准备原生图表请求...");

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
      } else {
        appendProgress("将内置专业图表系统提示词和用户要求发送给语言模型...");
        await onGenerateDiagram({ model: selectedModel, prompt: requirementText, diagramKind }, appendProgress);
        appendProgress("原生图表已在画布上流式生成完成。");
      }
    } catch (error) {
      appendProgress(error instanceof Error ? error.message : "生成失败。");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <aside className="ai-panel">
      <div className="segmented panel-mode">
        <button className={mode === "image" ? "active" : ""} type="button" onClick={() => setMode("image")}>
          图生图
        </button>
        <button className={mode === "diagram" ? "active" : ""} type="button" onClick={() => setMode("diagram")}>
          原生图表
        </button>
      </div>

      <div className="panel-section">
        <label>
          {mode === "image" ? "生图模型" : "语言模型"}
          <select
            value={(mode === "image" ? selectedImageModel?.id : selectedLanguageModel?.id) ?? ""}
            onChange={(event) =>
              updateSettings(
                mode === "image"
                  ? { ...settings, selectedImageModelId: event.target.value }
                  : { ...settings, selectedLanguageModelId: event.target.value },
              )
            }
          >
            {(mode === "image" ? settings.imageModels : settings.languageModels).length === 0 ? (
              <option value="">未配置</option>
            ) : null}
            {(mode === "image" ? settings.imageModels : settings.languageModels).map((model, index) => (
              <option key={model.id} value={model.id}>
                {model.name || `${mode === "image" ? "生图模型" : "语言模型"}${index + 1}`}
              </option>
            ))}
          </select>
        </label>
      </div>

      {mode === "diagram" ? (
        <>
          <div className="panel-section">
            <label>
              图表类型
              <select value={diagramKind} onChange={(event) => setDiagramKind(event.target.value as DiagramKind)}>
                {diagramOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="panel-section">
            <label>
              用户要求
              <textarea
                value={diagramUserRequirement}
                placeholder="写下这次要生成的具体内容，例如：用户从注册、登录、下单到支付成功的完整流程图。"
                onChange={(event) => setDiagramUserRequirement(event.target.value)}
              />
            </label>
          </div>
        </>
      ) : (
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
      )}

      <div className="panel-section">
        <button className="primary-button full-width-button" type="button" onClick={generate} disabled={isGenerating}>
          {isGenerating ? "生成中..." : mode === "image" ? "生成图片" : "流式生成到画布"}
        </button>
      </div>

      <div className="panel-section progress-box">
        <h3>{mode === "image" ? "图片生成进度" : "画布生成进度"}</h3>
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
