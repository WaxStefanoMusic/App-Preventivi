"use strict";
/* ==============================================================================
   App Preventivi — logica dell'interfaccia
   Funziona sia come pagina HTML da sola sia dentro il guscio Electron:
   quello che cambia (dove si salva, come si stampa) sta tutto in IO, che
   desktop.js sostituisce con le proprie versioni.
   ============================================================================== */

/* ==============================================================================
   0. UTILITÀ
   ============================================================================== */
const $  = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];
const uid = ()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));

/** importi: due decimali, punto per le migliaia e virgola per i centesimi */
const fmtNum = n => new Intl.NumberFormat('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2}).format(+n||0);
/** quantità: i decimali si scrivono solo se ci sono davvero */
const fmtQty = n => new Intl.NumberFormat('it-IT',{minimumFractionDigits:0,maximumFractionDigits:3}).format(+n||0);
/* La colonna Totale porta l'euro accanto alla cifra. Lo spazio è unificatore:
   l'euro non deve mai finire a capo, staccato dal suo numero. */
const fmtEur = n => fmtNum(n)+' €';

/* Un numero scritto a mano arriva in tutti i modi: «1.234,56», «1234.56»,
   «1 234,56», con o senza l'euro davanti. Vengono letti tutti allo stesso modo,
   perché un preventivo non è il posto in cui litigare con la punteggiatura. */
function numIT(v){
  if(typeof v==='number') return isFinite(v)?v:0;
  let s=String(v??'').trim().replace(/[€\s ]/g,'');
  if(!s) return 0;
  if(s.includes(',')){                       // la virgola, se c'è, è il decimale
    s=s.replace(/\./g,'').replace(',','.');
  }else if(/^-?\d{1,3}(\.\d{3})+$/.test(s)){ // «1.234» senza virgola: punti di migliaia
    s=s.replace(/\./g,'');
  }
  const n=parseFloat(s);
  return isFinite(n)?n:0;
}
/** arrotondamento a due decimali senza le sorprese della virgola mobile */
const cent = n => Math.round((+n||0)*100)/100;

function toast(msg,kind='',azione){
  const t=document.createElement('div');
  t.className='toast '+kind;
  t.innerHTML=`<span>${esc(msg)}</span>`;
  if(azione){
    const b=document.createElement('button');
    b.textContent=azione.label;
    b.onclick=()=>{ azione.fn(); t.remove(); };
    t.appendChild(b);
  }
  $('#toasts').appendChild(t);
  const durata = azione ? 14000 : (kind==='err'?5200:3000);
  setTimeout(()=>{t.style.opacity='0';t.style.transition='opacity .3s';setTimeout(()=>t.remove(),300);},durata);
}

/* ==============================================================================
   1. STATO
   ============================================================================== */
const CHIAVE_BOZZA='preventivi:bozza';
const CHIAVE_INTEST='preventivi:intestazione';
const CHIAVE_OPZ='preventivi:opzioni';

const ID_TOT='tot';

/* Un preventivo nuovo è vuoto: nessun articolo, nessun cliente, nessuna data.
   L'unica cosa che sopravvive è l'intestazione, che è sempre la stessa. */
const NUOVO = () => ({
  v:1,
  tabs:[
    {id:ID_TOT, type:'tot',  name:'PREVENTIVO COMPLESSIVO', icon:'Σ'},
    {id:'s'+uid(), type:'voci', name:'Preventivo', icon:'📄'},
  ],
  /* Nome del preventivo: quello che si legge in alto e che viene proposto
     quando si salva o si esporta. */
  nome:'',
  righe:[],                                   // {id,tabId,articolo,descrizione,prezzo,qta,iva}
  cliente:{nome:'',indirizzo:'',cell:'',mail:''},
  data:'',
  /* Prezzo concordato: null quando non c'è. Quando c'è è una tabella con una
     voce per ogni TAB — il complessivo e ogni sezione — perché il prezzo
     pattuito sul totale va ripartito fra le sezioni. */
  concordati:null,
  /* Acconti: le due scadenze di pagamento che si usano quasi sempre. La
     percentuale è quella che comanda, l'importo si ricava da lì. */
  acconti:[
    {id:uid(), nome:"ACCONTO ALLA CONFERMA D'ORDINE", perc:'50'},
    {id:uid(), nome:'RIMANENTE A LAVORI CONCLUSI',    perc:'50'},
  ],
  /* Complessivo semplificato: al posto di tutte le voci, una riga per
     sezione. È una scelta di QUESTO preventivo, quindi va nel file. */
  semplificato:false,
  /* Sezioni tenute FUORI dal complessivo. Restano dove sono, con i loro
     articoli e i loro totali: è il complessivo che non le conta — serve quando
     una sezione è un'alternativa, o un lavoro da quotare a parte. */
  escluse:[],
  active:null,                                // impostato subito dopo
});

let S = NUOVO();
S.active = S.tabs[1].id;

/* Due intestazioni, non una.
   INTEST è quella di QUESTO preventivo: viaggia dentro il file salvato.
   INTEST_PREDEF è quella con cui parte ogni preventivo NUOVO: sta nella
   cartella «Intestazione», nel file «Predefinita.html», e non cambia se si
   ritocca l'intestazione di un preventivo soltanto. */
let INTEST = '';
let INTEST_PREDEF = '';
/** preferenze dell'interfaccia, non del singolo preventivo */
/* zoom 0 = automatico; ambito = che cosa finisce in stampa e nelle esportazioni:
   «tutte», «tab» (solo quella aperta) o «scelte», e allora valgono le sezioni
   segnate in OPZ.scelte */
let OPZ = { theme:'light', orizzontale:false, zoom:0, ambito:'tab', scelte:[], totInFondo:false };

/** percorso del file aperto e se ci sono modifiche non salvate */
let filePath = null, modificato = false;

const tabById = id => S.tabs.find(t=>t.id===id);
const tabCorrente = () => tabById(S.active) || S.tabs[0];
const tabVoci = () => S.tabs.filter(t=>t.type==='voci');
/* Le sezioni che compongono il complessivo: tutte, meno quelle messe da parte
   dal menu «Sezioni nel Preventivo Complessivo». */
const esclusaDalTotale = id => Array.isArray(S.escluse) && S.escluse.includes(id);
const tabNelTotale = () => tabVoci().filter(t=>!esclusaDalTotale(t.id));
/** le righe del tab: quello complessivo le mostra tutte, in ordine di sezione */
function righeDi(tabId){
  if(tabId===ID_TOT){
    const ordine=new Map(S.tabs.map((t,i)=>[t.id,i]));
    return S.righe.filter(r=>!esclusaDalTotale(r.tabId))
                  .sort((a,b)=>(ordine.get(a.tabId)??99)-(ordine.get(b.tabId)??99));
  }
  return S.righe.filter(r=>r.tabId===tabId);
}
const rigaById = id => S.righe.find(r=>r.id===id);

let timerBozza=null;
function tocca(){
  modificato=true;
  aggiornaTitolo();
  IO.statoModificato?.(true);
  clearTimeout(timerBozza);
  timerBozza=setTimeout(()=>{
    try{ localStorage.setItem(CHIAVE_BOZZA, JSON.stringify(S)); }catch(_){}
  },300);
}
/** rende l'intestazione data quella predefinita, da qui in avanti */
async function salvaPredefinita(html){
  INTEST_PREDEF = html || '';
  try{ localStorage.setItem(CHIAVE_INTEST, INTEST_PREDEF); }catch(_){}
  try{ await IO.predefScrivi(INTEST_PREDEF); }catch(_){}
}
function salvaOpzioni(){
  try{ localStorage.setItem(CHIAVE_OPZ, JSON.stringify(OPZ)); }catch(_){}
}
/** un documento è «vuoto» se non c'è niente da perdere */
function documentoVuoto(d){
  if(!d) return true;
  if(d.nome) return false;                    // un nome dato a mano è già lavoro
  if((d.righe||[]).some(r=>r.articolo||r.descrizione||numIT(r.prezzo)||numIT(r.qta)!==1)) return false;
  if((d.righe||[]).length>1) return false;
  const c=d.cliente||{};
  return !c.nome && !c.indirizzo && !c.cell && !c.mail && !d.data;
}

/* ==============================================================================
   2. DATA — si scrive di seguito, i trattini li mette l'app
   Digitando 10082026 esce 10-08-2026: nessun trattino, nessuna barra da inserire.
   ============================================================================== */
const TITOLO_DATA='Scrivi solo i numeri: 10082026 diventa 10-08-2026';

function formattaData(cifre){
  const d=String(cifre??'').replace(/\D/g,'').slice(0,8);
  let out=d.slice(0,2);
  if(d.length>2) out+='-'+d.slice(2,4);
  if(d.length>4) out+='-'+d.slice(4,8);
  return out;
}
/** normalizza qualsiasi cosa somigli a una data: 10/8/26, 10.08.2026, 10082026 */
function normalizzaData(v){
  const s=String(v??'').trim();
  if(!s) return '';
  const soloCifre=s.replace(/\D/g,'');
  if(soloCifre.length===8) return formattaData(soloCifre);
  if(soloCifre.length===6){                   // anno a due cifre: 100826
    const a=+soloCifre.slice(4,6);
    return formattaData(soloCifre.slice(0,4)+String(a<70?2000+a:1900+a));
  }
  const m=s.match(/^(\d{1,2})\D(\d{1,2})\D(\d{2,4})$/);
  if(m){
    let a=m[3]; if(a.length===2) a=String(+a<70?2000+ +a:1900+ +a);
    return formattaData(m[1].padStart(2,'0')+m[2].padStart(2,'0')+a);
  }
  return formattaData(soloCifre);
}
/** rende il campo «data» autoformattante: si digita di seguito, i trattini arrivano da soli */
function legaCampoData(inp,onChange){
  const riscrivi=()=>{
    const primaCursore=inp.value.slice(0,inp.selectionStart||0).replace(/\D/g,'').length;
    inp.value=formattaData(inp.value);
    // il cursore torna dopo le cifre che c'erano prima, saltando i trattini
    let pos=0,n=0;
    while(pos<inp.value.length && n<primaCursore){ if(/\d/.test(inp.value[pos])) n++; pos++; }
    while(pos<inp.value.length && inp.value[pos]==='-') pos++;
    try{ inp.setSelectionRange(pos,pos); }catch(_){}
  };
  inp.addEventListener('input',()=>{ riscrivi(); onChange&&onChange(inp.value); });
  inp.addEventListener('paste',e=>{
    const t=(e.clipboardData||window.clipboardData).getData('text');
    if(t){ e.preventDefault(); inp.value=normalizzaData(t); onChange&&onChange(inp.value); }
  });
  inp.addEventListener('blur',()=>{
    const v=normalizzaData(inp.value);
    inp.value=v; onChange&&onChange(v);
  });
}

/* ==============================================================================
   3. CALCOLI
   IMPONIBILE = prezzo unitario × quantità     TOTALE = imponibile + IVA
   ============================================================================== */
/* Promo: la riga tiene due prezzi, quello di prima e quello nuovo. Tutti e due
   vengono calcolati per intero — imponibile, IVA e totale — perché il cliente
   deve vedere di quanto si è scesi. Nelle somme però entra solo il promo. */
const inPromo = r => r.promo!=null && String(r.promo).trim()!=='';

function calcoloRiga(r){
  const qta=numIT(r.qta), aliquota=numIT(r.iva);
  const conta=p=>{
    const imponibile=cent(p*qta);
    const iva=cent(imponibile*aliquota/100);
    return {imponibile, iva, totale:cent(imponibile+iva)};
  };
  const originale=conta(numIT(r.prezzo));
  const promo=inPromo(r)?conta(numIT(r.promo)):null;
  // «vale» è quello che fa testo: il promo se c'è, altrimenti l'originale
  const vale=promo||originale;
  return Object.assign({}, vale, {aliquota, originale, promo});
}
function totali(righe){
  let imponibile=0, iva=0;
  const aliquote=new Set();
  for(const r of righe){
    const c=calcoloRiga(r);      // già il prezzo che vale: promo se c'è
    imponibile+=c.imponibile; iva+=c.iva;
    if(c.imponibile) aliquote.add(c.aliquota);
  }
  imponibile=cent(imponibile); iva=cent(iva);
  return {imponibile, iva, totale:cent(imponibile+iva), aliquote:[...aliquote].sort((a,b)=>a-b)};
}
/* L'etichetta dell'IVA dice quanta se ne può dire con una riga sola:
   - una sola aliquota in tutto il preventivo: la si mette fra parentesi,
     «IVA TOTALE (22%)», così il foglio la dichiara senza doverla cercare;
   - aliquote diverse (cucina al 22%, posa al 10%): nessuna parentesi, perché
     una qualsiasi delle due sarebbe una mezza verità. La percentuale di ogni
     riga resta nella sua colonna «IVA %», che è dove va letta. */
function etichettaIva(t){
  const n=voceTesto('iva','IVA TOTALE');
  return t.aliquote.length===1 ? `${n} (${fmtQty(t.aliquote[0])}%)` : n;
}

const concordatoAttivo = () => S.concordati!==null;
const valConcordato = id => (S.concordati && S.concordati[id]!=null) ? S.concordati[id] : '';

/* Il prezzo concordato del TAB in cui ci si trova, e lo sconto che ne deriva.
   Restituisce null finché un prezzo non è stato scritto davvero, perché lo
   sconto compare solo allora. */
function concordatoDi(T,tabId){
  if(!concordatoAttivo()) return null;
  const scritto=valConcordato(tabId||S.active);
  if(String(scritto).trim()==='') return null;
  const prezzo=cent(numIT(scritto));
  const sconto=cent(T.totale-prezzo);
  return {prezzo, sconto, perc: T.totale ? cent(sconto*100/T.totale) : 0};
}

/* ------------------------------------------------------------------
   Ripartizione del prezzo concordato fra le sezioni.

   Il prezzo pattuito sul totale si spartisce in proporzione a quanto pesa
   ogni sezione: tutte ricevono lo stesso sconto percentuale, e nessuna si
   trova scontata più delle altre.

   Gli arrotondamenti al centesimo non tornano quasi mai da soli: l'ultima
   sezione prende quello che resta, così la somma delle sezioni fa esattamente
   la cifra concordata sul complessivo — al centesimo, non «più o meno».
   ------------------------------------------------------------------ */
function ripartisciConcordato(){
  if(!concordatoAttivo()) return;
  const sezioni=tabNelTotale();
  if(!sezioni.length) return;
  const scritto=valConcordato(ID_TOT);
  if(String(scritto).trim()===''){ for(const t of sezioni) S.concordati[t.id]=''; return; }

  const obiettivo=cent(numIT(scritto));
  const totaleGen=totali(righeDi(ID_TOT)).totale;
  // senza importi su cui pesare non c'è proporzione: va tutto alla prima
  if(!totaleGen){
    sezioni.forEach((t,i)=>{ S.concordati[t.id]=fmtNum(i===0?obiettivo:0); });
    return;
  }
  let dato=0;
  sezioni.forEach((t,i)=>{
    const quota = i===sezioni.length-1
      ? cent(obiettivo-dato)                                     // l'ultima chiude il conto
      : cent(totali(righeDi(t.id)).totale*obiettivo/totaleGen);
    if(i<sezioni.length-1) dato=cent(dato+quota);
    S.concordati[t.id]=fmtNum(quota);
  });
}

/* ------------------------------------------------------------------
   Complessivo semplificato
   Una riga per sezione: il suo nome al posto degli articoli, e i suoi conti
   già fatti. I totali in fondo NON cambiano — la somma delle sezioni è la
   stessa che veniva dalle voci — cambia solo quanto si mostra di come ci si
   arriva: un preventivo che dice «Cucina, Complementi, Posa» e basta.
   L'aliquota c'è solo se in quella sezione è una sola: con voci al 22 e al 10
   una percentuale unica sarebbe falsa.
   ------------------------------------------------------------------ */
const semplificato = tabId => !!S.semplificato && tabId===ID_TOT;
function righeSemplificate(){
  return tabNelTotale().map(t=>{
    const T=totali(righeDi(t.id));
    return {tabId:t.id, nome:t.name||'Sezione', icona:t.icon||'📄',
            imponibile:T.imponibile, totale:T.totale,
            aliquota: T.aliquote.length===1 ? T.aliquote[0] : null};
  });
}

/* ------------------------------------------------------------------
   Acconti
   L'importo si calcola sul prezzo concordato; se non c'è, sul totale ivato.
   Nelle sezioni si ripartisce con la stessa regola del prezzo concordato —
   in proporzione al peso, con l'ultima che assorbe il resto — così le quote
   delle sezioni sommano esattamente all'acconto del complessivo.
   ------------------------------------------------------------------ */
/* La base dev'essere la stessa per tutte le sezioni, altrimenti le quote non
   tornano: se il prezzo concordato è stato scritto davvero, comanda quello per
   tutte — anche per una sezione lasciata vuota, che allora vale zero come vale
   zero nella somma. Prendendo per quella sezione il suo totale ivato si
   mescolerebbero due misure diverse, e le rate risulterebbero sbagliate. */
function baseAcconti(tabId){
  if(concordatoAttivo() && String(valConcordato(ID_TOT)).trim()!=='')
    return cent(numIT(valConcordato(tabId)));
  return totali(righeDi(tabId)).totale;
}

/* La percentuale di una rata, sezione per sezione.
   Quella scritta in «perc» vale per tutte: è il 50/50 di partenza. Toccando la
   rata DENTRO una sezione — la percentuale, oppure direttamente l'importo —
   quella sezione si stacca e tiene la sua, annotata in «sez»; le altre
   continuano a seguire la predefinita, senza accorgersi di niente. */
function percAcconto(a,tabId){
  if(tabId && tabId!==ID_TOT && a.sez && a.sez[tabId]!=null) return a.sez[tabId];
  return a.perc;
}
/* Le percentuali si tengono PER INTERO, non arrotondate al centesimo di punto.
   Scrivendo 2.181,50 in una sezione da 5.137,20 la percentuale è 42,464463…%:
   arrotondata a 42,46 tornerebbe indietro come 2.181,26 €, e la cifra pattuita
   non sarebbe più quella. Nei campi la si mostra corta — due decimali, quanto
   serve a leggerla — e quella intera compare passandoci sopra col cursore. */
const percPiena = n => String(Math.round((+n||0)*1e8)/1e8).replace('.',',');
const percCorta = p => fmtQty(cent(numIT(p)));
const percEsatta = p => String(numIT(p)).replace('.',',');

const accontoRitoccato = (a,tabId) => !!(a && a.sez && tabId && a.sez[tabId]!=null);
/** true se in questa sezione almeno una rata è stata decisa a mano */
const sezioneRitoccata = tabId => tabId!==ID_TOT && S.acconti.some(a=>accontoRitoccato(a,tabId));
/* Nel complessivo la domanda diventa un'altra: c'è QUALCHE sezione decisa a
   mano? Se sì, la percentuale che si vede qui è ricavata dagli importi, e può
   non essere quella appena scritta: senza dirlo sembrerebbe un capriccio. */
const conSezioniAMano = () => tabNelTotale().some(t=>sezioneRitoccata(t.id));
const rateAMano = tabId => tabId===ID_TOT ? conSezioniAMano() : sezioneRitoccata(tabId);

/** scrive la percentuale dove va: nella sezione, o nella predefinita se si è nel complessivo */
function impostaPerc(a,tabId,valore){
  if(tabId===ID_TOT){ a.perc=valore; return; }
  (a.sez || (a.sez={}))[tabId]=valore;
}

/* L'importo di una rata. In una sezione è la sua percentuale sul suo totale.
   Nel complessivo NON è una percentuale sua: è la somma di quello che si
   incassa nelle sezioni. Se in «Complementi» il primo acconto è stato fissato
   a 2.150 €, il complessivo deve dire 2.150 € più le quote delle altre, non il
   50% di tutto: è quella la cifra che il cliente paga. */
function importoAcconto(a,tabId){
  if(tabId!==ID_TOT) return cent(baseAcconti(tabId)*numIT(percAcconto(a,tabId))/100);
  const sezioni=tabNelTotale();
  if(!sezioni.length) return cent(baseAcconti(ID_TOT)*numIT(a.perc)/100);
  return sezioni.reduce((tot,t)=>cent(tot+importoAcconto(a,t.id)),0);
}

/** la percentuale che il complessivo mostra: ricavata all'indietro dagli importi veri */
function percComplessivo(a){
  if(!tabNelTotale().some(t=>accontoRitoccato(a,t.id))) return a.perc;   // nessuno ha toccato niente
  const base=baseAcconti(ID_TOT);
  if(!base) return a.perc;
  return percPiena(importoAcconto(a,ID_TOT)*100/base);
}
/** quella da far vedere nel riquadro della sezione aperta */
const percMostrata = (a,tabId) => tabId===ID_TOT ? percComplessivo(a) : percAcconto(a,tabId);

/** ritoccando una sezione, il complessivo torna a essere la somma delle sezioni */
function sommaConcordati(){
  if(!concordatoAttivo()) return;
  let s=0;
  for(const t of tabNelTotale()) s=cent(s+numIT(valConcordato(t.id)));
  S.concordati[ID_TOT]=fmtNum(s);
}
/** «Sconto» con la percentuale fra parentesi, quando dice qualcosa */
const etichettaSconto = c => { const n=voceTesto('sconto','SCONTO');
  return c.perc ? `${n} (${fmtQty(c.perc)}%)` : n; };

/* ==============================================================================
   ASPETTO DELLE SCRITTE — quello che apre il menu «Sviluppatore»

   Le misure, il maiuscolo e il neretto delle voci del foglio erano numeri
   scritti nel foglio di stile: cambiarne uno voleva dire toccare il codice e
   ricompilare l'app. Qui quelle stesse voci diventano un elenco, e ognuna la si
   regola dall'app: come si chiama, quanto è grande, se va in maiuscolo, se è in
   grassetto. Quello che si sceglie vale SIA a schermo SIA sulla carta, perché
   il foglio stampato nasce da questa stessa pagina.

   Quello che non si tocca resta esattamente com'era: si scrive una regola solo
   per le proprietà davvero cambiate, e per il resto continua a valere il foglio
   di stile di sempre.
   ============================================================================== */
const CHIAVE_ASPETTO='preventivi:aspetto';
let ASPETTO={};

/* L'elenco delle voci su cui si può mettere mano.
   - «testo» c'è solo dove l'etichetta la scrive l'app: dove la scrive l'utente
     (il nome di una rata, il nome della sezione) rinominarla non vorrebbe dire
     niente.
   - «dim» è la variabile del foglio di stile da cui si legge la misura di
     partenza: così il suggerimento nel riquadro resta vero anche se un domani
     quella misura cambia.
   - «sel» sono i pezzi di pagina a schermo, «stampa» quelli del foglio: due
     elenchi perché il foglio stampato è costruito a parte, con altri nomi. */
const VOCI=[
  {gruppo:'Tabella'},
  {id:'testate',nome:'Testate delle colonne',dim:'--t-testata',
   sel:['table.voci thead th'],stampa:['table.st-tab thead th']},
  {id:'righe',nome:'Testo delle righe',dim:'--t-cella',
   sel:['table.voci tbody td'],stampa:['table.st-tab tbody td']},

  {id:'promo',nome:'Promo',dim:'--t-cella',
   sel:['tr.conpromo .pro','tr.conpromo input.pro'],stampa:['table.st-tab .pro']},

  {gruppo:'Totali'},
  {id:'imponibile',nome:'IMPONIBILE TOTALE',testo:'IMPONIBILE TOTALE',dim:'--t-tot-k',
   sel:['.totali .rt.v-imponibile .k'],stampa:['tbody.st-totali tr.v-imponibile .k']},
  {id:'imponibileImporto',nome:'… il suo importo',dim:'--t-tot-v',
   sel:['.totali .rt.v-imponibile .v'],stampa:['tbody.st-totali tr.v-imponibile .v']},
  {id:'iva',nome:'IVA TOTALE',testo:'IVA TOTALE',dim:'--t-tot-k',
   sel:['.totali .rt.v-iva .k'],stampa:['tbody.st-totali tr.v-iva .k']},
  {id:'ivaImporto',nome:'… il suo importo',dim:'--t-tot-v',
   sel:['.totali .rt.v-iva .v'],stampa:['tbody.st-totali tr.v-iva .v']},
  {id:'ivato',nome:'TOTALE',testo:'TOTALE',dim:'--t-fin-k',
   sel:['.totali .rt.v-ivato .k'],stampa:['tbody.st-totali tr.v-ivato .k']},
  {id:'ivatoImporto',nome:'… il suo importo',dim:'--t-fin-v',
   sel:['.totali .rt.v-ivato .v'],stampa:['tbody.st-totali tr.v-ivato .v']},
  {id:'sconto',nome:'SCONTO',testo:'SCONTO',dim:'--t-tot-k',
   sel:['.totali .rt.v-sconto .k'],stampa:['tbody.st-totali tr.v-sconto .k']},
  {id:'scontoImporto',nome:'… il suo importo',dim:'--t-tot-v',
   sel:['.totali .rt.v-sconto .v'],stampa:['tbody.st-totali tr.v-sconto .v']},
  {id:'concordato',nome:'PREZZO CONCORDATO',testo:'PREZZO CONCORDATO',dim:'--t-fin-k',
   sel:['.totali .rt.v-concordato .k'],stampa:['tbody.st-totali tr.v-concordato .k']},
  {id:'concordatoImporto',nome:'… il suo importo',dim:'--t-fin-v',
   sel:['.totali .rt.v-concordato .v input'],stampa:['tbody.st-totali tr.v-concordato .v']},

  {gruppo:'Rate e acconti'},
  {id:'rata',nome:'Nome della rata',dim:'--t-rata-k',
   sel:['.totali .rt.acconto .nome'],stampa:['tbody.st-totali tr.v-rata .k']},
  {id:'rataPerc',nome:'… la sua percentuale',dim:'--t-rata-p',
   sel:['.totali .rt.acconto .pc','.totali .rt.acconto .perc'],stampa:['tbody.st-totali tr.v-rata .pc']},
  {id:'rataImporto',nome:'… il suo importo',dim:'--t-rata-v',
   sel:['.totali .rt.acconto .v','.totali .rt.acconto .v input','.totali .rt.acconto .v .eu'],
   stampa:['tbody.st-totali tr.v-rata .v']},

  {gruppo:'Solo sul foglio stampato'},
  {id:'sezione',nome:'Nome della sezione',dim:'--t-sezione',stampa:['.st-sezione-nome']},
  {id:'cliente',nome:'Dati del cliente e data',dim:'--t-cliente',stampa:['.st-cliente','.st-data']},
];

const aspettoDi = id => ASPETTO[id] || {};
/** l'etichetta di una voce: quella scelta qui se c'è, altrimenti la solita */
const voceTesto = (id,predefinito) => {
  const t=aspettoDi(id).testo;
  return (t && t.trim()) ? t.trim() : predefinito;
};
/** la misura di partenza, letta dal foglio di stile: qui non si ricopia nessun numero */
function dimBase(v){
  try{ return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(v.dim))||''; }
  catch(_){ return ''; }
}
function regoleDi(s){
  const d=[];
  if(s.px)   d.push('font-size:'+s.px+'px');
  if(s.peso) d.push('font-weight:'+(s.peso==='g'?'700':'400'));
  if(s.caso) d.push('text-transform:'+(s.caso==='M'?'uppercase':s.caso==='m'?'lowercase':'none'));
  return d.length ? '{'+d.join(';')+'}' : '';
}

