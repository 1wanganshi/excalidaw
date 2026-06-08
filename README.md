# Excalidaw

Excalidaw is a clean Windows desktop drawing app built on top of Excalidraw. It keeps the familiar hand-drawn whiteboard experience and adds local-first AI tools for image generation and editable native diagram generation.

## Features

- Pure Excalidraw desktop experience
- Open, save, and export `.excalidraw` files locally
- AI image generation panel with aspect ratio and clarity options
- Generated images are automatically placed on the canvas with the correct aspect ratio
- Native diagram generation that streams editable Excalidraw elements onto the canvas
- Separate settings for image models and language models
- OpenAI-compatible model configuration with custom base URL and endpoints

## Download

Windows builds are published from GitHub Releases.

Go to the latest release, download `Excalidaw-0.1.0-x64.exe`, and run it.

## Development

```bash
npm install
npm run dev
```

## Build

Create an unpacked Windows desktop build:

```bash
npm run pack
```

Create a portable Windows executable:

```bash
npm run build
```

Build outputs are written to `release/`.

## AI Model Setup

Open Settings in the app and add models:

- Image model: used by the image generation panel. The default endpoint is `/images/generations`.
- Language model: used to generate editable Excalidraw diagrams. The default endpoint is `/chat/completions`.

API keys are stored locally in the app storage on your machine. They are not committed to this repository.

## Tech Stack

- Electron
- React
- Vite
- TypeScript
- `@excalidraw/excalidraw`

## License

MIT
