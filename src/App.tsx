import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Excalidraw,
  MainMenu,
  WelcomeScreen,
  convertToExcalidrawElements,
  restore,
} from "@excalidraw/excalidraw";
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, FileId } from "@excalidraw/excalidraw/element/types";
import "@excalidraw/excalidraw/index.css";
import AiPanel from "./AiPanel";
import SettingsModal from "./SettingsModal";
import { loadAiSettings, saveAiSettings } from "./storage";
import type { AiImageRequest, AiImageResult, AiModelConfig, AiSettings } from "./types";

type SceneSnapshot = {
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
};

type StoredScene = {
  type: "excalidraw";
  version: 2;
  source: "excalidaw-desktop";
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
};

const emptyScene: ExcalidrawInitialDataState = {
  elements: [],
  appState: {
    viewBackgroundColor: "#ffffff",
  },
  files: {},
};

function sanitizeAppState(appState: AppState): Partial<AppState> {
  const {
    collaborators,
    currentChartType,
    editingFrame,
    editingGroupId,
    editingLinearElement,
    errorMessage,
    isBindingEnabled,
    isLoading,
    openDialog,
    openMenu,
    openPopup,
    pendingImageElementId,
    resizingElement,
    selectionElement,
    selectedElementIds,
    selectedGroupIds,
    selectedLinearElement,
    suggestedBindings,
    toast,
    zenModeEnabled,
    ...serializableAppState
  } = appState;

  void collaborators;
  void currentChartType;
  void editingFrame;
  void editingGroupId;
  void editingLinearElement;
  void errorMessage;
  void isBindingEnabled;
  void isLoading;
  void openDialog;
  void openMenu;
  void openPopup;
  void pendingImageElementId;
  void resizingElement;
  void selectionElement;
  void selectedElementIds;
  void selectedGroupIds;
  void selectedLinearElement;
  void suggestedBindings;
  void toast;
  void zenModeEnabled;

  return {
    ...serializableAppState,
    viewBackgroundColor: appState.viewBackgroundColor ?? "#ffffff",
  };
}

function createStoredScene(snapshot: SceneSnapshot): StoredScene {
  return {
    type: "excalidraw",
    version: 2,
    source: "excalidaw-desktop",
    elements: snapshot.elements,
    appState: snapshot.appState,
    files: snapshot.files,
  };
}

function parseStoredScene(contents: string): ExcalidrawInitialDataState {
  const scene = JSON.parse(contents) as Partial<StoredScene>;

  return {
    elements: scene.elements ?? [],
    appState: {
      viewBackgroundColor: "#ffffff",
      ...(scene.appState ?? {}),
    },
    files: scene.files ?? {},
  };
}

function loadImageDimensions(source: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve({
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
      });
    };
    image.onerror = () => reject(new Error("无法读取生成图片的尺寸。"));
    image.src = source;
  });
}