/* Le regole scelte finiscono in un foglio di stile scritto al volo, in fondo
   alla testa della pagina: nasce dopo quello dell'app, e ogni selettore porta
   davanti un «body» in più, così vince su quelle di sempre senza riscriverle. */
function applicaAspetto(){
  const schermo=[], carta=[];
  for(const v of VOCI){
    if(!v.id) continue;
    const corpo=regoleDi(aspettoDi(v.id));
    if(!corpo) continue;
    if(v.sel)    schermo.push(v.sel.map(x=>'body '+x).join(',')+corpo);
    if(v.stampa) carta.push(v.stampa.map(x=>'body '+x).join(',')+corpo);
  }
  const css=schermo.join('\n')+(carta.length?'\n@media print{\n'+carta.join('\n')+'\n}':'');
  let tag=document.getElementById('aspettoUtente');
  if(!tag){ tag=document.createElement('style'); tag.id='aspettoUtente'; document.head.appendChild(tag); }
  tag.textContent=css;
}
function salvaAspetto(){ try{ localStorage.setItem(CHIAVE_ASPETTO,JSON.stringify(ASPETTO)); }catch(_){} }
function caricaAspetto(){
  try{ ASPETTO=JSON.parse(localStorage.getItem(CHIAVE_ASPETTO)||'{}')||{}; }catch(_){ ASPETTO={}; }
  applicaAspetto();
}

function dialogoAspetto(){
  const riga=v=>{
    if(v.gruppo) return `<div class="aspgruppo">${esc(v.gruppo)}</div>`;
    const s=aspettoDi(v.id), base=dimBase(v);
    const opz=(campo,elenco)=>elenco.map(([val,et])=>
      `<option value="${val}"${(s[campo]||'')===val?' selected':''}>${et}</option>`).join('');
    return `<div class="asprow" data-id="${v.id}">
      <span class="nome">${esc(v.nome)}</span>
      ${v.testo
        ? `<input class="testo" value="${esc(s.testo||'')}" placeholder="${esc(v.testo)}" title="Come vuoi che si chiami questa voce">`
        : `<input class="testo" disabled placeholder="—" title="Questo testo lo scrivi tu nel preventivo">`}
      <input class="px" type="number" min="6" max="60" step="0.5" value="${s.px||''}" placeholder="${base}" title="Dimensione in pixel">
      <select class="caso" title="Maiuscolo o minuscolo">${opz('caso',[['','Come adesso'],['M','MAIUSCOLO'],['m','minuscolo'],['n','Come scritto']])}</select>
      <select class="peso" title="Grassetto o normale">${opz('peso',[['','Come adesso'],['n','Normale'],['g','Grassetto']])}</select>
    </div>`;
  };
  modal('Aspetto delle scritte',
    `<div class="aspetto">
       <div class="asprow testata"><span class="nome">Voce</span><span>Come si chiama</span><span>Dim.</span><span>Maiuscole</span><span>Peso</span></div>
       ${VOCI.map(riga).join('')}
     </div>
     <p class="hint">Quello che cambi si vede subito, a schermo e sulla carta, e resta anche
     chiudendo l'app. Dove la casella del nome è vuota il testo lo scrivi tu nel preventivo.
     Lasciando vuota la dimensione vale quella di sempre, che trovi scritta in chiaro.</p>`,
    [{label:"Riporta tutto com'era",danger:true,fn:()=>{
        ASPETTO={}; salvaAspetto(); applicaAspetto(); render();
        toast('Scritte riportate come erano','ok');
        setTimeout(dialogoAspetto,60);
     }},
     {label:'Chiudi'}],
    ()=>{
      const cambia=(el,campo,valore)=>{
        const id=el.closest('.asprow').dataset.id;
        const s=ASPETTO[id]||(ASPETTO[id]={});
        if(valore==='') delete s[campo]; else s[campo]=valore;
        if(!Object.keys(s).length) delete ASPETTO[id];
        salvaAspetto(); applicaAspetto();
        /* le etichette stanno nel disegno della pagina, non nel foglio di
           stile: rinominandone una il foglio va ridisegnato */
        if(campo==='testo') render();
      };
      $$('.aspetto .testo:not([disabled])').forEach(el=>el.oninput =()=>cambia(el,'testo',el.value));
      $$('.aspetto .px'  ).forEach(el=>el.oninput =()=>cambia(el,'px',el.value));
      $$('.aspetto .caso').forEach(el=>el.onchange=()=>cambia(el,'caso',el.value));
      $$('.aspetto .peso').forEach(el=>el.onchange=()=>cambia(el,'peso',el.value));
    },'wide conx');
}

/* ==============================================================================
   4. TAB
   ============================================================================== */
let dragId=null;

function renderTabs(){
  const bar=$('#tabbar');
  bar.innerHTML='';
  S.tabs.forEach(t=>{
    const b=document.createElement('button');
    b.className='tab'+(t.id===S.active?' active':'')+(esclusaDalTotale(t.id)?' esclusa':'');
    if(esclusaDalTotale(t.id)) b.title='Fuori dal Preventivo Complessivo';
    b.draggable=t.type!=='tot';
    b.dataset.id=t.id;
    b.innerHTML=`<span class="ico">${esc(t.icon||'📄')}</span>
      <span class="lbl">${esc(t.name)}</span>
      <span class="cnt">${righeDi(t.id).length}</span>`+
      (t.type!=='tot'?`<span class="x" data-act="close" title="Elimina la sezione">×</span>`:'');
    b.onclick=e=>{
      if(e.target.dataset.act==='close'){ e.stopPropagation(); eliminaTab(t.id); return; }
      S.active=t.id; tocca(); render();
    };
    b.ondblclick=e=>{ if(t.type!=='tot'){ e.preventDefault(); rinominaTab(t.id); } };
    if(t.type!=='tot'){
      b.ondragstart=()=>{dragId=t.id;};
      b.ondragover=e=>{ if(dragId&&dragId!==t.id){ e.preventDefault(); b.classList.add('dragover'); } };
      b.ondragleave=()=>b.classList.remove('dragover');
      b.ondrop=e=>{
        e.preventDefault(); b.classList.remove('dragover');
        const da=S.tabs.findIndex(x=>x.id===dragId), a=S.tabs.findIndex(x=>x.id===t.id);
        if(da>0&&a>0){ const [m]=S.tabs.splice(da,1); S.tabs.splice(a,0,m); tocca(); render(); }
      };
    }
    bar.appendChild(b);
  });
  const add=document.createElement('div');
  add.className='tabadd';
  add.innerHTML=`<button class="sm" id="addTab" title="Aggiunge una sezione del preventivo">＋ Sezione</button>`;
  bar.appendChild(add);
  $('#addTab').onclick=()=>nuovoTab();
}

function nuovoTab(nome){
  const n=tabVoci().length+1;
  const t={id:'s'+uid(), type:'voci', name:nome||('Preventivo '+n), icon:'📄'};
  S.tabs.push(t);
  // la sezione nuova entra nel giro del prezzo concordato, per ora a zero
  if(concordatoAttivo()) S.concordati[t.id]='';
  S.active=t.id; tocca(); render();
  return t;
}
function rinominaTab(id){
  const t=tabById(id); if(!t) return;
  modal('Rinomina la sezione',`
    <label class="fld">Nome<input id="mNome" value="${esc(t.name)}"></label>
    <label class="fld" style="margin-top:10px">Icona<input id="mIco" value="${esc(t.icon||'')}" maxlength="4" style="width:90px"></label>
  `,[{label:'Annulla'},{label:'Salva',primary:true,fn:()=>{
    const v=$('#mNome').value.trim(); if(v) t.name=v;
    t.icon=$('#mIco').value.trim()||t.icon;
    tocca(); render();
  }}],()=>$('#mNome').select());
}
function eliminaTab(id){
  const t=tabById(id); if(!t||t.type==='tot') return;
  const n=righeDi(id).length;
  const fai=()=>{
    S.righe=S.righe.filter(r=>r.tabId!==id);
    S.tabs=S.tabs.filter(x=>x.id!==id);
    // sparita la sezione, sparisce anche la sua quota: il complessivo si rifà
    if(concordatoAttivo()){ delete S.concordati[id]; sommaConcordati(); }
    if(S.active===id) S.active=(tabVoci()[0]||S.tabs[0]).id;
    tocca(); render(); toast('Sezione eliminata');
  };
  if(!n) return fai();
  modal('Eliminare la sezione?',
    `<p style="margin:0">Stai per eliminare <b>${esc(t.name)}</b> e le sue <b>${n}</b> righe.</p>`,
    [{label:'Annulla'},{label:'Elimina',danger:true,fn:fai}]);
}

/* ==============================================================================
   5. RIGHE
   ============================================================================== */
function nuovaRiga(tabId){
  /* Dal preventivo complessivo la riga finisce nella prima sezione: lì dentro le
     righe non hanno casa propria, sono la somma di quelle delle sezioni. */
  let dest=tabId;
  if(dest===ID_TOT) dest=(tabVoci()[0]||nuovoTab()).id;
  const r={id:uid(), tabId:dest, articolo:'', descrizione:'', prezzo:'', qta:'1', iva:'22'};
  S.righe.push(r); tocca();
  return r;
}
function eliminaRiga(id){
  const i=S.righe.findIndex(r=>r.id===id);
  if(i<0) return;
  S.righe.splice(i,1); tocca(); render();
}

/** una copia della riga, subito sotto l'originale */
function duplicaRiga(id){
  const i=S.righe.findIndex(r=>r.id===id);
  if(i<0) return;
  const copia=Object.assign({},S.righe[i],{id:uid(),barrato:false});
  S.righe.splice(i+1,0,copia);
  tocca(); render();
  $(`#corpo tr[data-id="${copia.id}"]`)?.scrollIntoView({block:'nearest'});
  return copia;
}

/* Promo: resta tutto nella stessa riga, che va a capo. Sopra il prezzo di
   prima, sbarrato ma con il suo imponibile e il suo totale ben calcolati;
   sotto il prezzo promozionale, l'unico che entra nelle somme. */
function promoRiga(id){
  const r=rigaById(id);
  if(!r) return;
  if(r.promo!=null){ delete r.promo; tocca(); render(); return; }   // si torna indietro
  r.promo='';
  tocca(); render();
  const tr=$(`#corpo tr[data-id="${id}"]`);
  tr?.querySelector('input[data-k="promo"]')?.focus();
  tr?.scrollIntoView({block:'nearest'});
}

/* I preventivi salvati con la prima versione del Promo avevano due righe: una
   sbarrata e, subito sotto, la gemella con il prezzo nuovo. Qui le due tornano
   una riga sola, così quei file si riaprono con l'aspetto giusto e senza
   contare due volte. */
function migraPromo(righe){
  const out=[];
  for(let i=0;i<righe.length;i++){
    const r=righe[i];
    if(r&&r.barrato){
      const gemella=righe[i+1];
      const unita=Object.assign({},r);
      delete unita.barrato;
      if(gemella&&!gemella.barrato&&gemella.articolo===r.articolo&&gemella.descrizione===r.descrizione){
        unita.promo=gemella.prezzo; i++;      // la gemella viene assorbita
      }else unita.promo='';
      out.push(unita);
    }else out.push(r);
  }
  return out;
}

/** una copia della sezione con tutte le sue righe */
function duplicaTab(id){
  const t=tabById(id);
  if(!t||t.type==='tot') return;
  const copia={id:'s'+uid(), type:'voci', name:t.name+' (copia)', icon:t.icon};
  S.tabs.splice(S.tabs.indexOf(t)+1,0,copia);
  for(const r of S.righe.filter(x=>x.tabId===id).slice())
    S.righe.push(Object.assign({},r,{id:uid(),tabId:copia.id}));
  if(concordatoAttivo()){ S.concordati[copia.id]=''; sommaConcordati(); }
  S.active=copia.id; tocca(); render();
  toast('Sezione duplicata','ok');
}

/* ==============================================================================
   6. RENDER
   ============================================================================== */
function render(){
  document.documentElement.dataset.theme = OPZ.theme;
  document.documentElement.dataset.orient = OPZ.orizzontale?'orizzontale':'verticale';
  applicaFormatoPagina();
  renderTabs();
  $('#view').innerHTML = vistaPreventivo();
  legaVista();
  adattaDescrizioni();
  aggiornaTitolo();
}

function vistaPreventivo(){
  const t=tabCorrente();
  const righe=righeDi(t.id);
  const T=totali(righe);
  const complessivo = t.id===ID_TOT;
  const sempl = semplificato(t.id);
  const conTab = complessivo && !sempl;      // la colonna della sezione

  return `
  <div class="barra noprint centrata">
    ${complessivo?`<button id="btnSezioniTot" title="Scegli quali sezioni entrano nel Preventivo Complessivo">Sezioni nel Preventivo Complessivo ▾</button>`:''}
    ${complessivo?`<label class="btn spuntabarra" title="Al posto di tutte le voci mostra una riga per sezione, con il suo totale. I conti non cambiano.">
      <input type="checkbox" id="chkSemplice"${S.semplificato?' checked':''}>
      <span>Preventivo Complessivo Semplificato</span>
    </label>`:''}
    <button id="btnIntest" title="Compare in cima al preventivo stampato">🖊 Intestazione</button>
    <button id="btnCliente" title="Compare nel preventivo stampato, sotto l'intestazione">👤 Dati Cliente</button>
    <div class="campo-data">
      <span>Data</span>
      <input id="dataPrev" class="data" value="${esc(S.data)}" placeholder="gg-mm-aaaa"
             inputmode="numeric" autocomplete="off" maxlength="10" title="${TITOLO_DATA}">
    </div>
    <div class="spacer"></div>
    <div class="segbtns" title="Formato del foglio A4">
      <button data-or="v" class="${OPZ.orizzontale?'':'on'}">▯ Verticale</button>
      <button data-or="o" class="${OPZ.orizzontale?'on':''}">▭ Orizzontale</button>
    </div>
    <button id="btnSeleziona" title="${esc(descrizioneAmbito())}">☑ Seleziona</button>
    <button id="btnAnteprima" title="Guarda il foglio prima di stamparlo (Ctrl+Shift+P)">👁 Anteprima</button>
    <button id="btnStampa" title="Stampa su A4">🖨 Stampa</button>
    <button id="btnPdf" title="Esporta in PDF">⇩ PDF</button>
    <button id="btnXls" title="Esporta in Excel (.xlsx)">⇩ Excel</button>
  </div>

  <div class="foglio">
    <div class="tablewrap">
      <!-- La colonna TAB c'è solo nel preventivo complessivo, e solo a schermo:
           serve a ricordare da quale sezione arriva ogni riga. Sulla carta e
           nell'esportazione non compare, perché il foglio stampato viene
           costruito a parte (vedi costruisciStampa) e lì di colonne ce ne sono
           sette, quelle chieste. -->
      <table class="voci${conTab?' con-tab':''}">
        <colgroup>
          ${conTab?'<col class="c-tab">':''}
          <col class="c-art"><col class="c-desc"><col class="c-prezzo"><col class="c-qta">
          <col class="c-imp"><col class="c-iva"><col class="c-tot"><col class="c-az${complessivo?'':' larga'}">
        </colgroup>
        <thead><tr>
          ${conTab?'<th title="Sezione da cui arriva la riga">TAB</th>':''}
          <th>Articolo</th>
          <th>Descrizione</th>
          <th class="num">Prezzo unitario&nbsp;€</th>
          <th class="num">Quantità</th>
          <th class="num">Imponibile&nbsp;€</th>
          <th class="num">IVA %</th>
          <th class="num">Totale&nbsp;€</th>
          <th></th>
        </tr></thead>
        <tbody id="corpo">
          ${sempl
            ? (righeSemplificate().length
                ? righeSemplificate().map(rigaSempliceHTML).join('')
                : `<tr><td colspan="8" class="rigavuota">Nessuna sezione da riassumere.</td></tr>`)
            : (righe.length?righe.map((r,i)=>rigaHTML(r,complessivo,i,righe.length)).join(''):
              `<tr><td colspan="${conTab?9:8}" class="rigavuota">Nessuna voce. Premi «＋» qui sotto per iniziare.</td></tr>`)}
        </tbody>
      </table>
    </div>

    ${sempl?'':`<div class="azionitab noprint">
      <button id="btnRiga" class="primary piu" title="Aggiungi una riga (Ctrl+Invio)">＋</button>
    </div>`}

    <div class="totalibox noprint" id="riquadroTotali">${totaliHTML(T)}</div>
  </div>`;
}

