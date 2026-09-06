'use strict';
/* ==============================================================================
   Costruisce «preventivi.html»: la stessa app in un file solo, che si apre con
   un doppio clic in qualsiasi browser, senza installare niente.

   La sorgente resta una: App\renderer. Qui si limita a incollare dentro il
   foglio di stile e il codice, e a togliere i richiami ai file esterni (che in
   un file singolo non esisterebbero più).

       node crea-standalone.js          oppure     npm run html
   ============================================================================== */
const fs = require('fs');
const path = require('path');

const R = path.join(__dirname, 'renderer');
const USCITA = path.join(path.dirname(__dirname), 'preventivi.html');

const leggi = f => fs.readFileSync(path.join(R, f), 'utf8');

let html = leggi('index.html');
const css = leggi('styles.css');
const core = leggi('core.js');

/* Il criterio di sicurezza dei contenuti vieta il codice scritto dentro la
   pagina: in un file unico il codice è tutto lì dentro, quindi va tolto.
   Il file gira in locale, non carica niente da fuori. */
html = html.replace(/\s*<meta http-equiv="Content-Security-Policy"[\s\S]*?>\n?/, '\n');

/* Il testo da incollare si passa SEMPRE come funzione.
   Se lo si desse come stringa, replace() ci leggerebbe dentro i suoi segnali:
   «$$» diventerebbe «$», e `const $$ = …` di core.js si trasformerebbe in un
   secondo `const $ = …`. Il file veniva fuori con un errore di sintassi e
   l'app non partiva: un guasto che si vede solo aprendo il file finito. */
const incolla = (dove, cosa) => { html = html.replace(dove, () => cosa); };

incolla('<link rel="stylesheet" href="styles.css">', '<style>\n' + css + '\n</style>');
incolla(/\s*<script src="boot\.js"><\/script>/, '');
incolla(/\s*<script src="desktop\.js"><\/script>/, '');
incolla('<script src="core.js"></script>', '<script>\n' + core + '\n</script>');

/* nel file singolo non c'è nessun guscio Electron: l'app parte da sola */
incolla('<body>', '<body>\n<script>window.__DESKTOP__ = false;</script>');

/* Controllo prima di scrivere: stile e codice devono essere finiti dentro
   parola per parola. Meglio fermarsi qui che consegnare un file rotto. */
for (const [nome, testo] of [['styles.css', css], ['core.js', core]]) {
  if (!html.includes(testo)) {
    console.error('ERRORE: ' + nome + ' non è stato incollato integralmente. File non scritto.');
    process.exit(1);
  }
}

fs.writeFileSync(USCITA, html, 'utf8');
console.log('Creato: ' + USCITA + '  (' + Math.round(html.length / 1024) + ' KB)');
