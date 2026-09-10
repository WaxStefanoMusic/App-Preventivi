'use strict';
/* ==============================================================================
   App Preventivi — processo principale Electron

   Tre cose sole, ma fatte bene:
   - la finestra si adatta allo schermo, anche a un 4K, e segue i cambi di DPI
   - i preventivi si salvano in una cartella «Preventivi» accanto all'app
   - stampa e PDF escono in A4, verticale o orizzontale, come chiede la pagina
   ============================================================================== */
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const { execFile, spawn } = require('child_process');

/* Deve precedere qualsiasi getPath('userData'): fissa la cartella dati sia in
   sviluppo sia da eseguibile installato. */
app.setName('App Preventivi');

const { autoUpdater } = require('electron-updater');

const STATE_FILE = path.join(app.getPath('userData'), 'finestra.json');
const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');

/* -------------------------------------------------------------------------
   Dove finiscono i preventivi.
   Accanto all'applicazione, in una cartella «Preventivi»: è il posto che si
   trova senza cercare. Se non è scrivibile (installazione in Program Files,
   chiavetta in sola lettura) si ripiega sui Documenti dell'utente.
   ------------------------------------------------------------------------- */
const CARTELLA_SALVATAGGI = 'Preventivi';
/* Le intestazioni salvate stanno in una cartella loro, accanto ai preventivi:
   sono modelli che si riusano, non documenti. */
const CARTELLA_INTESTAZIONI = 'Intestazione';
/* I backup: copie datate di preventivi e intestazioni, accanto agli originali. */
const CARTELLA_BACKUP = 'Backup';
/* L'intestazione predefinita è un file come gli altri, dentro la stessa
   cartella: si vede, si copia, si porta su un altro computer. */
const FILE_PREDEFINITA = 'Predefinita.html';
/* Nome della cartella in cui electron-builder scrive gli eseguibili: vedi
   «directories.output» in package.json. */
const CARTELLA_BUILD = 'Installer';

/* Provando l'app appena compilata si finisce dentro la cartella di build
   (`Installer\win-unpacked`, o `Installer` per la versione portatile). I
   preventivi però non devono stare lì: quella cartella viene rigenerata a ogni
   compilazione, e se li si lascia dentro spariscono alla ricompilazione
   successiva. In quel caso si risale accanto al progetto — lo stesso posto in
   cui finiscono avviando l'app in sviluppo, così provando la build si ritrovano
   i preventivi di sempre invece di una cartella nuova e vuota.
   Un'installazione vera non passa mai di qui. */
function fuoriDallaCartellaBuild(dir) {
  const parti = path.resolve(dir).split(path.sep);
  const i = parti.lastIndexOf(CARTELLA_BUILD);
  if (i <= 0) return dir;
  const progetto = parti.slice(0, i).join(path.sep);
  try {
    return fs.existsSync(path.join(progetto, 'package.json')) ? path.dirname(progetto) : dir;
  } catch (_) { return dir; }
}
function cartellaApp() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return fuoriDallaCartellaBuild(process.env.PORTABLE_EXECUTABLE_DIR);
  if (app.isPackaged) return fuoriDallaCartellaBuild(path.dirname(app.getPath('exe')));
  /* in sviluppo la cartella dell'app è «…\App»: i preventivi stanno un piano
     sopra, accanto al progetto, dove l'utente li va a cercare */
  return path.dirname(app.getAppPath());
}
function scrivibile(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, '.prova-scrittura');
    fs.writeFileSync(p, '');
    fs.unlinkSync(p);
    return true;
  } catch (_) { return false; }
}
function leggiConfig() {
  // il BOM lasciato da certi editor manderebbe in errore JSON.parse, facendo
  // perdere in silenzio la cartella scelta dall'utente
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8').replace(/^﻿/, '')); } catch (_) { return {}; }
}
function scriviConfig(c) {
  try { fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true }); fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2)); } catch (_) {}
}

/* Dalla cartella base ricava le tre cartelle di lavoro e le crea.

   «dentroLaBase» distingue i due casi:
   - cartella scelta dall'utente: i preventivi stanno DIRETTAMENTE lì dentro.
     Chi sceglie «B:\Preventivi» vuole i suoi file in «B:\Preventivi», non in
     «B:\Preventivi\Preventivi»: la cartella l'ha già scelta e nominata lui.
   - cartella automatica (accanto all'app o nei Documenti): lì dentro c'è
     dell'altro, quindi i preventivi restano in una sottocartella loro.
   Intestazioni e backup invece stanno SEMPRE in una sottocartella, in tutti e
   due i casi: sono modelli e copie datate, non i documenti di ogni giorno. */
function cartelleDa(base, ripiego, dentroLaBase) {
  const c = {
    base,
    dir: dentroLaBase ? base : path.join(base, CARTELLA_SALVATAGGI),
    intestazioni: path.join(base, CARTELLA_INTESTAZIONI),
    backup: path.join(base, CARTELLA_BACKUP),
    ripiego: !!ripiego,
  };
  scrivibile(c.dir); scrivibile(c.intestazioni);
  return c;
}

function calcolaCartella() {
  // prima quella scelta dall'utente, se esiste ancora ed è scrivibile
  const scelta = leggiConfig().cartella;
  if (scelta && scrivibile(scelta)) return cartelleDa(scelta, false, true);
  if (scrivibile(path.join(cartellaApp(), CARTELLA_SALVATAGGI))) return cartelleDa(cartellaApp(), false, false);
  return cartelleDa(app.getPath('documents'), true, false);
}
let CARTELLA = calcolaCartella();

/* Il disinstallatore deve poter chiedere se cancellare i dati anche quando la
   cartella è stata spostata altrove: il percorso glielo si lascia scritto nel
   registro, che è l'unico posto che NSIS sa leggere senza complicazioni. */
function annotaCartellaPerDisinstallazione() {
  if (process.platform !== 'win32') return;
  try {
    execFile('reg', ['add', 'HKCU\\Software\\App Preventivi', '/v', 'CartellaDati',
      '/t', 'REG_SZ', '/d', CARTELLA.base, '/f'], { windowsHide: true }, () => {});
  } catch (_) {}
}

