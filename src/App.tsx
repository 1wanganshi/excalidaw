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
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
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

type HistoryEntry = {
  id: string;
  title: string;
  createdAt: number;
  elementCount: number;
  signature: string;
  scene: StoredScene;
};

const HISTORY_KEY = "excalidaw.sceneHistory.v1";
const MAX_HISTORY_ENTRIES = 50;

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

function createHistoryId() {
  return `history_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getVisibleElementCount(elements: readonly ExcalidrawElement[]) {
  return elements.filter((element) => !element.isDeleted).length;
}

function createSceneSignature(snapshot: SceneSnapshot) {
  return JSON.stringify({
    elements: snapshot.elements,
    files: snapshot.files,
  });
}

function loadHistoryEntries(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);

    if (!raw) {
      return [];
    }

    const entries = JSON.parse(raw) as Partial<HistoryEntry>[];

    if (!Array.isArray(entries)) {
      return [];
    }

    return entries
      .filter((entry): entry is HistoryEntry => Boolean(entry.id && entry.scene?.elements))
      .slice(0, MAX_HISTORY_ENTRIES);
  } catch {
    return [];
  }
}

function persistHistoryEntries(entries: HistoryEntry[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY_ENTRIES)));
}

function sceneFromHistoryEntry(entry: HistoryEntry): ExcalidrawInitialDataState {
  return {
    elements: entry.scene.elements ?? [],
    appState: {
      viewBackgroundColor: "#ffffff",
      ...(entry.scene.appState ?? {}),
    },
    files: entry.scene.files ?? {},
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

type MutableElementSkeleton = ExcalidrawElementSkeleton & {
  id?: string;
  label?: { text?: unknown };
  start?: { id?: string; text?: unknown; type?: string };
  end?: { id?: string; text?: unknown; type?: string };
  text?: unknown;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  points?: readonly [number, number][];
  startArrowhead?: string | null;
  endArrowhead?: string | null;
};

type ElementBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function stringifyText(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

function getElementBounds(element: MutableElementSkeleton): ElementBounds | null {
  if (
    typeof element.x !== "number" ||
    typeof element.y !== "number" ||
    typeof element.width !== "number" ||
    typeof element.height !== "number"
  ) {
    return null;
  }

  return {
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
  };
}

function getConnectorAnchor(from: ElementBounds, to: ElementBounds) {
  const fromCenter = {
    x: from.x + from.width / 2,
    y: from.y + from.height / 2,
  };
  const toCenter = {
    x: to.x + to.width / 2,
    y: to.y + to.height / 2,
  };
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;

  if (Math.abs(dx) > Math.abs(dy)) {
    return {
      x: dx >= 0 ? from.x + from.width : from.x,
      y: fromCenter.y,
    };
  }

  return {
    x: fromCenter.x,
    y: dy >= 0 ? from.y + from.height : from.y,
  };
}

function normalizeConnectorGeometry(
  element: MutableElementSkeleton,
  elementBoundsById: Map<string, ElementBounds>,
) {
  if ((element.type !== "arrow" && element.type !== "line") || !element.start?.id || !element.end?.id) {
    return element;
  }

  const startBounds = elementBoundsById.get(element.start.id);
  const endBounds = elementBoundsById.get(element.end.id);

  if (!startBounds || !endBounds) {
    return element;
  }

  const start = getConnectorAnchor(startBounds, endBounds);
  const end = getConnectorAnchor(endBounds, startBounds);
  const width = end.x - start.x;
  const height = end.y - start.y;

  return {
    ...element,
    type: "arrow",
    x: start.x,
    y: start.y,
    width,
    height,
    points: [
      [0, 0],
      [width, height],
    ],
    startArrowhead: element.startArrowhead ?? null,
    endArrowhead: element.type === "line" ? element.endArrowhead ?? null : element.endArrowhead ?? "arrow",
  } as MutableElementSkeleton;
}

function normalizeDiagramSkeletons(elements: ExcalidrawElementSkeleton[]) {
  const normalizedElements = elements.map((element) => {
    const next: MutableElementSkeleton = { ...(element as MutableElementSkeleton) };

    if (next.type === "text") {
      next.text = stringifyText(next.text);
    }

    if (next.label && typeof next.label === "object") {
      next.label = {
        ...next.label,
        text: stringifyText(next.label.text),
      };
    }

    (["start", "end"] as const).forEach((endpointKey) => {
      const endpoint = next[endpointKey];

      if (!endpoint || typeof endpoint !== "object") {
        return;
      }

      if (endpoint.type === "text" || "text" in endpoint) {
        next[endpointKey] = {
          ...endpoint,
          text: stringifyText(endpoint.text),
        };
      }
    });

    return next;
  });

  const elementBoundsById = new Map<string, ElementBounds>();

  normalizedElements.forEach((element) => {
    if (!element.id || element.type === "arrow" || element.type === "line") {
      return;
    }

    const bounds = getElementBounds(element);

    if (bounds) {
      elementBoundsById.set(element.id, bounds);
    }
  });

  return normalizedElements.map((element) => normalizeConnectorGeometry(element, elementBoundsById));
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
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [aiSettings, setAiSettings] = useState<AiSettings>(() => loadAiSettings());
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>(() => loadHistoryEntries());

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
    hasMountedSceneRef.current = false;
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

  const saveSnapshotToHistory = useCallback((snapshot: SceneSnapshot, title: string) => {
    const elementCount = getVisibleElementCount(snapshot.elements);

    if (elementCount === 0) {
      return;
    }

    const signature = createSceneSignature(snapshot);
    const entry: HistoryEntry = {
      id: createHistoryId(),
      title,
      createdAt: Date.now(),
      elementCount,
      signature,
      scene: createStoredScene(snapshot),
    };

    setHistoryEntries((current) => {
      if (current[0]?.signature === signature) {
        return current;
      }

      const nextEntries = [entry, ...current].slice(0, MAX_HISTORY_ENTRIES);
      persistHistoryEntries(nextEntries);
      return nextEntries;
    });
  }, []);

  const saveCurrentPageToHistory = useCallback((title = "页面") => {
    saveSnapshotToHistory(snapshotRef.current, title);
  }, [saveSnapshotToHistory]);

  const handleNew = useCallback(() => {
    saveCurrentPageToHistory("新建前页面");
    void window.excalidaw?.setCleanFile(null);
    loadScene(emptyScene);
    setIsHistoryOpen(false);
  }, [loadScene, saveCurrentPageToHistory]);

  const restoreHistory = useCallback((entry: HistoryEntry) => {
    saveCurrentPageToHistory("切换前页面");
    void window.excalidaw?.setCleanFile(null);
    loadScene(sceneFromHistoryEntry(entry));
    setIsHistoryOpen(false);
  }, [loadScene, saveCurrentPageToHistory]);

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
      const shiftedSkeletons = normalizeDiagramSkeletons(result.elements).map((element) => ({
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
        saveSnapshotToHistory(
          {
            elements: [...baseElements, ...elements],
            appState: sanitizeAppState(api.getAppState()),
            files: snapshotRef.current.files,
          },
          result.title || "AI生图表",
        );
        persistDirty(true);
      }
    },
    [persistDirty, saveSnapshotToHistory],
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
    const nextElements = [...api.getSceneElementsIncludingDeleted(), imageElement];
    const nextFiles = {
      ...snapshotRef.current.files,
      [fileId]: file,
    };

    api.updateScene({
      elements: nextElements,
      captureUpdate: "IMMEDIATELY",
    });
    api.scrollToContent([imageElement], { fitToContent: true });
    saveSnapshotToHistory(
      {
        elements: nextElements,
        appState: sanitizeAppState(api.getAppState()),
        files: nextFiles,
      },
      "生成图片",
    );
    persistDirty(true);
  }, [persistDirty, saveSnapshotToHistory]);

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
        <div className="top-bar-left">
          <button
            className={isAiPanelOpen ? "tool-button active" : "tool-button"}
            type="button"
            onClick={() => setIsAiPanelOpen((open) => !open)}
          >
            AI 助手
          </button>
          <button className="tool-button" type="button" onClick={handleNew}>
            新建页面
          </button>
          <button
            className={isHistoryOpen ? "tool-button active" : "tool-button"}
            type="button"
            onClick={() => setIsHistoryOpen((open) => !open)}
          >
            历史生成
          </button>
        </div>
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

      {isHistoryOpen ? (
        <div className="modal-backdrop" onMouseDown={() => setIsHistoryOpen(false)}>
          <section className="history-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>历史生成</h2>
              <button className="icon-button" type="button" onClick={() => setIsHistoryOpen(false)} aria-label="关闭">
                关闭
              </button>
            </div>
            <div className="history-list">
              {historyEntries.length === 0 ? (
                <p className="empty-settings">还没有历史生成内容。</p>
              ) : (
                historyEntries.map((entry) => (
                  <button className="history-item" type="button" key={entry.id} onClick={() => restoreHistory(entry)}>
                    <span className="history-title">{entry.title}</span>
                    <span className="history-meta">
                      {new Date(entry.createdAt).toLocaleString()} · {entry.elementCount} 个元素
                    </span>
                  </button>
                ))
              )}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
