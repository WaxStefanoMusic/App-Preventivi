# App Preventivi

Preventivi in formato A4, da stampare o esportare in PDF ed Excel.

```
APP PREVENTIVI\
├─ preventivi.html          ← l'app in un file solo: doppio clic e si apre nel browser
├─ Preventivi\
│  └─ Cucina Rossi\             ← una cartella per ogni preventivo
│     ├─ Cucina Rossi.preventivo
│     └─ Backup\                ← le sue copie, una ogni 10 minuti
├─ Intestazione\            ← le intestazioni salvate, una per file
│  └─ Predefinita.html      ← quella con cui parte ogni preventivo nuovo
├─ Backup\                  ← copie complete fatte a mano
└─ App\                     ← la versione desktop (Electron)
   ├─ avvia.cmd             ← avvio in sviluppo
   ├─ main.js  preload.js
   ├─ renderer\             ← styles.css, core.js, desktop.js, index.html
   ├─ build\                ← icona e personalizzazioni dell'installer
   └─ Installer\            ← gli eseguibili prodotti
      ├─ App Preventivi Setup 1.0.0.exe      (installer)
      └─ App-Preventivi-portable-1.0.0.exe   (portatile, non installa niente)
```

## Come si usa

**TAB.** «PREVENTIVO COMPLESSIVO» somma le righe di tutte le sezioni. Con
`＋ Sezione` se ne aggiungono altre: doppio clic per rinominarle, si trascinano
per riordinarle. Ogni TAB si stampa per conto suo; quello complessivo li stampa
tutti insieme.

Nel complessivo compare in più una prima colonna **TAB**, che ricorda da quale
sezione arriva ogni riga: cliccandola si va in quella sezione. Serve solo a
schermo — in stampa, nel PDF e nell'Excel restano le sette colonne di sempre.

**La tabella.** `＋ Riga` (o Ctrl+Invio) aggiunge una voce. Imponibile e Totale
si calcolano da soli: `prezzo × quantità`, poi l'IVA della riga. I numeri si
scrivono come vengono — `1.234,56`, `1234.56`, `1234,56` — e vengono riscritti
in bella copia quando si esce dal campo.

**Spostare una riga.** In fondo a ogni riga, prima della x, ci sono due frecce
che la portano su e giù dentro la sua sezione. La stessa cosa si fa trascinandola
col mouse: si afferra da un punto che non si scrive — le colonne dei conti, o la
zona dei tasti — e la si posa sopra o sotto un'altra riga, che intanto mostra da
che parte finirà. Nel preventivo complessivo non si sposta niente: lì le righe
arrivano da sezioni diverse e l'ordine è quello dei TAB. Frecce e trascinamento
restano a schermo: sulla carta e nelle esportazioni non compaiono.

**Nota.** In fondo a ogni sezione — non nel preventivo complessivo — c'è una riga
per appuntarsi qualcosa: cresce con il testo e si apre in grande con il tasto
`⤢`, come la Descrizione. Di suo **non** finisce nel preventivo: è un promemoria
per chi lo scrive. Spuntando la casella a destra ci entra, e sulla carta compare
in fondo, sotto le rate.

**Descrizione.** Il riquadro cresce con il testo; oltre le sei righe circa si
ferma e il pulsante `⤢` diventa blu: premendolo si apre la descrizione in una
finestra grande. Sulla carta viene stampata per intero.

**Intestazione.** Il pulsante c'è in tutti i TAB ed è sempre la stessa: carattere,
dimensione in punti, grassetto, corsivo, sottolineato, allineamento e colore,
come in Excel. Non si vede mentre compili: compare in cima al foglio stampato.
È l'unica cosa che resta quando si comincia un preventivo nuovo.

Le intestazioni si tengono da parte nella cartella **Intestazione**, una per
file: si dà un nome e si preme `💾 Salva nella cartella`, poi si richiamano
dall'elenco con `Carica`. `📁` apre la cartella.

I due pulsanti in fondo alla finestra fanno cose diverse:

| | |
|---|---|
| `Salva` | usa l'intestazione **in questo preventivo**, e basta |
| `★ Usa come Predefinita` | la mette anche in **tutti i preventivi nuovi** |

La predefinita è il file `Intestazione\Predefinita.html`: si può copiare su un
altro computer. Aprendo un preventivo vecchio si vede l'intestazione con cui era
stato fatto, e la predefinita non cambia.

**Dati Cliente e Data.** Anche questi si vedono solo sulla carta: il cliente a
sinistra, la data a destra. La data si scrive di seguito — `10082026` diventa
`10-08-2026` da sola.

