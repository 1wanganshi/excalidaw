const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("excalidaw", {
  onMenuCommand(callback) {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on("menu-command", listener);
    return () => ipcRenderer.removeListener("menu-command", listener);
  },
  openScene() {
    return ipcRenderer.invoke("scene:open");
  },
  saveScene(sceneJson, saveAs) {
    return ipcRenderer.invoke("scene:save", sceneJson, saveAs);
  },
  setDirty(isDirty) {
    return ipcRenderer.invoke("scene:set-dirty", isDirty);
  },
  setCleanFile(filePath) {
    return ipcRenderer.invoke("scene:set-clean-file", filePath);
  },
  testAiModel(model) {
    return ipcRenderer.invoke("ai:test-model", model);
  },
  generateAiImage(request) {
    return ipcRenderer.invoke("ai:generate-image", request);
  },
  generateAiDiagram(request) {
    return ipcRenderer.invoke("ai:generate-diagram", request);
  },
  generateAiDiagramStream(request, streamId) {
    return ipcRenderer.invoke("ai:generate-diagram-stream", { request, streamId });
  },
  onDiagramStreamEvent(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("ai:diagram-stream:event", listener);
    return () => ipcRenderer.removeListener("ai:diagram-stream:event", listener);
  },
  generateAiDiagramStreamV2(request, streamId) {
    return ipcRenderer.invoke("ai:generate-diagram-stream-v2", { request, streamId });
  },
  onDiagramStreamV2Event(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("ai:diagram-stream-v2:event", listener);
    return () => ipcRenderer.removeListener("ai:diagram-stream-v2:event", listener);
  },
  generateLogicLayout(request) {
    return ipcRenderer.invoke("ai:generate-logic-layout", request);
  },
  generatePosterDoc(request) {
    return ipcRenderer.invoke("ai:generate-poster-doc", request);
  },
});
