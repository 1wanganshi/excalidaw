import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

let mainWindow: BrowserWindow | null = null;
let currentFilePath: string | null = null;
let isDirty = false;

const fileFilters = [
  { name: "Excalidraw", extensions: ["excalidraw", "json"] },
  { name: "All Files", extensions: ["*"] },
];

type AiModelConfig = {
  kind?: "image" | "language";
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  imageEndpoint: string;
  chatEndpoint: string;
  testEndpoint: string;
};

type AiImageRequest = {
  model: AiModelConfig;
  prompt: string;
  aspectRatio: "1:1" | "9:16" | "16:9" | "3:4" | "4:3" | "2:3" | "3:2";
  resolution: "1k" | "2k" | "4k";
};

type AiDiagramRequest = {
  model: AiModelConfig;
  prompt: string;
  diagramKind: string;
};

function joinApiUrl(baseUrl: string, endpoint: string) {
  const base = baseUrl.replace(/\/+$/, "");
  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return `${base}${path}`;
}

function getAuthHeaders(apiKey: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

function getImageSize(
  modelName: string,
  aspectRatio: AiImageRequest["aspectRatio"],
  resolution: AiImageRequest["resolution"],
) {
  const [widthRatio, heightRatio] = aspectRatio.split(":").map(Number);
  const normalizedModel = modelName.toLowerCase();

  void resolution;

  if (normalizedModel.includes("dall-e-2")) {
    return "1024x1024";
  }

  if (widthRatio === heightRatio) {
    return "1024x1024";
  }

  if (normalizedModel.includes("dall-e-3")) {
    return widthRatio > heightRatio ? "1792x1024" : "1024x1792";
  }

  return widthRatio > heightRatio ? "1536x1024" : "1024x1536";
}

function getImageQuality(modelName: string, resolution: AiImageRequest["resolution"]) {
  const normalizedModel = modelName.toLowerCase();

  if (normalizedModel.includes("dall-e-2")) {
    return null;
  }

  if (normalizedModel.includes("dall-e-3")) {
    return "standard";
  }

  if (resolution === "4k") {
    return "medium";
  }

  if (resolution === "2k") {
    return "medium";
  }

  return "low";
}

function buildImageRequestBody(
  modelName: string,
  prompt: string,
  size: string,
  resolution: AiImageRequest["resolution"],
  options: { includeQuality?: boolean } = {},
) {
  const normalizedModel = modelName.toLowerCase();
  const quality = getImageQuality(modelName, resolution);
  const includeQuality = options.includeQuality ?? true;
  const body: Record<string, unknown> = {
    model: modelName,
    prompt,
    n: 1,
    size,
  };

  if (includeQuality && quality) {
    body.quality = quality;
  }

  if (normalizedModel.includes("dall-e")) {
    body.response_format = "b64_json";
  }

  return body;
}

function shouldRetryImageGeneration(status: number) {
  return [400, 408, 422, 429, 500, 502, 503, 504].includes(status);
}

function getFallbackImageResolution(resolution: AiImageRequest["resolution"]): AiImageRequest["resolution"] {
  return resolution === "4k" ? "2k" : "1k";
}

type ImageGenerationAttempt = {
  label: string;
  size: string;
  resolution: AiImageRequest["resolution"];
  includeQuality: boolean;
};

function buildImageGenerationAttempts(
  size: string,
  resolution: AiImageRequest["resolution"],
): ImageGenerationAttempt[] {
  const fallbackResolution = getFallbackImageResolution(resolution);
  const attempts: ImageGenerationAttempt[] = [
    {
      label: `${size} + ${resolution.toUpperCase()}`,
      size,
      resolution,
      includeQuality: true,
    },
    {
      label: `${size} + no quality`,
      size,
      resolution: fallbackResolution,
      includeQuality: false,
    },
  ];

  if (size !== "1024x1024") {
    attempts.push({
      label: `1024x1024 + no quality`,
      size: "1024x1024",
      resolution: "1k",
      includeQuality: false,
    });
  }

  return attempts;
}

function buildImagePrompt(prompt: string, aspectRatio: AiImageRequest["aspectRatio"], resolution: AiImageRequest["resolution"]) {
  return [
    prompt.trim(),
    "",
    "Image generation requirements:",
    `- Aspect ratio: ${aspectRatio}.`,
    `- Target clarity: ${resolution.toUpperCase()}.`,
    "- Create a visually pleasing, polished image with strong design sense.",
    "- Use controlled color, clear contrast, and a strong focal point.",
    "- Make the subject easy to understand at a glance; avoid clutter and muddy colors.",
    "- Use harmonious composition, balanced negative space, and professional lighting or visual hierarchy when relevant.",
  ].join("\n");
}

function parseImageResponse(payload: any) {
  const firstImage = payload?.data?.[0] ?? payload?.images?.[0] ?? payload?.image ?? payload;
  const b64 = firstImage?.b64_json ?? firstImage?.base64 ?? firstImage?.image_base64;
  const url = firstImage?.url ?? payload?.url;

  if (typeof b64 === "string" && b64.length > 0) {
    const mimeType = firstImage?.mime_type ?? "image/png";
    return {
      dataUrl: b64.startsWith("data:") ? b64 : `data:${mimeType};base64,${b64}`,
      mimeType,
    };
  }

  if (typeof url === "string" && url.length > 0) {
    return {
      dataUrl: url,
      mimeType: "image/png",
    };
  }

  throw new Error("模型返回中没有找到图片数据。");
}

function extractTextResponse(payload: any) {
  const content = payload?.choices?.[0]?.message?.content ?? payload?.choices?.[0]?.text ?? payload?.content;

  if (Array.isArray(content)) {
    return content.map((part) => part?.text ?? "").join("");
  }

  if (typeof content === "string") {
    return content;
  }

  throw new Error("语言模型返回中没有找到文本内容。");
}

function extractJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return JSON.parse(fenced[1]);
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("语言模型没有返回 JSON。");
  }

  return JSON.parse(text.slice(start, end + 1));
}

