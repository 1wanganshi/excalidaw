import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";

export type MenuCommand = "new" | "open" | "save" | "save-as";

export type MenuCommandMessage = {
  command: MenuCommand;
  payload?: unknown;
};

export type OpenSceneResult = {
  filePath: string;
  contents: string;
} | null;

export type SaveSceneResult = {
  filePath: string;
} | null;

export type AiModelConfigPayload = {
  id: string;
  kind: "image" | "language";
  name: string;
  provider: "openai-compatible" | "custom";
  baseUrl: string;
  apiKey: string;
  model: string;
  imageEndpoint: string;
  chatEndpoint: string;
  testEndpoint: string;
};

export type AiImageRequestPayload = {
  model: AiModelConfigPayload;
  prompt: string;
  aspectRatio: "1:1" | "9:16" | "16:9" | "3:4" | "4:3" | "2:3" | "3:2";
  resolution: "1k" | "2k" | "4k";
};

export type AiImageResultPayload = {
  dataUrl: string;
  mimeType: string;
};

export type AiDiagramRequestPayload = {
  model: AiModelConfigPayload;
  prompt: string;
  diagramKind: string;
};

export type AiDiagramResultPayload = {
  title?: string;
  elements: ExcalidrawElementSkeleton[];
};

export type AiTestResultPayload = {
  ok: boolean;
  message: string;
};

declare global {
  interface Window {
    excalidaw?: {
      onMenuCommand(callback: (message: MenuCommandMessage) => void): () => void;
      openScene(): Promise<OpenSceneResult>;
      saveScene(sceneJson: string, saveAs: boolean): Promise<SaveSceneResult>;
      setDirty(isDirty: boolean): Promise<void>;
      setCleanFile(filePath: string | null): Promise<void>;
      testAiModel(model: AiModelConfigPayload): Promise<AiTestResultPayload>;
      generateAiImage(request: AiImageRequestPayload): Promise<AiImageResultPayload>;
      generateAiDiagram(request: AiDiagramRequestPayload): Promise<AiDiagramResultPayload>;
    };
  }
}
