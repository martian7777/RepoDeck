# Developer & Contributor Guide

Thank you for contributing to RepoDeck! This guide provides everything you need to set up, build, test, and package the extension.

---

## 1. Local Workspace Setup

### Prerequisites
- Install **Node.js** (v18 or higher is recommended).
- Install **Git**.

### Installation
1. Clone the repository locally:
   ```bash
   git clone https://github.com/martian7777/repodeck.git
   cd repodeck
   ```
2. Install npm packages:
   ```bash
   npm install
   ```

---

## 2. Compiling & Building

RepoDeck uses `esbuild` for speed and bundle optimization. The build configurations are managed in `esbuild.mjs`.

- **Development Build (with Watcher)**:
  Compiles the codebase and watches for changes. Re-compiles automatically on edit:
  ```bash
  npm run watch
  ```
- **Production Build**:
  Minifies, bundles, and prepares files for publishing:
  ```bash
  npm run build
  ```
- **Type Checking**:
  Runs TypeScript type-checks without emitting files to verify syntax and types:
  ```bash
  npm run typecheck
  ```

---

## 3. Running & Debugging

1. Open the project root folder in VS Code.
2. Ensure `npm run watch` is running in an integrated terminal.
3. Open the **Run and Debug** view in the sidebar (`Ctrl+Shift+D` or `Cmd+Shift+D`).
4. Select **Run Extension** from the dropdown and click the green arrow (or press `F5`).
5. A new window (the **Extension Development Host**) will launch with the RepoDeck extension loaded.
6. Open any folder with a Git repository in the development host window to test the views.

### Webview Debugging
To inspect elements and debug javascript inside the webview panels:
1. Open the command palette inside the Extension Development Host window (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2. Run the command: `Developer: Toggle Developer Tools`.
3. Select the console tab to inspect warnings, errors, or logs emitted by the Preact application.

---

## 4. Packaging the Extension (.vsix)

To package the extension into an offline installable `.vsix` file:
1. Run the package script:
   ```bash
   npm run package
   ```
2. This runs `esbuild` in production mode and calls `vsce package`.
3. The resulting `.vsix` bundle will be generated in the root directory (e.g., `repodeck-0.9.0.vsix`).

To install the packed extension in your personal VS Code editor:
- Open the Extensions sidebar, click the `...` menu in the top-right corner, select **Install from VSIX...**, and select the generated file.

---

## 5. Code Conventions & Standards

- **TypeScript Strictness**: Keep strict type annotations in place. Avoid using `any` unless parsing generic incoming IPC messages.
- **Preact Components**: Store UI components in `webview/`. Components must follow a functional style using standard Preact hooks (`useState`, `useEffect`).
- **VS Code Theme Variables**: When writing CSS styles in the webview, use VS Code CSS custom properties (e.g., `var(--vscode-editor-background)`, `var(--vscode-button-background)`) to ensure the panels look cohesive with any editor theme (light, dark, high-contrast).
- **Git State Protection**: When executing local commands via the `git` wrapper, ensure you handle failures gracefully and avoid mutating user workspaces destructively.