/** i nomi dei file li scrive l'utente: qui si tolgono i caratteri che Windows non accetta */
const nomeFileSicuro = n => String(n || '').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 60);
const percorsoIntestazione = nome => path.join(CARTELLA.intestazioni, nomeFileSicuro(nome) + '.html');

let win = null;
let uiZoom = 1;          // fattore di ingrandimento dell'interfaccia
let zoomMode = 'auto';   // 'auto' | 'manuale'
/** la pagina ci tiene aggiornati: c'è del lavoro non salvato? */
let lavoroDaSalvare = false;
/** alla seconda passata la chiusura non chiede più niente */
let chiusuraConfermata = false;

const send = (canale, dati) => { if (win && !win.isDestroyed()) win.webContents.send(canale, dati); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* -------------------------------------------------------------------------
   Adattamento allo schermo
   ------------------------------------------------------------------------- */
/** Zoom suggerito in base allo spazio logico disponibile.
 *  Un 4K a 100% espone 3840 punti logici: senza ingrandire, i testi sarebbero
 *  illeggibili. A 150% ne espone 2560 e serve un ritocco più lieve. */
function autoZoomFor(display) {
  const w = display.workArea.width;
  if (w >= 3400) return 1.60;
  if (w >= 2800) return 1.30;
  if (w >= 2200) return 1.15;
  if (w <= 1400) return 0.90;
  return 1;
}
function defaultBounds(display) {
  const wa = display.workArea;
  const width = clamp(Math.round(wa.width * 0.82), 900, 1700);
  const height = clamp(Math.round(wa.height * 0.90), 640, 1200);
  return { width, height, x: Math.round(wa.x + (wa.width - width) / 2), y: Math.round(wa.y + (wa.height - height) / 2) };
}
function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) { return {}; }
}
let stateTimer = null;
function saveState() {
  clearTimeout(stateTimer);
  stateTimer = setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    const s = { ...win.getNormalBounds(), maximized: win.isMaximized(), uiZoom, zoomMode };
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); } catch (_) {}
  }, 500);
}
/** una posizione salvata vale solo se ricade ancora su uno schermo collegato */
function boundsAreVisible(b) {
  if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.width)) return false;
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  return screen.getAllDisplays().some(d => {
    const a = d.workArea;
    return cx >= a.x && cx <= a.x + a.width && cy >= a.y && cy <= a.y + a.height;
  });
}
function currentDisplay() {
  try { return win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay(); }
  catch (_) { return screen.getPrimaryDisplay(); }
}
function applyUiZoom(z, { fromAuto = false } = {}) {
  uiZoom = clamp(z, 0.6, 2.5);
  if (!fromAuto) zoomMode = 'manuale';
  if (win && !win.isDestroyed()) win.webContents.setZoomFactor(uiZoom);
  send('ui:zoom', { uiZoom, zoomMode, auto: autoZoomFor(currentDisplay()) });
  saveState();
}

/* -------------------------------------------------------------------------
   Finestra
   ------------------------------------------------------------------------- */
function createWindow() {
  const st = readState();
  const display = boundsAreVisible(st) ? screen.getDisplayMatching(st) : screen.getPrimaryDisplay();
  const b = boundsAreVisible(st) ? st : defaultBounds(display);

  zoomMode = st.zoomMode === 'manuale' ? 'manuale' : 'auto';
  uiZoom = zoomMode === 'manuale' ? clamp(+st.uiZoom || 1, 0.6, 2.5) : autoZoomFor(display);

  win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    minWidth: 860, minHeight: 600,
    backgroundColor: '#f9f9f7',
    show: false,
    title: 'App Preventivi',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      zoomFactor: uiZoom,
    },
  });
  if (st.maximized) win.maximize();

  Menu.setApplicationMenu(buildMenu());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { win.webContents.setZoomFactor(uiZoom); win.show(); });

  // nessun link deve portare fuori dall'app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  /* Chiusura con la X: se c'è del lavoro non salvato si chiede, ma la finestra
     deve poter sempre chiudersi. La domanda la fa qui il sistema: nella pagina
     l'unico modo sarebbe annullare la chiusura, e la X smetterebbe di
     rispondere senza spiegare perché. */
  win.on('close', (e) => {
    if (chiusuraConfermata || !lavoroDaSalvare) return;
    e.preventDefault();
    const r = dialog.showMessageBoxSync(win, {
      type: 'question', noLink: true, defaultId: 0, cancelId: 2,
      buttons: ['Salva ed esci', 'Esci senza salvare', 'Annulla'],
      title: 'Preventivo non salvato',
      message: 'Ci sono modifiche non salvate.',
      detail: 'Vuoi salvarle prima di chiudere?',
    });
    if (r === 2) return;                         // si resta dov'eravamo
    if (r === 1) { chiusuraConfermata = true; win.close(); return; }
    win.webContents.send('chiusura:salva');      // salva, poi richiama qui
  });

  win.on('closed', () => {
    win = null;
    // l'anteprima è figlia del preventivo: chiuso quello, non ha più senso
    if (winAnteprima && !winAnteprima.isDestroyed()) winAnteprima.destroy();
  });
  win.on('resize', saveState);
  win.on('move', saveState);
  win.on('maximize', saveState);
  win.on('unmaximize', saveState);
}

/* cambi di risoluzione, di scala di Windows o monitor collegati e scollegati */
function onDisplaysChanged() {
  if (!win || win.isDestroyed()) return;
  if (zoomMode === 'auto') applyUiZoom(autoZoomFor(currentDisplay()), { fromAuto: true });
  if (!boundsAreVisible(win.getNormalBounds())) win.setBounds(defaultBounds(screen.getPrimaryDisplay()));
}

/* -------------------------------------------------------------------------
   Menu
   ------------------------------------------------------------------------- */
const vociMenu = (etichetta, azione, acc) => ({ label: etichetta, accelerator: acc, click: () => send('menu:' + azione) });

