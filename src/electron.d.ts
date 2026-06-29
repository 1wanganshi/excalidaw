export type MenuCommand = "new" | "open" | "save" | "save-as";

export type PosterModulePayload =
  | { kind: "title"; text: string; source?: string }
  | { kind: "section"; text: string; source?: string }
  | { kind: "overview"; items: string[]; source?: string }
  | { kind: "paragraph"; text: string; source: string }
  | { kind: "highlight"; text: string; source: string }
  | { kind: "contrast"; wrong: string; right: string; source: string }
  | { kind: "formula"; items: string[]; source: string }
  | { kind: "case"; label?: string; text: string; source: string }
  | { kind: "list"; title?: string; items: string[]; source: string }
  | { kind: "summary"; text: string; source: string };

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
  modules: PosterModulePayload[];
};

export type AiTestResultPayload = {
  ok: boolean;
  message: string;
};

export type DiagramStreamEvent =
  | { streamId: string; kind: "title"; title: string }
  | { streamId: string; kind: "module"; module: PosterModulePayload; index: number }
  | { streamId: string; kind: "done"; total: number }
  | { streamId: string; kind: "error"; message: string };

export type DiagramStreamV2Event =
  | { streamId: string; kind: "title"; title: string }
  | { streamId: string; kind: "overview"; items: string[] }
  | { streamId: string; kind: "section"; section: unknown; index: number }
  | { streamId: string; kind: "done"; total: number }
  | { streamId: string; kind: "error"; message: string };

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
      generateAiDiagramStream(
        request: AiDiagramRequestPayload,
        streamId: string,
      ): Promise<{ ok: true; total: number } | { ok: false; message: string }>;
      onDiagramStreamEvent(callback: (event: DiagramStreamEvent) => void): () => void;
      generateAiDiagramStreamV2(
        request: AiDiagramRequestPayload,
        streamId: string,
      ): Promise<{ ok: true; total: number } | { ok: false; message: string }>;
      onDiagramStreamV2Event(callback: (event: DiagramStreamV2Event) => void): () => void;
      generateLogicLayout(
        request: AiDiagramRequestPayload,
      ): Promise<Record<string, unknown>>;
      generatePosterDoc(
        request: AiDiagramRequestPayload,
      ): Promise<Record<string, unknown>>;
    };
  }
}
