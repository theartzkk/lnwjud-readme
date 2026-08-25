!macro customInstall
  ; Resolve the shortcut from the actual end-user install directory at install time.
  SetOutPath "$INSTDIR"
  CreateDirectory "$SMPROGRAMS"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_FILENAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\${PRODUCT_FILENAME}.lnk"
  ; Silent uninstall (automation/updater) preserves user data and never blocks on UI.
  IfSilent keepData
  MessageBox MB_YESNO|MB_ICONQUESTION "Do you want to keep your user settings and workspaces data?$\n$\n(กด 'Yes' เพื่อเก็บข้อมูลการตั้งค่าและ Workspace ไว้$\nกด 'No' เพื่อลบข้อมูลผู้ใช้ AWH ออกจากเครื่อง)" IDYES keepData
    ; Delete only AWH canonical data. Never delete the legacy lnwjud directory:
    ; AWH can coexist with upstream compatibility data and must not destroy it.
    RMDir /r "$APPDATA\${PRODUCT_FILENAME}"
  keepData:
!macroend
