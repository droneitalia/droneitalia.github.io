# Diario di volo: integrazione pronta, attivazione da completare

Il codice aggiunge invii dal sito, verifica email condivisa con Commenti, fino a cinque foto e un avatar JPEG compressi (150 KiB ciascuno), link YouTube, moderazione di testo e immagini, coda privata dell’autore, revisione amministratore e notifica email. Le bozze non vengono pubblicate per il solo fatto di avere una sessione nel browser.

## Stato e verifiche

- 15 test automatici con SQLite reale in memoria: identità verificata dal servizio, diritti/consensi obbligatori, isolamento proprietari, media privati, YouTube limitato a indirizzi ammessi, moderazione non disponibile/flagged, video in attesa, invii idempotenti, notifiche senza duplicati su retry confermati, revisioni e approvazione, errori del provider email, ban community.
- Test e chiamate email/moderazione usano servizi simulati. Nessuna email reale è stata inviata.
- Controlli sintattici Node eseguiti per Worker e script frontend; HTML controllato per ID duplicati.
- Anteprima browser locale non disponibile: il daemon `sites-previewd` manca. Resta da verificare il flusso pubblico, con servizi configurati, prima della pubblicazione.
- La configurazione frontend ha `api:''` intenzionalmente. Non pubblicare su main prima dei controlli live.

## Costi verificati il 29 ottobre 2026

La scelta evita R2 e il relativo checkout con fatturazione a consumo. Le foto sono BLOB in un nuovo database D1, separato da quello dei commenti; limite applicativo complessivo 100 MiB, oltre il quale nuovi caricamenti sono rifiutati, senza upgrade automatico. Il limite effettivo disponibile va verificato sull’account.

- Workers Free: 100.000 richieste al giorno, 10 ms CPU per richiesta. Superare limiti può interrompere il servizio; nessun passaggio a pagamento è autorizzato.
- D1 Free: 5 milioni di righe lette/giorno, 100.000 scritte/giorno, 5 GB complessivi per account; limite di 500 MB per singolo database Free. Quote condivise con il resto dell’account.
- OpenAI Moderation: endpoint gratuito per gli utenti API; richiede un account e una chiave con accesso funzionante. Non usa modelli generativi a pagamento, non analizza l’intero video e non certifica privacy, copyright o regolarità del volo.
- Provider email già esistente: da identificare nel Worker Commenti. Se Brevo Free, limite pubblico 300 email/giorno; se Resend Free, 3.000/mese e 100/giorno. Login e notifiche condividono la quota effettiva dell’account. Non cambiare piano o attivare pay-as-you-go.
- Il Worker limita le notifiche a 10 nuovi record contattati/giorno e a tre tentativi per record, conservando quelli non inviati in coda. Un timeout dall’esito incerto non viene ritentato automaticamente: verificare il provider per evitare duplicati.
- YouTube: si memorizza soltanto l’ID video. Nessun file video viene caricato o analizzato a pagamento dal sito.

Fonti ufficiali:
https://developers.cloudflare.com/workers/platform/limits/
https://developers.cloudflare.com/d1/platform/pricing/
https://developers.cloudflare.com/d1/platform/limits/
https://developers.cloudflare.com/r2/get-started/
https://help.openai.com/en/articles/4936833-is-the-moderation-endpoint-free-to-use
https://developers.openai.com/api/docs/guides/moderation
https://resend.com/pricing
https://help.brevo.com/hc/it/articles/208580669-FAQ-Quali-sono-i-limiti-del-piano-Free

## Attivazione senza sostituire i servizi già funzionanti

1. Accedere al Cloudflare del progetto. Esaminare il Worker Commenti corrente, piano effettivo e provider email. Non sostituirlo con copie storiche dei file PayPal.
2. Nel solo endpoint autenticato `/auth/me`, riutilizzare la sessione e la logica di ban esistenti per restituire:
   ```json
   {"authenticated": true, "accountId": "identificatore-pseudonimo-stabile-del-soggetto", "canPost": true}
   ```
   `accountId` deve provenire dall’account verificato sul server, rimanere stabile attraverso nuovi accessi e non essere l’email in chiaro. `canPost` deve essere falso per gli account bloccati. Il nuovo servizio non si fida di valori inviati dal browser. Se questi campi mancano, l’invio rimane bloccato: nessun fallback a una semplice spunta locale o all’hash di una sessione temporanea.