function rigaHTML(r,complessivo,indice,quante){
  const c=calcoloRiga(r);
  const sez = complessivo ? tabById(r.tabId) : null;
  const promo = r.promo!=null;         // in promo anche se il prezzo è ancora vuoto
  /* Nelle colonne dei soldi vanno due righe dentro la stessa cella: sopra il
     prezzo di prima — sbarrato ma calcolato per intero — e sotto quello promo,
     che è l'unico a finire nelle somme. */
  const due=(sopra,sotto)=>promo
    ? `<span class="orig">${sopra}</span><span class="pro">${sotto}</span>`
    : sotto;
  return `<tr data-id="${r.id}"${promo?' class="conpromo"':''}>
    ${sez?`<td class="tabsez"><button class="vaitab" data-act="vaitab" title="Vai alla sezione «${esc(sez.name)}»"
      ><span class="i">${esc(sez.icon||'📄')}</span><span class="n">${esc(sez.name)}</span></button></td>`:''}
    <td class="cel-art">
      <input class="cell-in" data-k="articolo" value="${esc(r.articolo)}" placeholder="—">
    </td>
    <td class="cel-desc">
      <div class="descbox">
        <textarea class="cell-in" data-k="descrizione" rows="1" placeholder="Descrizione della voce">${esc(r.descrizione)}</textarea>
        <button class="descbtn" data-act="desc" title="Apri la descrizione in una finestra">⤢</button>
      </div>
    </td>
    <td>
      <input class="cell-in num orig" data-k="prezzo" value="${r.prezzo===''?'':fmtNum(numIT(r.prezzo))}" placeholder="0,00" inputmode="decimal">
      ${promo?`<input class="cell-in num pro" data-k="promo" value="${String(r.promo).trim()===''?'':fmtNum(numIT(r.promo))}"
        placeholder="promo" inputmode="decimal" title="Prezzo promozionale: è questo che conta nei totali">`:''}
    </td>
    <td class="cel-mezzo"><input class="cell-in num" data-k="qta" value="${r.qta===''?'':fmtQty(numIT(r.qta))}" placeholder="1" inputmode="decimal"></td>
    <td class="num calc" data-c="imponibile">${due(fmtNum(c.originale.imponibile), fmtNum(c.imponibile))}</td>
    <td class="cel-mezzo"><input class="cell-in num" data-k="iva" value="${r.iva===''?'':fmtQty(numIT(r.iva))}" placeholder="22" inputmode="decimal"></td>
    <td class="num calc" data-c="totale">${due(fmtEur(c.originale.totale), fmtEur(c.totale))}</td>
    <td class="az">${complessivo?'':`<button data-act="su" title="Sposta la riga in su"${indice===0?' disabled':''}>↑</button><button data-act="giu" title="Sposta la riga in giù"${indice===quante-1?' disabled':''}>↓</button>`}<button data-act="del" title="Elimina la riga">×</button></td>
  </tr>`;
}

/* La riga di una sezione. Non si scrive dentro: sono conti già fatti, che si
   cambiano andando nella sezione — ed è quello che fa il nome, cliccandolo. */
function rigaSempliceHTML(x){
  return `<tr class="semplice" data-tab="${esc(x.tabId)}">
    <td class="cel-art"></td>
    <td class="cel-desc"><button class="vaitab grande" data-act="vaisez" title="Vai alla sezione «${esc(x.nome)}»"
      ><span class="i">${esc(x.icona)}</span><span class="n">${esc(x.nome)}</span></button></td>
    <td class="num calc">${fmtNum(x.imponibile)}</td>
    <td class="cel-mezzo num calc">1</td>
    <td class="num calc">${fmtNum(x.imponibile)}</td>
    <td class="cel-mezzo num calc">${x.aliquota==null?'—':fmtQty(x.aliquota)}</td>
    <td class="num calc">${fmtEur(x.totale)}</td>
    <td class="az"></td>
  </tr>`;
}

/* Le righe di tutte le sezioni stanno in un elenco solo, una dietro l'altra:
   spostare una riga «in su» vuol dire scambiarla con quella che la precede
   NELLA SUA sezione, non con quella che la precede nell'elenco — che potrebbe
   appartenere a un'altra sezione e finirebbe per cambiare di posto pure lei. */
let rigaTrascinata=null;

function spostaRiga(id,verso){
  const r=rigaById(id); if(!r) return;
  const sorelle=S.righe.filter(x=>x.tabId===r.tabId);
  const i=sorelle.indexOf(r), j=i+verso;
  if(j<0||j>=sorelle.length) return;                 // già in cima o in fondo
  const a=S.righe.indexOf(sorelle[i]), b=S.righe.indexOf(sorelle[j]);
  S.righe[a]=sorelle[j]; S.righe[b]=sorelle[i];
  tocca(); render();
  $(`#corpo tr[data-id="${id}"]`)?.scrollIntoView({block:'nearest'});
}

/** posa la riga «da» sopra o sotto la riga «a», dentro la stessa sezione */
function posaRiga(da,a,prima){
  const rd=rigaById(da), ra=rigaById(a);
  if(!rd||!ra||rd===ra||rd.tabId!==ra.tabId) return;
  const senza=S.righe.filter(x=>x!==rd);
  const dove=senza.indexOf(ra)+(prima?0:1);
  senza.splice(dove,0,rd);
  S.righe=senza;
  tocca(); render();
  $(`#corpo tr[data-id="${da}"]`)?.scrollIntoView({block:'nearest'});
}

function totaliHTML(T){
  const attivo = concordatoAttivo();
  const c = concordatoDi(T);
  const nSez = tabNelTotale().length;
  const nota = attivo && nSez>1
    ? (S.active===ID_TOT
        ? 'Ripartito fra le ' + nSez + ' sezioni in proporzione al loro peso.'
        : 'Quota di questa sezione sul prezzo concordato complessivo.')
    : '';
  /* Quando c'è un prezzo concordato è lui la cifra che conta: l'evidenza passa
     a quella riga, e il totale ivato torna una riga come le altre. */
  return `
    <div class="totali">
      <div class="rt riepilogo v-imponibile"><span class="k">${esc(voceTesto('imponibile','IMPONIBILE TOTALE'))}</span><span class="v">${fmtEur(T.imponibile)}</span></div>
      <div class="rt riepilogo v-iva"><span class="k">${esc(etichettaIva(T))}</span><span class="v">${fmtEur(T.iva)}</span></div>
      <div class="rt v-ivato${attivo?'':' finale'}"><span class="k">${esc(voceTesto('ivato','TOTALE'))}</span><span class="v">${fmtEur(T.totale)}</span></div>
      ${attivo?'':`<div class="rt azioneconc">
        <button id="btnConcordato" class="conc">＋ Aggiungi Prezzo Concordato</button>
      </div>`}
      ${attivo?`<div class="rt riepilogo sconto v-sconto" id="rigaSconto"${c?'':' hidden'}>
        <span class="k">${esc(c?etichettaSconto(c):voceTesto('sconto','SCONTO'))}</span>
        <span class="v">${c?fmtEur(c.sconto):''}</span></div>`:''}
      ${attivo?`<div class="rt finale concordato v-concordato">
        <span class="k">${esc(voceTesto('concordato','PREZZO CONCORDATO'))}</span>
        <span class="v">
          <input id="inConcordato" value="${esc(valConcordato(S.active))}" placeholder="0,00"
                 inputmode="decimal" autocomplete="off" title="Il prezzo pattuito con il cliente">
          <span class="eu">€</span>
          <button id="btnToglieConcordato" class="x" title="Togli il prezzo concordato">×</button>
        </span>
      </div>`:''}
      ${S.acconti.length?`<div class="acconti">${accontiHTML()}</div>`:''}
    </div>
    ${nota?`<div class="notaconc">${esc(nota)}</div>`:''}
    ${notaPercentuali()}
    <button id="btnAcconto" class="conc" title="Aggiungi una rata / acconto">＋ Aggiungi Rata/Acconto</button>`;
}

/* Nel complessivo l'importo si legge e basta: lì è una somma, e per cambiarlo
   si va nella sezione che lo determina. Nelle sezioni invece si scrive, perché
   spesso l'accordo è «2.150 €» e non «il 43,72%». */
function accontiHTML(){
  const inSezione = S.active!==ID_TOT;
  return S.acconti.map((a,i)=>`
    <div class="rt acconto${accontoRitoccato(a,S.active)?' ritoccata':''}" data-i="${i}">
      <input class="nome" value="${esc(a.nome)}" placeholder="Descrizione della rata" title="${esc(a.nome)}">
      <span class="pc"><input class="perc" value="${esc(percCorta(percMostrata(a,S.active)))}" inputmode="decimal" placeholder="0"
        title="${esc((inSezione?'Percentuale di questa rata in questa sezione':'Percentuale predefinita: la seguono le sezioni non impostate a mano')+' — esatta: '+percEsatta(percMostrata(a,S.active))+'%')}">%</span>
      ${inSezione
        ? `<span class="v scrivi"><input class="imp" value="${esc(fmtNum(importoAcconto(a,S.active)))}" inputmode="decimal"
             title="L'importo di questa rata in questa sezione: scrivendolo, la percentuale si ricava da qui"><span class="eu">€</span></span>`
        : `<span class="v" title="Nel complessivo è la somma delle sezioni">${fmtEur(importoAcconto(a,ID_TOT))}</span>`}
      <button class="x" data-act="delacc" title="Togli questa rata">×</button>
    </div>`).join('');
}

/* Le percentuali le decide l'utente e possono anche non fare 100: si segnala
   quanto fanno, senza impedire niente — a volte è voluto.
   L'avviso c'è sempre nella pagina e si limita a nascondersi: comparire e
   sparire per davvero significherebbe rifare il riquadro mentre si scrive la
   percentuale, e il campo perderebbe il fuoco a metà cifra. */
function notaPercentuali(){
  if(!S.acconti.length) return '';
  const somma=cent(S.acconti.reduce((s,a)=>s+numIT(percMostrata(a,S.active)),0));
  const tot=S.active===ID_TOT;
  const testo = tot
    ? 'Una sezione ha le rate decise a mano: qui vedi la percentuale che ne risulta.'
    : 'Rate decise a mano in questa sezione.';
  const etichetta = tot ? 'Riporta tutte al predefinito' : 'Riporta al predefinito';
  return `<div class="notaconc avviso"${somma===100?' hidden':''}>Le rate sommano al ${fmtQty(somma)}%.</div>`
       + `<div class="notaconc mano" id="notaMano"${rateAMano(S.active)?'':' hidden'}>${testo}
           <button class="rimetti" id="btnRimettiAcconti" title="Le sezioni tornano a seguire la percentuale predefinita">${etichetta}</button></div>`;
}

/** ridisegna il riquadro dei totali senza far perdere il segno a chi sta scrivendo */
function aggiornaTotali(){
  const prima=$('#inConcordato');
  const scriveva = prima && document.activeElement===prima;
  const punto = scriveva ? prima.selectionStart : null;
  $('#riquadroTotali').innerHTML=totaliHTML(totali(righeDi(S.active)));
  legaConcordato();
  if(scriveva){
    const dopo=$('#inConcordato');
    if(dopo){ dopo.focus(); try{ dopo.setSelectionRange(punto,punto); }catch(_){} }
  }
}

function legaConcordato(){
  /* Il prezzo concordato vale per tutto il preventivo: aggiungendolo compare in
     ogni TAB, togliendolo sparisce da tutti. Così la somma delle sezioni e la
     cifra del complessivo restano sempre due facce della stessa cosa. */
  const agg=$('#btnConcordato');
  if(agg) agg.onclick=()=>{
    S.concordati={};
    for(const t of S.tabs) S.concordati[t.id]='';
    tocca(); aggiornaTotali();
    $('#inConcordato')?.focus();
  };
  const via=$('#btnToglieConcordato');
  if(via) via.onclick=()=>{ S.concordati=null; tocca(); aggiornaTotali(); };

  const inp=$('#inConcordato');
  if(inp){
    /* Scrivendo nel complessivo la cifra si ripartisce fra le sezioni;
       ritoccando una sezione, il complessivo torna a essere la loro somma. */
    const propaga=()=>{ if(S.active===ID_TOT) ripartisciConcordato(); else sommaConcordati(); };
    /* Mentre si scrive NON si ridisegna il riquadro: si aggiorna solo la riga
       dello sconto. Rifacendo tutto a ogni tasto il campo verrebbe distrutto e
       ricreato sotto le dita, con il cursore che salta e il testo riscritto in
       bella copia prima di aver finito di digitarlo. */
    inp.oninput=()=>{ S.concordati[S.active]=inp.value; propaga(); tocca(); ricalcolaSconto(); };
    inp.onblur=()=>{
      if(String(valConcordato(S.active)).trim()==='') return;
      S.concordati[S.active]=fmtNum(numIT(valConcordato(S.active)));   // «1234.5» → «1.234,50»
      inp.value=S.concordati[S.active];
      propaga(); tocca(); ricalcolaSconto();
    };
  }

  /* Rate e acconti: nome e percentuale si scrivono a mano, l'importo lo calcola
     l'app. Come per il prezzo concordato, scrivendo non si ridisegna il
     riquadro: si riscrivono solo gli importi. */
  $('#btnAcconto')?.addEventListener('click',()=>{
    S.acconti.push({id:uid(), nome:'ACCONTO', perc:''});
    tocca(); aggiornaTotali();
    const ultimo=$$('#riquadroTotali .rt.acconto').pop();
    ultimo?.querySelector('.nome')?.select();
  });

  /* Le rate impostate a mano in questa sezione tornano a seguire la
     predefinita: si cancella la loro annotazione, non si riscrive niente. */
  const rimetti=$('#btnRimettiAcconti');
  if(rimetti) rimetti.onclick=()=>{
    for(const a of S.acconti){
      if(!a.sez) continue;
      if(S.active===ID_TOT) delete a.sez; else delete a.sez[S.active];
    }
    tocca(); aggiornaTotali();
  };

  $$('#riquadroTotali .rt.acconto').forEach(el=>{
    const a=S.acconti[+el.dataset.i];
    if(!a) return;
    const nome=el.querySelector('.nome'), perc=el.querySelector('.perc'), imp=el.querySelector('.imp');
    const indice=+el.dataset.i;
    nome.oninput=()=>{ a.nome=nome.value; nome.title=nome.value; tocca(); };

    /* La percentuale scritta va dove deve: nella sezione aperta, o nella
       predefinita se si sta nel complessivo. Poi le ALTRE rate della stessa
       sezione si aggiustano da sé per fare 100. */
    const scritta=valore=>{
      impostaPerc(a,S.active,valore);
      bilanciaAcconti(indice,S.active);
      riscriviPercentuali(perc);
      tocca(); ricalcolaAcconti();
    };
    perc.oninput=()=>scritta(perc.value);
    perc.onblur=()=>{
      if(perc.value.trim()==='') return;
      /* Una rata sta fra 0 e 100: finito di scrivere, la cifra si riporta nei
         limiti. Non lo si fa mentre si digita, o scrivendo «100» il campo
         verrebbe corretto già al primo «1». */
      /* Se nel campo c'è ancora quello che ci abbiamo scritto noi — la
         percentuale accorciata per leggerla — non si tocca niente: riscrivendo
         quella corta, l'importo pattuito si sposterebbe di qualche centesimo. */
      const piena=percAcconto(a,S.active);
      if(perc.value.trim()===percCorta(piena)) return;
      const v=percPiena(Math.max(0,Math.min(100,numIT(perc.value))));
      scritta(v); perc.value=percCorta(v);
    };

    /* L'importo, quando è lui a essere pattuito. Da «2.150 €» si torna
       indietro alla percentuale che quella cifra vale su questa sezione: da lì
       in poi è una rata come le altre, e il complessivo se ne accorge. */
    if(imp){
      const daImporto=()=>{
        const base=baseAcconti(S.active);
        const quota = base ? numIT(imp.value)*100/base : 0;
        impostaPerc(a,S.active,percPiena(Math.max(0,Math.min(100,quota))));
        bilanciaAcconti(indice,S.active);
        riscriviPercentuali(null);          // qui si scrive nell'importo: le percentuali si riscrivono tutte
        tocca(); ricalcolaAcconti(imp);
      };
      imp.oninput=daImporto;
      imp.onblur=()=>{ daImporto(); imp.value=fmtNum(importoAcconto(a,S.active)); };
    }

    el.querySelector('[data-act="delacc"]').onclick=()=>{
      S.acconti=S.acconti.filter(x=>x.id!==a.id);
      normalizzaAcconti();                  // le rimaste tornano a fare 100
      tocca(); aggiornaTotali();
    };
  });
}

/* Le rate devono fare 100. Toccandone una, le altre si spostano da sé: la
   parte che resta si divide fra loro in proporzione a quanto valevano, e
   l'ultima assorbe il resto degli arrotondamenti — così la somma è esatta al
   centesimo di punto. Se le altre erano tutte a zero si dividono la parte
   rimasta in parti uguali: non c'è una proporzione da rispettare.
   La riga su cui si sta scrivendo non si tocca mai. */
function bilanciaAcconti(i,tabId){
  const n=S.acconti.length;
  if(n<2 || i<0 || i>=n) return;                 // con una rata sola non c'è niente da bilanciare
  const scritta=Math.max(0,Math.min(100,numIT(percAcconto(S.acconti[i],tabId))));
  const resto=100-scritta;
  const altri=S.acconti.map((_,k)=>k).filter(k=>k!==i);
  const pesi=altri.map(k=>Math.max(0,numIT(percAcconto(S.acconti[k],tabId))));
  const somma=pesi.reduce((a,b)=>a+b,0);
  let dato=0;
  altri.forEach((k,j)=>{
    const ultimo = j===altri.length-1;
    const quota = ultimo
      ? resto-dato
      : (somma>0 ? resto*pesi[j]/somma : resto/altri.length);
    dato=dato+quota;
    impostaPerc(S.acconti[k],tabId,percPiena(quota));
  });
}

/* Tolta una rata, quelle rimaste tornano a fare 100 mantenendo le proporzioni
   di prima: 50/30/20 senza la seconda diventa 71,43/28,57. */
function normalizzaAcconti(){
  if(!S.acconti.length) return;
  normalizzaIn(ID_TOT);                                   // le predefinite
  for(const t of tabVoci()) if(sezioneRitoccata(t.id)) normalizzaIn(t.id);
}
function normalizzaIn(tabId){
  const n=S.acconti.length;
  const pesi=S.acconti.map(a=>Math.max(0,numIT(percAcconto(a,tabId))));
  const somma=pesi.reduce((a,b)=>a+b,0);
  if(cent(somma)===100) return;
  let dato=0;
  S.acconti.forEach((a,k)=>{
    const quota = k===n-1
      ? 100-dato
      : (somma>0 ? 100*pesi[k]/somma : 100/n);
    dato=dato+quota;
    impostaPerc(a,tabId,percPiena(quota));
  });
}

/* Riporta nei campi le percentuali ricalcolate, tranne quello in cui si sta
   scrivendo. Va scritta quella della SEZIONE APERTA: prendendo la predefinita,
   digitando l'importo di un acconto in una sezione il campo della percentuale
   veniva riportato al 50% a ogni tasto, e sembrava che l'app non tenesse dietro. */
function riscriviPercentuali(escluso){
  $$('#riquadroTotali .rt.acconto').forEach(el=>{
    const a=S.acconti[+el.dataset.i]; if(!a) return;
    const inp=el.querySelector('.perc');
    if(!inp || inp===escluso) return;
    const piena=percMostrata(a,S.active);
    const corta=percCorta(piena);
    if(inp.value!==corta) inp.value=corta;
    inp.title=inp.title.replace(/ — esatta: .*$/,'')+' — esatta: '+percEsatta(piena)+'%';
  });
}

/** aggiorna la sola riga dello sconto: compare quando c'è un prezzo, sparisce se no */
function ricalcolaSconto(){
  const riga=$('#rigaSconto');
  if(riga){
    const c=concordatoDi(totali(righeDi(S.active)));
    riga.hidden=!c;
    if(c){
      riga.querySelector('.k').textContent=etichettaSconto(c);
      riga.querySelector('.v').textContent=fmtEur(c.sconto);
    }
  }
  ricalcolaAcconti();      // cambiando il concordato cambia la base delle rate
}

/** riscrive i soli importi delle rate: il campo in cui si scrive non si tocca */
function ricalcolaAcconti(escluso){
  $$('#riquadroTotali .rt.acconto').forEach(el=>{
    const a=S.acconti[+el.dataset.i];
    if(!a) return;
    const imp=el.querySelector('.imp');
    if(imp){ if(imp!==escluso) imp.value=fmtNum(importoAcconto(a,S.active)); }
    else el.querySelector('.v').textContent=fmtEur(importoAcconto(a,S.active));
    el.classList.toggle('ritoccata',accontoRitoccato(a,S.active));
  });
  const mano=$('#notaMano');
  if(mano) mano.hidden=!rateAMano(S.active);
  const avviso=$('#riquadroTotali .notaconc.avviso');
  if(avviso){
    const somma=cent(S.acconti.reduce((s,a)=>s+numIT(percMostrata(a,S.active)),0));
    avviso.hidden = somma===100;
    avviso.textContent = `Le rate sommano al ${fmtQty(somma)}%.`;
  }
}

/* --- descrizioni: il riquadro prende l'altezza del suo testo, entro un massimo --- */
const ALT_MAX_DESC=96;
function adattaDescrizione(el){
  if(!el) return;
  el.style.height='auto';
  el.style.height=Math.min(el.scrollHeight,ALT_MAX_DESC)+'px';
  // se il testo è più lungo di quel che si vede, il pulsante si accende
  el.closest('.descbox')?.classList.toggle('lunga', el.scrollHeight>ALT_MAX_DESC+2);
}
function adattaDescrizioni(){ $$('#corpo textarea[data-k="descrizione"]').forEach(adattaDescrizione); }

/* ==============================================================================
   7. INTERAZIONE
   ============================================================================== */
