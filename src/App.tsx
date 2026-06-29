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
import type {
  AiImageRequest,
  AiImageResult,
  AiModelConfig,
  AiSettings,
  InsertedAiImage,
  ParagraphRelation,
  PosterDocument,
  PosterModule,
  PosterTheme,
  SemanticMetadata,
} from "./types";
import { renderPoster, renderSingleModule } from "./poster/layout";
import { renderSectionV2, renderTitleV2, renderOverviewV2 } from "./poster/layoutV2";
import { POSTER_PADDING } from "./poster/themes";
import { buildAndRenderLogic } from "./logic/render";
import { buildLogicManuscriptIR } from "./logic/buildIr";
import { buildAiLayoutUserPrompt } from "./logic/buildAiLayoutPrompt";
import { parseAiLayoutPlan, resolveLayoutPlan } from "./logic/resolveLayoutPlan";
import { validateIrCoverage } from "./logic/validate";
import type { LogicExportMode } from "./logic/types";
import {
  collectDocumentText,
  diffSummary,
  repairDocument,
  validatePoster,
  type CharDiff,
} from "./poster/validate";
// 0.2.16 起：取消"严格校验 + 自动补齐"，回到 0.2.11 行为 ——
// 模型给什么就画什么，原文覆盖度只做警告，不再动渲染数据。

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

const POSTER_RETRY_LIMIT = 2;

/**
 * 轻量的 string-vs-string 字符多重集差异：用在 V2 章节聚合后的整体校验。
 * 跟 validate.ts 里的 computeCharMultisetDiff 等价但只返回数量，避免 import 形态错配。
 */
function computeCharDiffSimple(original: string, generated: string): { ok: boolean; missingCount: number; extraCount: number } {
  const norm = (s: string) => s.replace(/[\s　​‌‍﻿]+/g, "");
  const a = norm(original);
  const b = norm(generated);
  const count = (s: string) => {
    const m = new Map<string, number>();
    for (const ch of s) m.set(ch, (m.get(ch) ?? 0) + 1);
    return m;
  };
  const ca = count(a);
  const cb = count(b);
  let miss = 0;
  let extra = 0;
  for (const [ch, n] of ca) miss += Math.max(0, n - (cb.get(ch) ?? 0));
  for (const [ch, n] of cb) extra += Math.max(0, n - (ca.get(ch) ?? 0));
  return { ok: miss === 0 && extra === 0, missingCount: miss, extraCount: extra };
}


function assembleUserMessage(
  original: string,
  intent: string,
  theme: PosterTheme,
  retryDiff: CharDiff | null,
) {
  const sections = [`<theme>${theme}</theme>`, `<content>\n${original}\n</content>`];
  if (intent.trim()) {
    sections.push(`<intent>\n${intent.trim()}\n</intent>`);
  }
  if (retryDiff && !retryDiff.ok) {
    const missing = retryDiff.missing.join("");
    const extra = retryDiff.extra.join("");
    sections.push(
      `<retry missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}>上次输出与原文不一致。请把 missing 字符按原文顺序补回，并删除 extra 字符，然后重新输出。</retry>`,
    );
  }
  return sections.join("\n");
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v === "string") out.push(v);
  }
  return out;
}

function normalizeModules(raw: unknown): PosterModule[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set([
    "title",
    "section",
    "overview",
    "paragraph",
    "highlight",
    "contrast",
    "formula",
    "case",
    "list",
    "summary",
  ]);
  const out: PosterModule[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const kind = (item as { kind?: unknown }).kind;
    if (typeof kind !== "string" || !allowed.has(kind)) continue;
    const sourceRaw = (item as { source?: unknown }).source;
    const source = typeof sourceRaw === "string" ? sourceRaw : "";

    // 提取语义元信息（由两阶段管道产生，可选）
    const semantic = extractSemantic(item);

    switch (kind) {
      case "title": {
        const text = typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "";
        out.push({ kind: "title", text, source: "", semantic });
        break;
      }
      case "section": {
        const text = typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "";
        out.push({ kind: "section", text, source: "", semantic });
        break;
      }
      case "overview": {
        const items = asStringArray((item as { items?: unknown }).items);
        out.push({ kind: "overview", items, source: "", semantic });
        break;
      }
      case "paragraph": {
        const text = typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "";
        out.push({ kind: "paragraph", text, source: source || text, semantic });
        break;
      }
      case "highlight": {
        const text = typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "";
        out.push({ kind: "highlight", text, source: source || text, semantic });
        break;
      }
      case "contrast": {
        const wrong = typeof (item as { wrong?: unknown }).wrong === "string" ? (item as { wrong: string }).wrong : "";
        const right = typeof (item as { right?: unknown }).right === "string" ? (item as { right: string }).right : "";
        out.push({ kind: "contrast", wrong, right, source: source || wrong + right, semantic });
        break;
      }
      case "formula": {
        const items = asStringArray((item as { items?: unknown }).items);
        out.push({ kind: "formula", items, source: source || items.join(""), semantic });
        break;
      }
      case "case": {
        const label = typeof (item as { label?: unknown }).label === "string" ? (item as { label: string }).label : undefined;
        const text = typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "";
        out.push({ kind: "case", label, text, source: source || text, semantic });
        break;
      }
      case "list": {
        const title = typeof (item as { title?: unknown }).title === "string" ? (item as { title: string }).title : undefined;
        const items = asStringArray((item as { items?: unknown }).items);
        out.push({ kind: "list", title, items, source: source || items.join(""), semantic });
        break;
      }
      case "summary": {
        const text = typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "";
        out.push({ kind: "summary", text, source: source || text, semantic });
        break;
      }
    }
  }
  return out;
}

