# ---------------------------------------------------------------------------
# Personalizzazioni dell'installer NSIS — incluso in automatico da
# electron-builder (vedi «nsis.include» in package.json).
#
# Senza questa dichiarazione l'installer viene disegnato da Windows a 96 dpi e
# poi ingrandito come un'immagine: su uno schermo 4K al 150% risulta tutto
# sfocato, testi e pulsanti compresi. Dichiarandolo consapevole del DPI, i
# controlli vengono ridisegnati alla risoluzione vera dello schermo. Vale anche
# per il disinstallatore, che nasce dallo stesso script.
#
# NSIS 3.0.4.1 (quello usato da electron-builder) conosce solo ManifestDPIAware:
# equivale a «system aware», cioè segue il fattore di scala del monitor
# principale. ManifestDPIAwareness (per-monitor) esiste dalla 3.05 in poi.
# ---------------------------------------------------------------------------
!macro customHeader
  ManifestDPIAware true
!macroend

# ---------------------------------------------------------------------------
# Disinstallazione.
#
# Preventivi, intestazioni e backup stanno in tre cartelle sotto una cartella
# base, che l'utente può spostare dove vuole dall'app. Il percorso scelto
# l'applicazione lo lascia scritto nel registro, in HKCU\Software\App Preventivi:
# senza quello il disinstallatore saprebbe guardare solo accanto a sé e i dati
# spostati resterebbero lì per sempre, all'insaputa di chi disinstalla.
#
# Si cancellano SOLO le sottocartelle che sono nostre, mai la cartella base:
# se l'utente ha scelto «Documenti», dentro c'è la sua vita.
#
# I preventivi di una cartella scelta a mano stanno DIRETTAMENTE dentro quella
# cartella, non più in una sottocartella «Preventivi»: quei file qui non si
# toccano, perché cancellarli vorrebbe dire svuotare una cartella dell'utente.
# La riga «$R0\Preventivi» serve alle installazioni che la cartella non
# l'hanno mai cambiata, dove quella sottocartella c'è ancora.
#
# Si chiede sempre, e non si cancella di nascosto: sono i preventivi di
# un'attività. In disinstallazione silenziosa nessuna finestra è possibile, e
# allora non si tocca niente — meglio lasciare che distruggere senza chiedere.
# ---------------------------------------------------------------------------
!macro customUnInstall
  ${ifNot} ${Silent}
    ReadRegStr $R0 HKCU "Software\App Preventivi" "CartellaDati"
    ${If} $R0 == ""
      StrCpy $R0 "$INSTDIR"
    ${EndIf}

    MessageBox MB_YESNO|MB_ICONQUESTION \
      "Vuoi eliminare anche i dati di App Preventivi?$\r$\n$\r$\nVerranno cancellate queste cartelle:$\r$\n$R0\Preventivi$\r$\n$R0\Intestazione$\r$\n$R0\Backup$\r$\n$\r$\ne le impostazioni dell'app.$\r$\n$\r$\nI preventivi salvati direttamente in $R0 restano dove sono.$\r$\n$\r$\nSI = riparti da zero alla prossima installazione.$\r$\nNO = preventivi, intestazioni e backup restano dove sono." \
      /SD IDNO IDNO conservaDati

      RMDir /r "$R0\Preventivi"
      RMDir /r "$R0\Intestazione"
      RMDir /r "$R0\Backup"
      # se la cartella era rimasta quella d'installazione, si ripulisce anche lì
      RMDir /r "$INSTDIR\Preventivi"
      RMDir /r "$INSTDIR\Intestazione"
      RMDir /r "$INSTDIR\Backup"
      RMDir /r "$APPDATA\App Preventivi"
      RMDir /r "$LOCALAPPDATA\App Preventivi"

    conservaDati:
    DeleteRegKey HKCU "Software\App Preventivi"
  ${endIf}
!macroend
