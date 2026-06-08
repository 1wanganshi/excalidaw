import { useMemo, useState } from "react";
import { createDefaultModel } from "./storage";
import type { AiModelConfig, AiModelKind, AiSettings, AiTestResult } from "./types";

type SettingsModalProps = {
  settings: AiSettings;
  onClose: () => void;
  onSave: (settings: AiSettings) => void;
  onTestModel: (model: AiModelConfig) => Promise<AiTestResult>;
};

function getModelDisplayName(model: AiModelConfig, index: number) {
  return model.name.trim() || `${model.kind === "image" ? "生图模型" : "语言模型"}${index + 1}`;
}

export default function SettingsModal({ settings, onClose, onSave, onTestModel }: SettingsModalProps) {
  const [draft, setDraft] = useState<AiSettings>(settings);
  const [activeKind, setActiveKind] = useState<AiModelKind>("image");
  const [selectedId, setSelectedId] = useState(settings.selectedImageModelId || settings.imageModels[0]?.id || "");
  const [testStatus, setTestStatus] = useState("");
  const [isTesting, setIsTesting] = useState(false);

  const activeModels = activeKind === "image" ? draft.imageModels : draft.languageModels;
  const selectedModel = useMemo(
    () => activeModels.find((model) => model.id === selectedId) ?? activeModels[0],
    [activeModels, selectedId],
  );

  const patchModels = (kind: AiModelKind, updater: (models: AiModelConfig[]) => AiModelConfig[]) => {
    setDraft((current) =>
      kind === "image"
        ? { ...current, imageModels: updater(current.imageModels) }
        : { ...current, languageModels: updater(current.languageModels) },
    );
  };

  const updateModel = (modelId: string, patch: Partial<AiModelConfig>) => {
    patchModels(activeKind, (models) => models.map((model) => (model.id === modelId ? { ...model, ...patch } : model)));
  };

  const switchKind = (kind: AiModelKind) => {
    setActiveKind(kind);
    setSelectedId(kind === "image" ? draft.selectedImageModelId || draft.imageModels[0]?.id || "" : draft.selectedLanguageModelId || draft.languageModels[0]?.id || "");
    setTestStatus("");
  };

  const addModel = (kind: AiModelKind) => {
    const model = createDefaultModel(kind);
    setDraft((current) =>
      kind === "image"
        ? {
            ...current,
            imageModels: [...current.imageModels, model],
            selectedImageModelId: current.selectedImageModelId || model.id,
          }
        : {
            ...current,
            languageModels: [...current.languageModels, model],
            selectedLanguageModelId: current.selectedLanguageModelId || model.id,
          },
    );
    setActiveKind(kind);
    setSelectedId(model.id);
    setTestStatus("");
  };

  const deleteModel = (modelId: string) => {
    setDraft((current) => {
      if (activeKind === "image") {
        const imageModels = current.imageModels.filter((model) => model.id !== modelId);
        const selectedImageModelId =
          current.selectedImageModelId === modelId ? imageModels[0]?.id ?? "" : current.selectedImageModelId;
        setSelectedId(selectedImageModelId);
        return { ...current, imageModels, selectedImageModelId };
      }

      const languageModels = current.languageModels.filter((model) => model.id !== modelId);
      const selectedLanguageModelId =
        current.selectedLanguageModelId === modelId ? languageModels[0]?.id ?? "" : current.selectedLanguageModelId;
      setSelectedId(selectedLanguageModelId);
      return { ...current, languageModels, selectedLanguageModelId };
    });
    setTestStatus("");
  };

  const testModel = async () => {
    if (!selectedModel) {
      setTestStatus("请先新增一个模型。");
      return;
    }

    setIsTesting(true);
    setTestStatus("正在测试连接...");
    try {
      const result = await onTestModel(selectedModel);
      setTestStatus(result.message);
    } catch (error) {
      setTestStatus(error instanceof Error ? error.message : "测试失败。");
    } finally {
      setIsTesting(false);
    }
  };

  const normalizeForSave = (models: AiModelConfig[], kind: AiModelKind) =>
    models.map((model, index) => ({
      ...model,
      kind,
      name: model.name.trim() || `${kind === "image" ? "生图模型" : "语言模型"}${index + 1}`,
      baseUrl: model.baseUrl.trim().replace(/\/+$/, ""),
      imageEndpoint: model.imageEndpoint.trim() || "/images/generations",
      chatEndpoint: model.chatEndpoint.trim() || "/chat/completions",
      testEndpoint: model.testEndpoint.trim() || "/models",
    }));

  const save = () => {
    const imageModels = normalizeForSave(draft.imageModels, "image");
    const languageModels = normalizeForSave(draft.languageModels, "language");
    onSave({
      ...draft,
      imageModels,
      languageModels,
      selectedImageModelId: imageModels.some((model) => model.id === draft.selectedImageModelId)
        ? draft.selectedImageModelId
        : imageModels[0]?.id ?? "",
      selectedLanguageModelId: languageModels.some((model) => model.id === draft.selectedLanguageModelId)
        ? draft.selectedLanguageModelId
        : languageModels[0]?.id ?? "",
    });
    onClose();
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="settings-modal" role="dialog" aria-modal="true" aria-label="AI settings">
        <header className="modal-header">
          <h2>设置</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            X
          </button>
        </header>

        <div className="settings-layout">
          <aside className="model-list">
            <div className="segmented">
              <button className={activeKind === "image" ? "active" : ""} type="button" onClick={() => switchKind("image")}>
                生图模型
              </button>
              <button className={activeKind === "language" ? "active" : ""} type="button" onClick={() => switchKind("language")}>
                语言模型
              </button>
            </div>
            <button className="primary-button" type="button" onClick={() => addModel(activeKind)}>
              新增{activeKind === "image" ? "生图模型" : "语言模型"}
            </button>
            {activeModels.map((model, index) => (
              <button
                className={model.id === selectedModel?.id ? "model-tab active" : "model-tab"}
                key={model.id}
                type="button"
                onClick={() => {
                  setSelectedId(model.id);
                  setTestStatus("");
                }}
              >
                {getModelDisplayName(model, index)}
              </button>
            ))}
          </aside>

          {selectedModel ? (
            <div className="model-form">
              <label>
                名字
                <input
                  value={selectedModel.name}
                  placeholder={activeKind === "image" ? "例如 OpenAI 生图" : "例如 OpenAI 语言模型"}
                  onChange={(event) => updateModel(selectedModel.id, { name: event.target.value })}
                />
              </label>
              <label>
                Base URL
                <input
                  value={selectedModel.baseUrl}
                  placeholder="https://api.openai.com/v1"
                  onChange={(event) => updateModel(selectedModel.id, { baseUrl: event.target.value })}
                />
              </label>
              <label>
                API Key
                <input
                  value={selectedModel.apiKey}
                  type="password"
                  placeholder="sk-..."
                  onChange={(event) => updateModel(selectedModel.id, { apiKey: event.target.value })}
                />
              </label>
              <label>
                模型
                <input
                  value={selectedModel.model}
                  placeholder={activeKind === "image" ? "gpt-image-1" : "gpt-4o-mini"}
                  onChange={(event) => updateModel(selectedModel.id, { model: event.target.value })}
                />
              </label>
              {activeKind === "image" ? (
                <label>
                  生图接口
                  <input
                    value={selectedModel.imageEndpoint}
                    placeholder="/images/generations"
                    onChange={(event) => updateModel(selectedModel.id, { imageEndpoint: event.target.value })}
                  />
                </label>
              ) : (
                <label>
                  对话接口
                  <input
                    value={selectedModel.chatEndpoint}
                    placeholder="/chat/completions"
                    onChange={(event) => updateModel(selectedModel.id, { chatEndpoint: event.target.value })}
                  />
                </label>
              )}
              <label>
                测试接口
                <input
                  value={selectedModel.testEndpoint}
                  placeholder="/models"
                  onChange={(event) => updateModel(selectedModel.id, { testEndpoint: event.target.value })}
                />
              </label>

              <div className="settings-actions">
                <button type="button" onClick={testModel} disabled={isTesting}>
                  {isTesting ? "测试中" : "测试"}
                </button>
                <button className="danger-button" type="button" onClick={() => deleteModel(selectedModel.id)}>
                  删除
                </button>
              </div>

              {testStatus ? <p className="status-text">{testStatus}</p> : null}
            </div>
          ) : (
            <div className="empty-settings">还没有{activeKind === "image" ? "生图模型" : "语言模型"}，先新增一个。</div>
          )}
        </div>

        <footer className="modal-footer">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary-button" type="button" onClick={save}>
            保存
          </button>
        </footer>
      </section>
    </div>
  );
}