function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        vociMenu('Nuovo', 'nuovo', 'CommandOrControl+N'),
        vociMenu('Apri', 'apri', 'CommandOrControl+O'),
        vociMenu('Recenti', 'recenti'),
        vociMenu('Importa', 'importa'),
        { type: 'separator' },
        vociMenu('Salva', 'salva', 'CommandOrControl+S'),
        vociMenu('Salva con nome…', 'salvaCome', 'CommandOrControl+Shift+S'),
        { type: 'separator' },
        vociMenu('Anteprima di stampa', 'anteprima', 'CommandOrControl+Shift+P'),
        vociMenu('Stampa…', 'stampa', 'CommandOrControl+P'),
        vociMenu('Esporta in PDF…', 'pdf'),
        vociMenu('Esporta in Excel…', 'excel'),
        { type: 'separator' },
        { label: 'Apri la cartella «Preventivi»', click: () => shell.openPath(CARTELLA.dir) },
        { label: 'Apri la cartella «Intestazione»', click: () => shell.openPath(CARTELLA.intestazioni) },
        { label: 'Apri la cartella «Backup»', click: () => { try { fs.mkdirSync(CARTELLA.backup, { recursive: true }); } catch (_) {} shell.openPath(CARTELLA.backup); } },
        { type: 'separator' },
        { role: 'quit', label: 'Esci' },
      ],
    },
    {
      label: 'Preventivo',
      submenu: [
        vociMenu('Intestazione…', 'intestazione'),
        vociMenu('Dati Cliente…', 'cliente'),
      ],
    },
    {
      label: 'Modifica',
      submenu: [
        { role: 'undo', label: 'Annulla' }, { role: 'redo', label: 'Ripeti' },
        { type: 'separator' },
        { role: 'cut', label: 'Taglia' }, { role: 'copy', label: 'Copia' },
        { role: 'paste', label: 'Incolla' }, { role: 'selectAll', label: 'Seleziona tutto' },
      ],
    },
    {
      label: 'Visualizza',
      submenu: [
        { label: 'Interfaccia più grande', accelerator: 'CommandOrControl+=', click: () => applyUiZoom(uiZoom + 0.1) },
        { label: 'Interfaccia più piccola', accelerator: 'CommandOrControl+-', click: () => applyUiZoom(uiZoom - 0.1) },
        { label: 'Dimensione automatica', accelerator: 'CommandOrControl+0', click: () => { zoomMode = 'auto'; applyUiZoom(autoZoomFor(currentDisplay()), { fromAuto: true }); } },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Schermo intero' },
        { role: 'reload', label: 'Ricarica' },
        { role: 'toggleDevTools', label: 'Strumenti di sviluppo' },
      ],
    },
    /* Da qui si regolano le scritte del foglio — nome, dimensione, maiuscolo,
       grassetto — senza toccare il codice: il riquadro sta nella pagina, che è
       l'unica a sapere com'è fatto il foglio. */
    {
      label: 'Sviluppatore',
      submenu: [
        vociMenu('Aspetto delle scritte…', 'aspetto'),
      ],
    },
    {
      label: '?',
      submenu: [{
        label: 'Controlla aggiornamenti…',
        click: () => cercaAggiornamenti(true),
      }, {
        label: 'Informazioni',
        click: () => dialog.showMessageBox(win, {
          type: 'info', title: 'App Preventivi',
          message: 'App Preventivi ' + app.getVersion(),
          detail: 'Preventivi in formato A4, stampa e esportazione in PDF ed Excel.\n\nPreventivi:\n' + CARTELLA.dir + '\n\nIntestazioni:\n' + CARTELLA.intestazioni,
          buttons: ['Chiudi'],
        }),
      }],
    },
  ]);
}

/* -------------------------------------------------------------------------
   Aggiornamenti automatici

   Le versioni nuove stanno nelle Release della repository su GitHub, insieme a
   un foglietto («latest.yml») che dice qual è l'ultima. L'app lo legge
   all'avvio e poi ogni sei ore, scarica in sottofondo quello che serve e SOLO
   ALLA FINE si fa viva: mentre si scrive un preventivo non deve succedere
   niente.

   Chi decide quando installare è l'utente. «Installa adesso» chiude la
   finestra passando dalla porta di sempre — quella che, se c'è del lavoro non
   salvato, si ferma e lo chiede — e l'aggiornamento parte solo se la finestra
   si è chiusa davvero. Rispondendo «Alla prossima chiusura» non si fa niente:
   il pacchetto è già sul disco e verrà applicato uscendo dall'app.
   ------------------------------------------------------------------------- */
/* Il controllo chiesto dal menu parla anche quando non c'è niente di nuovo:
   chi lo chiede vuole una risposta. Quello automatico invece tace. */
let controlloChiesto = false;

function installaAggiornamento() {
  /* quitAndInstall() da solo chiuderebbe tutto senza passare dalla domanda sul
     preventivo non salvato: prima si chiude la finestra con le sue regole, e
     solo se si è chiusa per davvero si lascia partire l'installazione */
  if (!win || win.isDestroyed()) { autoUpdater.quitAndInstall(false, true); return; }
  win.once('closed', () => autoUpdater.quitAndInstall(false, true));
  win.close();
}

function preparaAggiornamenti() {
  /* in sviluppo non c'è nessuna versione installata da sostituire: il modulo
     si lamenterebbe e basta */
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;           // si scarica da sé, in sottofondo
  autoUpdater.autoInstallOnAppQuit = true;   // e comunque si applica all'uscita

  autoUpdater.on('update-downloaded', (info) => {
    const r = dialog.showMessageBoxSync(win, {
      type: 'question', noLink: true, defaultId: 0, cancelId: 1,
      buttons: ['Installa adesso', 'Alla prossima chiusura'],
      title: 'Aggiornamento pronto',
      message: 'È pronta la versione ' + info.version + '.',
      detail: 'È già stata scaricata. Installandola adesso l\'app si chiude e si riapre '
            + 'aggiornata; se hai un preventivo non salvato te lo chiede prima.',
    });
    if (r === 0) installaAggiornamento();
  });

  autoUpdater.on('update-not-available', () => {
    if (!controlloChiesto) return;
    controlloChiesto = false;
    dialog.showMessageBox(win, {
      type: 'info', buttons: ['Chiudi'], title: 'App Preventivi',
      message: 'Sei già all\'ultima versione.',
      detail: 'Versione installata: ' + app.getVersion(),
    });
  });

  /* Senza rete, o con GitHub irraggiungibile, non è successo niente di grave:
     si riproverà. Lo si dice solo a chi ha chiesto lui di controllare. */
  autoUpdater.on('error', (e) => {
    if (!controlloChiesto) return;
    controlloChiesto = false;
    dialog.showMessageBox(win, {
      type: 'warning', buttons: ['Chiudi'], title: 'App Preventivi',
      message: 'Non sono riuscito a controllare gli aggiornamenti.',
      detail: String((e && e.message) || e),
    });
  });

  cercaAggiornamenti();
  setInterval(cercaAggiornamenti, 6 * 60 * 60 * 1000);
}