function fitImageForCanvas(width: number, height: number) {
  if (width <= 0 || height <= 0) {
    return { width: 420, height: 420 };
  }

  const maxLongSide = 640;
  const scale = maxLongSide / Math.max(width, height);

  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

export default function App() {
  const excalidrawAPIRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const snapshotRef = useRef<SceneSnapshot>({
    elements: [],
    appState: emptyScene.appState ?? {},
    files: {},
  });
  const hasMountedSceneRef = useRef(false);
  const [initialData, setInitialData] = useState<ExcalidrawInitialDataState>(emptyScene);
  const [isAiPanelOpen, setIsAiPanelOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [aiSettings, setAiSettings] = useState<AiSettings>(() => loadAiSettings());

  const persistDirty = useMemo(() => {
    let dirty = false;

    return (nextDirty: boolean) => {
      if (dirty === nextDirty) {
        return;
      }

      dirty = nextDirty;
      void window.excalidaw?.setDirty(nextDirty);
    };
  }, []);

  const loadScene = useCallback((nextScene: ExcalidrawInitialDataState) => {
    snapshotRef.current = {
      elements: nextScene.elements ?? [],
      appState: nextScene.appState ?? {},
      files: nextScene.files ?? {},
    };

    if (excalidrawAPIRef.current) {
      const restoredScene = restore(
        nextScene,
        excalidrawAPIRef.current.getAppState(),
        excalidrawAPIRef.current.getSceneElementsIncludingDeleted(),
      );

      excalidrawAPIRef.current.updateScene({
        ...restoredScene,
        captureUpdate: "IMMEDIATELY",
      });
      excalidrawAPIRef.current.history.clear();
      persistDirty(false);
      return;
    }

    setInitialData(nextScene);
    persistDirty(false);
  }, [persistDirty]);

  const handleNew = useCallback(() => {
    void window.excalidaw?.setCleanFile(null);
    loadScene(emptyScene);
  }, [loadScene]);

  const handleOpen = useCallback(async () => {
    const result = await window.excalidaw?.openScene();

    if (!result) {
      return;
    }

    loadScene(parseStoredScene(result.contents));
  }, [loadScene]);

  const handleSave = useCallback(async (saveAs: boolean) => {
    const sceneJson = JSON.stringify(createStoredScene(snapshotRef.current), null, 2);
    const result = await window.excalidaw?.saveScene(sceneJson, saveAs);

    if (result) {
      persistDirty(false);
    }
  }, [persistDirty]);

  const updateAiSettings = useCallback((settings: AiSettings) => {
    setAiSettings(settings);
    saveAiSettings(settings);
  }, []);

  const testAiModel = useCallback(async (model: AiModelConfig) => {
    return window.excalidaw?.testAiModel(model) ?? { ok: false, message: "桌面桥接不可用。" };
  }, []);

  const generateAiImage = useCallback(
    async (
      request: AiImageRequest,
      onProgress: (message: string) => void,
    ) => {
      onProgress("已发送请求到生图模型...");
      const result = await window.excalidaw?.generateAiImage(request);
      onProgress("正在接收图片数据...");

      if (!result) {
        throw new Error("没有收到图片数据。");
      }

      return result;
    },
    [],
  );

  const generateAiDiagram = useCallback(
    async (
      request: { model: AiModelConfig; prompt: string; diagramKind: string },
      onProgress: (message: string) => void,
    ) => {
      const api = excalidrawAPIRef.current;

      if (!api) {
        throw new Error("画布还没有准备好。");
      }

      onProgress("已发送内置专业图表系统提示词和用户要求到语言模型...");
      const result = await window.excalidaw?.generateAiDiagram(request);
      onProgress("正在解析 Excalidraw 元素...");

      if (!result) {
        throw new Error("没有收到图表数据。");
      }

      const appState = api.getAppState();
      const offsetX = -appState.scrollX + 80;
      const offsetY = -appState.scrollY + 80;
      const shiftedSkeletons = result.elements.map((element) => ({
        ...element,
        x: typeof element.x === "number" ? element.x + offsetX : offsetX,
        y: typeof element.y === "number" ? element.y + offsetY : offsetY,
      }));
      const elements = convertToExcalidrawElements(shiftedSkeletons, { regenerateIds: true });
      const baseElements = api.getSceneElementsIncludingDeleted();

      onProgress(`准备在画布上流式生成 ${elements.length} 个元素...`);

      for (let index = 0; index < elements.length; index += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, index === 0 ? 80 : 180));
        api.updateScene({
          elements: [...baseElements, ...elements.slice(0, index + 1)],
          captureUpdate: "IMMEDIATELY",
        });
        onProgress(`已生成元素 ${index + 1}/${elements.length}`);
      }

      if (elements.length > 0) {
        api.scrollToContent(elements, { fitToContent: true });
        persistDirty(true);
      }
    },
    [persistDirty],
  );

  const insertAiImage = useCallback(async (result: AiImageResult) => {
    const api = excalidrawAPIRef.current;

    if (!api) {
      return;
    }

    const fileId = `ai_${Date.now().toString(36)}` as FileId;
    const now = Date.now();
    const file: BinaryFileData = {
      id: fileId,
      mimeType: result.mimeType as BinaryFileData["mimeType"],
      dataURL: result.dataUrl as BinaryFileData["dataURL"],
      created: now,
      lastRetrieved: now,
    };

    api.addFiles([file]);

    const appState = api.getAppState();
    const x = -appState.scrollX + 80;
    const y = -appState.scrollY + 80;
    const dimensions = await loadImageDimensions(result.dataUrl);
    const canvasSize = fitImageForCanvas(dimensions.width, dimensions.height);
    const [imageElement] = convertToExcalidrawElements(
      [
        {
          type: "image",
          x,
          y,
          width: canvasSize.width,
          height: canvasSize.height,
          fileId,
          status: "saved",
        },
      ],
      { regenerateIds: true },
    );

    api.updateScene({
      elements: [...api.getSceneElementsIncludingDeleted(), imageElement],
      captureUpdate: "IMMEDIATELY",
    });
    api.scrollToContent([imageElement], { fitToContent: true });
    persistDirty(true);
  }, [persistDirty]);

  useEffect(() => {
    return window.excalidaw?.onMenuCommand(({ command }) => {
      if (command === "new") {
        handleNew();
      }

      if (command === "open") {
        void handleOpen();
      }

      if (command === "save") {
        void handleSave(false);
      }

      if (command === "save-as") {
        void handleSave(true);
      }
    });
  }, [handleNew, handleOpen, handleSave]);

  return (
    <main className="app-shell">
      <nav className="top-bar">
        <button
          className={isAiPanelOpen ? "tool-button active" : "tool-button"}
          type="button"
          onClick={() => setIsAiPanelOpen((open) => !open)}
        >
          AI 助手
        </button>
        <button className="settings-button" type="button" onClick={() => setIsSettingsOpen(true)} aria-label="设置">
          设置
        </button>
      </nav>

      <div className="workspace">
        {isAiPanelOpen ? (
          <AiPanel
            settings={aiSettings}
            onSettingsChange={updateAiSettings}
            onGenerateImage={generateAiImage}
            onGenerateDiagram={generateAiDiagram}
            onInsertImage={insertAiImage}
          />
        ) : null}

        <section className="canvas-host">
          <Excalidraw
            initialData={initialData}
            excalidrawAPI={(api) => {
              excalidrawAPIRef.current = api;
            }}
            onChange={(elements, appState, files) => {
              snapshotRef.current = {
                elements,
                appState: sanitizeAppState(appState),
                files,
              };

              if (hasMountedSceneRef.current) {
                persistDirty(true);
              } else {
                hasMountedSceneRef.current = true;
              }
            }}
            UIOptions={{
              canvasActions: {
                export: {
                  saveFileToDisk: true,
                },
                loadScene: false,
                saveToActiveFile: false,
                toggleTheme: true,
              },
            }}
          >
            <MainMenu>
              <MainMenu.DefaultItems.Export />
              <MainMenu.DefaultItems.SaveAsImage />
              <MainMenu.DefaultItems.ToggleTheme />
              <MainMenu.DefaultItems.ChangeCanvasBackground />
            </MainMenu>
            <WelcomeScreen>
              <WelcomeScreen.Hints.MenuHint />
              <WelcomeScreen.Hints.ToolbarHint />
              <WelcomeScreen.Hints.HelpHint />
            </WelcomeScreen>
          </Excalidraw>
        </section>
      </div>

      {isSettingsOpen ? (
        <SettingsModal
          settings={aiSettings}
          onClose={() => setIsSettingsOpen(false)}
          onSave={updateAiSettings}
          onTestModel={testAiModel}
        />
      ) : null}
    </main>
  );
}
