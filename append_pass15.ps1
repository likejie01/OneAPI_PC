$css = @"

/* ============================================================
   pass 15 — popup glass system FINAL OVERRIDE
   Glass only on popup container. modal-mask = dim only.
   Light: white-frost. Dark: graphite-frost.
   ============================================================ */

:root {
  --popup-glass-bg: rgba(248, 250, 255, 0.80);
  --popup-glass-blur: blur(40px) saturate(180%) brightness(1.04);
  --popup-glass-border: rgba(60, 60, 67, 0.14);
  --popup-glass-shadow: 0 2px 1px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.10), 0 24px 56px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.82);
  --popup-item-bg: rgba(255,255,255,0.55);
  --popup-item-hover: rgba(0,122,255,0.07);
  --popup-item-active: rgba(0,122,255,0.12);
  --popup-item-border: rgba(60,60,67,0.10);
  --popup-input-bg: rgba(255,255,255,0.62);
  --popup-mask-bg: rgba(0,0,0,0.28);
}

:root[data-theme='dark'] {
  --popup-glass-bg: rgba(30, 30, 32, 0.84);
  --popup-glass-blur: blur(40px) saturate(160%) brightness(0.96);
  --popup-glass-border: rgba(255,255,255,0.10);
  --popup-glass-shadow: 0 2px 1px rgba(0,0,0,0.18), 0 8px 24px rgba(0,0,0,0.36), 0 28px 64px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.06);
  --popup-item-bg: rgba(255,255,255,0.05);
  --popup-item-hover: rgba(10,132,255,0.10);
  --popup-item-active: rgba(10,132,255,0.16);
  --popup-item-border: rgba(255,255,255,0.08);
  --popup-input-bg: rgba(255,255,255,0.07);
  --popup-mask-bg: rgba(0,0,0,0.50);
}

/* Reset all previous bg/filter overrides on popup surfaces */
.picker-menu, .assistant-menu, .image-style-menu, .image-config-menu,
.model-menu, .cli-extension-menu, .glass-picker-menu, .session-context-menu,
.chat-history-panel, .cli-history-panel, .cli-plan-floating-panel,
.desktop-update-popover, .modal-card, .announcement-modal-card,
.translation-modal-card, .markdown-code-action-menu,
.cli-extension-floating-tooltip, .toast-bar,
.image-preview-modal, .attachment-preview-modal {
  background: unset !important;
  background-color: unset !important;
  background-image: unset !important;
  backdrop-filter: unset !important;
  -webkit-backdrop-filter: unset !important;
}

/* Apply glass to picker/dropdown surfaces */
.picker-menu:not(.glass-picker-menu), .model-menu, .image-config-menu,
.markdown-code-action-menu, .cli-extension-floating-tooltip,
.session-context-menu, .assistant-menu:not(.glass-picker-menu),
.image-style-menu:not(.glass-picker-menu),
.cli-extension-menu:not(.glass-picker-menu) {
  background: var(--popup-glass-bg) !important;
  backdrop-filter: var(--popup-glass-blur) !important;
  -webkit-backdrop-filter: var(--popup-glass-blur) !important;
  border: 1px solid var(--popup-glass-border) !important;
  box-shadow: var(--popup-glass-shadow) !important;
  border-radius: 16px !important;
}

/* GlassPickerMenu wrapper */
.glass-picker-menu {
  background: transparent !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  border: none !important;
  box-shadow: none !important;
  position: relative !important;
  isolation: isolate !important;
}

.glass-picker-menu-bg {
  position: absolute !important;
  inset: 0 !important;
  border-radius: inherit !important;
  background: var(--popup-glass-bg) !important;
  backdrop-filter: var(--popup-glass-blur) !important;
  -webkit-backdrop-filter: var(--popup-glass-blur) !important;
  border: 1px solid var(--popup-glass-border) !important;
  box-shadow: var(--popup-glass-shadow) !important;
  z-index: -1 !important;
  pointer-events: none !important;
}

.glass-picker-menu-content {
  position: relative !important;
  z-index: 1 !important;
}

/* History panels and floating panels */
.chat-history-panel, .cli-history-panel,
.cli-plan-floating-panel, .desktop-update-popover {
  background: var(--popup-glass-bg) !important;
  backdrop-filter: var(--popup-glass-blur) !important;
  -webkit-backdrop-filter: var(--popup-glass-blur) !important;
  border: 1px solid var(--popup-glass-border) !important;
  box-shadow: var(--popup-glass-shadow) !important;
}

