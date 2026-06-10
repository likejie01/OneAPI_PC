$css = @"

/* ============================================================
   pass 16 — targeted fixes
   1. Hide scroll-dock button backgrounds
   2. Remove duplicate code block background layer
   3. Fix light mode popup glass opacity/depth
   ============================================================ */

/* Fix 1: conversation scroll buttons — transparent, no background */
.conversation-scroll-dock {
  background: transparent !important;
  box-shadow: none !important;
  border: none !important;
}

.conversation-scroll-button {
  background: transparent !important;
  background-color: transparent !important;
  border: none !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

.conversation-scroll-button:hover,
.conversation-scroll-button:focus-visible {
  background: transparent !important;
  background-color: transparent !important;
  box-shadow: none !important;
}

/* Fix 2: code block — single background layer only.
   .markdown-code-block is the outer container.
   .markdown-body pre inside it adds a second bg — remove it. */
.markdown-code-block pre,
.markdown-code-block .markdown-body pre {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  margin: 0 !important;
  border-radius: 0 !important;
}

/* Also remove the outer-level blur/border that was added on top of the already-styled block */
.markdown-code-block {
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

/* Fix 3: Light mode popup glass — increase opacity and add depth shadow
   to match dark mode visual weight */
:root {
  --popup-glass-bg: rgba(248, 250, 255, 0.92);
  --popup-glass-shadow:
    0 0 0 0.5px rgba(60,60,67,0.12),
    0 2px 6px rgba(0,0,0,0.06),
    0 8px 24px rgba(0,0,0,0.12),
    0 24px 56px rgba(0,0,0,0.10),
    inset 0 1px 0 rgba(255,255,255,0.90);
}

/* Dark mode — keep existing depth, just ensure parity */
:root[data-theme='dark'] {
  --popup-glass-bg: rgba(28, 28, 30, 0.88);
  --popup-glass-shadow:
    0 0 0 0.5px rgba(255,255,255,0.08),
    0 2px 6px rgba(0,0,0,0.22),
    0 8px 24px rgba(0,0,0,0.38),
    0 28px 64px rgba(0,0,0,0.44),
    inset 0 1px 0 rgba(255,255,255,0.06);
}
"@

Add-Content -LiteralPath 'D:\WorkSpace\NewAPI\OneAPI_PC\src\styles.css' -Value $css -Encoding UTF8
Write-Host "pass16 done"