**Prezzo concordato.** Sotto ai totali c'è `＋ Aggiungi Prezzo Concordato`.
Premendolo compare la riga in cui scrivere il prezzo pattuito con il cliente; da
quel momento, fra `TOTALE` e `PREZZO CONCORDATO`, si aggiunge da sola la
riga **SCONTO** con la differenza e la percentuale. Le due righe finiscono anche
in stampa, nel PDF e nell'Excel, e lì la cifra che chiude il conto diventa il
prezzo concordato. Il `×` accanto al prezzo lo toglie e tutto torna com'era.

**Acconti.** Sotto ai totali ci sono già le due scadenze che si usano quasi
sempre — `ACCONTO ALLA CONFERMA D'ORDINE` al 50% e `RIMANENTE A LAVORI CONCLUSI`
al 50%. Nome e **percentuale si scrivono a mano**, l'importo lo calcola l'app sul
prezzo concordato, o sul totale ivato se il concordato non c'è. Il `＋` sotto al
riquadro aggiunge un'altra rata, la `×` ne toglie una. Se le percentuali non
fanno 100 l'app te lo dice ma non ti ferma. Anche le rate finiscono in stampa,
nel PDF e nell'Excel.

Nelle sezioni ogni rata mostra la propria quota, spartita come il prezzo
concordato: le quote delle sezioni sommano al centesimo la rata del complessivo.

**Stampa ed esportazione.** `▯ Verticale` / `▭ Orizzontale` sceglie il formato A4;
il foglio a schermo è già largo quanto quello che uscirà. Quando le voci non
stanno in una pagina, la riga ARTICOLO · DESCRIZIONE · PREZZO UNITARIO €
· QUANTITÀ · IMPONIBILE € · IVA % · TOTALE viene ricopiata in cima alla pagina
nuova, e IMPONIBILE TOTALE € · IVA TOTALE · TOTALE restano uniti: se non
entrano in fondo, scendono insieme alla pagina dopo. Niente fondini colorati,
righe sottili, nero su bianco: la cartuccia dura.

Nei margini del foglio ci scrive il motore di stampa, non la pagina. L'app gli
dice di metterci solo il **nome del file in alto a destra** e il **numero di
pagina in basso a destra**: niente data, niente nome dell'applicazione, niente
indirizzo del file. Vale per `⇩ PDF` e per `🖨 Stampa` dell'app installata.

> Aprendo invece `preventivi.html` direttamente nel browser, quelle righe le
> decide il browser e una pagina web non può cambiarle: si tolgono a mano
> togliendo la spunta a **«Intestazioni e piè di pagina»** nella finestra di
> stampa (sparisce però anche il numero di pagina). Per avere il foglio come
> deve essere, stampa dall'app installata.

**Una sezione o tutte.** Quando le sezioni sono più d'una, accanto al formato del
foglio compare `Solo questa sezione / Tutte le sezioni`. Con «tutte», stampa, PDF
ed Excel prendono **tutti i TAB in un file solo**: nel PDF una sezione per pagina,
nell'Excel un foglio per sezione. **L'ordine è quello dei TAB**, che si
trascinano per cambiarlo.

`⇩ PDF` e `⇩ Excel` salvano nella cartella **Preventivi**. L'Excel è un `.xlsx`
vero, con la tabella tutta incorniciata e — soprattutto — **le formule dentro**:

| Cella | Formula |
|---|---|
| Imponibile € | `=prezzo × quantità` |
| Totale € | `=imponibile × (1 + IVA/100)` |
| Imponibile totale | `=SOMMA(...)` della colonna |
| IVA totale | `=MATR.SOMMA.PRODOTTO(imponibili; aliquote)/100` |
| Totale | `=imponibile totale + IVA` |
| Sconto | `=totale ivato − prezzo concordato` |
| Rate | `=base × percentuale/100` |

Cambiando un prezzo o una quantità dentro Excel, tutto il resto si aggiorna da
solo — sconto e rate compresi.

**Da dove si parte.** Al primissimo avvio dopo l'installazione l'app chiede una
volta sola dove tenere preventivi, intestazioni e backup; chi preferisce farlo
dopo chiude e se ne occupa dal tasto **Cartella Salvataggi**, in cima.
Poi — e a ogni avvio successivo — si apre il riquadro con cui si comincia:
**Nuovo**, **Carica Preventivo**, **Recenti**, **Chiudi**.

**Il nome.** Scegliendo «Nuovo» l'app chiede come si chiama il preventivo: da quel
nome nascono la **sua cartella** e, dentro, quella dei **backup**, dove viene
salvata una copia **ogni 10 minuti** finché ci lavori (solo se qualcosa è
cambiato; ne restano le ultime 40).

I preventivi si salvano con estensione `.preventivo`: un doppio clic li apre con
l'app, **anche i backup**. I vecchi file `.json` continuano ad aprirsi.

**Apri Recente.** Accanto ad `Apri`: gli ultimi dieci preventivi aperti o
salvati, con data e cartella. Quelli spostati o cancellati spariscono da soli
dall'elenco.