/* Modal cards — glass on card only */
.modal-card, .announcement-modal-card, .translation-modal-card {
  background: var(--popup-glass-bg) !important;
  backdrop-filter: var(--popup-glass-blur) !important;
  -webkit-backdrop-filter: var(--popup-glass-blur) !important;
  border: 1px solid var(--popup-glass-border) !important;
  box-shadow: var(--popup-glass-shadow) !important;
  border-radius: 20px !important;
}

/* modal-mask: dim overlay only — NO backdrop-filter (avoid full-screen blur) */
.modal-mask, .image-preview-modal-mask {
  background: var(--popup-mask-bg) !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

/* Image preview */
.image-preview-modal, .attachment-preview-modal {
  background: var(--popup-glass-bg) !important;
  backdrop-filter: var(--popup-glass-blur) !important;
  -webkit-backdrop-filter: var(--popup-glass-blur) !important;
  border: 1px solid var(--popup-glass-border) !important;
  box-shadow: var(--popup-glass-shadow) !important;
  border-radius: 20px !important;
}

/* Toast */
.toast-bar {
  background: var(--popup-glass-bg) !important;
  backdrop-filter: var(--popup-glass-blur) !important;
  -webkit-backdrop-filter: var(--popup-glass-blur) !important;
  border: 1px solid var(--popup-glass-border) !important;
  box-shadow: var(--popup-glass-shadow) !important;
  border-radius: 14px !important;
}

/* Inner items */
.picker-menu .picker-option,
.assistant-menu .picker-option,
.assistant-menu .assistant-picker-option,
.image-style-menu .image-style-picker-option,
.cli-extension-menu .cli-extension-card,
.session-context-menu .session-context-menu-item,
.markdown-code-action-menu button {
  background: var(--popup-item-bg) !important;
  border: 1px solid var(--popup-item-border) !important;
  border-radius: 10px !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  transition: background 0.12s ease, border-color 0.12s ease !important;
}

.picker-menu .picker-option:hover,
.picker-menu .picker-option:focus-visible,
.assistant-menu .assistant-picker-option:hover,
.assistant-menu .assistant-picker-option:focus-visible,
.image-style-menu .image-style-picker-option:hover,
.image-style-menu .image-style-picker-option:focus-visible,
.cli-extension-menu .cli-extension-card:hover,
.cli-extension-menu .cli-extension-card:focus-visible,
.session-context-menu .session-context-menu-item:hover,
.session-context-menu .session-context-menu-item:focus-visible,
.markdown-code-action-menu button:hover,
.markdown-code-action-menu button:focus-visible {
  background: var(--popup-item-hover) !important;
  border-color: rgba(0,122,255,0.18) !important;
}

.picker-menu .picker-option.active,
.assistant-menu .assistant-picker-option.active,
.image-style-menu .image-style-picker-option.active,
.picker-menu .picker-filter-chip.active {
  background: var(--popup-item-active) !important;
  border-color: rgba(0,122,255,0.24) !important;
  color: var(--accent) !important;
}

/* Inputs inside popups */
.picker-menu input:not([type='checkbox']):not([type='radio']):not([type='range']),
.picker-menu textarea, .picker-menu select,
.assistant-menu .assistant-search,
.cli-extension-menu .cli-extension-search {
  background: var(--popup-input-bg) !important;
  border: 1px solid var(--popup-glass-border) !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  box-shadow: none !important;
}

/* Section headers */
.picker-menu .picker-menu-head,
.assistant-menu .picker-menu-head,
.cli-extension-menu .picker-menu-head {
  background: transparent !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

/* Filter chips */
.picker-filter-chip {
  background: var(--popup-item-bg) !important;
  border-color: var(--popup-item-border) !important;
}

.picker-filter-chip.active {
  background: var(--popup-item-active) !important;
  border-color: rgba(0,122,255,0.24) !important;
  color: var(--accent) !important;
}

/* Remove pseudo-element decorations */
.picker-menu::before, .picker-menu::after,
.assistant-menu::before, .assistant-menu::after,
.image-style-menu::before, .image-style-menu::after,
.image-config-menu::before, .image-config-menu::after,
.model-menu::before, .model-menu::after,
.cli-extension-menu::before, .cli-extension-menu::after,
.modal-card::before, .modal-card::after {
  display: none !important;
  content: none !important;
}
"@

Add-Content -LiteralPath 'D:\WorkSpace\NewAPI\OneAPI_PC\src\styles.css' -Value $css -Encoding UTF8
Write-Host "pass15 done"
