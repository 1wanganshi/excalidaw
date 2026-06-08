import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";

export type AiModelKind = "image" | "language";
export type AiModelProvider = "openai-compatible" | "custom";

export type AiModelConfig = {
  id: string;
  kind: AiModelKind;
  name: string;
  provider: AiModelProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  imageEndpoint: string;
  chatEndpoint: string;
  testEndpoint: string;
};

export type PromptPreset = {
  id: string;
  name: string;
  prompt: string;
};

export type DiagramKind = "flowchart" | "fishbone" | "mindmap" | "architecture" | "timeline" | "custom";
export type ImageAspectRatio = "1:1" | "9:16" | "16:9" | "3:4" | "4:3" | "2:3" | "3:2";
export type ImageResolution = "1k" | "2k" | "4k";

export type AiSettings = {
  imageModels: AiModelConfig[];
  languageModels: AiModelConfig[];
  imagePrompts: PromptPreset[];
  diagramPrompts: PromptPreset[];
  selectedImageModelId: string;
  selectedLanguageModelId: string;
};

export type AiImageRequest = {
  model: AiModelConfig;
  prompt: string;
  aspectRatio: ImageAspectRatio;
  resolution: ImageResolution;
};

export type AiImageResult = {
  dataUrl: string;
  mimeType: string;
};

export type AiDiagramRequest = {
  model: AiModelConfig;
  prompt: string;
  diagramKind: DiagramKind;
};

export type AiDiagramResult = {
  elements: ExcalidrawElementSkeleton[];
  title?: string;
};

export type AiTestResult = {
  ok: boolean;
  message: string;
};
