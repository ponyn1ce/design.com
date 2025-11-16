Maket — minimal React + Fabric editor

Quick start:

1. Open PowerShell in this folder `editor-react`
2. Install dependencies:

```powershell
npm install
```

3. Run dev server:

```powershell
npm run dev
```

Open the shown local URL (usually http://localhost:5173)

Notes:
- Uses `fabric` for canvas editing. The canvas is full-screen and visually shows two pages (left and right).
- Upload images via the "Добавить фото" button — images are added to the canvas and can be moved/scaled/rotated.
- Add text via "Добавить текст".
- Theme depends on the device/browser `prefers-color-scheme` setting.
- To change theme detection code or interval for any timed tasks, edit `src/Editor.jsx`.
 - New features added:
	 - Objects are constrained inside page bounds (mask-like behavior) when moved or resized.
	 - Simple Layers panel (select objects) and Undo/Redo support.
	 - Uploaded images are stored in IndexedDB as Blobs to avoid localStorage quota issues.
	 - You can export the full spread or each page separately.
	 - The visual book area is reduced by 5x (PAGE_SCALE) — change `PAGE_SCALE` in `src/Editor.jsx` if needed.
	 - RGB controls for text color: use sliders in the side panel and press "Применить" to set selected text color.
	 - A4 simulation and height: pages use A4-like proportions (ratio ~1.414). The implementation multiplies A4 height by ~2 (user request) but caps to available viewport height to avoid overflow.
		 - To change how tall pages are, edit `PAGE_SCALE` in `src/Editor.jsx` (smaller -> narrower pages; larger -> wider). The A4 multiplier is set near the top of the file as `A4_RATIO`.

To build for production run `npm run build`.
