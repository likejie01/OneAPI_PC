!macro customUnInstallSection
  Section /o "删除本地个人文件（聊天记录、缓存、配置）"
    DetailPrint "Removing OneAPI desktop app data..."
    RMDir /r "$APPDATA\\oneapi-pc"
    RMDir /r "$LOCALAPPDATA\\oneapi-pc"
    RMDir /r "$APPDATA\\OneAPI PC"
    RMDir /r "$LOCALAPPDATA\\OneAPI PC"
  SectionEnd
!macroend
