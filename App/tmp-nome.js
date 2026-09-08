const fs = require('fs');
const LF = String.fromCharCode(10), CRLF = String.fromCharCode(13, 10);
const patch = (file, coppie, crlf) => {
  let s = fs.readFileSync(file, 'utf8');
  for (let [a, b] of coppie) {
    if (crlf) { a = a.split(LF).join(CRLF); b = b.split(LF).join(CRLF); }
    if (!s.includes(a)) { console.error('NON TROVATO in ' + file + ':\n' + a.slice(0, 150)); process.exit(1); }
    s = s.replace(a, () => b);
  }
  fs.writeFileSync(file, s);
  console.log(file + ' ok');
};

patch('renderer/core.js', [
  /* il nome dell'app diventa il titolo della finestra, a sinistra */
  [`function dialogoAvvio(){
  modal('',`, `function dialogoAvvio(){
  modal('App Preventivi',`],
  [`  null,'conx nomeapp');`, `  null,'conx');`],
  /* e il meccanismo che lo scriveva a destra non serve più */
  [`  /* «nomeapp» scrive «App Preventivi» in alto a destra, prima della crocetta:
     serve alla finestra che si apre per prima, che altrimenti non direbbe
     nemmeno di che programma è. */
  const conNome = /\bnomeapp\b/.test(cls||'');
  m.innerHTML=\`<h3><span>\${esc(titolo)}</span>\${conNome?\`<span class="nomeapp">App Preventivi</span>\`:''}\${conX?\`<button class="chiudix" title="Chiudi">×</button>\`:''}</h3>`,
   `  m.innerHTML=\`<h3><span>\${esc(titolo)}</span>\${conX?\`<button class="chiudix" title="Chiudi">×</button>\`:''}</h3>`],
], true);

patch('renderer/styles.css', [
  [`/* il nome dell'app, accanto alla crocetta, nella finestra che si apre per prima */
.modal h3 .nomeapp{
  margin-left:auto;font-size:12.5px;font-weight:600;color:var(--ink-3);
  letter-spacing:.02em;white-space:nowrap;
}
.modal h3 .nomeapp + .chiudix{margin-left:0}
`, ``],
]);
