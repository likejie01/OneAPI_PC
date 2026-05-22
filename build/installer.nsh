!macro customUnInstall
  DetailPrint "Removing OneAPI desktop app data..."
  RMDir /r "$APPDATA\\oneapi-pc"
  RMDir /r "$LOCALAPPDATA\\oneapi-pc"
  RMDir /r "$APPDATA\\OneAPI PC"
  RMDir /r "$LOCALAPPDATA\\OneAPI PC"
!macroend