**Tasto destro.** Sui campi in cui si scrive compaiono i comandi di Windows
(Taglia, Copia, Incolla). Su un **TAB** si aggiungono *Duplica la sezione*,
*Rinomina*, *Elimina*. Su una **riga** si aggiungono *Duplica la riga*, *Promo* e
*Elimina*.

**Promo.** Sbarra il prezzo che c'era e apre sotto una riga gemella dove scrivere
quello nuovo. Il prezzo vecchio resta a vista — sul foglio e in Excel — ma
**non entra nei conti**: serve solo a far vedere al cliente di quanto sei sceso.
Ripremendo *Promo* sulla riga barrata si torna indietro.

**Cartella e Backup.** Al centro della testata ci sono due pulsanti.
`📁 Cartella` mostra dove finiscono preventivi, intestazioni e backup, e permette
di **spostarli dove vuoi** (i file già salvati restano dove sono: da lì in avanti
si scrive nella cartella nuova). `🛟 Backup` apre la cartella dei backup **del
preventivo aperto**: da lì un doppio clic su una copia la riapre con l'app.

Disinstallando l'app ti viene sempre chiesto se cancellare anche i dati, e ti
vengono elencate le tre cartelle che verrebbero eliminate — anche se le hai
spostate altrove, perché il percorso resta annotato per il disinstallatore. La
risposta preferita è **No**: i dati restano.

**Nome del preventivo.** In alto, accanto al logo, c'è `Preventivo senza nome`:
cliccandoci si dà un nome al preventivo, e quel nome viene proposto quando salvi
o esporti in PDF ed Excel. I caratteri che Windows non accetta in un file
(`: / \ * ? " < >`) vengono sostituiti nel nome del file, ma restano com'erano
nel nome che leggi. Se nella finestra di salvataggio scegli un altro nome,
comanda quello. Il pallino giallo accanto al nome segnala modifiche non salvate.

**Salvataggi.** `Salva` / `Apri` usano un file `.json` che contiene tutto,
intestazione compresa. All'avvio si parte sempre da un preventivo vuoto; se la
volta prima era rimasto del lavoro non salvato, compare un avviso con
«Ripristina».

**Schermi 4K.** L'interfaccia si ingrandisce da sola in base allo schermo.
`Ctrl +` / `Ctrl −` per regolarla a mano, `Ctrl 0` per tornare automatici.
Anche l'installer è dichiarato consapevole del DPI, così non esce sfocato.

## Per chi ci mette mano

```
cd App
npm install
npm start          # avvia l'app          (oppure avvia.cmd)
npm run html       # rigenera preventivi.html dai file in renderer\
npm run installer  # ricrea gli eseguibili in Installer\
```

La sorgente è una sola: `App\renderer`. `preventivi.html` viene **generato** da
lì con `npm run html` — non va modificato a mano, le modifiche andrebbero perse
alla generazione successiva.

Avviando l'app dalla cartella di build (`Installer\win-unpacked`) i preventivi
vengono comunque scritti qui accanto, non dentro `Installer\`: quella cartella
viene rifatta a ogni compilazione.

## Pubblicare una versione nuova

L'app installata controlla da sola le Release della repository
[App-Preventivi](https://github.com/WaxStefanoMusic/App-Preventivi): all'avvio
e ogni sei ore. Se ne trova una più recente la scarica in sottofondo e, a
scaricamento finito, chiede se installarla adesso o alla prossima chiusura —
mai a metà di un preventivo. Nel menu `?` c'è anche «Controlla aggiornamenti…».

Perché una modifica arrivi a chi ha l'app installata servono due cose: **il
numero di versione più alto** e **una Release pubblicata**.

```
1. alza "version" in App\package.json          (1.0.1 → 1.0.2)
2. git commit e git push
3. cd App
   GH_TOKEN=$(gh auth token) npx electron-builder --win nsis portable --publish always
```

Se l'invio dei file si interrompe a metà — capita, sono 100 MB a file — gli
eseguibili sono comunque già pronti in `Installer\`: si finisce a mano con

```
gh release upload v1.0.2 Installer\App-Preventivi-Setup-1.0.2.exe ^
  Installer\App-Preventivi-Setup-1.0.2.exe.blockmap ^
  Installer\App-Preventivi-portable-1.0.2.exe Installer\latest.yml --clobber
```

`latest.yml` è il foglietto che l'app legge per sapere qual è l'ultima versione:
nella Release ci deve essere sempre, o l'aggiornamento non parte. Anche il nome
dell'installer non deve avere spazi, perché GitHub li sostituisce negli allegati
e l'app andrebbe a cercare un file che lì non esiste.

La versione portatile non si aggiorna da sé: è un solo file, senza niente da
installare, e va riscaricata quando serve.
