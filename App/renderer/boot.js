/* Deve girare PRIMA di core.js.
   Segnala che siamo dentro il guscio Electron: così core.js non parte da solo e
   non applica lo zoom del browser — ci pensa desktop.js, dopo aver messo al
   posto di IO le versioni che salvano davvero su disco. */
window.__DESKTOP__ = !!(window.preventivi && window.preventivi.isDesktop);