3. Creare un nuovo D1 sul piano Free, importare `backend/schema.sql` e collegarlo al nuovo Worker `drone-italia-diario` come `DB`. Non eseguire lo schema nel database Commenti. Registrare il database_id in `backend/wrangler.toml`.
4. Impostare in modo riservato i secret `JOURNAL_OWNER_SECRET` (casuale, almeno 32 caratteri), `OPENAI_API_KEY` e la chiave del provider email già utilizzato. Non salvarli in Git, HTML, log o screenshot. Verificare l’account API prima di abilitare la pubblicazione automatica; in assenza di moderazione, gli invii restano in attesa.
5. Impostare `MAIL_PROVIDER` (brevo/resend), `EMAIL_FROM` (mittente già verificato) e `ADMIN_EMAIL` (destinatario amministrativo confermato). Sono vuoti di default per evitare email a destinatari indovinati. Verificare quote e disattivazione di qualsiasi pay-as-you-go.
6. Distribuire il Worker sul piano Free e il cron orario. Verificare `/health`, sessione verificata, recupero identità dopo un nuovo login, ban, submit senza sessione negato e immagini private non accessibili pubblicamente.
7. Testare un invio autorizzato di testo/foto, uno con video, modifica del proprio invio in attesa e approvazione da un secondo ruolo. Inviare una notifica di prova al solo amministratore confermato e verificare la consegna, senza pubblicare dati personali di prova.
8. Impostare l’URL Worker reale in `assets/journal-config.js`. Aggiungere a index.html lo script defer `assets/journal-return.js?v=1` per tornare al Diario dopo il magic link, lasciando intatto il gestore `di-community-return` esistente.
9. Solo dopo questi controlli promuovere i file frontend su main e verificare la versione pubblicata. Controllare gallery, video, ricerca, form/checkbox, stato grigio privato e pannello. Nessuna modifica al sistema di pagamento.

## Comportamento e limiti

I video richiedono sempre revisione umana. Un esito positivo di Moderation è solo un segnale sulle categorie supportate, non una garanzia sui diritti dei contenuti. Dichiarazioni diritti e informativa sono obbligatorie e non preselezionate. L’amministratore può rifiutare o nascondere un contenuto. L’autore può modificare pending/rejected; gli aggiornamenti riavviano i controlli. Per cambiare un racconto già pubblicato si contatta l’amministratore (nessuna sostituzione delle foto pubblicate senza revisione).

Le immagini vengono ricodificate nel browser in JPEG senza metadati originali. Il server verifica dimensioni e formato ammesso. Gli upload incompleti e i contatori scaduti vengono ripuliti dal cron. Gli autori sono identificati tramite HMAC di un soggetto verificato; l’email non viene salvata nel Diario. Il valore `JOURNAL_OWNER_SECRET` va conservato per mantenere l’associazione dei racconti dopo reinstallazioni o nuovi accessi.

Il pannello Diario verifica la stessa chiave amministrativa tramite l’endpoint Commenti esistente; non salva chiavi nel browser. Le email riportano un link al pannello, senza token di approvazione o dati di accesso nell’URL.

## Esecuzione test

```sh
node --test tests/journal.test.mjs
```
Richiede Node con `node:sqlite` (eseguito con Node 24). I file preview.html, index.html locale di anteprima, build.py e le copie media non vanno pubblicati al posto della home: per index.html usare soltanto la modifica allo script di ritorno sulla sorgente corrente.

## Aggiornamento dopo la lettura del Worker Commenti reale

Il file fornito dall’utente il 29/10/2026 conferma `GAS_WEB_APP_URL` + `DRONE_ITALIA_SECRET`: il servizio email attuale è un gateway Google Apps Script, non Brevo/Resend. Le configurazioni di questi ultimi nel nuovo Worker sono alternative non attivate; prima della distribuzione occorre integrare il gateway esistente, dopo avere esaminato il suo Code.gs. Non creare un nuovo provider email.

È stata preparata `integration/worker-commenti-diario.mjs`, ottenuta dalla sorgente allegata cambiando soltanto `/auth/me`: restituisce uno pseudonimo stabile ottenuto con HMAC separato per dominio e `canPost` calcolato sui ban account già esistenti. Nessuna nuova tabella o secret è richiesta per questa modifica. Il nuovo Worker Diario invia `Origin: https://droneitalia.github.io` quando consulta il servizio Commenti, come richiesto dal codice reale.

I test sono ora 20: cinque usano il modulo Commenti aggiornato e verificano identità stabile tra sessioni, sessioni revocate, ban account, origine non consentita e collegamento autentico dei due moduli. Rimangono test locali, senza invii email reali. Eseguire `node --test tests/*.test.mjs`.

Fonte quote Google: https://developers.google.com/apps-script/guides/services/quotas (100 destinatari al giorno per account consumer, 1.500 per Workspace, quote per utente condivise con gli altri invii). Verificare il tipo di account e il codice GAS prima di confermare la capacità effettiva. Nessun valore di GAS_WEB_APP_URL o DRONE_ITALIA_SECRET va copiato in file pubblici.