function legaVista(){
  $('#btnIntest').onclick = dialogoIntestazione;
  $('#btnCliente').onclick = dialogoCliente;
  const spunta=$('#chkSemplice');
  if(spunta) spunta.onchange=()=>{ S.semplificato=spunta.checked; tocca(); render(); };
  /* nel complessivo semplificato le righe non si scrivono: il tasto non c'è */
  const piu=$('#btnRiga');
  if(piu) piu.onclick = ()=>{
    const r=nuovaRiga(S.active);
    render();
    const tr=$(`#corpo tr[data-id="${r.id}"]`);
    tr?.querySelector('input[data-k="articolo"]')?.focus();
    tr?.scrollIntoView({block:'nearest'});
  };
  $('#btnAnteprima').onclick = ()=>anteprimaStampa();
  $('#btnStampa').onclick = ()=>stampa();
  $('#btnPdf').onclick    = ()=>esportaPDF();
  $('#btnXls').onclick    = ()=>esportaExcel();

  $$('.barra .segbtns button').forEach(b=>b.onclick=()=>{
    OPZ.orizzontale = b.dataset.or==='o';
    salvaOpzioni(); render();
  });

  const sel=$('#btnSeleziona');
  if(sel) sel.onclick=e=>{ e.stopPropagation(); menuSeleziona(sel); };

  const sezTot=$('#btnSezioniTot');
  if(sezTot) sezTot.onclick=e=>{ e.stopPropagation(); menuSezioniTotale(sezTot); };
  adattaBarra();

  const dp=$('#dataPrev');
  legaCampoData(dp,v=>{ S.data=v; tocca(); });

  legaConcordato();

  const corpo=$('#corpo');

  corpo.addEventListener('input', e=>{
    const inp=e.target.closest('[data-k]'); if(!inp) return;
    const tr=inp.closest('tr[data-id]'); const r=rigaById(tr.dataset.id); if(!r) return;
    r[inp.dataset.k]=inp.value;
    if(inp.dataset.k==='descrizione') adattaDescrizione(inp);
    aggiornaCalcoli(tr,r);
    tocca();
  });

  /* Uscendo dal campo il numero si riscrive in bella copia: «1234.5» diventa
     «1.234,50». Si continua a poterlo scrivere come viene più comodo. */
  corpo.addEventListener('focusout', e=>{
    const inp=e.target.closest('input[data-k]'); if(!inp) return;
    const k=inp.dataset.k;
    if(k!=='prezzo'&&k!=='qta'&&k!=='iva'&&k!=='promo') return;
    const tr=inp.closest('tr[data-id]'); const r=rigaById(tr.dataset.id); if(!r) return;
    if(inp.value.trim()===''){ r[k]=''; return; }
    const n=numIT(inp.value);
    r[k]=String(n);
    inp.value = (k==='prezzo'||k==='promo') ? fmtNum(n) : fmtQty(n);
    aggiornaCalcoli(tr,r);
    tocca();
  });

  corpo.addEventListener('click', e=>{
    const b=e.target.closest('button[data-act]'); if(!b) return;
    /* Nel complessivo semplificato la riga non è una voce ma una sezione:
       cliccandola si va lì, dove quei numeri si possono cambiare. */
    if(b.dataset.act==='vaisez'){
      const riga=b.closest('tr[data-tab]');
      if(riga && tabById(riga.dataset.tab)){ S.active=riga.dataset.tab; tocca(); render(); }
      return;
    }
    const tr=b.closest('tr[data-id]'); if(!tr) return;
    const id=tr.dataset.id;
    if(b.dataset.act==='desc') dialogoDescrizione(id);
    if(b.dataset.act==='del')  eliminaRiga(id);
    if(b.dataset.act==='su')   spostaRiga(id,-1);
    if(b.dataset.act==='giu')  spostaRiga(id,+1);
    if(b.dataset.act==='vaitab'){
      const r=rigaById(id);
      if(r&&tabById(r.tabId)){ S.active=r.tabId; tocca(); render(); }
    }
  });

  /* Trascinamento delle righe. La riga diventa trascinabile solo se il dito è
     partito da un punto che non si scrive: premendo dentro una casella si deve
     poter selezionare il testo, non portarsi via la riga. Nel complessivo non
     si trascina niente: lì le righe arrivano da sezioni diverse e l'ordine è
     quello dei TAB. */
  if(S.active!==ID_TOT){
    corpo.addEventListener('mousedown',e=>{
      const tr=e.target.closest('tr[data-id]'); if(!tr) return;
      tr.draggable = !e.target.closest('input,textarea,select,button,[contenteditable]');
    });
    corpo.addEventListener('dragstart',e=>{
      const tr=e.target.closest('tr[data-id]'); if(!tr) return;
      rigaTrascinata=tr.dataset.id;
      tr.classList.add('sitrascina');
      try{ e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain',rigaTrascinata); }catch(_){}
    });
    corpo.addEventListener('dragover',e=>{
      const tr=e.target.closest('tr[data-id]');
      if(!tr||!rigaTrascinata||tr.dataset.id===rigaTrascinata) return;
      e.preventDefault();
      /* la riga si posa sopra o sotto quella puntata, a seconda di dove sta il
         mouse dentro di lei: è quello che si aspetta chi trascina */
      const m=tr.getBoundingClientRect();
      tr.classList.toggle('sopra', e.clientY < m.top+m.height/2);
      tr.classList.toggle('sotto', e.clientY >= m.top+m.height/2);
    });
    corpo.addEventListener('dragleave',e=>{
      const tr=e.target.closest('tr[data-id]');
      if(tr) tr.classList.remove('sopra','sotto');
    });
    corpo.addEventListener('drop',e=>{
      const tr=e.target.closest('tr[data-id]');
      if(!tr||!rigaTrascinata) return;
      e.preventDefault();
      const m=tr.getBoundingClientRect();
      const prima = e.clientY < m.top+m.height/2;
      const da=rigaTrascinata; rigaTrascinata=null;
      posaRiga(da,tr.dataset.id,prima);
    });
    corpo.addEventListener('dragend',()=>{
      rigaTrascinata=null;
      $$('#corpo tr').forEach(tr=>tr.classList.remove('sitrascina','sopra','sotto'));
    });
  }

  /* Ctrl+Invio aggiunge una riga: le mani restano sulla tastiera. */
  corpo.addEventListener('keydown', e=>{
    if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){ e.preventDefault(); $('#btnRiga')?.click(); }
  });
}

/** ricalcola solo la riga toccata e il riquadro dei totali: il fuoco non si perde */
function aggiornaCalcoli(tr,r){
  const c=calcoloRiga(r);
  const scrivi=(sel,sopra,sotto)=>{
    const cella=tr.querySelector(sel);
    const o=cella.querySelector('.orig'), p=cella.querySelector('.pro');
    if(o&&p){ o.textContent=sopra; p.textContent=sotto; }   // riga in promo
    else cella.textContent=sotto;
  };
  scrivi('[data-c="imponibile"]', fmtNum(c.originale.imponibile), fmtNum(c.imponibile));
  scrivi('[data-c="totale"]',     fmtEur(c.originale.totale),     fmtEur(c.totale));
  aggiornaTotali();
  const cnt=$(`.tab[data-id="${S.active}"] .cnt`);
  if(cnt) cnt.textContent=righeDi(S.active).length;
}

/* ==============================================================================
   8. FINESTRE — descrizione, intestazione, dati cliente
   ============================================================================== */
function modal(titolo,corpoHTML,bottoni=[{label:'Chiudi'}],onOpen,cls='',onClose){
  const ov=$('#overlay'), m=$('#modal');
  m.className='modal '+cls;
  /* La «x» in alto a sinistra si mette solo dove serve poter chiudere senza
     rispondere: la si chiede con la classe «conx». */
  const conX = /\bconx\b/.test(cls||'');
  m.innerHTML=`<h3><span>${esc(titolo)}</span>${conX?`<button class="chiudix" title="Chiudi">×</button>`:''}</h3>
    <div class="body">${corpoHTML}</div>
    <div class="foot">${bottoni.map((b,i)=>`<button data-i="${i}" class="${b.primary?'primary':b.danger?'danger':''}">${esc(b.label)}</button>`).join('')}</div>`;
  ov.hidden=false;
  const chiudi=()=>{ ov.hidden=true; m.innerHTML=''; document.removeEventListener('keydown',tasto); if(onClose) onClose(); };
  const tasto=e=>{ if(e.key==='Escape') chiudi(); };
  document.addEventListener('keydown',tasto);
  const x=m.querySelector('.chiudix');
  if(x) x.onclick=chiudi;
  $$('.foot button',m).forEach(b=>b.onclick=async()=>{
    const cfg=bottoni[+b.dataset.i];
    if(cfg.fn){ const r=await cfg.fn(); if(r===false) return; }
    chiudi();
  });
  /* Clic sullo sfondo.
     Nelle finestre in cui si SCRIVE non chiude niente: si esce solo con i
     pulsanti o con Esc. Tornando nell'app dopo essere andati in un altro
     programma, il clic con cui si riattiva la finestra cade quasi sempre sullo
     sfondo — e si portava via la descrizione o l'intestazione appena scritta.
     Lo stesso capitava selezionando il testo e lasciando il pulsante fuori: il
     browser assegna quel clic all'antenato comune fra dove si è premuto e dove
     si è lasciato, cioè allo sfondo.
     Nelle finestre di sola conferma, dove non c'è niente da perdere, il clic
     fuori continua a chiudere: ma solo se è cominciato E finito sullo sfondo. */
  const siScrive = !!m.querySelector('input,textarea,select,[contenteditable="true"]');
  let giuSulloSfondo=false, suSulloSfondo=false;
  ov.onmousedown=e=>{ giuSulloSfondo = (e.target===ov); };
  ov.onmouseup  =e=>{ suSulloSfondo  = (e.target===ov); };
  ov.onclick=e=>{
    const chiudere = !siScrive && giuSulloSfondo && suSulloSfondo && e.target===ov;
    giuSulloSfondo = suSulloSfondo = false;
    if(chiudere) chiudi();
  };
  if(onOpen) setTimeout(onOpen,30);
}

/* --- descrizione in grande: tutto il testo, senza limiti di riga --- */
function dialogoDescrizione(idRiga){
  const r=rigaById(idRiga); if(!r) return;
  const nome=r.articolo?`Descrizione — ${r.articolo}`:'Descrizione';
  modal(nome,
    `<textarea id="mDesc" class="grande" placeholder="Scrivi qui la descrizione, quanto ti serve.">${esc(r.descrizione)}</textarea>
     <p class="hint">Il testo viene stampato per intero: nel preventivo la colonna Descrizione si allarga da sola.</p>`,
    [{label:'Annulla'},{label:'Salva',primary:true,fn:()=>{
      r.descrizione=$('#mDesc').value;
      tocca();
      const tr=$(`#corpo tr[data-id="${r.id}"]`);
      if(tr){
        const ta=tr.querySelector('textarea[data-k="descrizione"]');
        ta.value=r.descrizione; adattaDescrizione(ta);
      }
    }}],
    ()=>{ const t=$('#mDesc'); t.focus(); t.setSelectionRange(t.value.length,t.value.length); },
    'wide');
}

/* --- dati del cliente: si vedono solo sulla carta --- */
function dialogoCliente(){
  const c=S.cliente;
  modal('Dati Cliente',`
    <label class="fld">Cliente:<input id="cNome" value="${esc(c.nome)}" placeholder="Ragione sociale o nome e cognome"></label>
    <label class="fld" style="margin-top:11px">Indirizzo:<input id="cInd" value="${esc(c.indirizzo)}" placeholder="Via, numero civico, CAP, città"></label>
    <div class="grid2" style="margin-top:11px">
      <label class="fld">Cell:<input id="cCell" value="${esc(c.cell)}" placeholder="+39 …"></label>
      <label class="fld">Mail:<input id="cMail" value="${esc(c.mail)}" placeholder="nome@dominio.it"></label>
    </div>
    <p class="hint">Non compaiono mentre compili: si vedono solo nella stampa e nell'esportazione, a sinistra, con la data accanto.</p>
  `,[{label:'Annulla'},{label:'Salva',primary:true,fn:()=>{
    S.cliente={nome:$('#cNome').value.trim(),indirizzo:$('#cInd').value.trim(),
               cell:$('#cCell').value.trim(),mail:$('#cMail').value.trim()};
    tocca(); toast('Dati cliente salvati','ok');
  }}],()=>$('#cNome').focus());
}

/* --- intestazione: uguale in tutti i tab, la stessa per ogni preventivo --- */
const FAMIGLIE=['Arial','Calibri','Cambria','Courier New','Garamond','Georgia','Segoe UI','Tahoma','Times New Roman','Trebuchet MS','Verdana'];
const DIMENSIONI=[8,9,10,11,12,14,16,18,20,22,24,28,32,36,48];

function dialogoIntestazione(){
  let staccaStato=null;              // smonta l'ascolto della selezione alla chiusura
  modal('Intestazione',`
    <div class="editbar">
      <div class="gr">
        <select class="fam" id="eFam" title="Carattere">
          <option value="">Carattere</option>
          ${FAMIGLIE.map(f=>`<option value="${esc(f)}" style="font-family:${esc(f)}">${esc(f)}</option>`).join('')}
        </select>
        <select class="dim" id="eDim" title="Dimensione">
          <option value="">Dim.</option>
          ${DIMENSIONI.map(d=>`<option value="${d}">${d}</option>`).join('')}
        </select>
      </div>
      <div class="gr">
        <button class="b" data-cmd="bold" title="Grassetto (Ctrl+B)">G</button>
        <button class="i" data-cmd="italic" title="Corsivo (Ctrl+I)">C</button>
        <button class="u" data-cmd="underline" title="Sottolineato (Ctrl+U)">S</button>
      </div>
      <div class="gr">
        <button data-cmd="justifyLeft" title="Allinea a sinistra">⇤</button>
        <button data-cmd="justifyCenter" title="Centra">↔</button>
        <button data-cmd="justifyRight" title="Allinea a destra">⇥</button>
      </div>
      <div class="gr">
        <input type="color" id="eCol" value="#000000" title="Colore del testo">
        <button data-cmd="insertUnorderedList" title="Elenco puntato">•—</button>
        <button data-cmd="removeFormat" title="Togli la formattazione">⌫</button>
      </div>
    </div>
    <div class="editor" id="eBody" contenteditable="true" spellcheck="false"
         data-vuoto="Scrivi qui l'intestazione: nome dell'azienda, indirizzo, partita IVA, contatti…"></div>

    <div class="intestgest">
      <label class="fld grow">Intestazioni salvate nella cartella «Intestazione»
        <select id="eSalvate"><option value="">— nessuna ancora —</option></select>
      </label>
      <button id="eCarica" title="Porta nell'editor l'intestazione scelta">Carica</button>
      <button id="eElimina" class="danger" title="Elimina il file scelto">Elimina</button>
      <button id="eApri" class="ghost" title="Apri la cartella «Intestazione»">📁</button>
    </div>
    <div class="intestgest">
      <label class="fld grow">Salva questa intestazione con il nome
        <input id="eNome" placeholder="es. Carta intestata ditta" maxlength="60" autocomplete="off">
      </label>
      <button id="eSalvaFile">💾 Salva nella cartella</button>
    </div>

    <p class="hint">Non si vede mentre compili il preventivo: compare in cima al foglio nella stampa e nell'esportazione, uguale in tutti i TAB.<br>
    <b>Salva</b> usa l'intestazione in questo preventivo. <b>Usa come Predefinita</b> la mette anche in tutti quelli nuovi.</p>
  `,[{label:'Annulla'},
     {label:'★ Usa come Predefinita',fn:async()=>{
        const html=pulisciHTML($('#eBody').innerHTML);
        INTEST=html;
        await salvaPredefinita(html);
        tocca(); toast('Intestazione predefinita impostata','ok');
     }},
     {label:'Salva',primary:true,fn:()=>{
        INTEST=pulisciHTML($('#eBody').innerHTML);
        tocca(); toast('Intestazione salvata nel preventivo','ok');
     }}],
    ()=>{
      const ed=$('#eBody');
      ed.innerHTML=INTEST||'';
      ed.focus();
      legaCartellaIntestazioni(ed);
      try{ document.execCommand('styleWithCSS',false,true); }catch(_){}

      const stato=legaStatoPulsanti(ed);
      staccaStato=stato.stacca;
      legaIncolla(ed);

      $$('.editbar button[data-cmd]').forEach(b=>b.onmousedown=e=>{
        e.preventDefault();                      // non far perdere la selezione
        document.execCommand(b.dataset.cmd,false,null);
        ed.focus();
        stato.aggiorna();
      });
      /* Dopo aver scelto, il menu NON si azzera: resta a mostrare la misura
         che il testo ha adesso, come la barra di Excel. */
      $('#eFam').onchange=e=>{
        if(e.target.value) document.execCommand('fontName',false,e.target.value);
        ed.focus(); stato.aggiorna();
      };
      $('#eDim').onchange=e=>{
        if(e.target.value) impostaDimensione(ed, +e.target.value);
        ed.focus(); stato.aggiorna();
      };
      $('#eCol').oninput=e=>{ document.execCommand('foreColor',false,e.target.value); ed.focus(); };
    },'wide',
    ()=>{ if(staccaStato) staccaStato(); });
}

/* Incollando da una mail o da un sito arrivano anche le misure del carattere di
   quel documento: righe che là stavano bene, qui vengono una diversa dall'altra
   e non corrispondono a niente di scelto. Si tiene quel che si è voluto —
   grassetto, corsivo, sottolineato, allineamento — e si lasciano fuori misure e
   famiglie, che le decide la barra qui sopra. */
function legaIncolla(ed){
  ed.addEventListener('paste', e=>{
    const app=e.clipboardData;
    if(!app) return;
    e.preventDefault();
    const html=app.getData('text/html');
    let pezzo;
    if(html){
      const d=document.createElement('div');
      d.innerHTML=pulisciHTML(html);
      $$('*',d).forEach(n=>{
        if(n.style){
          n.style.removeProperty('font-size');
          n.style.removeProperty('font-family');
          n.style.removeProperty('line-height');
        }
        n.removeAttribute('size');
        n.removeAttribute('face');
      });
      pezzo=d.innerHTML;
    }else{
      pezzo=esc(app.getData('text/plain')).replace(/\r?\n/g,'<br>');
    }
    document.execCommand('insertHTML',false,pezzo);
  });
}

/* I pulsanti di formattazione si accendono da soli.
   Non solo quando li si preme: anche portando il cursore dentro una parola già
   in grassetto, il pulsante G risulta premuto — così si vede sempre com'è
   scritto il punto in cui ci si trova, senza doverlo indovinare. */
/* Che misura ha il testo dove mi trovo?
   Non lo si chiede a execCommand, che conosce solo sette misure e mente appena
   il testo è stato scritto in CSS: lo si legge dal testo stesso, convertendo da
   pixel a punti tipografici — gli stessi numeri dell'elenco.
   Selezionando un tratto con misure diverse non se ne inventa una: si risponde
   null, e la barra lo dice invece di mostrarne una sbagliata. */
function dimensioneCorrente(ed){
  const sel=document.getSelection();
  if(!sel||!sel.rangeCount) return undefined;
  const range=sel.getRangeAt(0);
  if(!ed.contains(range.commonAncestorContainer)) return undefined;

  const inPunti=nodo=>{
    const el=nodo.nodeType===3?nodo.parentElement:nodo;
    if(!el) return null;
    const px=parseFloat(getComputedStyle(el).fontSize);
    return px?Math.round(px*0.75*10)/10:null;      // 1pt = 1px × 72/96
  };
  if(sel.isCollapsed) return inPunti(range.startContainer);

  const misure=new Set();
  (function cammina(n){
    if(n.nodeType===3){
      if(n.textContent.trim() && range.intersectsNode(n)) misure.add(inPunti(n));
      return;
    }
    for(const f of n.childNodes) cammina(f);
  })(ed);
  if(!misure.size) return inPunti(range.startContainer);
  return misure.size===1 ? [...misure][0] : null;   // null = misure diverse
}