function cercaAggiornamenti(chiestoDallUtente) {
  if (chiestoDallUtente) controlloChiesto = true;
  if (!app.isPackaged) {
    if (chiestoDallUtente) dialog.showMessageBox(win, {
      type: 'info', buttons: ['Chiudi'], title: 'App Preventivi',
      message: 'Gli aggiornamenti valgono per l\'app installata.',
      detail: 'Questa copia gira dai sorgenti, quindi non c\'è niente da aggiornare.',
    });
    return;
  }
  autoUpdater.checkForUpdates().catch(() => {});
}

/* -------------------------------------------------------------------------
   Cartella dei preventivi
   ------------------------------------------------------------------------- */
/* «maiScelta» serve al primo avvio: se nessuno ha mai scelto dove salvare,
   l'app lo chiede una volta invece di decidere da sola e basta. */
ipcMain.handle('cartella:info', () => ({ ...CARTELLA, maiScelta: !leggiConfig().cartella }));
ipcMain.handle('cartella:apri', async () => {
  try { fs.mkdirSync(CARTELLA.dir, { recursive: true }); } catch (_) {}
  await shell.openPath(CARTELLA.dir);
  return true;
});
ipcMain.handle('cartella:scegli', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Dove tenere preventivi, intestazioni e backup',
    defaultPath: CARTELLA.base,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const scelta = r.filePaths[0];
  if (!scrivibile(scelta))
    return { errore: 'In quella cartella non si può scrivere. Scegline un\'altra.' };
  const cfg = leggiConfig(); cfg.cartella = scelta; scriviConfig(cfg);
  CARTELLA = cartelleDa(scelta, false, true);
  annotaCartellaPerDisinstallazione();
  Menu.setApplicationMenu(buildMenu());
  return { ...CARTELLA };
});

/** torna alla cartella di partenza, accanto all'applicazione */
ipcMain.handle('cartella:predefinita', async () => {
  const cfg = leggiConfig(); delete cfg.cartella; scriviConfig(cfg);
  CARTELLA = calcolaCartella();
  annotaCartellaPerDisinstallazione();
  Menu.setApplicationMenu(buildMenu());
  return { ...CARTELLA };
});

/* -------------------------------------------------------------------------
   Backup: una copia datata di preventivi e intestazioni, dentro «Backup».
   Si copia, non si sposta: gli originali restano dove sono.
   ------------------------------------------------------------------------- */
const dueCifre = n => String(n).padStart(2, '0');
function nomeBackup() {
  const d = new Date();
  return `${d.getFullYear()}-${dueCifre(d.getMonth() + 1)}-${dueCifre(d.getDate())}` +
         `_${dueCifre(d.getHours())}-${dueCifre(d.getMinutes())}-${dueCifre(d.getSeconds())}`;
}
/* Quando i preventivi stanno direttamente nella cartella scelta dall'utente,
   «Intestazione» e «Backup» sono lì dentro insieme a loro: nel backup vanno
   saltate, o la copia dei preventivi si porterebbe dietro i backup di prima —
   cioè sé stessa, che a ogni giro raddoppia. */
const daSaltare = () => new Set(
  [CARTELLA.intestazioni, CARTELLA.backup].map(p => path.resolve(p).toLowerCase()));
const eSaltata = (salta, p) => salta.has(path.resolve(p).toLowerCase());

/* Copia il CONTENUTO di una cartella, saltando quello che non ci interessa.
   Non si usa fsp.cp sulla cartella intera: quando i preventivi stanno nella
   cartella base, la destinazione («Backup» dentro la stessa base) è dentro
   l'origine, e cp si rifiuta di partire — «cannot copy to a subdirectory of
   self» — anche se il filtro escluderebbe la destinazione. Voce per voce il
   problema non si pone: le cartelle da saltare non ci arrivano nemmeno. */
async function copiaDentro(sorgente, destinazione, salta) {
  await fsp.mkdir(destinazione, { recursive: true });
  for (const v of await fsp.readdir(sorgente, { withFileTypes: true })) {
    const p = path.join(sorgente, v.name);
    if (eSaltata(salta, p)) continue;
    await fsp.cp(p, path.join(destinazione, v.name), { recursive: true });
  }
}

async function contaFile(dir, salta = new Set()) {
  let n = 0;
  try {
    for (const v of await fsp.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, v.name);
      if (eSaltata(salta, p)) continue;
      if (v.isDirectory()) n += await contaFile(p, salta);
      else n++;
    }
  } catch (_) {}
  return n;
}

/* -------------------------------------------------------------------------
   Ogni preventivo ha la sua cartella, con dentro il file e i suoi backup:

     Preventivi\Cucina Rossi\Cucina Rossi.preventivo
     Preventivi\Cucina Rossi\Backup\Cucina Rossi 2026-08-17_21-30-00.preventivo

   Così i backup stanno accanto al preventivo a cui appartengono, e il tasto
   «Backup» porta esattamente lì invece che in un mucchio unico.
   ------------------------------------------------------------------------- */
const EST = 'preventivo';
const cartellaDiPreventivo = nome => path.join(CARTELLA.dir, nomeFileSicuro(nome));

ipcMain.handle('preventivo:cartella', async (_e, { nome } = {}) => {
  const pulito = nomeFileSicuro(nome);
  if (!pulito) return { errore: 'Serve un nome' };
  const cartella = cartellaDiPreventivo(pulito);
  const backup = path.join(cartella, CARTELLA_BACKUP);
  try {
    await fsp.mkdir(backup, { recursive: true });
    return { ok: true, nome: pulito, cartella, backup, file: path.join(cartella, pulito + '.' + EST) };
  } catch (e) { return { errore: e.message }; }
});

