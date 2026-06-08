import type { AiModelConfig, AiModelKind, AiSettings, PromptPreset } from "./types";

const SETTINGS_KEY = "excalidaw.aiSettings.v2";
const LEGACY_SETTINGS_KEY = "excalidaw.aiImageSettings.v1";

const defaultSettings: AiSettings = {
  imageModels: [],
  languageModels: [],
  imagePrompts: [],
  diagramPrompts: [],
  selectedImageModelId: "",
  selectedLanguageModelId: "",
};

export function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createDefaultModel(kind: AiModelKind): AiModelConfig {
  return {
    id: createId(kind === "image" ? "image_model" : "llm_model"),
    kind,
    name: "",
    provider: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: kind === "image" ? "gpt-image-1" : "gpt-4o-mini",
    imageEndpoint: "/images/generations",
    chatEndpoint: "/chat/completions",
    testEndpoint: "/models",
  };
}

export function createDefaultPrompt(index: number): PromptPreset {
  return {
    id: createId("prompt"),
    name: `提示词${index}`,
    prompt: "",
  };
}

function normalizeModels(models: unknown, kind: AiModelKind): AiModelConfig[] {
  if (!Array.isArray(models)) {
    return [];
  }

  return models.map((model, index) => {
    const item = model as Partial<AiModelConfig>;
    const fallback = createDefaultModel(kind);
    return {
      ...fallback,
      ...item,
      id: item.id || createId(kind === "image" ? "image_model" : "llm_model"),
      kind,
      name: item.name || `${kind === "image" ? "生图模型" : "语言模型"}${index + 1}`,
      baseUrl: item.baseUrl || fallback.baseUrl,
      model: item.model || fallback.model,
      imageEndpoint: item.imageEndpoint || fallback.imageEndpoint,
      chatEndpoint: item.chatEndpoint || fallback.chatEndpoint,
      testEndpoint: item.testEndpoint || fallback.testEndpoint,
    };
  });
}

function normalizePrompts(prompts: unknown): PromptPreset[] {
  if (!Array.isArray(prompts)) {
    return [];
  }

  return prompts.map((prompt, index) => {
    const item = prompt as Partial<PromptPreset>;
    return {
      id: item.id || createId("prompt"),
      name: item.name || `提示词${index + 1}`,
      prompt: item.prompt || "",
    };
  });
}

export function normalizeSettings(settings: Partial<AiSettings> | null): AiSettings {
  const imageModels = normalizeModels(settings?.imageModels, "image");
  const languageModels = normalizeModels(settings?.languageModels, "language");
  const imagePrompts = normalizePrompts(settings?.imagePrompts);
  const diagramPrompts = normalizePrompts(settings?.diagramPrompts);

  return {
    imageModels,
    languageModels,
    imagePrompts,
    diagramPrompts,
    selectedImageModelId: imageModels.some((model) => model.id === settings?.selectedImageModelId)
      ? settings!.selectedImageModelId!
      : imageModels[0]?.id ?? "",
    selectedLanguageModelId: languageModels.some((model) => model.id === settings?.selectedLanguageModelId)
      ? settings!.selectedLanguageModelId!
      : languageModels[0]?.id ?? "",
  };
}

function loadLegacySettings(): AiSettings | null {
  try {
    const raw = localStorage.getItem(LEGACY_SETTINGS_KEY);
    if (!raw) {
      return null;
    }

    const legacy = JSON.parse(raw) as {
      models?: AiModelConfig[];
      prompts?: PromptPreset[];
      selectedModelId?: string;
    };
    const imageModels = normalizeModels(legacy.models, "image");
    const imagePrompts = normalizePrompts(legacy.prompts);

    return normalizeSettings({
      imageModels,
      imagePrompts,
      selectedImageModelId: legacy.selectedModelId,
    });
  } catch {
    return null;
  }
}

export function loadAiSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      return normalizeSettings(JSON.parse(raw) as Partial<AiSettings>);
    }

    return loadLegacySettings() ?? defaultSettings;
  } catch {
    return defaultSettings;
  }
}

export function saveAiSettings(settings: AiSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
}

export function getNextPromptName(prompts: PromptPreset[]) {
  return `提示词${prompts.length + 1}`;
}
