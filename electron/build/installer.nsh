; electron/build/installer.nsh — NSIS hooks (electron-builder nsis.include).
; desktop.3 and older bundled the game art in resources\game\public\assets. Since desktop.4 the art lives in
; %APPDATA%\<product>\art (installed from the art pack). Before the old version is uninstalled, its art is moved to
; %APPDATA%\<product>\art-migrate; on first start the app (electron/art.js) checks it file by file against the pack's
; sha256 and reuses every match, so an upgrade does not download the art again. A failed move only costs a download.
!macro customInit
  StrCpy $0 "$INSTDIR\resources\game\public\assets"
  StrCpy $1 "$APPDATA\${PRODUCT_NAME}\art-migrate"
  ${If} ${FileExists} "$0\*.*"
  ${AndIfNot} ${FileExists} "$APPDATA\${PRODUCT_NAME}\art\.art-state.json"
    CreateDirectory "$1"
    ${IfNot} ${FileExists} "$1\assets\*.*"
      Rename "$0" "$1\assets"
    ${EndIf}
    CreateDirectory "$1\data"
    Rename "$INSTDIR\resources\game\data\local-assets.json" "$1\data\local-assets.json"
  ${EndIf}
!macroend