/** lo stesso, per il carattere: si mostra solo se è uno dei nostri */
function famigliaCorrente(ed){
  const sel=document.getSelection();
  if(!sel||!sel.rangeCount) return undefined;
  const range=sel.getRangeAt(0);
  if(!ed.contains(range.commonAncestorContainer)) return undefined;
  const n=range.startContainer;
  const el=n.nodeType===3?n.parentElement:n;
  if(!el) return null;
  const prima=(getComputedStyle(el).fontFamily||'').split(',')[0].replace(/["']/g,'').trim();
  return FAMIGLIE.find(f=>f.toLowerCase()===prima.toLowerCase()) || null;
}

/** scrive nel menu la misura del punto in cui ci si trova */
function mostraDimensione(pt){
  const sel=$('#eDim');
  if(!sel||pt===undefined) return;
  const vuota=sel.options[0];
  // le misure arrivate incollando possono non essere in elenco: si aggiungono
  [...sel.querySelectorAll('option[data-extra]')].forEach(o=>o.remove());
  if(pt===null){ vuota.textContent='—'; sel.value=''; return; }
  vuota.textContent='Dim.';
  const v=String(pt);
  if(![...sel.options].some(o=>o.value===v)){
    const o=document.createElement('option');
    o.value=v; o.textContent=v; o.dataset.extra='1';
    sel.insertBefore(o, [...sel.options].find(x=>x.value&&+x.value>pt) || null);
  }
  sel.value=v;
}

function mostraFamiglia(nome){
  const sel=$('#eFam');
  if(!sel||nome===undefined) return;
  sel.options[0].textContent = nome ? 'Carattere' : '—';
  sel.value = nome || '';
}

function legaStatoPulsanti(ed){
  // «togli la formattazione» non è un interruttore: non si accende mai
  const pulsanti=$$('.editbar button[data-cmd]').filter(b=>b.dataset.cmd!=='removeFormat');
  const aggiorna=()=>{
    for(const b of pulsanti){
      let acceso=false;
      try{ acceso=document.queryCommandState(b.dataset.cmd); }catch(_){}
      b.classList.toggle('on',acceso);
      b.setAttribute('aria-pressed',acceso?'true':'false');
    }
    mostraDimensione(dimensioneCorrente(ed));
    mostraFamiglia(famigliaCorrente(ed));
  };
  /* «selectionchange» arriva sul documento, non sull'editor: si risponde solo
     mentre il fuoco è davvero lì dentro, altrimenti si darebbe retta anche alle
     selezioni fatte negli altri campi della finestra. */
  const suSelezione=()=>{ if(ed.contains(document.getSelection()?.anchorNode)) aggiorna(); };
  document.addEventListener('selectionchange',suSelezione);
  ed.addEventListener('keyup',aggiorna);
  ed.addEventListener('mouseup',aggiorna);
  ed.addEventListener('focus',aggiorna);
  aggiorna();
  return { aggiorna, stacca:()=>document.removeEventListener('selectionchange',suSelezione) };
}

/* --- la cartella «Intestazione»: elenco, carica, salva, elimina --- */
function legaCartellaIntestazioni(ed){
  const sel=$('#eSalvate'), nome=$('#eNome');

  const riempi=async(scegli)=>{
    let elenco=[];
    try{ elenco=await IO.intestElenco(); }catch(_){}
    sel.innerHTML = elenco.length
      ? '<option value="">— scegli —</option>'+elenco.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('')
      : '<option value="">— nessuna ancora —</option>';
    if(scegli && elenco.includes(scegli)) sel.value=scegli;
  };
  riempi();

  // scegliendone una dall'elenco il nome si riporta da solo nel campo:
  // risalvarla sopra è la cosa che si fa più spesso
  sel.onchange=()=>{ if(sel.value) nome.value=sel.value; ripristinaElimina(); };

  $('#eCarica').onclick=async()=>{
    if(!sel.value) return toast('Scegli prima un\'intestazione dall\'elenco','err');
    const html=await IO.intestLeggi(sel.value);
    if(html==null) return toast('Intestazione non trovata','err');
    ed.innerHTML=pulisciHTML(html);
    toast('«'+sel.value+'» caricata','ok');
  };

  $('#eSalvaFile').onclick=async()=>{
    const n=(nome.value||'').trim();
    if(!n){ nome.focus(); return toast('Dai un nome all\'intestazione','err'); }
    const r=await IO.intestScrivi(n, pulisciHTML(ed.innerHTML));
    if(r&&r.errore) return toast(r.errore,'err');
    await riempi(r&&r.nome||n);
    toast('Salvata nella cartella «Intestazione»','ok');
  };

  /* Eliminare è definitivo: il pulsante chiede conferma da solo, senza aprire
     un'altra finestra sopra questa (ci sarebbe una finestra sola, e si
     perderebbe quel che c'è nell'editor). */
  const btnDel=$('#eElimina');
  const ripristinaElimina=()=>{ btnDel.textContent='Elimina'; btnDel.dataset.conferma=''; };
  btnDel.onclick=async()=>{
    if(!sel.value){ ripristinaElimina(); return toast('Scegli prima un\'intestazione dall\'elenco','err'); }
    if(btnDel.dataset.conferma!==sel.value){
      btnDel.dataset.conferma=sel.value;
      btnDel.textContent='Confermi?';
      setTimeout(ripristinaElimina,4000);
      return;
    }
    const r=await IO.intestElimina(sel.value);
    ripristinaElimina();
    if(r&&r.errore) return toast(r.errore,'err');
    await riempi();
    toast('Intestazione eliminata');
  };

  $('#eApri').onclick=()=>IO.intestApriCartella();
  if(!IO.desktop) $('#eApri').hidden=true;   // nel browser non c'è una cartella da aprire
}

/* execCommand conosce solo sette dimensioni: si usa la più grande come segnalibro
   e subito dopo la si sostituisce con la misura vera, in punti tipografici — gli
   stessi che si scelgono in Excel.
   Il segnalibro va cercato però nella forma giusta: con «styleWithCSS» acceso —
   che serve a tutto il resto della barra — execCommand non scrive più
   <font size=7> ma <span style="font-size: xxx-large">, e la sostituzione non
   trovava niente. Risultato: qualunque misura si scegliesse, il testo restava
   xxx-large, e righe che dovevano essere diverse venivano tutte enormi uguali.
   Per questo comando lo si spegne un attimo e lo si riaccende subito. */
function impostaDimensione(editor,pt){
  try{ document.execCommand('styleWithCSS',false,false); }catch(_){}
  document.execCommand('fontSize',false,'7');
  try{ document.execCommand('styleWithCSS',false,true); }catch(_){}
  $$('font[size="7"]',editor).forEach(f=>{
    const s=document.createElement('span');
    s.style.fontSize=pt+'pt';
    while(f.firstChild) s.appendChild(f.firstChild);
    f.replaceWith(s);
  });
  /* Rete di sicurezza: se una versione futura del motore scrivesse comunque in
     CSS, la misura scelta vince lo stesso invece di lasciare un xxx-large. */
  $$('span[style*="xxx-large"]',editor).forEach(s=>{ s.style.fontSize=pt+'pt'; });
}

/* L'intestazione viene riscritta nella pagina: quello che entra passa da qui,
   così un copia-incolla da una pagina web non porta dentro codice. */
const TAG_OK=new Set(['B','STRONG','I','EM','U','S','SPAN','DIV','P','BR','FONT','H1','H2','H3','H4','H5','H6','UL','OL','LI','TABLE','THEAD','TBODY','TR','TD','TH','HR','SUB','SUP','CENTER','SMALL','BIG']);
const ATTR_OK=new Set(['style','align','color','face','size','width','height','colspan','rowspan']);
function pulisciHTML(html){
  const doc=new DOMParser().parseFromString('<div id="r">'+String(html||'')+'</div>','text/html');
  const radice=doc.getElementById('r');
  const passa=n=>{
    [...n.children].forEach(passa);
    if(!TAG_OK.has(n.tagName)){
      // il contenuto si salva, l'involucro no
      const p=n.parentNode;
      while(n.firstChild) p.insertBefore(n.firstChild,n);
      n.remove();
      return;
    }
    [...n.attributes].forEach(a=>{
      const nome=a.name.toLowerCase();
      if(!ATTR_OK.has(nome)) return n.removeAttribute(a.name);
      if(nome==='style'&&/(url\s*\(|expression|position\s*:\s*fixed|@import)/i.test(a.value)) n.removeAttribute(a.name);
    });
  };
  [...radice.children].forEach(passa);
  return radice.innerHTML;
}

/* ==============================================================================
   9. IL FOGLIO STAMPATO
   Viene costruito al momento: intestazione, dati del cliente con la data
   accanto, poi la tabella con i totali in fondo.
   ============================================================================== */
/* Che cosa finisce nel foglio stampato o esportato: la sola sezione aperta,
   tutte in fila, oppure quelle segnate col tasto «Seleziona». L'ordine è sempre
   quello dei TAB, che si trascinano. */

/* I TAB che si possono stampare: le sezioni e, in testa, il PREVENTIVO
   COMPLESSIVO, che è un foglio a tutti gli effetti — raccoglie le righe di
   tutte le sezioni e ha i suoi totali. Restano fuori solo eventuali TAB di
   altro genere. L'ordine è quello dei TAB, che si trascinano. */
function tabStampabili(){
  return S.tabs.filter(t=>t.type==='tot'||t.type==='voci');
}

/* Le sezioni segnate si tengono per identificativo, ma gli identificativi
   cambiano da un preventivo all'altro: quelli di un documento chiuso non
   valgono più, e si scartano. */
function sceltePulite(){
  const esistenti=new Set(tabStampabili().map(t=>t.id));
  return (OPZ.scelte||[]).filter(id=>esistenti.has(id));
}

/* Il complessivo apre o chiude il documento: c'è chi mette davanti il totale,
   perché è la cifra che il cliente cerca, e chi lo tiene per ultimo, dopo aver
   mostrato da che cosa nasce. Vale per anteprima, stampa, PDF ed Excel — che
   partono tutti da questo stesso elenco. */
function ordinaTot(ids){
  if(!ids.includes(ID_TOT)) return ids;
  const altri=ids.filter(id=>id!==ID_TOT);
  return OPZ.totInFondo ? [...altri,ID_TOT] : [ID_TOT,...altri];
}

function ambitoTabs(){
  const sezioni=tabStampabili().map(t=>t.id);
  if(OPZ.ambito==='scelte'){
    const segnate=new Set(sceltePulite());
    const scelte=sezioni.filter(id=>segnate.has(id));   // nell'ordine dei TAB
    if(scelte.length) return ordinaTot(scelte);
    // niente di segnato: si ripiega sulla sezione aperta, che è sempre qualcosa
    return [S.active];
  }
  if(OPZ.ambito!=='tutte') return [S.active];
  return sezioni.length?ordinaTot(sezioni):[S.active];
}

/** in parole: che cosa verrà stampato — serve al suggerimento del tasto */
function descrizioneAmbito(){
  const che='Che cosa finisce in anteprima, stampa, PDF ed Excel: ';
  const dove = ambitoTabs().includes(ID_TOT)
    ? ' Il preventivo complessivo va '+(OPZ.totInFondo?'in fondo.':'in cima.')
    : '';
  if(OPZ.ambito==='tutte') return che+'il preventivo complessivo e tutte le sezioni.'+dove;
  if(OPZ.ambito==='scelte'){
    const nomi=ambitoTabs().map(id=>(tabById(id)||{}).name).filter(Boolean);
    return che+(nomi.length>1?'le sezioni segnate ('+nomi.join(', ')+').':nomi[0]||'la sezione aperta.')+dove;
  }
  return che+'solo la sezione aperta.';
}

/* Il menu del tasto «Seleziona»: le due scelte veloci in cima, sotto l'elenco
   delle sezioni con la spunta. Le spunte mostrano sempre che cosa verrà
   stampato, anche quando la scelta arriva dalle due voci di sopra: segnandone
   una a mano si passa alla scelta libera. */
function menuSeleziona(tasto){
  chiudiMenuDom();
  const sezioni=tabStampabili();
  const attive=new Set(ambitoTabs());
  /* Il complessivo porta il suo nome tutto maiuscolo, che in mezzo all'elenco
     griderebbe: qui si scrive come gli altri. */
  const nomeVoce = t => t.type==='tot' ? 'Preventivo Complessivo' : t.name;
  const m=document.createElement('div');
  m.className='menuctx menusel';
  m.innerHTML=
    `<button data-m="tutte"${OPZ.ambito==='tutte'?' class="segnata"':''}>Tutte le sezioni</button>`+
    `<button data-m="tab"${OPZ.ambito==='tab'?' class="segnata"':''}>Sezione corrente</button>`+
    `<div class="divisore"></div>`+
    (sezioni.length
      ? sezioni.map(t=>`<label class="spunta"><input type="checkbox" data-id="${esc(t.id)}"${attive.has(t.id)?' checked':''}><span>${esc(nomeVoce(t))}</span></label>`).join('')
      : `<div class="vuoto">Nessuna sezione</div>`)+
    `<div class="divisore"></div>`+
    `<div class="titolo">Preventivo Complessivo</div>`+
    `<button data-p="cima"${OPZ.totInFondo?'':' class="segnata"'}>In cima</button>`+
    `<button data-p="fondo"${OPZ.totInFondo?' class="segnata"':''}>In fondo</button>`;
  document.body.appendChild(m);

  // sotto al tasto, e se non ci sta si sposta quanto basta per restare a video
  const r=tasto.getBoundingClientRect();
  collocaFluttuante(m,r.left,r.bottom+6);

  m.addEventListener('click',ev=>{
    /* Dove va il complessivo non chiude il menu: è una scelta che si prende
       guardando l'elenco delle sezioni, e spesso si cambia idea subito. */
    const dove=ev.target.closest('button[data-p]');
    if(dove){
      OPZ.totInFondo = dove.dataset.p==='fondo';
      salvaOpzioni();
      m.querySelectorAll('button[data-p]').forEach(b=>b.classList.toggle('segnata',b===dove));
      const t=$('#btnSeleziona'); if(t) t.title=descrizioneAmbito();
      return;
    }
    const scelta=ev.target.closest('button[data-m]');
    if(!scelta) return;
    OPZ.ambito=scelta.dataset.m; salvaOpzioni();
    chiudiSeleziona(); render();
  });

  /* Le spunte non chiudono il menu: se ne segnano più d'una di seguito. */
  m.addEventListener('change',ev=>{
    if(!ev.target.matches('input[type="checkbox"]')) return;
    OPZ.ambito='scelte';
    OPZ.scelte=[...m.querySelectorAll('input[type="checkbox"]:checked')].map(c=>c.dataset.id);
    salvaOpzioni();
    m.querySelectorAll('button[data-m]').forEach(b2=>b2.classList.remove('segnata'));
    const t2=$('#btnSeleziona'); if(t2) t2.title=descrizioneAmbito();
  });

  const fuori=ev=>{ if(!m.contains(ev.target) && ev.target!==tasto) chiudiSeleziona(); };
  const tastiera=ev=>{ if(ev.key==='Escape') chiudiSeleziona(); };
  function chiudiSeleziona(){
    document.removeEventListener('mousedown',fuori);
    document.removeEventListener('keydown',tastiera);
    m.remove();
  }
  setTimeout(()=>{
    document.addEventListener('mousedown',fuori);
    document.addEventListener('keydown',tastiera);
  },0);
}

/* Una sezione tolta dal complessivo si stacca anche dalle rate: le percentuali
   che aveva in quel momento diventano sue. Senza questo, cambiando le rate dal
   complessivo cambierebbero anche a lei — che con quel totale non c'entra più
   niente. Rimettendola dentro, se le sue percentuali sono rimaste quelle
   predefinite torna semplicemente a seguirle. */
function staccaAccontiDi(tabId){
  for(const a of S.acconti) impostaPerc(a,tabId,percAcconto(a,tabId));
}
function riattaccaAccontiDi(tabId){
  for(const a of S.acconti)
    if(a.sez && a.sez[tabId]!=null && numIT(a.sez[tabId])===numIT(a.perc)) delete a.sez[tabId];
}

/* Quali sezioni entrano nel complessivo. Togliendone una, il preventivo
   complessivo smette di contarla: la sezione resta al suo posto, intatta, e
   basta rimetterle la spunta per riaverla dentro. */
function menuSezioniTotale(tasto){
  chiudiMenuDom();
  const sezioni=tabVoci();
  const m=document.createElement('div');
  m.className='menuctx menusel';
  m.innerHTML=
    `<div class="titolo">Sezioni nel Preventivo Complessivo</div>`+
    (sezioni.length
      ? sezioni.map(t=>`<label class="spunta"><input type="checkbox" data-id="${esc(t.id)}"${esclusaDalTotale(t.id)?'':' checked'}><span>${esc(t.icon||'📄')} ${esc(t.name)}</span></label>`).join('')
      : `<div class="vuoto">Nessuna sezione</div>`)+
    `<div class="divisore"></div>`+
    `<button data-m="tutte">Rimettile tutte</button>`;
  document.body.appendChild(m);

  const r=tasto.getBoundingClientRect();
  collocaFluttuante(m,r.left,r.bottom+6);

  /* Le spunte non chiudono il menu: se ne tolgono e rimettono più d'una di
     seguito, guardando intanto come cambia il totale dietro. */
  const applica=()=>{
    const prima=new Set(Array.isArray(S.escluse)?S.escluse:[]);
    const ora=[...m.querySelectorAll('input[type="checkbox"]:not(:checked)')].map(c=>c.dataset.id);
    for(const id of ora)   if(!prima.has(id))    staccaAccontiDi(id);      // appena tolta
    for(const id of prima) if(!ora.includes(id)) riattaccaAccontiDi(id);   // appena rimessa
    S.escluse=ora;
    tocca(); render();
  };
  m.addEventListener('change',ev=>{ if(ev.target.matches('input[type="checkbox"]')) applica(); });
  m.addEventListener('click',ev=>{
    if(!ev.target.closest('button[data-m="tutte"]')) return;
    m.querySelectorAll('input[type="checkbox"]').forEach(c=>{ c.checked=true; });
    applica();
  });

  const fuori=ev=>{ if(!m.contains(ev.target) && ev.target!==tasto) chiudi(); };
  const tastiera=ev=>{ if(ev.key==='Escape') chiudi(); };
  function chiudi(){
    document.removeEventListener('mousedown',fuori);
    document.removeEventListener('keydown',tastiera);
    m.remove();
  }
  setTimeout(()=>{
    document.addEventListener('mousedown',fuori);
    document.addEventListener('keydown',tastiera);
  },0);
}

/* I comandi in cima stanno su UNA riga sola, sempre, e in mezzo allo schermo.
   Quando non ci stanno — schermo piccolo, o il complessivo che ha due voci in
   più delle sezioni — invece di andare a capo si stringono di un gradino, e se
   ancora non basta di due: meglio due pixel di imbottitura in meno che una
   fila di tasti che balla da una riga all'altra. */
function adattaBarra(){
  const b=$('.barra'); if(!b) return;
  b.classList.remove('stretta','strettissima');
  if(b.scrollWidth<=b.clientWidth+1) return;
  b.classList.add('stretta');
  if(b.scrollWidth<=b.clientWidth+1) return;
  b.classList.add('strettissima');
  /* Se nemmeno stringendo ci sta — finestra molto piccola — si smette di
     centrare: centrata, la riga verrebbe tagliata da tutte e due le parti e
     non si capirebbe nemmeno da che parte cercare il resto. */
  b.classList.toggle('trabocca', b.scrollWidth>b.clientWidth+1);
}
addEventListener('resize',adattaBarra);

function applicaFormatoPagina(){
  const verso = OPZ.orizzontale ? 'landscape' : 'portrait';
  // margini stretti ma sicuri: nessuna stampante arriva al bordo del foglio
  $('#pageStyle').textContent = `@page{ size:A4 ${verso}; margin:12mm 11mm 14mm; }`;
}

/* I dati del cliente stanno accanto all'intestazione, quindi in mezzo foglio:
   lì le due colonne non ci stanno più — i recapiti restavano senza spazio e il
   blocco si allungava a vuoto. Uno sotto l'altro, etichetta e valore
   incolonnati, occupano meno e si leggono meglio. */
function clienteStampaHTML(){
  const c=S.cliente;
  const r=(k,v)=> v?`<div class="r"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>`:'';
  return r('Cliente:',c.nome)+r('Indirizzo:',c.indirizzo)+r('Cell:',c.cell)+r('Mail:',c.mail);
}

/* Il foglio stampato: una sezione sola, oppure tutte in fila in un documento
   unico, ognuna con la sua intestazione, i suoi dati e i suoi totali, e un
   salto pagina fra l'una e l'altra. */
function costruisciStampa(){
  const ids=ambitoTabs();
  $('#stampa').innerHTML = ids
    .map((id,i)=>`<div class="st-sezione${i<ids.length-1?' salta':''}">${foglioStampaHTML(id)}</div>`)
    .join('');
}

function foglioStampaHTML(tabId){
  const t=tabById(tabId)||tabCorrente();
  const righe=righeDi(t.id);
  const T=totali(righe);
  const conc=concordatoDi(T,t.id);

  const corpo = semplificato(t.id)
    ? (righeSemplificate().map(x=>`<tr>
        <td class="art"></td>
        <td class="desc">${esc(x.nome)}</td>
        <td class="num">${fmtNum(x.imponibile)}</td>
        <td class="num mezzo">1</td>
        <td class="num">${fmtNum(x.imponibile)}</td>
        <td class="num mezzo">${x.aliquota==null?'—':fmtQty(x.aliquota)}</td>
        <td class="num">${fmtEur(x.totale)}</td>
      </tr>`).join('') || `<tr><td colspan="7" class="st-vuoto">Preventivo senza sezioni.</td></tr>`)
    : righe.length
    ? righe.map(r=>{
        const c=calcoloRiga(r);
        const p=r.promo!=null;
        /* Sul foglio la riga in promo va a capo dentro se stessa: sopra il
           prezzo di prima con i suoi conti, sbarrato; sotto quello promo. */
        /* Il prezzo della riga: senza promo è LUI che va scritto anche sotto.
           Passando il promo — vuoto, quando promo non ce n'è — la colonna
           «Prezzo unitario» restava in bianco su tutti i preventivi normali. */
        const prezzoPieno = r.prezzo===''?'':fmtNum(numIT(r.prezzo));
        const prezzoPromo = String(r.promo??'').trim()===''?'':fmtNum(numIT(r.promo));
        const due=(sopra,sotto)=>p
          ? `<span class="orig">${sopra}</span><span class="pro">${sotto}</span>`
          : sotto;
        return `<tr${p?' class="conpromo"':''}>
          <td class="art">${esc(r.articolo)}</td>
          <td class="desc">${esc(r.descrizione)}</td>
          <td class="num">${due(prezzoPieno, p?prezzoPromo:prezzoPieno)}</td>
          <td class="num mezzo">${r.qta===''?'':fmtQty(numIT(r.qta))}</td>
          <td class="num">${due(fmtNum(c.originale.imponibile), fmtNum(c.imponibile))}</td>
          <td class="num mezzo">${fmtQty(c.aliquota)}</td>
          <td class="num">${due(fmtEur(c.originale.totale), fmtEur(c.totale))}</td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="7" class="st-vuoto">Preventivo senza voci.</td></tr>`;

  /* In alto, affiancati: a sinistra chi manda il preventivo, a destra a chi va.
     Prima stavano uno sotto l'altro e si mangiavano due centimetri di foglio. */
  const cliente=clienteStampaHTML();
  const alto = (INTEST||cliente)
    ? `<div class="st-alto">
         <div class="st-head">${INTEST||''}</div>
         ${cliente?`<div class="st-cliente">${cliente}</div>`:''}
       </div>` : '';

  /* Il nome della sezione fra i dati del cliente e la tabella: dice a colpo
     d'occhio di che cosa parla il foglio, e serve soprattutto quando le sezioni
     sono stampate tutte insieme in un documento unico. */
  const nomeSezione = t.id===ID_TOT ? 'PREVENTIVO COMPLESSIVO' : (t.name||'');

  return `
    ${alto}
    ${(nomeSezione||S.data)?`<div class="st-riga-sezione">
       <div class="st-sezione-nome">${esc(nomeSezione)}</div>
       ${S.data?`<div class="st-data"><span class="k">Data</span>${esc(S.data)}</div>`:''}
     </div>`:''}
    <table class="st-tab">
      <!-- Alla descrizione va lo spazio buono: le altre colonne prendono solo
           quel che serve al loro numero e alla loro testata, niente di più. -->
      <colgroup>
        <col style="width:10%"><col style="width:36%"><col style="width:11%"><col style="width:10%">
        <col style="width:13%"><col style="width:7%"><col style="width:13%">
      </colgroup>
      <thead><tr>
        <th>ARTICOLO</th>
        <th>DESCRIZIONE</th>
        <!-- l'euro sta attaccato a «UNITARIO»: andando a capo non resta solo -->
        <th class="num">PREZZO UNITARIO&nbsp;€</th>
        <th class="num">QUANTITÀ</th>
        <th class="num">IMPONIBILE&nbsp;€</th>
        <th class="num">IVA %</th>
        <th class="num">TOTALE&nbsp;€</th>
      </tr></thead>
      <tbody>${corpo}</tbody>
      <!-- l'importo si prende le ultime due colonne: un totale a sei cifre non
           deve mai andare a capo a metà. L'ultima riga è quella che chiude il
           conto: il prezzo concordato se c'è, altrimenti il totale ivato. -->
      <tbody class="st-totali">
        <tr class="riepilogo v-imponibile"><td class="k" colspan="5">${esc(voceTesto('imponibile','IMPONIBILE TOTALE'))}</td><td class="v" colspan="2">${fmtEur(T.imponibile)}</td></tr>
        <tr class="riepilogo v-iva"><td class="k" colspan="5">${esc(etichettaIva(T))}</td><td class="v" colspan="2">${fmtEur(T.iva)}</td></tr>
        <tr class="v-ivato${conc?'':' finale'}"><td class="k" colspan="5">${esc(voceTesto('ivato','TOTALE'))}</td><td class="v" colspan="2">${fmtEur(T.totale)}</td></tr>
        ${conc?`<tr class="riepilogo v-sconto"><td class="k" colspan="5">${esc(etichettaSconto(conc))}</td><td class="v" colspan="2">${fmtEur(conc.sconto)}</td></tr>
        <tr class="finale v-concordato"><td class="k" colspan="5">${esc(voceTesto('concordato','PREZZO CONCORDATO'))}</td><td class="v" colspan="2">${fmtEur(conc.prezzo)}</td></tr>`:''}
        ${S.acconti.map((a,i)=>`<tr class="acconto v-rata${i===0?' primo':''}">
          <td class="k" colspan="4">${esc(a.nome)}</td>
          <td class="pc">${percMostrata(a,t.id)===''?'':percCorta(percMostrata(a,t.id))+'%'}</td>
          <td class="v" colspan="2">${fmtEur(importoAcconto(a,t.id))}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

/** il nome che si legge in alto: è quello che va nell'angolo del foglio */
const nomeDocumento = () => S.nome || (filePath ? nomeDaPercorso(filePath) : '');

/* Anteprima: si guarda il foglio prima di consumarci sopra della carta. È lo
   stesso identico PDF dell'esportazione — quindi quello che si vede è quello
   che esce — e dal visualizzatore si può stampare o salvarlo su file. */
async function anteprimaStampa(){
  applicaFormatoPagina();
  costruisciStampa();
  await new Promise(r=>setTimeout(r,60));
  const r=await IO.anteprima({orizzontale:OPZ.orizzontale, titolo:nomeDocumento()});
  if(r&&r.errore) toast('Anteprima non riuscita: '+r.errore,'err');
}

async function stampa(){
  applicaFormatoPagina();
  costruisciStampa();
  await new Promise(r=>setTimeout(r,60));       // il foglio deve essere già in pagina
  await IO.stampa({orizzontale:OPZ.orizzontale, titolo:nomeDocumento()});
}
async function esportaPDF(){
  applicaFormatoPagina();
  costruisciStampa();
  await new Promise(r=>setTimeout(r,60));
  await IO.pdf({orizzontale:OPZ.orizzontale, nome:nomeFile('pdf'), titolo:nomeDocumento()});
}

/** i caratteri che Windows non accetta in un nome di file */
const perFile = s => String(s||'').replace(/[\\/:*?"<>|]/g,'-').replace(/\s+/g,' ').trim();

/* L'estensione dei preventivi: sua, così un doppio clic — anche su un backup —
   li apre con l'applicazione invece che con un editor di testo. */
const EST_PREVENTIVO='preventivo';

/** Nome proposto per i file salvati ed esportati.
 *  Se il preventivo ha un nome vale quello, com'è stato scritto. Altrimenti se
 *  ne compone uno con quel che si sa: «Preventivo Rossi 17-08-2026.pdf». */
function nomeFile(est){
  if(S.nome) return perFile(S.nome)+'.'+est;
  const pezzi=['Preventivo'];
  // esportando più sezioni insieme, il nome di una sola sarebbe fuorviante
  const soli=ambitoTabs();
  const t=soli.length===1?(tabById(soli[0])||tabCorrente()):null;
  if(t && t.id!==ID_TOT && t.name && t.name.toLowerCase()!=='preventivo') pezzi.push(t.name);
  if(S.cliente.nome) pezzi.push(S.cliente.nome);
  if(S.data) pezzi.push(S.data);
  return perFile(pezzi.join(' '))+'.'+est;
}

/** dal percorso di un file al nome da mostrare: senza cartelle e senza estensione */
const nomeDaPercorso = p => String(p||'').split(/[\\/]/).pop().replace(/\.[^.]+$/,'');

/* ------------------------------------------------------------------
   Cartella dei salvataggi e backup
   ------------------------------------------------------------------ */
async function dialogoCartella(){
  const c=await IO.cartellaInfo();
  if(!c){
    return modal('Cartella dei salvataggi',
      `<p style="margin:0">Stai usando l'app dal file <b>preventivi.html</b> nel browser, che non ha
       una cartella propria: i file finiscono dove li mette il browser, di solito in «Download».</p>
       <p class="hint">Con l'app installata puoi invece scegliere dove tenere preventivi,
       intestazioni e backup.</p>`,
      [{label:'Chiudi'}]);
  }
  const riga=(k,v)=>`<div class="cartriga"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>`;
  modal('Cartella dei salvataggi',`
    <div class="cartelle">
      ${riga('Preventivi',c.dir)}
      ${riga('Intestazioni',c.intestazioni)}
      ${riga('Backup',c.backup)}
    </div>
    ${c.ripiego?`<p class="hint" style="color:#8a5c00">Accanto all'app non si poteva scrivere:
      i file vanno nei tuoi Documenti.</p>`:''}
    <p class="hint">Cambiando cartella, i file che ci sono già <b>restano dove sono</b>:
    da lì in avanti si salva nella cartella nuova. Se vuoi portarti dietro i vecchi,
    copiali a mano.</p>
  `,[{label:'Chiudi'},
     {label:'Apri la cartella',fn:()=>{ IO.cartellaApri(); return false; }},
     {label:'Riporta a quella predefinita',fn:async()=>{
        const n=await IO.cartellaPredefinita();
        if(n) toast('Cartella riportata a: '+n.base,'ok');
     }},
     {label:'📁 Cambia cartella…',primary:true,fn:async()=>{
        const n=await IO.cartellaScegli();
        if(!n) return;
        if(n.errore) return toast(n.errore,'err');
        toast('Da ora si salva in: '+n.base,'ok');
     }}]);
}

/* Il tasto Backup porta ai backup DI QUESTO preventivo: stanno nella sua
   cartella, non in un mucchio comune, e si aprono con un doppio clic perché
   hanno la stessa estensione del preventivo. */
/* La cartella di QUESTO preventivo: quella che porta il suo nome, con dentro il
   file e la sottocartella dei backup. Finché il preventivo non ha un nome quella
   cartella non esiste ancora, e non si inventa: si offre di darglielo. */
async function apriCartellaPreventivo(){
  if(!IO.desktop)
    return toast('Nel browser i file li tiene il browser: non c\'è una cartella da aprire','');
  if(!filePath && !S.nome)
    return modal('Cartella del preventivo',
      `<p style="margin:0">Questo preventivo non ha ancora un nome, quindi non ha nemmeno una
       cartella sua.</p>
       <p class="hint">Dagli un nome: l'app crea la cartella con dentro il file e, accanto,
       quella dei backup.</p>`,
      [{label:'Chiudi'},{label:'Dai un nome e salva',primary:true,fn:()=>dialogoNome(true)}]);
  const r=await IO.preventivoApriCartella({percorso:filePath,nome:S.nome});
  if(r&&r.errore) return toast(r.errore,'err');
  toast('Cartella di «'+nomeDocumento()+'»','ok');
  return r;
}

async function dialogoBackup(){
  if(!IO.desktop){
    const r=await IO.backupCrea();
    return toast(r&&r.ok?'Backup scaricato':'Backup non riuscito', r&&r.ok?'ok':'err');
  }
  if(!filePath){
    return modal('Backup',
      `<p style="margin:0">Questo preventivo non è ancora stato salvato, quindi non ha una cartella
       dove tenere i backup.</p>
       <p class="hint">Dagli un nome e salvalo: da quel momento la copia di sicurezza viene fatta
       da sola ogni ${MINUTI_BACKUP} minuti, dentro la sua cartella.</p>`,
      [{label:'Chiudi'},{label:'Dai un nome e salva',primary:true,fn:()=>dialogoNome(true)}]);
  }
  const dir=await IO.preventivoApriBackup({percorso:filePath});
  toast('Backup di «'+nomeDocumento()+'»','ok');
  return dir;
}

/* ------------------------------------------------------------------
   Backup automatico: una copia ogni tot minuti, accanto al preventivo
   ------------------------------------------------------------------ */
const MINUTI_BACKUP=10;
let timerBackup=null, ultimoBackup='';

async function backupAutomatico(){
  if(!IO.desktop||!filePath) return;
  const ora=documentoSerializzato();
  if(ora===ultimoBackup) return;            // niente è cambiato: niente copia
  const r=await IO.preventivoBackup({percorso:filePath, contenuto:ora});
  if(r&&r.ok) ultimoBackup=ora;
}
function avviaBackupAutomatico(){
  clearInterval(timerBackup);
  timerBackup=setInterval(backupAutomatico, MINUTI_BACKUP*60*1000);
}

/* ------------------------------------------------------------------
   Preventivi aperti di recente
   ------------------------------------------------------------------ */
async function dialogoRecenti(){
  const elenco=await IO.recentiElenco();
  if(!elenco.length){
    return modal('Apri Recente',
      `<p style="margin:0">Non hai ancora aperto o salvato nessun preventivo.</p>`,
      [{label:'Chiudi'},{label:'Apri…',primary:true,fn:()=>{ apriPreventivo(); }}]);
  }
  const quando=t=>{
    const d=new Date(t);
    return d.toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit',year:'numeric'})+
           ' alle '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'});
  };
  modal('Apri Recente',`
    <div class="recenti">
      ${elenco.map((v,i)=>`<button class="rec" data-i="${i}">
        <span class="n">${esc(v.nome)}</span>
        <span class="q">${esc(quando(v.quando))}</span>
        <span class="p">${esc(v.cartella)}</span>
      </button>`).join('')}
    </div>
  `,[{label:'Chiudi'},{label:'Svuota l\'elenco',danger:true,fn:async()=>{ await IO.recentiSvuota(); }}],
   ()=>{
     $$('.recenti .rec').forEach(b=>b.onclick=async()=>{
       const v=elenco[+b.dataset.i];
       $('#overlay').hidden=true; $('#modal').innerHTML='';
       await apriDaPercorso(v.percorso);
     });
   },'wide');
}

async function apriDaPercorso(percorso){
  try{
    const f=await IO.apriPercorso(percorso);
    if(!f) return;
    if(f.errore) return toast('Non riesco ad aprirlo: '+f.errore,'err');
    caricaDocumento(f.contenuto,f.percorso);
    toast('Aperto «'+nomeDocumento()+'»','ok');
  }catch(e){ toast('Apertura non riuscita: '+e.message,'err'); }
}

/* Dare il nome subito non è una formalità: da quel nome nascono la cartella del
   preventivo e la sua sottocartella dei backup, ed è lì che l'app salverà da
   sola ogni ${MINUTI_BACKUP} minuti. Senza nome non c'è dove mettere niente. */
function dialogoNome(allAvvio,daAvvio){
  /* Venendo dal riquadro iniziale, «Annulla» non abbandona: riporta lì, che è
     il posto da cui si è partiti. */
  const bottoni = [
    daAvvio ? {label:'Annulla',fn:()=>{ setTimeout(dialogoAvvio,50); }} : {label:'Annulla'},
    {label: daAvvio?'Crea':'Salva',primary:true,fn:()=>confermaNome(!!allAvvio)},
  ];

  modal(daAvvio?'Nuovo preventivo':'Nome del preventivo',`
    <label class="fld">Nome
      <input id="mNomeDoc" value="${esc(S.nome)}" maxlength="80" autocomplete="off"
             placeholder="es. Cucina Rossi">
    </label>
    <p class="hint">${allAvvio
      ? `Con questo nome l'app crea la <b>cartella del preventivo</b> e, dentro, quella dei
         <b>backup</b>: da lì in poi salva da sola ogni ${MINUTI_BACKUP} minuti.`
      : `È il nome che si legge in alto e quello del file. Cambiandolo, da qui in avanti si salva
         nella cartella con il nome nuovo.`}</p>
    <p class="hint" id="mNomeAvviso" hidden></p>
  `,bottoni,
    ()=>{
      const i=$('#mNomeDoc');
      i.select();
      i.onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault();
        $$('.modal .foot button').pop().click(); } };
    },
    /* La «x» c'è sempre: si può chiudere senza dare un nome — per dare
       un'occhiata, o perché si è appena ripristinato il preventivo della
       sessione precedente. Il nome si dà dopo, cliccandolo in alto. */
    'conx');
}

/* ------------------------------------------------------------------
   Le due finestre che si vedono per prime.

   Al primissimo avvio dopo l'installazione l'app non sa ancora dove tenere le
   sue cose: lo chiede, una volta sola. Chi preferisce farlo con calma chiude e
   se ne occupa dopo, dal tasto «Cartella Salvataggi» in cima.
   Subito dopo — e a ogni avvio successivo — si apre il riquadro con cui si
   comincia: nuovo, carica, recenti.
   ------------------------------------------------------------------ */
const CHIAVE_CARTELLA_CHIESTA='preventivi:cartellaChiesta';

async function daChiedereLaCartella(){
  if(!IO.desktop) return false;
  try{ if(localStorage.getItem(CHIAVE_CARTELLA_CHIESTA)) return false; }catch(_){}
  let c=null;
  try{ c=await IO.cartellaInfo(); }catch(_){}
  try{ localStorage.setItem(CHIAVE_CARTELLA_CHIESTA,'1'); }catch(_){}   // si chiede una volta sola
  return !!(c && c.maiScelta);
}

function dialogoPrimaCartella(){
  return new Promise(async risolvi=>{
    let c=null;
    try{ c=await IO.cartellaInfo(); }catch(_){}
    modal('Dove tenere i preventivi',`
      <p style="margin:0">Prima di cominciare, scegli la cartella dove l'app terrà
      <b>preventivi</b>, <b>intestazioni</b> e <b>backup</b>.</p>
      ${c?`<div class="cartelle">
        <div class="cartriga"><span class="k">Adesso</span><span class="v">${esc(c.base)}</span></div>
      </div>`:''}
      <p class="hint">Puoi cambiarla quando vuoi dal tasto <b>Cartella Salvataggi</b>, in cima
      alla finestra. I file che ci sono già restano dove sono.</p>
    `,
    [{label:'Chiudi'},
     {label:'📁 Scegli la cartella…',primary:true,fn:async()=>{
        const n=await IO.cartellaScegli();
        if(!n) return false;                       // ha annullato: la finestra resta
        if(n.errore){ toast(n.errore,'err'); return false; }
        toast('Da ora si salva in: '+n.base,'ok');
     }}],
    null,'conx',()=>risolvi());
  });
}

/* Il riquadro con cui si comincia. Niente nome da scrivere: quello lo chiede
   «Nuovo», e solo a chi sta davvero creando un preventivo. */
function dialogoAvvio(){
  modal('App Preventivi',`
    <p style="margin:0">Da dove vuoi partire?</p>
    <p class="hint">Con <b>Nuovo</b> dai un nome al preventivo e l'app gli prepara cartella e
    backup. Con <b>Carica Preventivo</b> apri un file dalla cartella dei salvataggi, con
    <b>Recenti</b> uno degli ultimi su cui hai lavorato.</p>
  `,
  [{label:'✚ Nuovo',primary:true,fn:()=>{ setTimeout(()=>dialogoNome(true,true),50); }},
   {label:'📂 Carica Preventivo',fn:()=>{ setTimeout(apriPreventivo,50); }},
   {label:'🕘 Recenti',fn:()=>{ setTimeout(dialogoRecenti,50); }},
   {label:'Chiudi'}],
  null,'conx');
}

/** applica il nome e, se si può, prepara subito cartella e file */
async function confermaNome(allAvvio){
  const nuovo=$('#mNomeDoc').value.trim();
  if(!nuovo){
    const a=$('#mNomeAvviso');
    if(a){ a.hidden=false; a.textContent='Serve un nome per poter creare la cartella.'; }
    $('#mNomeDoc').focus();
    return false;                              // la finestra resta aperta
  }
  S.nome=nuovo; tocca(); aggiornaTitolo();
  if(!IO.desktop) return;
  const c=await IO.preventivoCartella(nuovo);
  if(!c||c.errore) return toast(c&&c.errore||'Cartella non creata','err');
  if(allAvvio||!filePath){
    // il file non esiste ancora: lo si scrive subito, così la cartella non
    // resta vuota e il backup automatico ha da subito dove appoggiarsi
    try{
      await IO.salva(documentoSerializzato(),{percorso:c.file,nome:''});
      filePath=c.file; modificato=false; aggiornaTitolo();
      toast('Creato in '+c.cartella,'ok');
    }catch(e){ toast('Non riesco a creare il file: '+e.message,'err'); }
  }
}

/* ==============================================================================
   10. ESPORTAZIONE IN EXCEL
   Il file .xlsx è uno ZIP di XML: si scrive a mano, senza librerie esterne, così
   l'app resta un solo file e non dipende da niente.
   ============================================================================== */
const TAB_CRC=(()=>{ const t=new Uint32Array(256);
  for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1); t[n]=c>>>0; }
  return t; })();
function crc32(u8){
  let c=0xFFFFFFFF;
  for(let i=0;i<u8.length;i++) c=TAB_CRC[(c^u8[i])&0xFF]^(c>>>8);
  return (c^0xFFFFFFFF)>>>0;
}
/** ZIP senza compressione (metodo «store»): Excel lo apre senza storie */
function zip(files){
  const enc=new TextEncoder();
  const pezzi=[], centrale=[];
  let offset=0, n=0;
  for(const f of files){
    const nome=enc.encode(f.name);
    const dati=f.data;
    const crc=crc32(dati), size=dati.length;
    const lh=new DataView(new ArrayBuffer(30));
    lh.setUint32(0,0x04034b50,true); lh.setUint16(4,20,true); lh.setUint16(6,0x0800,true);
    lh.setUint16(8,0,true); lh.setUint16(10,0,true); lh.setUint16(12,0x21,true);
    lh.setUint32(14,crc,true); lh.setUint32(18,size,true); lh.setUint32(22,size,true);
    lh.setUint16(26,nome.length,true); lh.setUint16(28,0,true);
    pezzi.push(new Uint8Array(lh.buffer),nome,dati);

    const ch=new DataView(new ArrayBuffer(46));
    ch.setUint32(0,0x02014b50,true); ch.setUint16(4,20,true); ch.setUint16(6,20,true);
    ch.setUint16(8,0x0800,true); ch.setUint16(10,0,true); ch.setUint16(12,0,true); ch.setUint16(14,0x21,true);
    ch.setUint32(16,crc,true); ch.setUint32(20,size,true); ch.setUint32(24,size,true);
    ch.setUint16(28,nome.length,true); ch.setUint16(30,0,true); ch.setUint16(32,0,true);
    ch.setUint16(34,0,true); ch.setUint16(36,0,true); ch.setUint32(38,0,true);
    ch.setUint32(42,offset,true);
    centrale.push(new Uint8Array(ch.buffer),nome);

    offset+=30+nome.length+size; n++;
  }
  const cdInizio=offset;
  let cdLung=0; for(const p of centrale) cdLung+=p.length;
  const eo=new DataView(new ArrayBuffer(22));
  eo.setUint32(0,0x06054b50,true); eo.setUint16(4,0,true); eo.setUint16(6,0,true);
  eo.setUint16(8,n,true); eo.setUint16(10,n,true);
  eo.setUint32(12,cdLung,true); eo.setUint32(16,cdInizio,true); eo.setUint16(20,0,true);

  const tutto=[...pezzi,...centrale,new Uint8Array(eo.buffer)];
  let tot=0; for(const p of tutto) tot+=p.length;
  const out=new Uint8Array(tot);
  let p=0; for(const b of tutto){ out.set(b,p); p+=b.length; }
  return out;
}
const utf8 = s => new TextEncoder().encode(s);
const xes  = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));

/** riferimento di cella: (0,0) → A1 */
function cellaRif(col,riga){
  let s='', c=col;
  do{ s=String.fromCharCode(65+(c%26))+s; c=Math.floor(c/26)-1; }while(c>=0);
  return s+(riga+1);
}
const cellaTesto = (col,riga,v,st=0)=> v===''||v==null ? '' :
  `<c r="${cellaRif(col,riga)}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${xes(v)}</t></is></c>`;
const numXml = v => (+v).toFixed(4).replace(/0+$/,'').replace(/\.$/,'');
const cellaNum = (col,riga,v,st=0)=> v===''||v==null||isNaN(v) ? '' :
  `<c r="${cellaRif(col,riga)}" s="${st}"><v>${numXml(v)}</v></c>`;
/* Cella con formula: dentro c'è il calcolo, e accanto il risultato già pronto —
   così il numero si legge anche prima che Excel ricalcoli, e cambiando un
   prezzo o una quantità si aggiorna tutto da solo. */
const cellaForm = (col,riga,formula,v,st=0)=>
  `<c r="${cellaRif(col,riga)}" s="${st}"><f>${xes(formula)}</f>${v==null||isNaN(v)?'':`<v>${numXml(v)}</v>`}</c>`;

/** l'intestazione formattata diventa righe di testo semplice: il foglio di
    calcolo è fatto per i numeri, il bello sta nel PDF */
function intestazioneTesto(){
  if(!INTEST) return [];
  const d=document.createElement('div');
  d.innerHTML=INTEST.replace(/<\/(div|p|h[1-6]|li|tr)>/gi,'\n').replace(/<br\s*\/?>/gi,'\n');
  return d.textContent.split('\n').map(r=>r.replace(/\s+/g,' ').trim()).filter(Boolean);
}

/* Un foglio di calcolo per ogni sezione.
   I numeri non sono fotografie: imponibili, totali, IVA, sconto e rate sono
   formule vere. Cambiando un prezzo o una quantità dentro Excel, tutto il resto
   si rifà da solo — che è il motivo per cui si esporta in Excel invece che in
   PDF. Le funzioni si scrivono in inglese anche per l'Excel italiano: è il
   formato del file a volerle così, poi le traduce lui. */
function foglioXlsx(tabId,primo){
  const t=tabById(tabId)||tabCorrente();
  const righe=righeDi(t.id);
  const T=totali(righe);

  const celle=[];     // righe di XML
  const merge=[];
  let r=0;
  const add = (...c)=> celle.push(`<row r="${r+1}">${c.filter(Boolean).join('')}</row>`);
  const RIF = (col,riga)=>cellaRif(col,riga);

  /* In cima, affiancati come sulla carta: l'intestazione occupa le colonne di
     sinistra (A-D), i dati del cliente quelle di destra (E-G). Chi dei due ha
     più righe detta l'altezza del blocco. */
  const linee=intestazioneTesto();
  const c=S.cliente;
  const voci=[['Cliente:',c.nome],['Indirizzo:',c.indirizzo],['Cell:',c.cell],['Mail:',c.mail]].filter(v=>v[1]);
  const alte=Math.max(linee.length,voci.length);
  for(let i=0;i<alte;i++){
    const riga=[];
    if(linee[i]!=null){
      riga.push(cellaTesto(0,r,linee[i],i===0?2:1));
      merge.push(`<mergeCell ref="${RIF(0,r)}:${RIF(3,r)}"/>`);
    }
    if(voci[i]){
      riga.push(cellaTesto(4,r,voci[i][0],1), cellaTesto(5,r,voci[i][1],0));
      merge.push(`<mergeCell ref="${RIF(5,r)}:${RIF(6,r)}"/>`);
    }
    add(...riga);
    r++;
  }
  if(alte) r++;                                  // una riga di respiro

  // --- nome della sezione e, alla sua altezza, la data ---
  const nomeSezione = t.id===ID_TOT ? 'PREVENTIVO COMPLESSIVO' : (t.name||'');
  if(nomeSezione||S.data){
    const riga=[];
    if(nomeSezione){
      riga.push(cellaTesto(0,r,nomeSezione,28));
      merge.push(`<mergeCell ref="${RIF(0,r)}:${RIF(4,r)}"/>`);
    }
    if(S.data) riga.push(cellaTesto(5,r,'Data:',9), cellaTesto(6,r,S.data,0));
    add(...riga);
    r+=2;
  }

  // --- intestazione della tabella (tutte incorniciate) ---
  const testate=['ARTICOLO','DESCRIZIONE','PREZZO UNITARIO €','QUANTITÀ','IMPONIBILE €','IVA %','TOTALE €'];
  const rTestate=r;
  add(...testate.map((h,i)=>cellaTesto(i,r,h,6)));
  r++;

  // --- voci: imponibile e totale sono formule ---
  const rPrima=r;
  /* Complessivo semplificato: una riga per sezione. Le formule restano vere —
     imponibile = prezzo × quantità, totale = imponibile + IVA — così anche qui
     si può ritoccare un numero e vedere il resto rifarsi da solo. Dove la
     sezione mescola più aliquote non c'è una percentuale da scrivere, e il
     totale va come cifra: una formula con un'aliquota inventata sarebbe peggio. */
  const vociSemplici = semplificato(t.id) ? righeSemplificate() : null;
  for(const x of (vociSemplici||[])){
    add(
      cellaTesto(0,r,'',13),
      cellaTesto(1,r,x.nome,14),
      cellaNum(2,r,x.imponibile,15),
      cellaNum(3,r,1,16),
      cellaForm(4,r,`${RIF(2,r)}*${RIF(3,r)}`,x.imponibile,15),
      x.aliquota==null ? cellaTesto(5,r,'—',17) : cellaNum(5,r,x.aliquota,17),
      x.aliquota==null ? cellaNum(6,r,x.totale,18)
                       : cellaForm(6,r,`${RIF(4,r)}*(1+${RIF(5,r)}/100)`,x.totale,18),
    );
    r++;
  }
  for(const v of (vociSemplici?[]:righe)){
    const cc=calcoloRiga(v);
    if(inPromo(v)){
      /* In un foglio di calcolo due prezzi non stanno in una cella sola: il
         prezzo di prima prende una riga sua, sbarrata, con i suoi conti scritti
         però come TESTO. SOMMA salta il testo, e così quei numeri si vedono
         senza entrare nei totali — senza formule acrobatiche per escluderli. */
      const o=calcoloRiga(v).originale;
      add(
        // articolo e descrizione non si sbarrano: non è cambiato l'articolo,
        // è cambiato quanto costa
        cellaTesto(0,r,v.articolo,13),
        cellaTesto(1,r,v.descrizione,14),
        cellaNum(2,r,numIT(v.prezzo),31),
        cellaNum(3,r,numIT(v.qta),16),
        cellaTesto(4,r,fmtNum(o.imponibile),30),
        cellaNum(5,r,cc.aliquota,17),
        cellaTesto(6,r,fmtNum(o.totale)+' €',30),
      );
      r++;
      // e sotto la riga vera, con le formule, che è quella che conta
      add(
        cellaTesto(0,r,v.articolo,13),
        cellaTesto(1,r,'PROMO — '+v.descrizione,14),
        cellaNum(2,r,numIT(v.promo),15),
        cellaNum(3,r,numIT(v.qta),16),
        cellaForm(4,r,`${RIF(2,r)}*${RIF(3,r)}`,cc.imponibile,15),
        cellaNum(5,r,cc.aliquota,17),
        cellaForm(6,r,`${RIF(4,r)}*(1+${RIF(5,r)}/100)`,cc.totale,18),
      );
    }else{
      add(
        cellaTesto(0,r,v.articolo,13),
        cellaTesto(1,r,v.descrizione,14),
        cellaNum(2,r,numIT(v.prezzo),15),
        cellaNum(3,r,numIT(v.qta),16),
        cellaForm(4,r,`${RIF(2,r)}*${RIF(3,r)}`,cc.imponibile,15),
        cellaNum(5,r,cc.aliquota,17),
        cellaForm(6,r,`${RIF(4,r)}*(1+${RIF(5,r)}/100)`,cc.totale,18),
      );
    }
    r++;
  }
  const rUltima=r-1;
  const cIsole = rUltima>=rPrima;
  const gamma = col => `${RIF(col,rPrima)}:${RIF(col,rUltima)}`;
  r++;

  // --- totali ---
  const conc=concordatoDi(T,t.id);
  const eti=(testo,st)=>{ merge.push(`<mergeCell ref="${RIF(3,r)}:${RIF(5,r)}"/>`); return cellaTesto(3,r,testo,st); };

  /* Nelle etichette non c'è il simbolo: sta accanto all'importo, dove si legge
     insieme alla cifra. Nel foglio di calcolo è il formato numerico a metterlo,
     così il valore resta un numero su cui fare i conti. */
  const rImponibile=r;
  add(eti('IMPONIBILE TOTALE',19),
      cIsole ? cellaForm(6,r,`SUM(${gamma(4)})`,T.imponibile,26) : cellaNum(6,r,0,26)); r++;
  const rIva=r;
  add(eti(etichettaIva(T),19),
      cIsole ? cellaForm(6,r,`SUMPRODUCT(${gamma(4)},${gamma(5)})/100`,T.iva,26) : cellaNum(6,r,0,26)); r++;
  const rIvato=r;
  add(eti(voceTesto('ivato','TOTALE'),conc?19:21),
      cellaForm(6,r,`${RIF(6,rImponibile)}+${RIF(6,rIva)}`,T.totale,conc?26:27)); r++;

  let rBase=rIvato;                       // la cifra su cui si calcolano le rate
  if(conc){
    const rSconto=r;
    add(eti(etichettaSconto(conc).toUpperCase(),19),
        cellaForm(6,r,`${RIF(6,rIvato)}-${RIF(6,rSconto+1)}`,conc.sconto,26)); r++;
    add(eti('PREZZO CONCORDATO',21), cellaNum(6,r,conc.prezzo,27));
    rBase=r; r++;
  }

  // --- rate e acconti: importo = base × percentuale ---
  if(S.acconti.length){
    r++;
    for(const a of S.acconti){
      const rp=r;
      add(cellaTesto(1,r,a.nome,23),
          cellaNum(5,r,numIT(percMostrata(a,t.id)),24),
          cellaForm(6,r,`${RIF(6,rBase)}*${RIF(5,rp)}/100`,importoAcconto(a,t.id),29));
      merge.push(`<mergeCell ref="${RIF(1,r)}:${RIF(4,r)}"/>`);
      r++;
    }
  }

  const larghezze=[16,54,17,11,16,8,16]
    .map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('');

  const xml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:${RIF(6,r)}"/>
<sheetViews><sheetView showGridLines="0"${primo?' tabSelected="1"':''} workbookViewId="0"><pane ySplit="${rTestate+1}" topLeftCell="A${rTestate+2}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${larghezze}</cols>
<sheetData>${celle.join('')}</sheetData>
${merge.length?`<mergeCells count="${merge.length}">${merge.join('')}</mergeCells>`:''}
<printOptions/>
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup paperSize="9" orientation="${OPZ.orizzontale?'landscape':'portrait'}" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;

  const nome=(t.id===ID_TOT?'Preventivo complessivo':t.name).slice(0,31).replace(/[\\/*?:\[\]]/g,' ')||'Foglio';
  return {nome,xml};
}

function costruisciXlsx(tabIds){
  const elenco=(tabIds&&tabIds.length)?tabIds:[S.active];
  const fogli=elenco.map((id,i)=>foglioXlsx(id,i===0));
  // due sezioni non possono chiamarsi uguale: Excel non aprirebbe il file
  const visti=new Set();
  fogli.forEach((f,i)=>{
    let n=f.nome, k=2;
    while(visti.has(n.toLowerCase())) n=(f.nome.slice(0,28)+' '+(k++)).trim();
    visti.add(n.toLowerCase()); f.nome=n;
  });

  const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4">
 <numFmt numFmtId="164" formatCode="#,##0.00"/>
 <numFmt numFmtId="165" formatCode="0&quot;%&quot;"/>
 <numFmt numFmtId="166" formatCode="#,##0.###"/>
 <numFmt numFmtId="167" formatCode="#,##0.00\ &quot;€&quot;"/>
</numFmts>
<fonts count="9">
 <font><sz val="9.75"/><name val="Calibri"/></font>
 <font><b/><sz val="8.25"/><name val="Calibri"/></font>
 <font><b/><sz val="11"/><name val="Calibri"/></font>
 <font><b/><sz val="13.5"/><name val="Calibri"/></font>
 <font><strike/><sz val="9.75"/><color rgb="FF888888"/><name val="Calibri"/></font>
 <font><b/><sz val="9.375"/><name val="Calibri"/></font>
 <font><b/><sz val="8.625"/><name val="Calibri"/></font>
 <font><b/><sz val="10.5"/><name val="Calibri"/></font>
 <font><b/><sz val="9.75"/><name val="Calibri"/></font>
</fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="6">
 <border><left/><right/><top/><bottom/><diagonal/></border>
 <border><left/><right/><top/><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border>
 <border><left/><right/><top style="thin"><color rgb="FF000000"/></top><bottom/><diagonal/></border>
 <border><left/><right/><top style="thin"><color rgb="FF000000"/></top><bottom style="double"><color rgb="FF000000"/></bottom><diagonal/></border>
 <border><left style="thin"><color rgb="FF9A9A9A"/></left><right style="thin"><color rgb="FF9A9A9A"/></right><top style="thin"><color rgb="FF9A9A9A"/></top><bottom style="thin"><color rgb="FF9A9A9A"/></bottom><diagonal/></border>
 <border><left style="medium"><color rgb="FF000000"/></left><right style="medium"><color rgb="FF000000"/></right><top style="medium"><color rgb="FF000000"/></top><bottom style="medium"><color rgb="FF000000"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="34">
 <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
 <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
 <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
 <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
 <xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right"/></xf>
 <xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
 <xf numFmtId="0" fontId="1" fillId="0" borderId="5" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" horizontal="center" wrapText="1"/></xf>
 <xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
 <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
 <xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right"/></xf>
 <xf numFmtId="164" fontId="3" fillId="0" borderId="3" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
 <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right"/></xf>
 <xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
 <xf numFmtId="0" fontId="0" fillId="0" borderId="4" xfId="0" applyBorder="1"/>
 <xf numFmtId="0" fontId="0" fillId="0" borderId="4" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
 <xf numFmtId="164" fontId="0" fillId="0" borderId="4" xfId="0" applyNumberFormat="1" applyBorder="1"/>
 <xf numFmtId="166" fontId="0" fillId="0" borderId="4" xfId="0" applyNumberFormat="1" applyBorder="1"/>
 <xf numFmtId="165" fontId="0" fillId="0" borderId="4" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
 <xf numFmtId="167" fontId="0" fillId="0" borderId="4" xfId="0" applyNumberFormat="1" applyBorder="1"/>
 <xf numFmtId="0" fontId="1" fillId="0" borderId="4" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
 <xf numFmtId="164" fontId="1" fillId="0" borderId="4" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
 <xf numFmtId="0" fontId="6" fillId="0" borderId="5" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
 <xf numFmtId="164" fontId="3" fillId="0" borderId="5" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
 <xf numFmtId="0" fontId="6" fillId="0" borderId="4" xfId="0" applyFont="1" applyBorder="1"/>
 <xf numFmtId="165" fontId="8" fillId="0" borderId="4" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
 <xf numFmtId="164" fontId="1" fillId="0" borderId="4" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
 <xf numFmtId="167" fontId="5" fillId="0" borderId="4" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
 <xf numFmtId="167" fontId="3" fillId="0" borderId="5" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
 <xf numFmtId="0" fontId="7" fillId="0" borderId="0" xfId="0" applyFont="1"/>
 <xf numFmtId="167" fontId="8" fillId="0" borderId="4" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
 <xf numFmtId="0" fontId="4" fillId="0" borderId="4" xfId="0" applyFont="1" applyBorder="1"/>
 <xf numFmtId="164" fontId="4" fillId="0" borderId="4" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
 <xf numFmtId="166" fontId="4" fillId="0" borderId="4" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
 <xf numFmtId="0" fontId="4" fillId="0" borderId="4" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normale" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const n=fogli.length;
  const files=[
    {name:'[Content_Types].xml', data:utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${fogli.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`)},
    {name:'_rels/.rels', data:utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`)},
    {name:'xl/workbook.xml', data:utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${fogli.map((f,i)=>`<sheet name="${xes(f.nome)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets>
</workbook>`)},
    {name:'xl/_rels/workbook.xml.rels', data:utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${fogli.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}
<Relationship Id="rId${n+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`)},
    {name:'xl/styles.xml', data:utf8(styles)},
    ...fogli.map((f,i)=>({name:`xl/worksheets/sheet${i+1}.xml`, data:utf8(f.xml)})),
  ];
  return zip(files);
}

async function esportaExcel(){
  try{
    const dati=costruisciXlsx(ambitoTabs());
    const nome=nomeFile('xlsx');
    const dove=await IO.salvaBinario(nome,dati,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    if(dove!==false) toast('Foglio Excel esportato','ok');
  }catch(e){ toast('Esportazione non riuscita: '+e.message,'err'); }
}

/* ==============================================================================
   10-bis. IMPORTAZIONE — da un foglio Excel o da un altro preventivo
   Un .xlsx è uno ZIP di XML: si apre allo stesso modo in cui lo si scrive,
   senza librerie. Il .json è quello salvato dall'app.
   ============================================================================== */
const comeBytes = d =>
  d instanceof Uint8Array ? d :
  d instanceof ArrayBuffer ? new Uint8Array(d) :
  (d && d.buffer) ? new Uint8Array(d.buffer, d.byteOffset||0, d.byteLength) : new Uint8Array(0);

async function sgonfia(u8){
  const ds=new DecompressionStream('deflate-raw');
  return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer());
}

/** apre uno ZIP e restituisce nome→byte. Legge le misure dall'indice centrale,
    che è sempre corretto anche quando l'intestazione locale è a zero. */
async function leggiZip(buf){
  const dv=new DataView(buf), len=buf.byteLength;
  let eocd=-1;
  for(let i=len-22;i>=Math.max(0,len-22-65535);i--){ if(dv.getUint32(i,true)===0x06054b50){ eocd=i; break; } }
  if(eocd<0) throw new Error('Il file non è un foglio Excel valido');
  const quanti=dv.getUint16(eocd+10,true);
  let p=dv.getUint32(eocd+16,true);
  const dec=new TextDecoder();
  const dentro=new Map();
  for(let i=0;i<quanti && p+46<=len;i++){
    if(dv.getUint32(p,true)!==0x02014b50) break;
    const metodo=dv.getUint16(p+10,true);
    const compresso=dv.getUint32(p+20,true);
    const lNome=dv.getUint16(p+28,true), lExtra=dv.getUint16(p+30,true), lNota=dv.getUint16(p+32,true);
    const off=dv.getUint32(p+42,true);
    const nome=dec.decode(new Uint8Array(buf,p+46,lNome));
    p+=46+lNome+lExtra+lNota;
    if(off+30>len||dv.getUint32(off,true)!==0x04034b50) continue;
    const nl=dv.getUint16(off+26,true), el=dv.getUint16(off+28,true);
    const inizio=off+30+nl+el;
    const grezzo=new Uint8Array(buf,inizio,Math.min(compresso,len-inizio));
    try{
      if(metodo===0) dentro.set(nome,grezzo.slice());
      else if(metodo===8) dentro.set(nome,await sgonfia(grezzo));
    }catch(_){ /* una parte illeggibile non deve far cadere tutto il file */ }
  }
  return dentro;
}

/** le righe del primo foglio, cella per cella: {colonna: {v, n}} — «n» segna i numeri */
async function celleDelFoglio(buf){
  const file=await leggiZip(buf);
  const testo=n=>{ const d=file.get(n); return d?new TextDecoder().decode(d):null; };
  const xml=t=>new DOMParser().parseFromString(t,'application/xml');

  /* Quale foglio è il primo lo dice la cartella di lavoro, non il nome del
     file: Excel non lo chiama sempre «sheet1.xml». */
  let percorso=null;
  const wb=testo('xl/workbook.xml'), rels=testo('xl/_rels/workbook.xml.rels');
  if(wb&&rels){
    const primo=xml(wb).getElementsByTagName('sheet')[0];
    const rid=primo&&(primo.getAttribute('r:id')||primo.getAttribute('id'));
    if(rid){
      const rel=[...xml(rels).getElementsByTagName('Relationship')].find(r=>r.getAttribute('Id')===rid);
      if(rel){
        let t=(rel.getAttribute('Target')||'').replace(/^\/?(xl\/)?/,'');
        if(t) percorso='xl/'+t;
      }
    }
  }
  if(!percorso||!file.has(percorso)) percorso=[...file.keys()].find(k=>/^xl\/worksheets\/[^/]+\.xml$/i.test(k));
  if(!percorso) throw new Error('Nel file non c\'è nessun foglio di calcolo');

  // le stringhe stanno quasi sempre in un elenco a parte, condiviso
  const condivise=[];
  const sst=testo('xl/sharedStrings.xml');
  if(sst) for(const si of xml(sst).getElementsByTagName('si'))
    condivise.push([...si.getElementsByTagName('t')].map(t=>t.textContent).join(''));

  const doc=xml(testo(percorso));
  const righe=[];
  for(const row of doc.getElementsByTagName('row')){
    const celle={};
    for(const c of row.getElementsByTagName('c')){
      const col=(c.getAttribute('r')||'').replace(/\d+/g,'');
      const tipo=c.getAttribute('t');
      let v='', numero=false;
      if(tipo==='inlineStr'){
        v=[...c.getElementsByTagName('t')].map(t=>t.textContent).join('');
      }else{
        const vn=c.getElementsByTagName('v')[0];
        v=vn?vn.textContent:'';
        if(tipo==='s') v=condivise[+v]||'';
        else if(!tipo||tipo==='n') numero=true;
      }
      if(v!=='') celle[col]={v,n:numero};
    }
    righe.push(celle);
  }
  return righe;
}

/* I nomi delle colonne si confrontano senza accenti, senza € e senza %: così
   «QUANTITÀ», «Quantita» e «QTA» finiscono tutti nello stesso posto. */
const NORM = s => String(s||'').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
  .replace(/[€%. ]/g,' ').replace(/\s+/g,' ').trim();

const NOMI_COLONNE = {
  articolo:   ['ARTICOLO','CODICE','COD','RIFERIMENTO','RIF','VOCE','N'],
  descrizione:['DESCRIZIONE','DESCR','LAVORAZIONE','OGGETTO','LAVORO'],
  prezzo:     ['PREZZO UNITARIO','PREZZO UNIT','PREZZO','UNITARIO','IMPORTO UNITARIO','COSTO UNITARIO'],
  qta:        ['QUANTITA','QTA','Q TA','QUANT','QTY','NUMERO','PZ'],
  iva:        ['IVA','ALIQUOTA IVA','ALIQUOTA'],
};

/** cerca la riga delle intestazioni e ne ricava colonna→campo */
function mappaColonne(righe){
  for(let i=0;i<Math.min(righe.length,40);i++){
    const mappa={};
    for(const [col,cel] of Object.entries(righe[i])){
      if(cel.n) continue;                       // una testata non è un numero
      const t=NORM(cel.v);
      if(!t) continue;
      for(const [campo,alias] of Object.entries(NOMI_COLONNE)){
        if(mappa[campo]) continue;
        if(alias.some(a=>t===a||t.startsWith(a+' '))){ mappa[campo]=col; break; }
      }
    }
    // serve almeno di che riconoscere una voce: cosa è, e quanto costa
    if((mappa.articolo||mappa.descrizione) && Object.keys(mappa).length>=2) return {mappa,riga:i};
  }
  return null;
}

/** le voci di un foglio Excel */
async function vociDaXlsx(buf){
  const righe=await celleDelFoglio(buf);
  const trovata=mappaColonne(righe);
  if(!trovata) throw new Error(
    'Non trovo le colonne. Nel foglio ci vuole una riga con le intestazioni: Articolo, Descrizione, Prezzo unitario, Quantità, IVA.');
  const {mappa,riga}=trovata;
  /* I numeri di Excel usano il punto come decimale, sempre: vanno letti come
     sono. Solo le celle di testo passano dalla lettura all'italiana. */
  const num=cel=>{
    if(!cel) return '';
    if(cel.n){ const n=parseFloat(cel.v); return isFinite(n)?String(n):''; }
    return cel.v.trim()===''?'':String(numIT(cel.v));
  };
  const testo=cel=>cel?String(cel.v).trim():'';
  const voci=[];
  for(let i=riga+1;i<righe.length;i++){
    const r=righe[i];
    const articolo=testo(r[mappa.articolo]), descrizione=testo(r[mappa.descrizione]);
    // le righe dei totali non hanno né articolo né descrizione: si saltano
    if(!articolo&&!descrizione) continue;
    voci.push({articolo,descrizione,prezzo:num(r[mappa.prezzo]),qta:num(r[mappa.qta]),iva:num(r[mappa.iva])});
  }
  return voci;
}

/** le voci di un preventivo salvato */
function vociDaJson(u8){
  let d;
  try{ d=JSON.parse(new TextDecoder().decode(u8).replace(/^﻿/,'')); }
  catch(_){ throw new Error('Non riesco a leggere il file: serve un foglio Excel (.xlsx) o un preventivo (.json)'); }
  const doc=d.documento||d;
  if(!Array.isArray(doc.righe)) throw new Error('In questo preventivo non ci sono voci');
  return doc.righe.map(r=>({
    articolo:String(r.articolo||''), descrizione:String(r.descrizione||''),
    prezzo:String(r.prezzo??''), qta:String(r.qta??''), iva:String(r.iva??''),
  }));
}

async function estraiVoci(dati){
  const u8=comeBytes(dati);
  if(u8.length<4) throw new Error('Il file è vuoto');
  const zip = u8[0]===0x50&&u8[1]===0x4B&&u8[2]===0x03&&u8[3]===0x04;   // «PK..»
  return zip ? await vociDaXlsx(u8.slice().buffer) : vociDaJson(u8);
}

async function importaVoci(){
  let f;
  try{ f=await IO.importa(); }catch(e){ return toast('Importazione non riuscita: '+e.message,'err'); }
  if(!f) return;

  let voci;
  try{ voci=await estraiVoci(f.dati); }
  catch(e){ return toast(e.message,'err'); }
  if(!voci.length) return toast('Nel file non ho trovato voci da importare','err');

  /* Il preventivo complessivo non è un contenitore: è la somma degli altri.
     Importando da lì si finirebbe per svuotare tutte le sezioni insieme, quindi
     le voci vanno nella prima sezione vera, e il messaggio dice quale. */
  let dest=S.active;
  if(dest===ID_TOT) dest=(tabVoci()[0]||nuovoTab()).id;
  const t=tabById(dest);
  const presenti=S.righe.filter(r=>r.tabId===dest).length;

  const fai=()=>{
    S.righe=S.righe.filter(r=>r.tabId!==dest);
    for(const v of voci) S.righe.push(Object.assign({id:uid(),tabId:dest},v));
    S.active=dest; tocca(); render();
    toast(voci.length+(voci.length===1?' voce importata':' voci importate')+' in «'+t.name+'»','ok');
  };

  if(!presenti) return fai();
  modal('Sostituire le voci?',
    `<p style="margin:0">Nella sezione <b>${esc(t.name)}</b> ci sono <b>${presenti}</b> voci: verranno sostituite dalle <b>${voci.length}</b> del file.</p>
     <p class="hint">Il file da cui importi non viene toccato.</p>`,
    [{label:'Annulla'},{label:'Sostituisci',danger:true,fn:fai}]);
}

/* ==============================================================================
   11. SALVATAGGIO E APERTURA DEL PREVENTIVO
   ============================================================================== */
function documentoSerializzato(){
  return JSON.stringify({app:'App Preventivi', v:1, salvato:new Date().toISOString(),
    intestazione:INTEST, documento:S}, null, 2);
}
function caricaDocumento(testo,percorso){
  const d=JSON.parse(testo);
  const doc=d.documento||d;
  if(!doc||!Array.isArray(doc.tabs)) throw new Error('File non riconosciuto');
  S=Object.assign(NUOVO(),doc);
  S.cliente=Object.assign({nome:'',indirizzo:'',cell:'',mail:''},doc.cliente||{});
  S.righe=migraPromo((doc.righe||[]).map(r=>Object.assign({id:uid(),tabId:S.tabs[1]?.id||ID_TOT},r)));
  if(!S.tabs.some(t=>t.type==='tot')) S.tabs.unshift({id:ID_TOT,type:'tot',name:'PREVENTIVO COMPLESSIVO',icon:'Σ'});
  if(!tabById(S.active)) S.active=(tabVoci()[0]||S.tabs[0]).id;
  /* Prezzo concordato: i file scritti prima della ripartizione avevano un
     valore solo, buono per tutto il preventivo. Lo si mette sul complessivo e
     lo si spartisce fra le sezioni, così i preventivi vecchi si riaprono senza
     perdere la cifra pattuita. */
  if(typeof doc.concordato==='string' && !doc.concordati){
    S.concordati={};
    for(const t of S.tabs) S.concordati[t.id]='';
    S.concordati[ID_TOT]=doc.concordato;
    ripartisciConcordato();
  }else if(doc.concordati && typeof doc.concordati==='object'){
    S.concordati=doc.concordati;
    for(const t of S.tabs) if(S.concordati[t.id]==null) S.concordati[t.id]='';
  }else{
    S.concordati=null;
  }
  delete S.concordato;
  // i file salvati prima che il nome esistesse lo prendono dal nome del file
  S.nome = typeof doc.nome==='string' && doc.nome ? doc.nome : (percorso ? nomeDaPercorso(percorso) : '');
  /* L'intestazione arriva dal file: vale per QUESTO preventivo e basta. La
     predefinita non si tocca — aprire il preventivo di un anno fa non deve
     cambiare quella con cui si parte da domani. */
  INTEST = typeof d.intestazione==='string' ? pulisciHTML(d.intestazione) : '';
  filePath=percorso||null; modificato=false;
  tocca(); modificato=false;
  render();
}

async function nuovoPreventivo(){
  const fai=()=>{
    S=NUOVO(); S.active=S.tabs[1].id;
    INTEST=INTEST_PREDEF;              // vuoto tutto, tranne l'intestazione
    filePath=null; modificato=false;
    try{ localStorage.removeItem(CHIAVE_BOZZA); }catch(_){}
    render(); toast('Preventivo nuovo');
  };
  if(modificato && !documentoVuoto(S)){
    return modal('Preventivo non salvato',
      '<p style="margin:0">Le modifiche non salvate andranno perse.</p>',
      [{label:'Annulla'},{label:'Continua',danger:true,fn:fai}]);
  }
  fai();
}
async function salvaPreventivo(comeNuovo){
  try{
    /* Se il preventivo ha un nome ma non ancora un file, si salva da sé nella
       sua cartella, senza chiedere niente: la cartella la crea l'app. */
    if(!comeNuovo && !filePath && S.nome && IO.desktop){
      const c=await IO.preventivoCartella(S.nome);
      if(c&&c.file) filePath=c.file;
    }
    const dove=await IO.salva(documentoSerializzato(), {percorso:comeNuovo?null:filePath, nome:nomeFile(EST_PREVENTIVO)});
    if(!dove) return;
    filePath=dove;
    /* Se nella finestra di salvataggio il file è stato chiamato in un altro
       modo, comanda quello: il nome in alto e quello sul disco devono dire la
       stessa cosa, altrimenti si cerca un file che non si chiama così. */
    S.nome=nomeDaPercorso(dove);
    modificato=false; aggiornaTitolo();
    toast('Preventivo salvato','ok');
  }catch(e){ toast('Salvataggio non riuscito: '+e.message,'err'); }
}
async function apriPreventivo(){
  try{
    const f=await IO.apri();
    if(!f) return;
    caricaDocumento(f.contenuto, f.percorso);
    toast('Preventivo aperto','ok');
  }catch(e){ toast('Apertura non riuscita: '+e.message,'err'); }
}

function aggiornaTitolo(){
  IO.statoModificato?.(modificato && !documentoVuoto(S));
  const el=$('#docname');
  if(!el) return;
  // il nome dato a mano ha la precedenza; se non c'è, vale quello del file aperto
  const nome = S.nome || (filePath ? nomeDaPercorso(filePath) : '');
  const mostrato = nome || 'Preventivo senza nome';
  el.innerHTML = esc(mostrato)+(modificato?'<span class="mod" title="Modifiche non salvate">•</span>':'');
  el.classList.toggle('senzanome',!nome);
  document.title = 'App Preventivi — '+mostrato;
}

/* ==============================================================================
   12. IO — versione «pagina web». desktop.js la sostituisce con quella vera.
   ============================================================================== */
const IO = {
  desktop:false,
  scarica(nome,dati,tipo){
    const b=dati instanceof Blob?dati:new Blob([dati],{type:tipo||'application/octet-stream'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(b); a.download=nome; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),5000);
  },
  async salvaBinario(nome,dati,tipo){ this.scarica(nome,dati,tipo); return nome; },
  async salva(testo,{nome}){ this.scarica(nome,utf8(testo),'application/json'); return nome; },
  /** sceglie un file dal disco; «binario» per l'Excel, che non è testo */
  _scegli(accetta,binario){
    return new Promise(res=>{
      const inp=$('#fileInput');
      inp.value=''; inp.accept=accetta;
      inp.onchange=async()=>{
        const f=inp.files&&inp.files[0];
        if(!f) return res(null);
        res(binario ? {percorso:f.name, dati:await f.arrayBuffer()}
                    : {percorso:f.name, contenuto:await f.text()});
      };
      inp.click();
    });
  },
  async apri(){ return this._scegli('.json,application/json',false); },
  async importa(){ return this._scegli('.xlsx,.json',true); },
  /* Nel browser l'anteprima è la finestra di stampa stessa: la mostra lui, e
     da lì si sceglie «Salva come PDF». */
  async anteprima(){ window.print(); return {ok:true}; },
  async stampa(){ window.print(); },
  async pdf(){
    toast('Nella finestra di stampa scegli «Salva come PDF»');
    window.print();
  },

  /* Nel browser non c'è una cartella «Intestazione» da usare: le intestazioni
     salvate restano nella memoria del browser, con gli stessi nomi. Nella
     versione desktop tutto questo diventa file veri, e desktop.js prende il
     posto di questi metodi. */
  _intest(){
    try{ return JSON.parse(localStorage.getItem('preventivi:intestazioni')||'{}'); }catch(_){ return {}; }
  },
  _intestSalva(o){
    try{ localStorage.setItem('preventivi:intestazioni', JSON.stringify(o)); }catch(_){}
  },
  async intestElenco(){ return Object.keys(this._intest()).sort((a,b)=>a.localeCompare(b,'it')); },
  async intestLeggi(nome){ const o=this._intest(); return nome in o ? o[nome] : null; },
  async intestScrivi(nome,html){ const o=this._intest(); o[nome]=html; this._intestSalva(o); return {ok:true,nome}; },
  async intestElimina(nome){ const o=this._intest(); delete o[nome]; this._intestSalva(o); return {ok:true}; },
  async intestApriCartella(){ return false; },
  async apriPercorso(){ return null; },
  async preventivoCartella(){ return null; },
  async preventivoApriCartella(){ return null; },
  async preventivoApriBackup(){ return null; },
  async preventivoBackup(){ return {errore:'non disponibile nel browser'}; },
  async recentiElenco(){ return []; },
  async recentiSvuota(){ return true; },
  /* Nel browser non c'è una cartella da scegliere: i file li salva dove dice
     il browser stesso, e il backup si scarica come un file qualsiasi. */
  async cartellaInfo(){ return null; },
  async cartellaScegli(){ return null; },
  async cartellaPredefinita(){ return null; },
  async cartellaApri(){ return false; },
  async backupCrea(){
    const dati=utf8(JSON.stringify({app:'App Preventivi', backup:true,
      quando:new Date().toISOString(), intestazionePredefinita:INTEST_PREDEF,
      intestazioni:this._intest(), documento:S}, null, 2));
    this.scarica('Backup App Preventivi.json',dati,'application/json');
    return {ok:true, scaricato:true};
  },
  async backupApri(){ return false; },
  async backupElenco(){ return []; },
  async predefLeggi(){ try{ return localStorage.getItem(CHIAVE_INTEST); }catch(_){ return null; } },
  async predefScrivi(){ return true; },     // il salvataggio vero lo fa già salvaPredefinita()
};

/* ==============================================================================
   13. ADATTAMENTO ALLO SCHERMO (solo pagina web: nel desktop ci pensa Electron)
   Un 4K a 100% mostra 3840 punti: senza ingrandire, i caratteri sono spilli.
   ============================================================================== */
function zoomAutomatico(){
  const l=window.screen.availWidth;
  if(l>=3400) return 1.60;
  if(l>=2800) return 1.30;
  if(l>=2200) return 1.15;
  if(l<=1400) return 0.90;
  return 1;
}
function applicaZoom(z){
  OPZ.zoom = z||0;
  const f = z || zoomAutomatico();
  document.documentElement.style.zoom = f;
  salvaOpzioni();
}
function legaZoomWeb(){
  applicaZoom(OPZ.zoom);
  window.addEventListener('resize',()=>{ if(!OPZ.zoom) applicaZoom(0); });
  document.addEventListener('keydown',e=>{
    if(!(e.ctrlKey||e.metaKey)) return;
    if(e.key==='+'||e.key==='='){ e.preventDefault(); applicaZoom(clamp((OPZ.zoom||zoomAutomatico())+0.1,0.6,2.5)); }
    if(e.key==='-'){ e.preventDefault(); applicaZoom(clamp((OPZ.zoom||zoomAutomatico())-0.1,0.6,2.5)); }
    if(e.key==='0'){ e.preventDefault(); applicaZoom(0); }
  });
}

/* ==============================================================================
   14. AVVIO
   ============================================================================== */
/* ==============================================================================
   14-bis. MENU DEL TASTO DESTRO
   Sui campi in cui si scrive servono i comandi di Windows (taglia, copia,
   incolla): quelli li sa fare solo il menu vero del sistema, perché «incolla»
   dagli appunti una pagina web non può farlo da sola. Sui TAB e sulle righe
   servono invece i comandi dell'app. Le due cose si mettono insieme in un
   menu solo, costruito su misura per il punto in cui si è premuto.
   ============================================================================== */
function contestoDaEvento(e){
  const tab=e.target.closest('.tab[data-id]');
  if(tab&&tabById(tab.dataset.id)?.type!=='tot') return {tipo:'tab', id:tab.dataset.id};
  const tr=e.target.closest('#corpo tr[data-id]');
  if(tr){
    const r=rigaById(tr.dataset.id);
    return {tipo:'riga', id:tr.dataset.id, barrato:!!(r&&r.barrato)};
  }
  return {tipo:'testo'};
}

function eseguiAzioneMenu(azione,id){
  if(azione==='duplicaRiga') duplicaRiga(id);
  if(azione==='promo')       promoRiga(id);
  if(azione==='duplicaTab')  duplicaTab(id);
  if(azione==='eliminaRiga') eliminaRiga(id);
  if(azione==='rinominaTab') rinominaTab(id);
  if(azione==='eliminaTab')  eliminaTab(id);
}

function legaMenuContestuale(){
  document.addEventListener('contextmenu', e=>{
    if(!$('#overlay').hidden && !e.target.closest('#modal')) return;
    const ctx=contestoDaEvento(e);
    if(IO.menuContestuale){          // desktop: menu vero di Windows
      e.preventDefault();
      IO.menuContestuale(ctx);
      return;
    }
    // nel browser i comandi degli appunti li dà già il menu suo: qui si
    // aggiungono i nostri solo dove servono
    if(ctx.tipo==='testo') return;
    e.preventDefault();
    menuDom(ctx,e.clientX,e.clientY);
  });
}

/* Dove mettere un riquadro che galleggia sopra la pagina (i menu).
   L'interfaccia si ingrandisce con lo «zoom» sulla radice del documento: le
   misure lette con getBoundingClientRect sono già in pixel di finestra, ma
   «left» e «top» di un elemento fisso quello zoom se lo riprendono un'altra
   volta. Senza dividerlo, su uno schermo grande il menu si apre spostato di
   parecchio rispetto al punto in cui è stato chiesto. */
function collocaFluttuante(el,x,y){
  const z=parseFloat(getComputedStyle(document.documentElement).zoom)||1;
  const b=el.getBoundingClientRect();
  const sx=Math.max(8,Math.min(x,innerWidth -b.width -8));
  const sy=Math.max(8,Math.min(y,innerHeight-b.height-8));
  el.style.left=(sx/z)+'px';
  el.style.top =(sy/z)+'px';
}

/** menu dell'app, per la versione che gira nel browser */
function menuDom(ctx,x,y){
  chiudiMenuDom();
  const voci = ctx.tipo==='tab'
    ? [['Duplica la sezione','duplicaTab'],['Rinomina…','rinominaTab'],['Elimina','eliminaTab']]
    : [['Duplica la riga','duplicaRiga'],[ctx.barrato?'Togli la barratura':'Promo','promo'],['Elimina','eliminaRiga']];
  const m=document.createElement('div');
  m.className='menuctx';
  m.innerHTML=voci.map(([t,a])=>`<button data-a="${a}">${esc(t)}</button>`).join('');
  document.body.appendChild(m);
  collocaFluttuante(m,x,y);
  m.onclick=ev=>{
    const b2=ev.target.closest('button[data-a]');
    if(b2) eseguiAzioneMenu(b2.dataset.a,ctx.id);
    chiudiMenuDom();
  };
  setTimeout(()=>{
    document.addEventListener('click',chiudiMenuDom,{once:true});
    document.addEventListener('contextmenu',chiudiMenuDom,{once:true});
  },0);
}
function chiudiMenuDom(){ $$('.menuctx').forEach(m=>m.remove()); }

/* I tasti in cima hanno nomi lunghi — «Cartella Preventivo Corrente» — e su una
   finestra media non ci starebbero: finirebbero fuori dallo schermo, tagliati,
   senza nemmeno un segno che dica che ci sono. Invece di accorciare i nomi si
   stringe la testata: prima corpo e imbottiture, poi, se non basta ancora,
   restano le sole icone — e i nomi passano nei suggerimenti.
   Si misura l'ultimo tasto, non «scrollWidth»: qui il traboccare è visibile,
   e quel numero non lo racconterebbe. */
function adattaTestata(){
  const h=$('header.app'); if(!h) return;
  const trabocca=()=>{
    const u=h.lastElementChild; if(!u) return false;
    return u.getBoundingClientRect().right > h.getBoundingClientRect().right-6;
  };
  h.classList.remove('stretta','icone');
  if(!trabocca()) return;
  h.classList.add('stretta');
  if(!trabocca()) return;
  h.classList.add('icone');
}
addEventListener('resize',adattaTestata);

function legaTestata(){
  $('#btnNuovo').onclick   = nuovoPreventivo;
  $('#btnApri').onclick    = apriPreventivo;
  $('#btnRecenti').onclick = dialogoRecenti;
  $('#btnCartella').onclick = dialogoCartella;
  $('#btnCartellaPrev').onclick = apriCartellaPreventivo;
  $('#btnBackup').onclick   = dialogoBackup;
  const nomeDoc=$('#docname');
  // senza la funzione di mezzo, al dialogo arriverebbe l'evento del clic come
  // primo argomento — che è «vero», e farebbe comparire la variante d'avvio
  nomeDoc.onclick   = ()=>dialogoNome();
  nomeDoc.onkeydown = e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); dialogoNome(); } };
  $('#btnSalva').onclick   = ()=>salvaPreventivo(false);
  $('#btnSalvaCome').onclick = ()=>salvaPreventivo(true);
  adattaTestata();
  $('#btnTema').onclick    = ()=>{
    OPZ.theme = OPZ.theme==='dark'?'light':'dark';
    salvaOpzioni(); render();
  };
  document.addEventListener('keydown',e=>{
    if(!(e.ctrlKey||e.metaKey)) return;
    const k=e.key.toLowerCase();
    if(k==='s'){ e.preventDefault(); salvaPreventivo(e.shiftKey); }
    if(k==='o'){ e.preventDefault(); apriPreventivo(); }
    if(k==='p'){ e.preventDefault(); stampa(); }
  });
  /* Solo nel browser. Dentro l'app NO: annullare qui la chiusura la blocca e
     basta, senza mostrare niente — la X in alto a destra smetteva di
     funzionare. Lì la domanda la fa il processo principale, con una finestra
     vera e tre risposte possibili. */
  if(!IO.desktop) window.addEventListener('beforeunload',e=>{
    if(modificato && !documentoVuoto(S)){ e.preventDefault(); e.returnValue=''; }
  });
}

async function avvia(){
  IO.fileDaAprire = IO.fileDaAprire || (async()=>null);
  /* L'intestazione predefinita viene ripassata al setaccio prima di rientrare
     in pagina: quel che è stato incollato una volta da fuori non torna com'era.
     Nel desktop il file nella cartella «Intestazione» ha la precedenza: è lì
     che si vede, si copia e si porta su un altro computer. */
  let predef=null;
  try{ predef = await IO.predefLeggi(); }catch(_){}
  if(predef==null){ try{ predef = localStorage.getItem(CHIAVE_INTEST); }catch(_){} }
  try{ INTEST_PREDEF = pulisciHTML(predef || ''); }catch(_){ INTEST_PREDEF=''; }
  INTEST = INTEST_PREDEF;
  try{ OPZ = Object.assign(OPZ, JSON.parse(localStorage.getItem(CHIAVE_OPZ)||'{}')); }catch(_){}
  caricaAspetto();

  /* Si parte sempre da un preventivo vuoto — tranne l'intestazione, che resta.
     Il lavoro della volta prima non viene però buttato via in silenzio: se era
     rimasto qualcosa, lo si può riprendere con un clic. */
  let bozza=null;
  try{ bozza=JSON.parse(localStorage.getItem(CHIAVE_BOZZA)||'null'); }catch(_){}

  S=NUOVO(); S.active=S.tabs[1].id;
  filePath=null; modificato=false;

  legaTestata();
  legaMenuContestuale();
  if(!window.__DESKTOP__) legaZoomWeb();
  render();

  /* Un preventivo aperto con un doppio clic (magari un backup) ha la
     precedenza su tutto: è quello che si vuole vedere. */
  let apertoDaFuori=false;
  try{
    const f=await IO.fileDaAprire?.();
    if(f&&f.contenuto){ caricaDocumento(f.contenuto,f.percorso); apertoDaFuori=true; }
  }catch(_){}

  if(!apertoDaFuori && bozza && !documentoVuoto(bozza)){
    toast('C\'è il preventivo della sessione precedente.','',{label:'Ripristina',fn:()=>{
      // ripristinando non ha più senso restare a chiedere un nome nuovo
      if(!$('#overlay').hidden && $('#mNomeDoc')){ $('#overlay').hidden=true; $('#modal').innerHTML=''; }
      S=Object.assign(NUOVO(),bozza);
      S.cliente=Object.assign({nome:'',indirizzo:'',cell:'',mail:''},bozza.cliente||{});
      S.righe=migraPromo(S.righe||[]);
      if(!tabById(S.active)) S.active=(tabVoci()[0]||S.tabs[0]).id;
      modificato=true; render(); toast('Preventivo ripristinato','ok');
    }});
  }

  /* Si parte dal riquadro iniziale. Nel browser non servirebbe a niente — non
     c'è nessuna cartella da scegliere e nessun file da aprire — e non si apre.
     Aprendo un preventivo con un doppio clic non si apre nemmeno: quello che si
     voleva vedere è già a video. */
  if(!apertoDaFuori && IO.desktop) setTimeout(async()=>{
    if(await daChiedereLaCartella()) await dialogoPrimaCartella();
    dialogoAvvio();
  },250);
  avviaBackupAutomatico();
}

if(!window.__DESKTOP__) document.addEventListener('DOMContentLoaded',avvia);