/** 从 LLM 返回的原始模块数据中提取语义元信息 */
function extractSemantic(item: unknown): SemanticMetadata | undefined {
  const raw = (item as { semantic?: unknown }).semantic;
  if (!raw || typeof raw !== "object") return undefined;
  const sem = raw as Record<string, unknown>;
  const importance = sem.importance;
  if (importance !== 1 && importance !== 2 && importance !== 3) return undefined;
  const relationToPrev = sem.relationToPrev;
  const relatedRaw = sem.relatedConcepts;
  const relatedConcepts = Array.isArray(relatedRaw)
    ? relatedRaw.filter((c): c is string => typeof c === "string")
    : undefined;
  const validRelations = new Set(["causes", "contrasts", "elaborates", "exampleOf", "sequential", "none"]);
  return {
    importance: importance as 1 | 2 | 3,
    relationToPrev: typeof relationToPrev === "string" && validRelations.has(relationToPrev)
      ? (relationToPrev as ParagraphRelation)
      : undefined,
    relatedConcepts: relatedConcepts && relatedConcepts.length > 0 ? relatedConcepts : undefined,
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
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  // 四张手稿图：插入到画布后保留每张图的 elementId，用于在白板右下角浮层做 1/2/3/4 跳转。
  const [manuscriptElementIds, setManuscriptElementIds] = useState<string[]>([]);
  const [activeManuscriptIndex, setActiveManuscriptIndex] = useState<number | null>(null);
  // 四张手稿图"流式入画布"模式下，4 张图的槽位（位置/尺寸）在第一张到达时计算并锁定，
  // 后续 2/3/4 张沿用同一份 slot，避免视口变化导致排版错位。
  type ManuscriptSlot = { x: number; y: number; w: number; h: number };
  const manuscriptSlotsRef = useRef<ManuscriptSlot[] | null>(null);
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

  const renderPosterDocument = useCallback(
    async (
      doc: PosterDocument,
      theme: PosterTheme,
      onProgress: (message: string) => void,
    ) => {
      const api = excalidrawAPIRef.current;
      if (!api) {
        throw new Error("画布还没有准备好。");
      }

      const appState = api.getAppState();
      const offsetX = -appState.scrollX + 80;
      const offsetY = -appState.scrollY + 80;
      const layout = renderPoster(doc, theme, { x: offsetX, y: offsetY });
      const skeletons = layout.elements;
      const elements = convertToExcalidrawElements(skeletons, { regenerateIds: true });
      const baseElements = api.getSceneElementsIncludingDeleted();

      onProgress(`准备在画布上一句一句生成 ${elements.length} 个元素...`);

      // Phase-based pacing: within a phase elements appear fast (装饰先出, 文字最后);
      // between phases pause longer so the user feels each sentence "appear".
      const phaseBreaks = layout.phaseBreaks.length > 0 ? layout.phaseBreaks : [elements.length];
      const breakSet = new Set(phaseBreaks);
      const totalPhases = phaseBreaks.length;
      const intraDelay = elements.length > 200 ? 24 : 40;
      const phaseDelay = totalPhases > 30 ? 220 : totalPhases > 16 ? 320 : 460;

      let currentPhase = 0;
      for (let index = 0; index < elements.length; index += 1) {
        const isPhaseBoundary = breakSet.has(index);
        const delay = index === 0 ? 200 : isPhaseBoundary ? phaseDelay : intraDelay;
        await new Promise((resolve) => window.setTimeout(resolve, delay));
        api.updateScene({
          elements: [...baseElements, ...elements.slice(0, index + 1)],
          captureUpdate: "IMMEDIATELY",
        });
        if (isPhaseBoundary) {
          currentPhase += 1;
          onProgress(`已展开 ${currentPhase}/${totalPhases} 段`);
        }
      }

      if (elements.length > 0) {
        api.scrollToContent(elements, { fitToContent: true });
        saveSnapshotToHistory(
          {
            elements: [...baseElements, ...elements],
            appState: sanitizeAppState(api.getAppState()),
            files: snapshotRef.current.files,
          },
          doc.title || "白板讲解长图",
        );
        persistDirty(true);
      }
    },
    [persistDirty, saveSnapshotToHistory],
  );

  // 旧的非流式实现，作为桥接缺失时的兜底
  const runDiagramFallback = useCallback(
    async (
      request: {
        model: AiModelConfig;
        original: string;
        intent: string;
        theme: PosterTheme;
      },
      onProgress: (message: string) => void,
      onNeedRepair: (doc: PosterDocument, diff: CharDiff) => void,
    ) => {
      const original = request.original;
      let attempt = 0;
      let lastDiff: CharDiff | null = null;
      let lastDoc: PosterDocument | null = null;
      while (attempt <= POSTER_RETRY_LIMIT) {
        onProgress(attempt === 0 ? "发送原文与切块系统提示词到语言模型..." : `第 ${attempt} 次重试...`);
        const userMessage = assembleUserMessage(original, request.intent, request.theme, lastDiff);
        const result = await window.excalidaw?.generateAiDiagram({
          model: request.model,
          prompt: userMessage,
          diagramKind: request.theme,
        });
        if (!result) throw new Error("没有收到语言模型返回。");
        const modules = normalizeModules((result as { modules?: unknown }).modules);
        const doc: PosterDocument = { title: typeof result.title === "string" ? result.title : "", modules };
        const diff = validatePoster(doc, original);
        if (diff.ok) {
          await renderPosterDocument(doc, request.theme, onProgress);
          return;
        }
        lastDiff = diff;
        lastDoc = doc;
        attempt += 1;
      }
      if (lastDoc && lastDiff) onNeedRepair(lastDoc, lastDiff);
    },
    [renderPosterDocument],
  );

  const generateAiDiagram = useCallback(
    async (
      request: {
        model: AiModelConfig;
        original: string;
        intent: string;
        theme: PosterTheme;
      },
      onProgress: (message: string) => void,
      onNeedRepair: (doc: PosterDocument, diff: CharDiff) => void,
    ) => {
      const api = excalidrawAPIRef.current;
      if (!api) {
        throw new Error("画布还没有准备好。");
      }

      const original = request.original;
      if (!original.trim()) {
        throw new Error("请填写内容原文。");
      }

      const v2Supported = typeof window.excalidaw?.generateAiDiagramStreamV2 === "function";
      const v1Supported = typeof window.excalidaw?.generateAiDiagramStream === "function";

      if (!v2Supported && !v1Supported) {
        return runDiagramFallback(request, onProgress, onNeedRepair);
      }

      onProgress("开始流式生成（V2 章节 + pattern）...");

      const startedAt = Date.now();
      const appState = api.getAppState();
      const offsetX = -appState.scrollX + 80;
      const offsetY = -appState.scrollY + 80;
      const origin = { x: offsetX, y: offsetY };
      let yCursor = origin.y + POSTER_PADDING;

      const baseElements = api.getSceneElementsIncludingDeleted();
      const sessionElements: ExcalidrawElement[] = [];
      const collectedSections: unknown[] = [];
      let docTitle = "";
      let titleRendered = false;
      let overviewRendered = false;
      let totalEmitted = 0;
      const streamId = `diagramv2_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

      const flush = (skels: Parameters<typeof convertToExcalidrawElements>[0]) => {
        if (!skels || skels.length === 0) return;
        const newOnes = convertToExcalidrawElements(skels, { regenerateIds: true });
        sessionElements.push(...newOnes);
        api.updateScene({
          elements: [...baseElements, ...sessionElements],
          captureUpdate: "IMMEDIATELY",
        });
        api.scrollToContent(newOnes, { fitToContent: false });
      };

      const renderTitleIfNeeded = (title: string) => {
        if (titleRendered || !title) return;
        titleRendered = true;
        docTitle = title;
        const r = renderTitleV2(title, request.theme, origin, yCursor);
        flush(r.elements);
        yCursor = r.nextY;
      };

      const renderOverviewItems = (items: string[]) => {
        if (overviewRendered || items.length === 0) return;
        overviewRendered = true;
        const r = renderOverviewV2(items, request.theme, origin, yCursor);
        flush(r.elements);
        yCursor = r.nextY;
      };

      const drainSection = (raw: unknown) => {
        if (!raw || typeof raw !== "object") return;
        const section = raw as {
          no?: number;
          label?: string;
          body?: unknown[];
          source?: string;
        };
        if (!Array.isArray(section.body)) return;
        // Sanitize patterns: drop ones with unknown pattern names
        const knownPatterns = new Set([
          "free_paragraph",
          "central_negation",
          "triplet_circles",
          "contrast_card",
          "formula_chain",
          "triplet_list",
          "scene_with_quotes",
          "case_box",
          "highlight",
          "summary",
        ]);
        const cleanBody = section.body.filter(
          (p): p is { pattern: string } =>
            typeof p === "object" &&
            p !== null &&
            typeof (p as { pattern?: unknown }).pattern === "string" &&
            knownPatterns.has((p as { pattern: string }).pattern),
        );
        if (cleanBody.length === 0) return;
        const cleanSection = {
          no: section.no,
          label: section.label,
          body: cleanBody as never,
          source: typeof section.source === "string" ? section.source : "",
        };
        collectedSections.push(cleanSection);
        totalEmitted += 1;
        // 0.2.11 行为：每收到一章就立刻画
        const r = renderSectionV2(cleanSection as never, request.theme, origin, yCursor);
        flush(r.elements);
        yCursor = r.nextY;
        onProgress(
          `已生成第 ${totalEmitted} 章「${section.label ?? ""}」（${Math.round(
            (Date.now() - startedAt) / 1000,
          )}s）`,
        );
      };

      let streamError: string | null = null;

      if (v2Supported) {
        let firstSignalSeen = false;
        const unsubscribe = window.excalidaw!.onDiagramStreamV2Event((event) => {
          if (event.streamId !== streamId) return;
          firstSignalSeen = true;
          if (event.kind === "title") {
            renderTitleIfNeeded(event.title);
          } else if (event.kind === "overview") {
            // 先确保 title 出现（title 可能比 overview 晚到，但我们以先到的为准）
            renderOverviewItems(event.items);
          } else if (event.kind === "section") {
            drainSection(event.section);
          } else if (event.kind === "error") {
            streamError = event.message;
          }
        });

        // 心跳：让 UI 显示"还在等模型首字节"，避免空白时用户以为卡死。
        const heartbeatId = window.setInterval(() => {
          const seconds = Math.round((Date.now() - startedAt) / 1000);
          if (!firstSignalSeen) {
            onProgress(`等待模型首字节（已等 ${seconds}s，最长 75s）...`);
          }
        }, 3000);

        try {
          const userMessage = assembleUserMessage(original, request.intent, request.theme, null);
          const result = await window.excalidaw!.generateAiDiagramStreamV2(
            {
              model: request.model,
              prompt: userMessage,
              diagramKind: request.theme,
            },
            streamId,
          );
          if (!result.ok) {
            throw new Error(result.message || streamError || "流式生成失败");
          }
          if (streamError) {
            throw new Error(streamError);
          }
        } finally {
          window.clearInterval(heartbeatId);
          unsubscribe();
        }

        if (collectedSections.length === 0) {
          throw new Error("流式生成结束，但模型没有给出任何章节。");
        }

        // 贫瘠检查：模型偷懒只用 free_paragraph 时给出提示。不阻塞画布展示。
        let totalPatterns = 0;
        let freeParaCount = 0;
        for (const s of collectedSections) {
          const body = (s as { body?: Array<{ pattern?: string }> }).body ?? [];
          for (const p of body) {
            totalPatterns += 1;
            if (p?.pattern === "free_paragraph") freeParaCount += 1;
          }
        }
        const freeRatio = totalPatterns > 0 ? freeParaCount / totalPatterns : 0;
        if (totalPatterns >= 4 && freeRatio > 0.7) {
          onProgress(
            `⚠ 这次生成偏单调：${freeParaCount}/${totalPatterns} 个段落都是普通段（${Math.round(
              freeRatio * 100,
            )}%）。`,
          );
        }

        // 字符覆盖度仅作警告 —— 不再动渲染结果。
        // 模型漏字时，让用户自己看见缺失，而不是自动补回（自动补回会污染画面）。
        const genText = collectedSections
          .map((s) => {
            const body = (s as { body?: Array<{ pattern?: string; text?: string; wrong?: string; right?: string; items?: string[]; scene?: string; quotes?: string[]; punch?: string; quote?: string; body?: string; center?: string; options?: string[] }> }).body ?? [];
            return body
              .map((p) => {
                const parts: string[] = [];
                const pushS = (v: unknown) => { if (typeof v === "string") parts.push(v); };
                const pushA = (v: unknown) => { if (Array.isArray(v)) for (const it of v) pushS(it); };
                pushS(p.text);
                pushS(p.wrong);
                pushS(p.right);
                pushS(p.scene);
                pushA(p.quotes);
                pushS(p.punch);
                pushS(p.quote);
                pushS(p.body);
                pushS(p.center);
                pushA(p.items);
                pushA(p.options);
                return parts.join("");
              })
              .join("");
          })
          .join("");
        const ws = /[\s　​‌‍﻿]+/g;
        const genLen = genText.replace(ws, "").length;
        const origLen = original.replace(ws, "").length;
        const coverage = origLen > 0 ? Math.round((genLen / origLen) * 100) : 100;

        onProgress(
          `生成完成 — ${totalEmitted} 章 / ${Math.round((Date.now() - startedAt) / 1000)}s / 原文覆盖 ${coverage}%（${genLen}/${origLen} 字）。`,
        );
        if (genLen < origLen) {
          onProgress(
            `⚠ 模型实际覆盖原文 ${coverage}%，少了 ${origLen - genLen} 字。如果对原文完整度有要求，可重新生成或换更聪明的模型。`,
          );
        }

        saveSnapshotToHistory(
          {
            elements: [...baseElements, ...sessionElements],
            appState: sanitizeAppState(api.getAppState()),
            files: snapshotRef.current.files,
          },
          docTitle || "白板讲解长图",
        );
        api.scrollToContent(sessionElements, { fitToContent: true });
        persistDirty(true);
        return;
      }

      // —— v2 不可用，回退到 v1 流式 ——
      const collectedModules: PosterModule[] = [];
      const unsubscribe = window.excalidaw!.onDiagramStreamEvent((event) => {
        if (event.streamId !== streamId) return;
        if (event.kind === "title") {
          docTitle = event.title;
        } else if (event.kind === "module") {
          const normalized = normalizeModules([event.module]);
          if (normalized.length === 0) return;
          const m = normalized[0];
          const { elements: skel, nextY } = renderSingleModule(m, request.theme, origin, yCursor);
          if (skel.length === 0) return;
          flush(skel as never);
          collectedModules.push(m);
          yCursor = nextY;
          totalEmitted += 1;
          onProgress(`已生成 ${totalEmitted} 个模块（${Math.round((Date.now() - startedAt) / 1000)}s）`);
        } else if (event.kind === "error") {
          streamError = event.message;
        }
      });

      try {
        const userMessage = assembleUserMessage(original, request.intent, request.theme, null);
        const result = await window.excalidaw!.generateAiDiagramStream(
          {
            model: request.model,
            prompt: userMessage,
            diagramKind: request.theme,
          },
          streamId,
        );
        if (!result.ok) {
          throw new Error(result.message || streamError || "流式生成失败");
        }
        if (streamError) {
          throw new Error(streamError);
        }
      } finally {
        unsubscribe();
      }

      const doc: PosterDocument = { title: docTitle, modules: collectedModules };
      const diff = validatePoster(doc, original);
      if (!diff.ok) {
        onProgress(`流式生成完成，原文校验失败：${diffSummary(diff)}`);
        onNeedRepair(doc, diff);
        return;
      }
      onProgress(`流式生成完成，共 ${collectedModules.length} 个模块 / ${Math.round((Date.now() - startedAt) / 1000)}s。`);
      saveSnapshotToHistory(
        {
          elements: [...baseElements, ...sessionElements],
          appState: sanitizeAppState(api.getAppState()),
          files: snapshotRef.current.files,
        },
        docTitle || "白板讲解长图",
      );
      api.scrollToContent(sessionElements, { fitToContent: true });
      persistDirty(true);
    },
    [persistDirty, runDiagramFallback, saveSnapshotToHistory],
  );

  const generateLogicManuscript = useCallback(
    async (
      request: {
        original: string;
        theme: PosterTheme;
        export: LogicExportMode;
        model?: AiModelConfig;
        useAiLayout?: boolean;
        intent?: string;
      },
      onProgress: (message: string) => void,
    ) => {
      const api = excalidrawAPIRef.current;
      if (!api) {
        throw new Error("画布还没有准备好。");
      }

      const original = request.original.trim();
      if (!original) {
        throw new Error("请填写内容原文。");
      }

      const appState = api.getAppState();
      const offsetX = -appState.scrollX + 80;
      const offsetY = -appState.scrollY + 80;

      onProgress("正在本地切句并识别逻辑结构...");
      const ir = buildLogicManuscriptIR(original, request.export);

      const check = validateIrCoverage(ir);
      if (!check.ok) {
        throw new Error(check.message);
      }
      onProgress(check.message);

      let posterDoc = undefined;
      const canUseAi =
        request.useAiLayout &&
        request.export === "lecture" &&
        request.model &&
        typeof window.excalidaw?.generateLogicLayout === "function";

      if (canUseAi) {
        try {
          onProgress("AI 正在分析章节结构与 pattern 布局（不改写原文）...");
          const userPrompt = buildAiLayoutUserPrompt(ir, request.intent);
          const raw = await window.excalidaw!.generateLogicLayout({
            model: request.model!,
            prompt: userPrompt,
            diagramKind: "logic-layout",
          });
          const plan = parseAiLayoutPlan(raw);
          if (!plan) {
            onProgress("AI 返回格式无效，回退本地布局。");
          } else {
            const resolved = resolveLayoutPlan(ir, plan);
            posterDoc = resolved.doc;
            onProgress(resolved.message);
          }
        } catch (err) {
          onProgress(`AI 布局失败：${(err as Error).message} 已回退本地布局。`);
        }
      } else if (request.useAiLayout && request.export === "lecture") {
        onProgress("未配置语言模型，使用本地规则布局。");
      }

      const { layout } = buildAndRenderLogic(original, request.export, request.theme, {
        x: offsetX,
        y: offsetY,
      }, posterDoc);

      onProgress(
        `已切分 ${ir.sentences.length} 句，${ir.edges.length} 条逻辑边；${posterDoc ? "AI+本地" : "本地"} V2 渲染。`,
      );

      const elements = convertToExcalidrawElements(layout.elements, { regenerateIds: true });
      const baseElements = api.getSceneElementsIncludingDeleted();
      onProgress(`正在绘制 ${elements.length} 个元素...`);

      const phaseBreaks = layout.phaseBreaks.length > 0 ? layout.phaseBreaks : [elements.length];
      const breakSet = new Set(phaseBreaks);
      const intraDelay = elements.length > 200 ? 20 : 32;
      const phaseDelay = 260;

      for (let index = 0; index < elements.length; index += 1) {
        const isPhaseBoundary = breakSet.has(index);
        const delay = index === 0 ? 120 : isPhaseBoundary ? phaseDelay : intraDelay;
        await new Promise((resolve) => window.setTimeout(resolve, delay));
        api.updateScene({
          elements: [...baseElements, ...elements.slice(0, index + 1)],
          captureUpdate: "IMMEDIATELY",
        });
      }

      if (elements.length > 0) {
        api.scrollToContent(elements, { fitToContent: true });
        const titleSlice = ir.title ? ir.normalized.slice(ir.title.start, ir.title.end) : "";
        saveSnapshotToHistory(
          {
            elements: [...baseElements, ...elements],
            appState: sanitizeAppState(api.getAppState()),
            files: snapshotRef.current.files,
          },
          titleSlice || (request.export === "lecture" ? "讲义长图" : "逻辑导图"),
        );
        persistDirty(true);
      }

      onProgress(
        `手稿绘图完成 — ${request.export === "lecture" ? "讲义长图" : "逻辑导图"}，${elements.length} 个元素。`,
      );
    },
    [persistDirty, saveSnapshotToHistory],
  );

  const acceptPosterRepair = useCallback(
    async (
      doc: PosterDocument,
      theme: PosterTheme,
      original: string,
      onProgress: (message: string) => void,
    ) => {
      const repaired = repairDocument(doc, original);
      const recheck = validatePoster(repaired, original);
      if (!recheck.ok) {
        onProgress(`本地修复后仍有差异：${diffSummary(recheck)}（已尽力补救）`);
      } else {
        onProgress("已按原文强制修复，开始渲染...");
      }
      void collectDocumentText;
      await renderPosterDocument(repaired, theme, onProgress);
    },
    [renderPosterDocument],
  );

  const insertAiImage = useCallback(async (result: AiImageResult): Promise<InsertedAiImage | null> => {
    const api = excalidrawAPIRef.current;

    if (!api) {
      return null;
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

    return {
      elementId: imageElement.id,
      fileId,
      x,
      y,
      width: canvasSize.width,
      height: canvasSize.height,
    };
  }, [persistDirty, saveSnapshotToHistory]);

  // 四张手稿图模式：把 4 张 9:16 图片横向插入画布。
  // 关键：用与单图 insertAiImage 一致的逐张提交路径（每张都 addFiles + updateScene + 等一帧），
  // 因为之前发现批量 addFiles 后立刻 updateScene 会出现 fileId 还没注册完就渲染、显示破图占位的问题。
  // 尺寸按"当前可视区的 90%"动态计算 —— 4 张 9:16 横向排开 + 间隙，整体限制在视口 90% 内并居中。
  const insertAiImages = useCallback(async (results: AiImageResult[]): Promise<InsertedAiImage[]> => {
    const api = excalidrawAPIRef.current;

    if (!api || results.length === 0) {
      return [];
    }

    const initialAppState = api.getAppState();
    const zoom = initialAppState.zoom?.value ?? 1;
    // 视口大小 → 场景坐标
    const viewW = initialAppState.width / zoom;
    const viewH = initialAppState.height / zoom;

    // 总占用宽 / 高都不超过视口 96%。每张图保持 9:16。
    const GAP = Math.max(8, viewW * 0.01);
    const targetW = viewW * 0.96;
    const targetH = viewH * 0.96;

    // 先按"高度撑满 96%"算单图宽（9:16 → w = h * 9/16），若 4 张总宽超出 96% 再按宽度反推。
    let imgH = targetH;
    let imgW = (imgH * 9) / 16;
    const totalW = imgW * 4 + GAP * 3;
    if (totalW > targetW) {
      imgW = (targetW - GAP * 3) / 4;
      imgH = (imgW * 16) / 9;
    }

    const groupWidth = imgW * 4 + GAP * 3;
    // 居中放在当前视口里（按初始 scroll 计算，逐张插入时不再使用滚动后的 appState 避免漂移）
    const startX = -initialAppState.scrollX + (viewW - groupWidth) / 2;
    const startY = -initialAppState.scrollY + (viewH - imgH) / 2;

    const insertedMeta: InsertedAiImage[] = [];
    const insertedElementIds: string[] = [];

    for (let i = 0; i < results.length; i += 1) {
      const result = results[i];
      const fileId = `ai_${Date.now().toString(36)}_${i}` as FileId;
      const now = Date.now();
      const file: BinaryFileData = {
        id: fileId,
        mimeType: result.mimeType as BinaryFileData["mimeType"],
        dataURL: result.dataUrl as BinaryFileData["dataURL"],
        created: now,
        lastRetrieved: now,
      };

      api.addFiles([file]);

      const x = startX + i * (imgW + GAP);
      const y = startY;

      const [imageElement] = convertToExcalidrawElements(
        [
          {
            type: "image",
            x,
            y,
            width: imgW,
            height: imgH,
            fileId,
            status: "saved",
          },
        ],
        { regenerateIds: true },
      );

      const nextElements = [...api.getSceneElementsIncludingDeleted(), imageElement];
      api.updateScene({
        elements: nextElements,
        captureUpdate: "IMMEDIATELY",
      });

      // 关键：让 Excalidraw 内部把 file 数据真正挂到 image element 上，避免破图占位
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      insertedMeta.push({
        elementId: imageElement.id,
        fileId,
        x,
        y,
        width: imgW,
        height: imgH,
      });
      insertedElementIds.push(imageElement.id);
    }

    // 4 张全部就位后，统一存历史 + 滚动到整组中央
    const allInserted = api.getSceneElementsIncludingDeleted();
    const newImageElements = allInserted.filter((el) => insertedElementIds.includes(el.id));
    api.scrollToContent(newImageElements, { fitToContent: true });

    saveSnapshotToHistory(
      {
        elements: allInserted,
        appState: sanitizeAppState(api.getAppState()),
        files: snapshotRef.current.files,
      },
      "生成四张手稿图",
    );
    persistDirty(true);

    // 同步白板右下角的跳转浮层
    setManuscriptElementIds(insertedElementIds);
    setActiveManuscriptIndex(0);

    return insertedMeta;
  }, [persistDirty, saveSnapshotToHistory]);

  // 流式入画布：第 index 张图就绪时立刻插入，不必等 4 张全齐。
  // 第一次调用（index===0 或 ref 为空）时按当前视口算好全部 total 张的槽位并锁定，
  // 后续 2/3/4… 复用同一份 slot 不再重算，避免视口变化导致错位。
  const insertManuscriptAt = useCallback(async (
    index: number,
    total: number,
    result: AiImageResult,
  ): Promise<InsertedAiImage | null> => {
    const api = excalidrawAPIRef.current;
    if (!api) return null;

    // 计算/复用槽位
    let slots = manuscriptSlotsRef.current;
    if (!slots || slots.length !== total || index === 0) {
      const appState = api.getAppState();
      const zoom = appState.zoom?.value ?? 1;
      const viewW = appState.width / zoom;
      const viewH = appState.height / zoom;

      const GAP = Math.max(8, viewW * 0.01);
      const targetW = viewW * 0.96;
      const targetH = viewH * 0.96;

      let imgH = targetH;
      let imgW = (imgH * 9) / 16;
      const totalW = imgW * total + GAP * (total - 1);
      if (totalW > targetW) {
        imgW = (targetW - GAP * (total - 1)) / total;
        imgH = (imgW * 16) / 9;
      }

      const groupWidth = imgW * total + GAP * (total - 1);
      const startX = -appState.scrollX + (viewW - groupWidth) / 2;
      const startY = -appState.scrollY + (viewH - imgH) / 2;

      slots = Array.from({ length: total }, (_, i) => ({
        x: startX + i * (imgW + GAP),
        y: startY,
        w: imgW,
        h: imgH,
      }));
      manuscriptSlotsRef.current = slots;
    }

    const slot = slots[index];
    if (!slot) return null;

    const fileId = `ai_${Date.now().toString(36)}_${index}` as FileId;
    const now = Date.now();
    const file: BinaryFileData = {
      id: fileId,
      mimeType: result.mimeType as BinaryFileData["mimeType"],
      dataURL: result.dataUrl as BinaryFileData["dataURL"],
      created: now,
      lastRetrieved: now,
    };
    api.addFiles([file]);

    const [imageElement] = convertToExcalidrawElements(
      [
        {
          type: "image",
          x: slot.x,
          y: slot.y,
          width: slot.w,
          height: slot.h,
          fileId,
          status: "saved",
        },
      ],
      { regenerateIds: true },
    );

    const nextElements = [...api.getSceneElementsIncludingDeleted(), imageElement];
    api.updateScene({ elements: nextElements, captureUpdate: "IMMEDIATELY" });

    // 让 Excalidraw 真正把 file 挂到 element 上，避免破图占位
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    // 第一张：把视图定位到该图中心并设为 158% 缩放（实测最佳阅读比例），登记到右下角浮层
    if (index === 0) {
      const TARGET_ZOOM = 1.58;
      const st = api.getAppState();
      // Excalidraw 的 scroll 是"画布到视口左上角的偏移"，按 zoom 后再换算
      const cx = slot.x + slot.w / 2;
      const cy = slot.y + slot.h / 2;
      api.updateScene({
        appState: {
          zoom: { value: TARGET_ZOOM as AppState["zoom"]["value"] },
          scrollX: st.width / (2 * TARGET_ZOOM) - cx,
          scrollY: st.height / (2 * TARGET_ZOOM) - cy,
        },
        captureUpdate: "IMMEDIATELY",
      });
      setManuscriptElementIds([imageElement.id]);
      setActiveManuscriptIndex(0);
    } else {
      setManuscriptElementIds((prev) => {
        const next = [...prev];
        next[index] = imageElement.id;
        return next;
      });
    }

    // 最后一张：保存历史快照
    if (index === total - 1) {
      saveSnapshotToHistory(
        {
          elements: api.getSceneElementsIncludingDeleted(),
          appState: sanitizeAppState(api.getAppState()),
          files: snapshotRef.current.files,
        },
        "生成四张手稿图",
      );
      // 用完释放，下次一组新的从头算
      manuscriptSlotsRef.current = null;
    }
    persistDirty(true);

    return {
      elementId: imageElement.id,
      fileId,
      x: slot.x,
      y: slot.y,
      width: slot.w,
      height: slot.h,
    };
  }, [persistDirty, saveSnapshotToHistory]);

  // 用一张新生成的图替换画布上已有的 image element（保留位置/尺寸/id），用于"单张重生"。
  // 做法：注册新 file → 把目标 element 的 fileId 指向新 file → updateScene。
  const replaceAiImage = useCallback(async (elementId: string, result: AiImageResult): Promise<boolean> => {
    const api = excalidrawAPIRef.current;
    if (!api) return false;

    const existing = api
      .getSceneElementsIncludingDeleted()
      .find((el) => el.id === elementId && !el.isDeleted);

    if (!existing || existing.type !== "image") {
      return false;
    }

    const newFileId = `ai_${Date.now().toString(36)}_r` as FileId;
    const now = Date.now();
    const file: BinaryFileData = {
      id: newFileId,
      mimeType: result.mimeType as BinaryFileData["mimeType"],
      dataURL: result.dataUrl as BinaryFileData["dataURL"],
      created: now,
      lastRetrieved: now,
    };

    api.addFiles([file]);

    const nextElements = api.getSceneElementsIncludingDeleted().map((el) =>
      el.id === elementId && el.type === "image"
        ? { ...el, fileId: newFileId, version: el.version + 1, versionNonce: Math.floor(Math.random() * 0x7fffffff) }
        : el,
    );

    api.updateScene({
      elements: nextElements,
      captureUpdate: "IMMEDIATELY",
    });

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    saveSnapshotToHistory(
      {
        elements: api.getSceneElementsIncludingDeleted(),
        appState: sanitizeAppState(api.getAppState()),
        files: snapshotRef.current.files,
      },
      "重生手稿图",
    );
    persistDirty(true);
    return true;
  }, [persistDirty, saveSnapshotToHistory]);

  // 把指定 id 的元素居中显示在画布中央（视角移动，不动元素）。
  const focusAiImage = useCallback((elementId: string) => {
    const api = excalidrawAPIRef.current;
    if (!api) return;

    const target = api
      .getSceneElementsIncludingDeleted()
      .find((element) => element.id === elementId && !element.isDeleted);

    if (!target) return;

    api.scrollToContent([target], { fitToContent: true });
  }, []);

  // 手稿图专用聚焦：保持 158% 缩放比例（实测最佳阅读尺寸），把目标图居中。
  const focusManuscriptImage = useCallback((elementId: string) => {
    const api = excalidrawAPIRef.current;
    if (!api) return;
    const target = api
      .getSceneElementsIncludingDeleted()
      .find((el) => el.id === elementId && !el.isDeleted);
    if (!target) return;

    const TARGET_ZOOM = 1.58;
    const st = api.getAppState();
    const cx = target.x + target.width / 2;
    const cy = target.y + target.height / 2;
    api.updateScene({
      appState: {
        zoom: { value: TARGET_ZOOM as AppState["zoom"]["value"] },
        scrollX: st.width / (2 * TARGET_ZOOM) - cx,
        scrollY: st.height / (2 * TARGET_ZOOM) - cy,
      },
      captureUpdate: "IMMEDIATELY",
    });
  }, []);

  // 白板右下角浮层：1/2/3/4 跳转到对应手稿图（保持 158% 缩放）
  const jumpToManuscript = useCallback((index: number) => {
    const id = manuscriptElementIds[index];
    if (!id) return;
    setActiveManuscriptIndex(index);
    focusManuscriptImage(id);
  }, [manuscriptElementIds, focusManuscriptImage]);

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
            onGenerateLogic={generateLogicManuscript}
            onInsertImage={insertAiImage}
            onInsertImages={insertAiImages}
            onInsertManuscriptAt={insertManuscriptAt}
            onReplaceImage={replaceAiImage}
            onFocusImage={focusAiImage}
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
          {manuscriptElementIds.length > 0 ? (
            <div className="manuscript-jump-fab" role="group" aria-label="四张手稿图跳转">
              {manuscriptElementIds.map((id, index) => (
                <button
                  key={id}
                  type="button"
                  className={activeManuscriptIndex === index ? "active" : ""}
                  onClick={() => jumpToManuscript(index)}
                  aria-label={`跳转到第 ${index + 1} 张手稿图`}
                >
                  {index + 1}
                </button>
              ))}
            </div>
          ) : null}
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