function buildDiagramSystemPrompt(diagramKind: string) {
  return [
    "You are an AI system that generates professional, editable Excalidraw native diagrams.",
    "The user message is the only user requirement. There is no separate prompt template.",
    "Your real job is not to draw boxes. Your job is to translate information into visual language so readers understand complex content quickly.",
    "Before generating, infer the main character of the diagram, the intended reading path, and how layout, color, size, and whitespace can serve comprehension.",
    "Do not merely copy the user's words. Extract entities, actions, relationships, dependencies, branches, loops, roles, and implied structure.",
    "Default to a vertical, top-to-bottom diagram when the user does not clearly ask for another layout. Most business process, architecture, and explanation diagrams should read from top to bottom.",
    "Choose the natural visual skeleton for the content: vertical top-to-bottom flow for common processes, vertical layers for architecture, horizontal flow only for timelines or explicit left-to-right stories, radial layout for concept expansion, side-by-side layout for comparison, swimlanes for multi-role interaction.",
    "Use visual hierarchy. L1 core nodes should be visually stronger and limited to about 1 to 3. L2 nodes are main support steps. L3 items are small notes or secondary branches.",
    "Every diagram must feel simple, spacious, and premium. It should be immediately understandable at first glance, closer to a clean executive briefing slide than a decorative poster.",
    "The main content must be visually dominant. Make the core idea or main path easy to see within 3 seconds, then let secondary content quietly support it.",
    "Use a restrained design-system mindset: one clear title, one primary accent color, muted supporting colors, consistent spacing, consistent node sizes, and no unnecessary ornament.",
    "Prefer clarity over richness. Create one strong visual structure such as a central spine, stepped journey, layered swimlane, compact matrix, or hub-and-spoke map instead of a busy collection of boxes.",
    "Use presentation details sparingly. Add section labels, pale group backgrounds, small note cards, or numbered step markers only when they make the main message clearer.",
    "Use contrast intentionally: key nodes should stand out through size, stroke width, color, or placement; secondary nodes should recede through lighter fills, smaller type, or quieter stroke colors. The viewer should immediately know where to look first.",
    "Use a coherent palette of 2 to 4 semantic colors with restrained fills. Avoid random rainbow colors, muddy low-contrast fills, or a flat single-color diagram unless the user's content explicitly calls for it.",
    "Make the complete canvas visually balanced. Do not let one side become crowded while another side is empty unless that imbalance communicates the story.",
    "Use semantic color, not decoration: deep blue #2C5282 for standard flow, warm orange #DD6B20 for decisions or attention, deep green #276749 for success or positive results, deep red #C53030 for risk or blockers, deep gray #4A5568 for secondary information.",
    "Use subtle fills and clean borders. Prefer white or very light backgrounds such as #F7FAFC, #EBF8FF, #FFF5EB, #F0FFF4 with the semantic stroke colors above. Avoid heavy filled blocks unless they identify the core node.",
    "Only emphasize 1 to 3 important nodes in color when there are many nodes. Keep ordinary nodes white or gray so the key story stands out.",
    "Whitespace matters. Keep at least 56 px canvas margin, 24 to 32 px inside a group, 72 to 96 px between different groups, and extra breathing room around key nodes.",
    "Prevent overlap and folding. No element may cover another element. Do not place text on top of arrows. Do not stack nodes in the same area. Leave enough room for labels and connectors.",
    "Use stable spacing for vertical layouts: a typical node is 220 to 280 px wide and 72 to 96 px high; vertical gap between connected nodes should usually be 72 to 112 px; sibling nodes should have at least 64 px horizontal gap.",
    "Connections express logic: solid arrows for required causality, dashed arrows for optional or indirect relations, thicker arrows for the key path, curved or returning arrows for retry loops.",
    "Connections must be stable and attached to nodes. Give every important node in this JSON response a unique ASCII id such as node_start, node_auth, node_success. For arrows, always use start and end objects referencing node ids from the same response instead of floating unbound coordinates.",
    "Always place arrow elements after the nodes they reference so conversion can bind them correctly. Never reference an id that has not already appeared as a shape node in elements.",
    "For a vertical flow, connect from the bottom of the upper node to the top of the lower node. For branches, connect from the decision node to left/right lower branch nodes. Keep connectors outside node interiors except at their binding points. Never leave visible gaps between a connector and its source or target node.",
    "Avoid visual clutter. If too many lines would cross, group related content with a subtle dashed rectangle or summarize secondary details inside a note. Prefer routed arrows around nodes over arrows crossing through nodes.",
    "For simple requests, keep the diagram concise. Prefer 4 to 7 nodes for a simple flow.",
    "For very complex requests, extract the main line and keep the main diagram under about 10 meaningful nodes. Put secondary details into grouped notes or small supporting cards.",
    "Special cases: short-video scripts become horizontal scene timelines; element/content lists become relationship maps or card matrices instead of forced flows; login/auth flows should include success and failure branches when useful.",
    "Run a silent self-check before output: can the main message and core path be understood in 3 seconds, is the main content visually dominant, do secondary elements feel supportive instead of competing, is the whitespace relaxed, and does every color carry meaning?",
    "Return JSON only. No markdown. No explanation.",
    "Shape must be: {\"title\":\"...\",\"elements\":[...]}",
    "Each element must be compatible with Excalidraw convertToExcalidrawElements skeletons.",
    "Allowed element types: rectangle, diamond, ellipse, arrow, line, text.",
    "For shape nodes, prefer a shape with id and a label object, for example {\"id\":\"node_start\",\"type\":\"rectangle\",\"x\":64,\"y\":64,\"width\":240,\"height\":80,\"label\":{\"text\":\"节点标题\",\"fontSize\":20},\"strokeColor\":\"#2C5282\",\"backgroundColor\":\"#EBF8FF\",\"roughness\":0.5,\"opacity\":90}.",
    "Use x, y, width, height for shapes. Align x and y to multiples of 16 whenever possible.",
    "Use roughness: 0.35 to 0.6 for a polished hand-drawn feeling, not a messy sketch.",
    "Use strokeWidth 2 for normal nodes and 3 for core nodes. Use fontSize 20 to 24 for core labels, 16 to 18 for normal labels, 13 to 14 for notes. Add a short title text at the top when useful.",
    "For arrows, always use bound arrows such as {\"type\":\"arrow\",\"x\":184,\"y\":144,\"width\":0,\"height\":88,\"start\":{\"id\":\"node_start\"},\"end\":{\"id\":\"node_next\"},\"endArrowhead\":\"arrow\",\"strokeColor\":\"#2C5282\",\"roughness\":0.5}. The renderer will correct geometry from the referenced node ids, so ids are mandatory for node-to-node connectors.",
    "Only use unbound arrows or lines for decorative dividers or annotations that intentionally do not connect two nodes. Otherwise include start.id and end.id.",
    "Output elements in streaming-friendly order: title or group background first, then core nodes, then supporting nodes, then arrows, then notes.",
    "Keep labels concise. Prefer Chinese labels when the user's requirement is Chinese.",
    "Keep the diagram readable: usually 8 to 24 elements, spaced out, with a clear reading path.",
    "Prefer Chinese labels when the user's requirement is Chinese.",
    `Requested diagram kind: ${diagramKind}.`,
  ].join("\n");
}