/** la cartella del preventivo aperto, aperta in Esplora file */
ipcMain.handle('preventivo:apriCartella', async (_e, { percorso, nome } = {}) => {
  const pulito = nomeFileSicuro(nome);
  /* senza percorso e senza nome non c'è nessuna cartella di preventivo: si
     tornerebbe indietro fino a quella generale, che non è quello che si chiede */
  if (!percorso && !pulito) return { errore: 'Il preventivo non ha ancora un nome' };
  const dir = percorso ? path.dirname(percorso) : cartellaDiPreventivo(pulito);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  await shell.openPath(dir);
  return { ok: true, cartella: dir };
});

/** la cartella dei backup del preventivo aperto, aperta in Esplora file */
ipcMain.handle('preventivo:apriBackup', async (_e, { percorso, nome } = {}) => {
  let dir = percorso ? path.join(path.dirname(percorso), CARTELLA_BACKUP)
                     : path.join(cartellaDiPreventivo(nome || ''), CARTELLA_BACKUP);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  await shell.openPath(dir);
  return dir;
});

/** una copia datata accanto al preventivo; ne tiene le ultime «tieni» */
ipcMain.handle('preventivo:backup', async (_e, { percorso, contenuto, tieni = 40 } = {}) => {
  try {
    if (!percorso) return { errore: 'Il preventivo non ha ancora un file' };
    const dir = path.join(path.dirname(percorso), CARTELLA_BACKUP);
    await fsp.mkdir(dir, { recursive: true });
    const base = path.basename(percorso).replace(/\.[^.]+$/, '');
    const file = path.join(dir, `${base} ${nomeBackup()}.${EST}`);
    await fsp.writeFile(file, contenuto, 'utf8');
    // le copie vecchie non servono a niente: si tengono le ultime
    const tutti = (await fsp.readdir(dir)).filter(f => f.endsWith('.' + EST)).sort();
    for (const v of tutti.slice(0, Math.max(0, tutti.length - tieni)))
      await fsp.unlink(path.join(dir, v)).catch(() => {});
    return { ok: true, percorso: file };
  } catch (e) { return { errore: e.message }; }
});

/* -------------------------------------------------------------------------
   I preventivi aperti di recente
   ------------------------------------------------------------------------- */
function ricordaRecente(percorso) {
  if (!percorso) return;
  const cfg = leggiConfig();
  const lista = (cfg.recenti || []).filter(p => p.toLowerCase() !== percorso.toLowerCase());
  lista.unshift(percorso);
  cfg.recenti = lista.slice(0, 10);
  scriviConfig(cfg);
  try { app.addRecentDocument(percorso); } catch (_) {}
}
ipcMain.handle('recenti:elenco', async () => {
  const lista = leggiConfig().recenti || [];
  const vivi = [];
  for (const p of lista) {
    try {
      const st = await fsp.stat(p);
      vivi.push({ percorso: p, nome: path.basename(p).replace(/\.[^.]+$/, ''),
                  cartella: path.dirname(p), quando: st.mtimeMs });
    } catch (_) { /* cancellato o spostato: sparisce dall'elenco */ }
  }
  if (vivi.length !== lista.length) {
    const cfg = leggiConfig(); cfg.recenti = vivi.map(v => v.percorso); scriviConfig(cfg);
  }
  return vivi;
});
ipcMain.handle('recenti:ricorda', (_e, { percorso }) => { ricordaRecente(percorso); return true; });
ipcMain.handle('recenti:svuota', () => { const c = leggiConfig(); c.recenti = []; scriviConfig(c); return true; });

ipcMain.handle('backup:crea', async () => {
  try {
    const dest = path.join(CARTELLA.backup, nomeBackup());
    await fsp.mkdir(dest, { recursive: true });
    let quanti = 0;
    for (const [sorgente, nome] of [[CARTELLA.dir, CARTELLA_SALVATAGGI], [CARTELLA.intestazioni, CARTELLA_INTESTAZIONI]]) {
      if (!fs.existsSync(sorgente)) continue;
      const salta = sorgente === CARTELLA.dir ? daSaltare() : new Set();
      const n = await contaFile(sorgente, salta);
      if (!n) continue;                       // una cartella vuota non si copia
      await copiaDentro(sorgente, path.join(dest, nome), salta);
      quanti += n;
    }
    if (!quanti) { await fsp.rm(dest, { recursive: true, force: true }); return { vuoto: true }; }
    return { ok: true, percorso: dest, file: quanti };
  } catch (e) { return { errore: e.message }; }
});

ipcMain.handle('backup:apri', async () => {
  try { fs.mkdirSync(CARTELLA.backup, { recursive: true }); } catch (_) {}
  await shell.openPath(CARTELLA.backup);
  return true;
});

ipcMain.handle('backup:elenco', async () => {
  try {
    const v = await fsp.readdir(CARTELLA.backup, { withFileTypes: true });
    return v.filter(x => x.isDirectory()).map(x => x.name).sort().reverse();
  } catch (_) { return []; }
});

/* -------------------------------------------------------------------------
   File
   ------------------------------------------------------------------------- */
const FILTRI = {
  preventivo: [{ name: 'Preventivo', extensions: ['preventivo', 'json'] }],
  json:       [{ name: 'Preventivo', extensions: ['preventivo', 'json'] }],
  pdf:        [{ name: 'Documento PDF', extensions: ['pdf'] }],
  xlsx:       [{ name: 'Cartella di lavoro di Excel', extensions: ['xlsx'] }],
};

ipcMain.handle('file:scegliSalva', async (_e, { nome, tipo } = {}) => {
  try { fs.mkdirSync(CARTELLA.dir, { recursive: true }); } catch (_) {}
  const r = await dialog.showSaveDialog(win, {
    title: 'Salva',
    defaultPath: path.join(CARTELLA.dir, nome || 'Preventivo'),
    filters: FILTRI[tipo] || FILTRI.preventivo,
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  });
  return r.canceled ? null : r.filePath;
});

