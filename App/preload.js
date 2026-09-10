'use strict';
/* Unico ponte fra la pagina e il processo principale: la pagina non tocca il
   disco, chiede. Tutto il resto di Node resta fuori dalla portata del renderer. */
const { contextBridge, ipcRenderer } = require('electron');

const on = (canale, cb) => {
  const h = (_e, dati) => cb(dati);
  ipcRenderer.on(canale, h);
  return () => ipcRenderer.off(canale, h);
};

contextBridge.exposeInMainWorld('preventivi', {
  isDesktop: true,

  // cartella dei salvataggi
  cartella:      ()          => ipcRenderer.invoke('cartella:info'),
  scegliCartella:()          => ipcRenderer.invoke('cartella:scegli'),
  cartellaPredefinita:()     => ipcRenderer.invoke('cartella:predefinita'),
  apriCartella:  ()          => ipcRenderer.invoke('cartella:apri'),

  // backup
  backupCrea:    ()          => ipcRenderer.invoke('backup:crea'),
  backupApri:    ()          => ipcRenderer.invoke('backup:apri'),
  backupElenco:  ()          => ipcRenderer.invoke('backup:elenco'),

  // file
  scegliSalva:   (nome,tipo) => ipcRenderer.invoke('file:scegliSalva', { nome, tipo }),
  scegliApri:    ()          => ipcRenderer.invoke('file:scegliApri'),
  scegliImporta: ()          => ipcRenderer.invoke('file:scegliImporta'),
  apriPercorso:  (percorso)  => ipcRenderer.invoke('file:apriPercorso', { percorso }),

  // cartella e backup del singolo preventivo
  preventivoCartella:  (nome)     => ipcRenderer.invoke('preventivo:cartella', { nome }),
  preventivoApriCartella:(o={})   => ipcRenderer.invoke('preventivo:apriCartella', o),
  preventivoApriBackup:(o={})     => ipcRenderer.invoke('preventivo:apriBackup', o),
  preventivoBackup:    (o={})     => ipcRenderer.invoke('preventivo:backup', o),

  // preventivi aperti di recente
  recentiElenco: ()          => ipcRenderer.invoke('recenti:elenco'),
  recentiSvuota: ()          => ipcRenderer.invoke('recenti:svuota'),

  // un file aperto con un doppio clic
  fileDaAprire:  ()          => ipcRenderer.invoke('avvio:fileDaAprire'),
  onApriQuesto:  (cb)        => on('file:apriQuesto', cb),
  scriviTesto:   (percorso,testo) => ipcRenderer.invoke('file:scriviTesto', { percorso, testo }),
  scriviBinario: (percorso,dati)  => ipcRenderer.invoke('file:scriviBinario', { percorso, dati }),
  leggi:         (percorso)  => ipcRenderer.invoke('file:leggi', { percorso }),
  apriFile:      (percorso)  => ipcRenderer.invoke('file:apri', { percorso }),

  // intestazioni salvate nella cartella «Intestazione»
  intestCartella:    ()          => ipcRenderer.invoke('intest:cartella'),
  intestApriCartella:()          => ipcRenderer.invoke('intest:apriCartella'),
  intestElenco:      ()          => ipcRenderer.invoke('intest:elenco'),
  intestLeggi:       (nome)      => ipcRenderer.invoke('intest:leggi', { nome }),
  intestScrivi:      (nome,html) => ipcRenderer.invoke('intest:scrivi', { nome, html }),
  intestElimina:     (nome)      => ipcRenderer.invoke('intest:elimina', { nome }),
  predefLeggi:       ()          => ipcRenderer.invoke('intest:predefLeggi'),
  predefScrivi:      (html)      => ipcRenderer.invoke('intest:predefScrivi', { html }),

  // carta
  anteprima:     (opz={})    => ipcRenderer.invoke('stampa:anteprima', opz),
  stampa:        (opz={})    => ipcRenderer.invoke('stampa:carta', opz),
  pdf:           (opz={})    => ipcRenderer.invoke('stampa:pdf', opz),

  // adattamento allo schermo
  zoomGet:       ()          => ipcRenderer.invoke('ui:zoomGet'),
  zoomSet:       (opz={})    => ipcRenderer.invoke('ui:zoomSet', opz),
  onZoom:        (cb)        => on('ui:zoom', cb),

  // menu del tasto destro
  menuContestuale: (ctx) => ipcRenderer.invoke('menu:contestuale', ctx),
  onAzioneMenu:    (cb)  => on('menu:azione', cb),

  // voci di menu
  onMenu: (cb) => {
    const azioni = ['nuovo','apri','recenti','importa','salva','salvaCome','anteprima','stampa','pdf','excel','intestazione','cliente','aspetto'];
    const off = azioni.map(a => on('menu:' + a, () => cb(a)));
    return () => off.forEach(f => f());
  },

  // chiusura della finestra
  statoModificato: (v)  => ipcRenderer.send('stato:modificato', v),
  chiusuraProcedi: ()   => ipcRenderer.send('chiusura:procedi'),
  onChiusuraSalva: (cb) => on('chiusura:salva', cb),

  nuovaIstanza: (percorso) => ipcRenderer.invoke('app:nuovaIstanza', { percorso }),
  info: () => ipcRenderer.invoke('app:info'),
});
