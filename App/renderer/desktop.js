"use strict";
/* ==============================================================================
   Versione desktop: qui IO smette di scaricare file dal browser e comincia a
   scrivere davvero su disco, nella cartella «Preventivi».
   Gira solo dentro Electron: nella pagina HTML da sola questo file non c'è.
   ============================================================================== */
if (window.preventivi && window.preventivi.isDesktop) (function () {
  const P = window.preventivi;

  /* ---------------------------------------------------------------
     Salvataggi e aperture
     --------------------------------------------------------------- */
  IO.desktop = true;

  IO.salva = async function (testo, { percorso, nome }) {
    let dove = percorso;
    if (!dove) {
      dove = await P.scegliSalva(nome, 'preventivo');
      if (!dove) return null;
    }
    await P.scriviTesto(dove, testo);
    return dove;
  };

  IO.apri = async function () {
    const f = await P.scegliApri();
    if (!f) return null;
    return { percorso: f.percorso, contenuto: f.contenuto };
  };

  IO.importa = async function () {
    const f = await P.scegliImporta();
    if (!f) return null;
    return { percorso: f.percorso, dati: f.dati };
  };

  IO.salvaBinario = async function (nome, dati, tipo) {
    const est = (nome.split('.').pop() || '').toLowerCase();
    const dove = await P.scegliSalva(nome, est);
    if (!dove) return false;
    await P.scriviBinario(dove, dati);
    apriDopo(dove);
    return dove;
  };

  /* ---------------------------------------------------------------
     Intestazioni: file veri nella cartella «Intestazione»
     --------------------------------------------------------------- */
  IO.intestElenco       = () => P.intestElenco();
  IO.intestLeggi        = (nome) => P.intestLeggi(nome);
  IO.intestScrivi       = (nome, html) => P.intestScrivi(nome, html);
  IO.intestElimina      = (nome) => P.intestElimina(nome);
  IO.intestApriCartella = () => P.intestApriCartella();

  /* Cartella dei salvataggi e backup: qui sono cartelle vere su disco */
  IO.cartellaInfo        = () => P.cartella();
  IO.cartellaScegli      = () => P.scegliCartella();
  IO.cartellaPredefinita = () => P.cartellaPredefinita();
  IO.cartellaApri        = () => P.apriCartella();
  IO.backupCrea          = () => P.backupCrea();
  IO.backupApri          = () => P.backupApri();
  IO.backupElenco        = () => P.backupElenco();

  /* Menu del tasto destro: lo disegna Windows, l'azione torna qui */
  IO.menuContestuale = (ctx) => P.menuContestuale(ctx);
  P.onAzioneMenu(({ azione, id }) => eseguiAzioneMenu(azione, id));

  /* Cartella del singolo preventivo, suoi backup, e i recenti */
  IO.apriPercorso         = (p) => P.apriPercorso(p);
  IO.preventivoCartella   = (nome) => P.preventivoCartella(nome);
  IO.preventivoApriCartella = (o) => P.preventivoApriCartella(o);
  IO.preventivoApriBackup = (o) => P.preventivoApriBackup(o);
  IO.preventivoBackup     = (o) => P.preventivoBackup(o);
  IO.recentiElenco        = () => P.recentiElenco();
  IO.recentiSvuota        = () => P.recentiSvuota();
  IO.fileDaAprire         = () => P.fileDaAprire();

  // doppio clic su un preventivo mentre l'app è già aperta
  P.onApriQuesto((percorso) => apriDaPercorso(percorso));
  IO.predefLeggi        = () => P.predefLeggi();
  IO.predefScrivi       = (html) => P.predefScrivi(html);

  IO.anteprima = ({ orizzontale, titolo }) => P.anteprima({ orizzontale, titolo });

  /* Chiusura con la X: il processo principale ha chiesto, l'utente ha detto di
     salvare. Si salva e gli si ridà la parola. */
  IO.statoModificato = (v) => P.statoModificato(v);
  P.onChiusuraSalva(async () => {
    try { await salvaPreventivo(false); } catch (_) {}
    P.chiusuraProcedi();
  });

  IO.stampa = async function ({ orizzontale, titolo }) {
    const r = await P.stampa({ orizzontale, titolo });
    if (r && r.errore) toast('Stampa non riuscita: ' + r.errore, 'err');
  };

  IO.pdf = async function ({ orizzontale, nome, titolo }) {
    const dove = await P.scegliSalva(nome, 'pdf');
    if (!dove) return false;
    const r = await P.pdf({ orizzontale, percorso: dove, titolo });
    if (r && r.errore) { toast('PDF non riuscito: ' + r.errore, 'err'); return false; }
    toast('PDF creato', 'ok');
    apriDopo(dove);
    return dove;
  };

  /** un file appena esportato si apre volentieri: il pulsante resta lì un attimo */
  function apriDopo(percorso) {
    const nome = percorso.split(/[\\/]/).pop();
    toast(nome, 'ok', { label: 'Apri', fn: () => P.apriFile(percorso) });
  }

  /* ---------------------------------------------------------------
     Pulsanti in più nella testata: la cartella dei preventivi e lo zoom
     --------------------------------------------------------------- */
  function testataDesktop() {
    const testata = document.querySelector('header.app');
    const primo = document.querySelector('#btnTema');

    // il pulsante «Cartella» sta già al centro della testata (index.html)
    const zoom = document.createElement('div');
    zoom.className = 'segbtns';
    zoom.style.marginLeft = '4px';
    zoom.innerHTML = `<button id="zMeno" title="Interfaccia più piccola (Ctrl+-)">−</button>
      <button id="zAuto" title="Dimensione automatica (Ctrl+0)"><span id="zVal">100%</span></button>
      <button id="zPiu" title="Interfaccia più grande (Ctrl++)">+</button>`;
    testata.insertBefore(zoom, primo);

    let stato = { uiZoom: 1 };
    const mostra = z => { stato = z; const v = document.querySelector('#zVal'); if (v) v.textContent = Math.round(z.uiZoom * 100) + '%'; };
    document.querySelector('#zMeno').onclick = () => P.zoomSet({ uiZoom: stato.uiZoom - 0.1 });
    document.querySelector('#zPiu').onclick = () => P.zoomSet({ uiZoom: stato.uiZoom + 0.1 });
    document.querySelector('#zAuto').onclick = () => P.zoomSet({ mode: 'auto' });
    P.onZoom(mostra);
    P.zoomGet().then(mostra);
  }

  /* ---------------------------------------------------------------
     Menu della finestra
     --------------------------------------------------------------- */
  function legaMenu() {
    P.onMenu(azione => {
      if (azione === 'nuovo') nuovoPreventivo();
      if (azione === 'apri') apriPreventivo();
      if (azione === 'importa') importaVoci();
      if (azione === 'salva') salvaPreventivo(false);
      if (azione === 'salvaCome') salvaPreventivo(true);
      if (azione === 'anteprima') anteprimaStampa();
      if (azione === 'stampa') stampa();
      if (azione === 'pdf') esportaPDF();
      if (azione === 'excel') esportaExcel();
      if (azione === 'intestazione') dialogoIntestazione();
      if (azione === 'cliente') dialogoCliente();
      if (azione === 'aspetto') dialogoAspetto();
    });
  }

  /* ---------------------------------------------------------------
     Avvio
     --------------------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', () => {
    avvia();
    testataDesktop();
    legaMenu();
    P.cartella().then(c => {
      if (c && c.ripiego) {
        toast('Accanto all\'app non si può scrivere: i file vanno in ' + c.base, 'err');
      }
    });
  });
})();