ipcMain.handle('file:scegliApri', async () => {
  try { fs.mkdirSync(CARTELLA.dir, { recursive: true }); } catch (_) {}
  const r = await dialog.showOpenDialog(win, {
    title: 'Apri un preventivo',
    defaultPath: CARTELLA.dir,
    filters: FILTRI.preventivo,
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const percorso = r.filePaths[0];
  const contenuto = await fsp.readFile(percorso, 'utf8');
  ricordaRecente(percorso);
  return { percorso, contenuto: contenuto.replace(/^﻿/, '') };
});

/** apre un preventivo di cui si conosce già il percorso (elenco dei recenti) */
ipcMain.handle('file:apriPercorso', async (_e, { percorso }) => {
  try {
    const contenuto = await fsp.readFile(percorso, 'utf8');
    ricordaRecente(percorso);
    return { percorso, contenuto: contenuto.replace(/^﻿/, '') };
  } catch (e) { return { errore: e.message }; }
});

/* Importazione: si accettano sia i fogli Excel sia i preventivi salvati, e il
   file torna in byte grezzi — un .xlsx è compresso, leggerlo come testo lo
   rovinerebbe. Chi ha chiesto il file lo riconosce da sé dai primi byte. */
ipcMain.handle('file:scegliImporta', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Importa le voci',
    defaultPath: CARTELLA.dir,
    filters: [
      { name: 'Excel o preventivo', extensions: ['xlsx', 'json'] },
      { name: 'Cartella di lavoro di Excel', extensions: ['xlsx'] },
      { name: 'Preventivo', extensions: ['json'] },
    ],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const percorso = r.filePaths[0];
  return { percorso, dati: new Uint8Array(await fsp.readFile(percorso)) };
});

ipcMain.handle('file:scriviTesto', async (_e, { percorso, testo }) => {
  await fsp.mkdir(path.dirname(percorso), { recursive: true });
  await fsp.writeFile(percorso, testo, 'utf8');
  ricordaRecente(percorso);
  return true;
});
ipcMain.handle('file:scriviBinario', async (_e, { percorso, dati }) => {
  await fsp.mkdir(path.dirname(percorso), { recursive: true });
  await fsp.writeFile(percorso, Buffer.from(dati));
  return true;
});
ipcMain.handle('file:leggi', async (_e, { percorso }) => {
  const t = await fsp.readFile(percorso, 'utf8');
  return t.replace(/^﻿/, '');
});
ipcMain.handle('file:apri', async (_e, { percorso }) => shell.openPath(percorso));

/* -------------------------------------------------------------------------
   Intestazioni salvate — cartella «Intestazione»
   Un file .html per ognuna, con il nome che le ha dato l'utente. «Predefinita»
   è quella con cui parte ogni preventivo nuovo.
   ------------------------------------------------------------------------- */
ipcMain.handle('intest:cartella', () => CARTELLA.intestazioni);
ipcMain.handle('intest:apriCartella', async () => {
  try { fs.mkdirSync(CARTELLA.intestazioni, { recursive: true }); } catch (_) {}
  await shell.openPath(CARTELLA.intestazioni);
  return true;
});
ipcMain.handle('intest:elenco', async () => {
  try {
    const file = await fsp.readdir(CARTELLA.intestazioni);
    return file.filter(f => f.toLowerCase().endsWith('.html'))
      .map(f => f.slice(0, -5))
      .sort((a, b) => a.localeCompare(b, 'it'));
  } catch (_) { return []; }
});
ipcMain.handle('intest:leggi', async (_e, { nome }) => {
  try { return await fsp.readFile(percorsoIntestazione(nome), 'utf8'); } catch (_) { return null; }
});
ipcMain.handle('intest:scrivi', async (_e, { nome, html }) => {
  const pulito = nomeFileSicuro(nome);
  if (!pulito) return { errore: 'Serve un nome' };
  await fsp.mkdir(CARTELLA.intestazioni, { recursive: true });
  await fsp.writeFile(percorsoIntestazione(pulito), String(html || ''), 'utf8');
  return { ok: true, nome: pulito };
});
ipcMain.handle('intest:elimina', async (_e, { nome }) => {
  try { await fsp.unlink(percorsoIntestazione(nome)); return { ok: true }; }
  catch (e) { return { errore: e.message }; }
});
ipcMain.handle('intest:predefLeggi', async () => {
  try { return await fsp.readFile(path.join(CARTELLA.intestazioni, FILE_PREDEFINITA), 'utf8'); }
  catch (_) { return null; }
});
ipcMain.handle('intest:predefScrivi', async (_e, { html }) => {
  await fsp.mkdir(CARTELLA.intestazioni, { recursive: true });
  await fsp.writeFile(path.join(CARTELLA.intestazioni, FILE_PREDEFINITA), String(html || ''), 'utf8');
  return { ok: true };
});

/* -------------------------------------------------------------------------
   Stampa e PDF
   La pagina ha già costruito il foglio e scritto la regola @page: qui basta
   dire a Chromium di rispettarla («preferCSSPageSize»), così il verticale e
   l'orizzontale scelti nell'app sono quelli che escono davvero.
   Gli sfondi non si stampano: nero su bianco, la cartuccia dura.
   ------------------------------------------------------------------------- */
/* Nei margini del foglio ci scrive il motore di stampa, non la pagina: qui gli
   si dice cosa metterci. Solo il nome del file in alto a destra e il numero di
   pagina in basso — niente data, niente nome dell'applicazione, niente
   indirizzo del file. */
const escHtml = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const STILE_MARGINE = 'width:100%;margin:0;padding:0 11mm;font-family:Arial,Helvetica,sans-serif;font-size:8px;color:#555;';
const intestazioneStampa = titolo =>
  `<div style="${STILE_MARGINE}"><div style="text-align:right">${escHtml(titolo)}</div></div>`;
const pieStampa = () =>
  `<div style="${STILE_MARGINE}"><div style="text-align:right"><span class="pageNumber"></span>/<span class="totalPages"></span></div></div>`;

ipcMain.handle('stampa:carta', async (_e, { orizzontale, titolo } = {}) => {
  return new Promise(resolve => {
    if (!win || win.isDestroyed()) return resolve({ errore: 'finestra chiusa' });
    win.webContents.print(
      {
        silent: false, printBackground: false, pageSize: 'A4',
        landscape: !!orizzontale, margins: { marginType: 'default' },
        /* Con la stampa su carta si può solo sostituire il testo, non spostarlo:
           al posto del nome dell'applicazione va il nome del file, e al posto
           dell'indirizzo non va niente. */
        header: String(titolo || ' '),
        footer: ' ',
      },
      (ok, motivo) => resolve(ok ? { ok: true } : { errore: motivo === 'cancelled' ? null : (motivo || 'annullata') })
    );
  });
});

/* Anteprima: il foglio si vede prima di stamparlo. Si genera lo stesso identico
   PDF dell'esportazione e lo si apre nel visualizzatore di Chromium, che è già
   dentro l'app: da lì si guarda, si stampa e si salva su file senza passare da
   «Microsoft Print to PDF». */
let winAnteprima = null;

ipcMain.handle('stampa:anteprima', async (_e, { orizzontale, titolo } = {}) => {
  try {
    const dati = await win.webContents.printToPDF({
      pageSize: 'A4', landscape: !!orizzontale, printBackground: false,
      preferCSSPageSize: true, generateDocumentOutline: false,
      displayHeaderFooter: true,
      headerTemplate: intestazioneStampa(titolo),
      footerTemplate: pieStampa(),
    });

    // il file precedente potrebbe essere ancora aperto: prima si chiude
    if (winAnteprima && !winAnteprima.isDestroyed()) { winAnteprima.destroy(); winAnteprima = null; }
    const file = path.join(app.getPath('temp'), 'App Preventivi - anteprima.pdf');
    await fsp.writeFile(file, dati);

    /* La finestra va larga quanto serve perché il foglio ci stia INTERO al 100%:
       un A4 verticale è 794 pixel, uno orizzontale 1123, e alla sua sinistra il
       visualizzatore tiene la striscia delle miniature, che da sola si prende
       poco più di 300 pixel. Con la vecchia misura fissa di 1000 il foglio
       usciva a destra e compariva la barra di scorrimento orizzontale. */
    const wa = currentDisplay().workArea;
    const FOGLIO = orizzontale ? 1123 : 794;   // A4 al 100%, in pixel CSS
    const MINIATURE = 340;                     // striscia laterale + barra di scorrimento
    winAnteprima = new BrowserWindow({
      width: Math.min(FOGLIO + MINIATURE, wa.width - 40),
      height: Math.min(1180, wa.height - 60),
      title: 'Anteprima di stampa' + (titolo ? ' — ' + titolo : ''),
      autoHideMenuBar: true,
      backgroundColor: '#525659',
      /* NIENTE sessione separata: il visualizzatore PDF di Chromium vive solo
         nella sessione predefinita, e con una «partition» il file non si
         caricava per niente — la finestra restava vuota. Lo zoom si rimette a
         posto dopo, che è meno elegante ma funziona. */
      webPreferences: { plugins: true, contextIsolation: true, sandbox: false, zoomFactor: 1 },
    });
    winAnteprima.setMenuBarVisibility(false);
    // il visualizzatore vorrebbe rinominare la finestra col nome del file
    winAnteprima.on('page-title-updated', e => e.preventDefault());
    /* La percentuale scritta nella barra dell'anteprima è lo zoom del
       visualizzatore: 100% a finestra, 116% a schermo intero, dove il foglio ha
       spazio per essere un po' più grande. Glielo si chiede con «#zoom=…», che
       legge all'apertura del file; il cambio richiede una ricarica, perché il
       solo frammento non lo smuove.
       Chromium però ricorda lo zoom per ORIGINE, e l'app gira sullo stesso
       «file://»: senza rimetterlo a mano l'anteprima si riapriva all'85% di
       prima. Lo si riafferma dopo il caricamento, quando il visualizzatore ha
       finito di applicare il suo. */
    const base = 'file:///' + file.replace(/\\/g, '/');
    const ZOOM_FINESTRA = 100, ZOOM_INTERO = 116;
    let zoomChiesto = ZOOM_FINESTRA;

    const riafferma = () => {
      if (!winAnteprima || winAnteprima.isDestroyed()) return;
      try { winAnteprima.webContents.setZoomFactor(zoomChiesto / 100); } catch (_) {}
    };
    winAnteprima.webContents.on('dom-ready', riafferma);
    winAnteprima.webContents.on('did-finish-load', riafferma);
    winAnteprima.webContents.on('did-frame-finish-load', riafferma);
    for (const ms of [150, 500, 1200]) setTimeout(riafferma, ms);

    const zoomDovuto = () =>
      (winAnteprima.isFullScreen() || winAnteprima.isMaximized()) ? ZOOM_INTERO : ZOOM_FINESTRA;

    const applicaZoom = async () => {
      if (!winAnteprima || winAnteprima.isDestroyed()) return;
      const perc = zoomDovuto();
      zoomChiesto = perc;
      try {
        /* Cambiare il solo frammento è una navigazione «nella stessa pagina»:
           il visualizzatore non se ne accorge. Si ricarica, ed è lì che rilegge
           la percentuale — anche se nel frattempo era stata cambiata a mano. */
        await winAnteprima.webContents.loadURL(base + '#zoom=' + perc);
        if (!winAnteprima || winAnteprima.isDestroyed()) return;
        winAnteprima.webContents.reload();
      } catch (_) {}
      for (const ms of [200, 700]) setTimeout(riafferma, ms);
    };
    /* Gli eventi arrivano mentre la finestra si sta ancora ridimensionando:
       si aspetta che abbia finito, altrimenti si ricarica sulla misura vecchia. */
    const suCambioStato = () => setTimeout(applicaZoom, 250);
    for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'])
      winAnteprima.on(ev, suCambioStato);

    winAnteprima.on('closed', () => { winAnteprima = null; });

    await winAnteprima.loadURL(base + '#zoom=' + zoomChiesto);
    azzera();
    return { ok: true };
  } catch (e) { return { errore: e.message }; }
});

ipcMain.handle('stampa:pdf', async (_e, { orizzontale, percorso, titolo } = {}) => {
  try {
    const dati = await win.webContents.printToPDF({
      pageSize: 'A4',
      landscape: !!orizzontale,
      printBackground: false,
      preferCSSPageSize: true,
      generateDocumentOutline: false,
      displayHeaderFooter: true,
      headerTemplate: intestazioneStampa(titolo),
      footerTemplate: pieStampa(),
    });
    await fsp.mkdir(path.dirname(percorso), { recursive: true });
    await fsp.writeFile(percorso, dati);
    return { ok: true, percorso };
  } catch (e) {
    return { errore: e.message };
  }
});

/* -------------------------------------------------------------------------
   Interfaccia
   ------------------------------------------------------------------------- */
ipcMain.handle('ui:zoomGet', () => {
  const d = currentDisplay();
  return {
    uiZoom, zoomMode, auto: autoZoomFor(d),
    schermo: {
      logico: `${d.workArea.width}×${d.workArea.height}`,
      fisico: `${Math.round(d.bounds.width * d.scaleFactor)}×${Math.round(d.bounds.height * d.scaleFactor)}`,
      scala: d.scaleFactor,
    },
  };
});
ipcMain.handle('ui:zoomSet', (_e, { uiZoom: z, mode } = {}) => {
  if (mode === 'auto') { zoomMode = 'auto'; applyUiZoom(autoZoomFor(currentDisplay()), { fromAuto: true }); }
  else if (z != null) applyUiZoom(z);
  return { uiZoom, zoomMode };
});
/* -------------------------------------------------------------------------
   Menu del tasto destro.
   I comandi degli appunti li mette il sistema (una pagina web non può
   incollare da sola), quelli dell'app li aggiunge la pagina dicendo su che
   cosa si è premuto.
   ------------------------------------------------------------------------- */
ipcMain.handle('menu:contestuale', (e, ctx = {}) => {
  const manda = (azione) => win && !win.isDestroyed() && win.webContents.send('menu:azione', { azione, id: ctx.id });
  const voci = [];

  if (ctx.tipo === 'tab') {
    voci.push({ label: 'Duplica la sezione', click: () => manda('duplicaTab') });
    voci.push({ label: 'Rinomina…', click: () => manda('rinominaTab') });
    voci.push({ label: 'Elimina la sezione', click: () => manda('eliminaTab') });
  } else if (ctx.tipo === 'riga') {
    voci.push({ label: 'Duplica Riga', click: () => manda('duplicaRiga') });
    voci.push({ label: 'Copia Riga', click: () => manda('copiaRiga') });
    /* «Incolla Riga» compare solo se c'è qualcosa da incollare: se lo sa la
       pagina, che tiene la riga copiata, e ce lo dice insieme al resto. */
    if (ctx.copiato) voci.push({ label: 'Incolla Riga', click: () => manda('incollaRiga') });
    voci.push({ label: ctx.barrato ? 'Togli la barratura' : 'Promo', click: () => manda('promo') });
    voci.push({ label: 'Elimina la riga', click: () => manda('eliminaRiga') });
  }

  // i comandi di Windows: sempre, così su un campo si può sempre incollare
  if (voci.length) voci.push({ type: 'separator' });
  voci.push(
    { role: 'cut', label: 'Taglia' },
    { role: 'copy', label: 'Copia' },
    { role: 'paste', label: 'Incolla' },
    { type: 'separator' },
    { role: 'selectAll', label: 'Seleziona tutto' },
  );

  Menu.buildFromTemplate(voci).popup({ window: win });
  return true;
});

ipcMain.on('stato:modificato', (_e, v) => { lavoroDaSalvare = !!v; });
/* la pagina ha finito di salvare: adesso si può chiudere davvero */
ipcMain.on('chiusura:procedi', () => {
  chiusuraConfermata = true;
  if (win && !win.isDestroyed()) win.close();
});

ipcMain.handle('app:info', () => ({
  versione: app.getVersion(),
  cartella: CARTELLA.dir,
  electron: process.versions.electron,
}));

/* -------------------------------------------------------------------------
   Ciclo di vita
   ------------------------------------------------------------------------- */
/* Un preventivo aperto con un doppio clic (anche un backup) arriva come
   parametro sulla riga di comando: lo si passa alla pagina appena è pronta. */
function fileDaRiga(argv) {
  const v = (argv || []).slice(1).find(a => /\.(preventivo|json)$/i.test(a) && fs.existsSync(a));
  return v || null;
}
let fileDaAprire = fileDaRiga(process.argv);

/* Un'altra finestra dell'app, eventualmente con dentro un preventivo. Si
   riavvia l'eseguibile: in sviluppo davanti va il percorso del progetto, che
   quando l'app è impacchettata è già dentro l'eseguibile. */
ipcMain.handle('app:nuovaIstanza', (_e, { percorso } = {}) => {
  try {
    const argomenti = app.isPackaged ? [] : [app.getAppPath()];
    if (percorso) argomenti.push(percorso);
    const figlio = spawn(process.execPath, argomenti, { detached: true, stdio: 'ignore' });
    figlio.unref();
    return { ok: true };
  } catch (e) { return { errore: e.message }; }
});

ipcMain.handle('avvio:fileDaAprire', async () => {
  if (!fileDaAprire) return null;
  const p = fileDaAprire; fileDaAprire = null;
  try {
    const contenuto = await fsp.readFile(p, 'utf8');
    ricordaRecente(p);
    return { percorso: p, contenuto: contenuto.replace(/^﻿/, '') };
  } catch (_) { return null; }
});

/* L'app si apre quante volte si vuole, e ogni finestra lavora per conto suo:
   capita di tenere aperto un preventivo mentre se ne guarda un altro, e prima
   la seconda apertura si limitava a riportare in primo piano la prima.
   Le finestre condividono solo la cartella dei salvataggi e le preferenze,
   che si scrivono di rado; il preventivo aperto, quello no: è di chi lo tiene. */
{
  app.whenReady().then(() => {
    annotaCartellaPerDisinstallazione();
    createWindow();
    preparaAggiornamenti();   // la finestra c'è: se serve dire qualcosa, c'è dove dirlo
    screen.on('display-metrics-changed', onDisplaysChanged);
    screen.on('display-added', onDisplaysChanged);
    screen.on('display-removed', onDisplaysChanged);
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
