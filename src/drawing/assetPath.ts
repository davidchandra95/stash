// This module must evaluate before the Excalidraw module initializes its font URLs.
Object.assign(window, { EXCALIDRAW_ASSET_PATH: new URL('drawing/', document.baseURI).href })