function updateTitle() {
  if (!mainWindow) {
    return;
  }

  const fileName = currentFilePath ? currentFilePath.split(/[\\/]/).pop() : "Untitled";
  mainWindow.setTitle(`${isDirty ? "*" : ""}${fileName} - Excalidaw`);
}

function sendMenuCommand(command: string, payload?: unknown) {
  mainWindow?.webContents.send("menu-command", { command, payload });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    title: "Excalidaw",
    backgroundColor: "#ffffff",
    icon: join(__dirname, "../assets/icon.ico"),
    webPreferences: {
      preload: join(__dirname, "../electron/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    await mainWindow.loadFile(join(__dirname, "../dist/index.html"));
  }

  mainWindow.on("close", (event) => {
    if (!isDirty) {
      return;
    }

    const choice = dialog.showMessageBoxSync(mainWindow!, {
      type: "warning",
      buttons: ["Cancel", "Discard"],
      defaultId: 0,
      cancelId: 0,
      title: "Unsaved changes",
      message: "This drawing has unsaved changes.",
    });

    if (choice === 0) {
      event.preventDefault();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  updateTitle();
}

function createMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        { label: "New", accelerator: "CmdOrCtrl+N", click: () => sendMenuCommand("new") },
        { label: "Open...", accelerator: "CmdOrCtrl+O", click: () => sendMenuCommand("open") },
        { type: "separator" },
        { label: "Save", accelerator: "CmdOrCtrl+S", click: () => sendMenuCommand("save") },
        { label: "Save As...", accelerator: "CmdOrCtrl+Shift+S", click: () => sendMenuCommand("save-as") },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "togglefullscreen" },
        { type: "separator" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "resetZoom" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Excalidraw Project",
          click: () => shell.openExternal("https://github.com/excalidraw/excalidraw"),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle("scene:open", async () => {
  if (!mainWindow) {
    return null;
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open Excalidraw file",
    filters: fileFilters,
    properties: ["openFile"],
  });

  if (result.canceled || !result.filePaths[0]) {
    return null;
  }

  const filePath = result.filePaths[0];
  const contents = await readFile(filePath, "utf8");
  currentFilePath = filePath;
  isDirty = false;
  updateTitle();

  return { filePath, contents };
});

ipcMain.handle("scene:save", async (_event, sceneJson: string, saveAs: boolean) => {
  if (!mainWindow) {
    return null;
  }

  let filePath = currentFilePath;

  if (saveAs || !filePath) {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Save Excalidraw file",
      defaultPath: currentFilePath ?? "Untitled.excalidraw",
      filters: fileFilters,
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    filePath = result.filePath;
  }

  await writeFile(filePath, sceneJson, "utf8");
  currentFilePath = filePath;
  isDirty = false;
  updateTitle();

  return { filePath };
});

ipcMain.handle("scene:set-dirty", (_event, nextDirty: boolean) => {
  isDirty = nextDirty;
  updateTitle();
});

ipcMain.handle("scene:set-clean-file", (_event, filePath: string | null) => {
  currentFilePath = filePath;
  isDirty = false;
  updateTitle();
});

ipcMain.handle("ai:test-model", async (_event, model: AiModelConfig) => {
  try {
    if (!model.baseUrl || !model.testEndpoint) {
      return { ok: false, message: "请填写 Base URL 和测试接口。" };
    }

    const response = await fetch(joinApiUrl(model.baseUrl, model.testEndpoint), {
      method: "GET",
      headers: {
        ...getAuthHeaders(model.apiKey),
      },
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        ok: false,
        message: `测试失败：HTTP ${response.status} ${text.slice(0, 180)}`,
      };
    }

    return { ok: true, message: "连接成功。" };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? `测试失败：${error.message}` : "测试失败。",
    };
  }
});

ipcMain.handle("ai:generate-image", async (_event, request: AiImageRequest) => {
  const { model, prompt, aspectRatio = "1:1", resolution = "1k" } = request;

  if (!model.baseUrl || !model.imageEndpoint || !model.model || !prompt.trim()) {
    throw new Error("请填写生图模型配置、模型名和提示词。");
  }

  const size = getImageSize(model.model, aspectRatio, resolution);
  const finalPrompt = buildImagePrompt(prompt, aspectRatio, resolution);

  const url = joinApiUrl(model.baseUrl, model.imageEndpoint);
  const headers = {
    "Content-Type": "application/json",
    ...getAuthHeaders(model.apiKey),
  };
  const createImage = (attempt: ImageGenerationAttempt) =>
    fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(
        buildImageRequestBody(model.model, finalPrompt, attempt.size, attempt.resolution, {
          includeQuality: attempt.includeQuality,
        }),
      ),
    });
  const attempts = buildImageGenerationAttempts(size, resolution);
  const failures: string[] = [];

  for (const attempt of attempts) {
    const response = await createImage(attempt);

    if (response.ok) {
      const payload = await response.json();
      return parseImageResponse(payload);
    }

    const text = await response.text();
    failures.push(`${attempt.label}: HTTP ${response.status} ${text.slice(0, 140)}`);

    if (!shouldRetryImageGeneration(response.status)) {
      break;
    }
  }

  throw new Error(
    `生图失败：已自动尝试 ${attempts.length} 种兼容请求仍失败。请检查设置里的生图模型是否是真正的图片生成模型，生图接口通常应为 /images/generations。失败详情：${failures.join(" | ")}`,
  );
});

ipcMain.handle("ai:generate-diagram", async (_event, request: AiDiagramRequest) => {
  const { model, prompt, diagramKind } = request;

  if (!model.baseUrl || !model.chatEndpoint || !model.model || !prompt.trim()) {
    throw new Error("请填写语言模型配置、模型名和用户要求。");
  }

  const response = await fetch(joinApiUrl(model.baseUrl, model.chatEndpoint), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(model.apiKey),
    },
    body: JSON.stringify({
      model: model.model,
      temperature: 0.2,
      messages: [
        { role: "system", content: buildDiagramSystemPrompt(diagramKind) },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`图表生成失败：HTTP ${response.status} ${text.slice(0, 240)}`);
  }

  const payload = await response.json();
  const parsed = extractJsonObject(extractTextResponse(payload));

  if (!Array.isArray(parsed.elements)) {
    throw new Error("语言模型返回的 JSON 缺少 elements 数组。");
  }

  return {
    title: typeof parsed.title === "string" ? parsed.title : "",
    elements: parsed.elements,
  };
});

app.whenReady().then(async () => {
  createMenu();
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
