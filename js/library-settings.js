/* Pagine editoriali delle ambientazioni in Biblioteca > "Ambientazioni e
   storie" (integrazione FASE FINALE). Contenuto interamente statico,
   riusato ESCLUSIVAMENTE dalle tre premesse fornite (Icaro/Ich/Eidos):
   nessun evento/personaggio/luogo/fazione/creatura/conflitto/cronologia
   inventato qui, nessun collegamento fra le tre ambientazioni non
   presente nelle fonti. Una sola funzione di rendering per tutte e tre
   (stesso schema a 17 punti), mai tre markup duplicati.

   Una sezione compare SOLO se la fonte contiene davvero quel materiale:
   se LIBRARY_SETTINGS[key].sections non include una voce, quella sezione
   non viene mostrata (mai un contenitore vuoto) — l'assenza va registrata
   nel documento di lavorazione, non qui nel codice applicativo. */

/* Fonti: "Icaro – Premessa", "Eidos" e "Ich", documenti di ambientazione
   forniti dall'autore del gioco (letti integralmente per popolare questo
   file). Nessuna delle tre schede include una "sezione riservata al
   Narratore": nessuna delle fonti contiene anticipazioni narrative
   distinte dal resto del materiale (Eidos ha una nota di preparazione al
   personaggio, riportata sotto "Indicazioni per il Narratore" perché è
   procedurale e non un'anticipazione di trama). Nessuna delle tre include
   una copertina: nessun asset immagine reale è stato aggiunto al progetto
   per queste ambientazioni. Entrambe le omissioni valgono per tutte e tre
   le schede e sono registrate qui in assenza di un documento di
   lavorazione dedicato a questa sotto-fase. */
const LIBRARY_SETTINGS = {
  icaro: {
    title: 'Icaro',
    summary: 'Sulla Terra il sole si è spento nel 2747: l\'umanità sopravvive sotto nove cupole cittadine, divisa in caste di colore e governata da una tecnocrazia planetaria, la Repubblica Pannazionale.',
    sections: [
      { label: 'Premessa', body: '«L\'uomo si vanta di essere padrone della propria storia, ma può pensare che non differisca affatto dagli animali. Tuttavia vi è una diversità a cui ho pensato. Non nel modo di comunicare, ma nella facoltà di esserne protagonista e non semplice spettatore.» — George Script, Storico e Poeta di C-8' },
      { label: 'Ambientazione', body: 'La storia è ambientata nell\'anno 161 CE (data corrente 3172) su una Terra priva di sole: nel 2747 un guasto alla stazione stellare Icaro, incaricata di prelevare energia dal Sole per il pianeta e le colonie marziane, ne causò lo spegnimento in appena otto minuti e venti secondi. Dopo trecento anni di glaciazione totale (il manto di ghiaccio esterno tocca i -140°), l\'umanità sopravvive grazie a sperimentazione genetica, meccanica e cibernetica in nove città-stato cupolate, erette sopra i resti di metropoli storiche. L\'ambientazione dichiara ispirazioni a Horizon Zero Dawn, Akira, Ghost in the Shell, Altered Carbon e Westworld.' },
      { label: 'Epoca e contesto', body: 'Le nove Metropoli attive (C1-C9) sorgono nei pressi di città preesistenti: C1 São Paulo (nuova), C2 New York, C3 Pechino, C4 Roma, C5 Nuova Delhi (nuova), C6 Mosca, C7 Tokyo, C8 Cairo, C9 Johannesburg. Il governo centrale, la Repubblica Pannazionale, nacque dalla Convenzione del Wyrd redatta dall\'Icaro Ilysia Rodano dopo le guerre civili dei primi anni di buio; il patto abolì le armi da fuoco e ogni credo religioso organizzato, accentrando il potere in una tecnocrazia fondata su efficienza e libero mercato.' },
      { label: 'Temi principali', body: [
        'Il valore della vita contro la sua riduzione a peso economico sacrificabile ("il fine giustifica i mezzi"), dichiarato nel documento come tema conduttore della campagna.',
        'Il confronto fra le correnti filosofiche Utilitarismo, Inflazione e Reionizzati sul senso da dare alla sopravvivenza della specie.',
        'La competizione come principio sociale: ogni individuo vive di "Anni Luce" assegnati in base alla propria utilità, misurata dal sistema Cromo.'
      ] },
      { label: 'Luoghi principali', body: [
        'C1 – la Culla delle Materie Prime: raffinazione di risorse e produzione del Vantablack, controllata dalla BlackRoot Industries.',
        'C2 – sorta presso New York: sicurezza, forze dell\'ordine e Patrioti, patria di Richard Phillips.',
        'C3 – la Città delle Macchine (presso Pechino): robotica e meccanica, sede della compagnia Bernard.',
        'C4 – presso Roma: arti sceniche, spettacoli e Immersioni, patria dell\'Icaro Anastasia Kurer.',
        'C5 – la Città Verde (presso Nuova Delhi): biotecnologie, Eden Bioforge e Next Tech.',
        'C6 – la Città Fantasma (presso Mosca): spionaggio digitale, Delos Industries.',
        'C7 – la Città del Movimento (presso Tokyo): automazione e logistica, Fate Trade e Kirov Dynamics.',
        'C8 – la Città della Rinascita (presso il Cairo): ricerca medica, MedSync.',
        'C9 – la Città del Passato (presso Johannesburg): archeologia industriale, Crypto Memories.'
      ] },
      { label: 'Fazioni', body: [
        'La Repubblica Pannazionale, governo tecnocratico centrale nato dalla Convenzione del Wyrd.',
        'Gli Icaro, concilio di scienziati insigniti di vita eterna per meriti scientifici e genetici (unico colore ammesso: il bianco).',
        'La scala cromatica sociale: giallo (programmatori/ingegneri), amaranto (politici e grandi imprese), arancio (forze dell\'ordine, banchieri, medici), verde (artisti e intrattenitori), blu (operai specializzati), viola (operai comuni), grigio (spenti), nero (Spegni-luce, criminali ricercati), senza colore (chi vive fuori dal sistema, comprese le macchine e i Patrioti).',
        'I Patrioti, corpo armato androide della Lloyd Defence, unica forza autorizzata a usare armi da fuoco.'
      ] },
      { label: 'Personaggi rilevanti', body: [
        'Ilysia Rodano, "la purissima", Icaro autrice della Convenzione del Wyrd.',
        'Richard Phillips, III Collegiale di Repubblica, originario di C2.',
        'George Script, storico e poeta di C-8, voce della Premessa.',
        'Jacques Bernard, alla guida della compagnia Bernard (C3) dopo la morte del padre.',
        'Dottoressa Dawn Jordsonn, ricercatrice di C5 sulla "vita dopo la morte" e sul sistema Cromo.',
        'Norman Delos, a capo della Delos Industries (C6).',
        'Fate Alatri (Fate Trade) e Florens Esprit (Akila), figure di spicco di C7.',
        'Dottoressa Cleyra Arpana, MedSync, ricerche di potenziamento cognitivo a C8.',
        'Thomas Epos, fondatore di Crypto Memories e del Progetto Ich, da poco deceduto; Evan Wood, che gli è succeduta alla guida della corporazione.'
      ] },
      { label: 'Minacce e antagonisti', body: [
        'Antoine Delacroix, il terrorista che spense una delle undici città originarie: il criminale più temuto della Repubblica.',
        'I gruppi "Spegni-luce": Demo, Dotcom, i Senzavolto, gli Anonymous.',
        'Le "Anime di metallo" e la dipendenza dal Telonio nei bassifondi, con il relativo mercato nero di parti di corpo.',
        'I "Teste di metallo" di C3, culto dell\'efficienza robotica sull\'efficienza umana.'
      ] },
      { label: 'Conflitti', body: [
        'L\'attentato terroristico alla prima C1, che ne causò lo spegnimento e portò alla militarizzazione di C2.',
        'Il "brainfreeze" (raggelamento), male di natura ignota che porta chi ne soffre a uno stato catatonico o all\'autodistruzione.',
        'L\'aumento dei suicidi e le rivolte dei gruppi sociali soppiantati dalle macchine contro gli Icaro stessi.',
        'A C9, la contrapposizione fra la visione originaria di Thomas Epos per il Progetto Ich (ricostruire la memoria perduta) e la sua trasformazione, sotto Evan Wood, in un sistema di intrattenimento immersivo ad alto profitto.'
      ] },
      { label: 'Spunti per sviluppare storie', body: [
        'Indagare la vera causa del brainfreeze, il male che spinge migliaia di cittadini all\'autospegnimento.',
        'Muoversi nei bassifondi di C6 fra sorveglianza totale, Anonymous e identità criptate.',
        'Le "Cliniche Grigie" di C8, dove si sperimentano terapie non approvate sul confine fra cura e alterazione.',
        'Il conflitto interno a Crypto Memories (C9) fra chi vede nella memoria una salvezza e chi la sfrutta come nuova forma di dominio.'
      ] },
      { label: 'Indicazioni per il Narratore', body: 'La stessa premessa del documento dichiara il tema conduttore: raccontare il valore della vita, spesso ridotta a peso economico o a mezzo sacrificabile in nome dell\'efficienza, e cosa significhi davvero "essere umano" in un mondo costruito sulla competizione. Restano volutamente fuori scena: la causa esatta del guasto alla stazione stellare Icaro (mai approfondita oltre "qualcosa di ignoto") e ogni dettaglio sulle colonie marziane, di cui si perse il contatto e che la fonte non descrive ulteriormente.' },
      { label: 'Informazioni per i giocatori', body: 'Furto e omicidio sono equiparati a crimini contro l\'umanità; le armi da fuoco sono vietate a chiunque non sia un Patriota. Ogni personaggio nasce con una banca di Anni Luce donata da chi lo mette al mondo e riceve un colore in base alla scala cromatica: il colore non è un destino fisso, ma riflette il ruolo sociale e può cambiare, in peggio verso il grigio in caso di "autospegnimento" o verso il "senza colore" per chi fugge dal sistema.' },
      { label: 'Fonti', body: '"Icaro – Premessa", documento di ambientazione fornito dall\'autore del gioco.' }
    ]
  },
  eidos: {
    title: 'Eidos',
    summary: 'Un secolo dopo la sconfitta del dio vendicatore Aima, il mondo di Eidos resta diviso fra due fazioni in guerra per il controllo di un\'antica chiave, mentre gas tossici e mostri chiamati Tèras popolano le terre devastate dalla Grande Guerra.',
    sections: [
      { label: 'Premessa', body: '«In principio era il caos, poi il Demiurgo plasmò il cosmo.» Le leggende raccontano che un dio vendicatore, Aima, si risvegliò nel mondo riportando con sé la magia dimenticata; sconfitto dagli uomini dopo una guerra devastante, prima di sparire tinse il cielo di rosso con una pioggia di sangue, promettendo di tornare: «Il desiderio di trovare la chiave avvelenerà per sempre le vostre menti, ma ciò che state inseguendo vi permetterà di ottenere il potere di ricostruire il mondo a vostro piacimento, o non farete altro che aprire le porte alla sua distruzione?»' },
      { label: 'Ambientazione', body: 'Da quella pioggia sono nate le paludi tossiche che ancora oggi appestano l\'aria. Sono trascorsi circa cent\'anni dall\'esilio di Aima: le popolazioni superstiti hanno raggiunto un equilibrio instabile, mentre una guerra fra tre fazioni si trascina da decenni. Chorisfos ed Epizi, un tempo un solo popolo, si contendono territori e potere; dai resti della città ribelle di Antarsia, distrutta e oggi in rovina presso la Grande Palude di Tèime, è nata la terza fazione degli Antarsi.' },
      { label: 'Epoca e contesto', body: 'La guerra fra Chorisfos ed Epizi iniziò poco più di trent\'anni dopo la sconfitta di Aima e durò circa cinquant\'anni, con soste intermittenti; il grosso degli scontri si è concluso da circa vent\'anni, lasciando un fragile stallo mentre entrambe le fazioni continuano a cercare "la chiave", legata a una leggenda che promette il potere di ricostruire il mondo — o di distruggerlo.' },
      { label: 'Temi principali', body: [
        'La ricerca della chiave e il suo prezzo per chi la insegue.',
        'La contrapposizione fra magia (Chorisfos) e scienza (Epizi) come letture rivali della stessa catastrofe.',
        'La memoria perduta: gran parte dei saperi e degli scritti precedenti alla Grande Guerra sono andati distrutti o romanzati.'
      ] },
      { label: 'Luoghi principali', body: [
        'Apologeti, capitale sotterranea dei Chorisfos, scavata per centinaia di metri su più livelli.',
        'Epimno, capitale in altezza degli Epizi, protetta da scudi difensivi e aria filtrata.',
        'Lechta, capitale insulare e commerciale degli Eporiani, alle pendici di un vulcano.',
        'Erissa, la città mai vista degli Antarsi, di cui nessuno conosce la reale ubicazione.',
        'Le rovine di Antarsia, presso la Grande Palude di Tèime.',
        'La cava di Minote, controllata dagli Epizi per l\'energia delle loro armature.'
      ] },
      { label: 'Fazioni', body: [
        'Chorisfos: regime militare guidato da un Alto Concilio rinnovato ogni dieci anni, capo di Stato Amos Krusciov; vieta ogni forma d\'arte e separa i figli dai genitori a tre anni per l\'addestramento al Periphto.',
        'Epizi: retta da un Presidente a vita, Thomas Eichorst, con un Parlamento di sua nomina; vieta la magia e attribuisce ai Chorisfos l\'origine dei Tèras.',
        'Eporiani: popolo neutrale governato da un re ereditario, naviganti e mercanti, unica fazione che convive in armonia con i Tèras.',
        'Antarsi: sopravvissuti della distrutta Antarsia, guerriglieri che rifiutano il dominio delle due fazioni maggiori.'
      ] },
      { label: 'Personaggi rilevanti', body: [
        'Amos Krusciov, capo di Stato dei Chorisfos.',
        'Thomas Eichorst, Presidente a vita degli Epizi.',
        'Robert Epos, scienziato dei Chorisfos che formulò l\'armatura a gemme e, in origine, un antidoto contro le malattie.',
        'Karl Rottluff, scienziato degli Epizi che ne corruppe la formula per creare i soldati capaci di assumere forma di mostro.'
      ] },
      { label: 'Minacce e antagonisti', body: [
        'I Tèras, mostri comparsi dopo la sconfitta di Aima: nessuna fazione possiede un bestiario completo, e ciascuna ne dà una spiegazione diversa (corruzione tecnologica per i Chorisfos, abuso della magia per gli Epizi).',
        'I soldati d\'élite degli Epizi capaci di assumere la forma di un Tèras grazie alla formula corrotta di Rottluff: perdono progressivamente memoria e coscienza, diventando vere e proprie macchine da guerra.'
      ] },
      { label: 'Conflitti', body: [
        'La guerra pluridecennale fra Chorisfos ed Epizi per territori, popolazioni e la ricerca della chiave.',
        'La guerra di logoramento degli Antarsi contro entrambe le fazioni maggiori, che non avrà fine finché non avranno distrutto ogni loro città e liberato tutti gli abitanti al loro interno.',
        'Il rischio interno per gli stessi soldati Epizi potenziati: l\'armatura o il potere assunto, se abusati, arrivano a consumarne la coscienza fino a corromperli.'
      ] },
      { label: 'Spunti per sviluppare storie', body: [
        'La leggenda della chiave come motore di ogni spedizione oltre i confini noti.',
        'Un personaggio ribelle infiltrato in una delle due fazioni, secondo l\'eccezione che il Narratore può valutare in fase di creazione.',
        'I villaggi nascosti da cui, di tanto in tanto, arrivano nuovi reclutati per l\'una o l\'altra fazione: un obiettivo dichiarato di entrambi gli eserciti.'
      ] },
      { label: 'Indicazioni per il Narratore', body: 'I personaggi giocanti possono appartenere solo a Chorisfos o Epizi. Un\'idea di personaggio ribelle infiltrato può essere proposta al Narratore ma va valutata caso per caso: ne verrà accettato al massimo uno, con una bozza credibile di come si sia infiltrato nello schieramento scelto — un\'idea non abbastanza credibile non viene accettata, anche se fosse l\'unica proposta. Tutti i personaggi partono dal grado di soldato semplice, senza privilegi di partenza; l\'apprendimento di nuove tecniche segue l\'avanzamento della trama e non un livello fisso, quindi non tutti i personaggi progrediscono nello stesso momento. Se entrambe le fazioni vengono scelte dal gruppo, servono almeno due giocatori per ciascuna, da comunicare al Narratore prima di scrivere il background.' },
      { label: 'Informazioni per i giocatori', body: 'I campi del background del personaggio vanno compilati tutti, nel modo più esauriente possibile, prima di iniziare a giocare. Non esiste un bestiario ufficiale dei Tèras: ciò che il personaggio crede di sapere su di loro dipende dalla fazione di appartenenza, non da una verità oggettiva condivisa.' },
      { label: 'Fonti', body: '"Eidos", documento di ambientazione fornito dall\'autore del gioco.' }
    ]
  },
  ich: {
    title: 'Ich',
    summary: 'Nel mondo ciclico di Erdegis, ispirato alle culture norrene e celtiche, città alchemiche (Stad) e popoli tribali (Stam) convivono nella comune, mai risolta ricerca dell\'Ich: un bene primario o un potere divino che nessuno ha mai realmente trovato.',
    sections: [
      { label: 'Premessa', body: '«Senti quella voce? Sussurra al tuo orecchio muovendo passi invisibili, ciò che cerca appartiene ad ogni essere di Erdegis. Essa si annida in un labirinto che vede la luce soltanto nei nostri sogni.» — Vǫluspá Varhena Kynwyrd, ciclo argenteo' },
      { label: 'Ambientazione', body: 'Erdegis è un mondo "ciclico" di impronta medievale e rinascimentale con qualche accezione anacronistica: la scoperta scientifica vi è spesso associata all\'alchimia. I suoi abitanti, i reveries, popolano quattro grandi continenti più isole: Magna a nord-est (che ospita le regioni di Skjioldland, Kynhjarta/Kynwird, Bhorkyn e Skry y Kalter), Ourobera a ovest (il "continente delle piogge", abitato dagli Urobri), Vanargand a sud-ovest (climi opposti fra nord desertico e sud boscoso) e Restan a sud-est, diviso in due isole.' },
      { label: 'Epoca e contesto', body: 'Il mondo ha attraversato tre grandi cicli: il Ciclo degli Asi (la creazione di Erdegis e dei reveries da parte degli Aesir), il Ciclo argenteo (la fusione fra Aesir e reveries e la nascita delle prime società) e l\'attuale Ciclo aureo, un\'epoca di forti movimenti commerciali, espansioni territoriali e prime avvisaglie di guerra fra stad e di repressione delle tribù.' },
      { label: 'Temi principali', body: [
        'La ricerca dell\'Ich, l\'unico elemento che accomuna stad e stam pur restando incompreso da entrambe.',
        'La rete del Wyrd dei Kynwird: ogni azione, presente o passata, genera un\'eco che si propaga in entrambe le direzioni del tempo.',
        'Il dualismo fra le città (Stad), votate alla tecnica e all\'alchimia, e i popoli tribali (Stam), legati a territorio, tradizione e culto.'
      ] },
      { label: 'Luoghi principali', body: [
        'Kynhjarta, cuore del continente di Magna, terra dei Kynwird e del loro albero della vita.',
        'Skjioldland, regione delle stad guidate dalla casata Skjold, fra il Culto dei Tre Sussurri e il Culto di Sol.',
        'Bhorkyn, dominata dalla ricca Stadgull e dal suo rapporto di sudditanza con i popoli tribali locali (i Bhorkyn).',
        'Skry y Kalter, terra del clan Skrykru, arroccata presso il "Nido dell\'Aquila".',
        'Ourobera, il continente delle piogge, dove gli Urobri sopravvivono nella Palude nera dopo essere stati scacciati dalle loro terre originarie.',
        'L\'isola di Aesir Oga e la città di Bo Aesir, che custodiscono la più sacra delle nove dimore degli Aesir.'
      ] },
      { label: 'Fazioni', body: [
        'I Kynwird, il grande clan pacifico delle "radici" di Erdegis, oggi guidato da Skuld Hjiarta dopo la morte della matriarca Varhena.',
        'La casata Skjold di Skjioldland (Jarl Ecbert Skjold e regina Aslaog Sigurd).',
        'La dinastia gullkinn di Bhorkyn (Jarl Asgull Bauclaire), fondata su un rapporto di sudditanza con i Bhorkyn tribali.',
        'Il clan Skrykru di Skry y Kalter, votato al miglioramento di sé e alla venerazione del sole.',
        'Il clan Urobri della palude di Ourobera, guidato dall\'Hersir Siggy Scagliamanto.',
        'La famiglia di corsari Kraken, alleata ai Tevel di Vanargand, che controlla le rotte commerciali (e schiaviste) a ovest.'
      ] },
      { label: 'Personaggi rilevanti', body: [
        'Ecbert Skjold e Aslaog Sigurd, sovrani di Skjioldland.',
        'Skuld Hjiarta, "la donna fiore", guida attuale dei Kynwird.',
        'Aurelio Solgull I, fondatore leggendario della dinastia di Bhorkyn, che comprò la libertà dei popoli tribali locali rendendoli sua servitù armata.',
        'Asgull Bauclaire e Agnes Skold, sovrani attuali di Bhorkyn, e il loro erede Aurum Bauclaire.',
        'Siggy Scagliamanto, Hersir degli Urobri dopo la morte di Jord Urobr.',
        'Hjalmar e Ragnar an Kraken, capostipiti della famiglia di corsari.'
      ] },
      { label: 'Minacce e antagonisti', body: [
        'I Mordersort ("assassini in nero") di Bhorkyn, addestrati a uccidere spie e avversari politici senza lasciare tracce.',
        'I Kynjager ("cacciatori di Kyn"), gilda nata dal Culto di Sol per dare la caccia a chi manifesta poteri magici.',
        'Gli Aratare, figure nere del folklore associate a Hel e ai cattivi presagi, temute come annuncio di morte.'
      ] },
      { label: 'Conflitti', body: [
        'Il rapporto di sudditanza dei sovrani di Bhorkyn verso i Bhorkyn tribali, comprati generazioni fa dal loro hersir Bodran Arbjorn in cambio della pace.',
        'La tensione interna ai Kynwird dopo la morte della matriarca Varhena, con alcuni clan meno propensi al dialogo con le stad rispetto al passato.',
        'L\'ostilità di lunga data fra Skrykru e Bhorkyn, che si lasciano reciprocamente i corpi degli esploratori catturati come monito ai confini.'
      ] },
      { label: 'Spunti per sviluppare storie', body: [
        'Il mistero mai risolto dell\'Ich, cercato da secoli sia dalle stad che dalle stam senza che nessuno l\'abbia mai trovato o compreso.',
        'Il labirinto dell\'Ich, disegno lasciato dall\'Aesir Lodur ai primi reveries: chi ne scoprisse il significato troverebbe "qualcosa di più sacro degli Asi".',
        'Il centro della dimora sacra di Aesir Oga, di cui nessuno è mai riuscito a raccontare cosa custodisca, non essendone mai uscito.'
      ] },
      { label: 'Indicazioni per il Narratore', body: 'Il documento di ambientazione lascia volutamente aperta l\'occupazione dei territori non ancora assegnati a un popolo, invitando il gruppo a definirli in gioco: prima di farlo chiede però di condividere gli elementi culturali imprescindibili già stabiliti (i cicli del mondo, le figure mitologiche, la simbologia runica), così che ogni aggiunta resti coerente con essi.' },
      { label: 'Informazioni per i giocatori', body: 'Ogni popolazione usa la stessa lingua, il Data-L (o Datael), spesso mescolata a termini della lingua degli Asi conosciuti solo dai Voluspà. Le figure dei Voluspà, capaci di leggere lingue sconosciute e di avere visioni, sono ricercate sia dalle città che dai popoli tribali.' },
      { label: 'Fonti', body: '"Ich", documento di ambientazione fornito dall\'autore del gioco.' }
    ]
  }
};

function librarySettingSectionHtml(section) {
  if (!section || !section.body) return '';
  const body = Array.isArray(section.body)
    ? `<ul style="margin:4px 0 0;padding-left:18px;">${section.body.map(li => `<li>${escapeHtml(li)}</li>`).join('')}</ul>`
    : `<p style="margin:4px 0 0;white-space:pre-wrap;">${escapeHtml(section.body)}</p>`;
  return `<div class="section-title" style="margin-top:14px;"><span class="dot neutral"></span>${escapeHtml(section.label)}</div>${body}`;
}

function librarySettingPageHtml(key) {
  const setting = LIBRARY_SETTINGS[key];
  if (!setting) {
    return '<p class="helper-text" style="margin:0;">Questa ambientazione non è ancora disponibile.</p>';
  }
  const coverHtml = setting.cover
    ? `<img src="${escapeHtml(setting.cover)}" alt="" style="width:100%;border-radius:8px;margin-bottom:10px;">`
    : '';
  const summaryHtml = setting.summary ? `<p class="helper-text" style="margin:0;">${escapeHtml(setting.summary)}</p>` : '';
  const sectionsHtml = (setting.sections || []).map(librarySettingSectionHtml).join('');
  return `${coverHtml}${summaryHtml}${sectionsHtml}`;
}

function openLibrarySettingPage(key) {
  const setting = LIBRARY_SETTINGS[key];
  const titleEl = $('#library-setting-title');
  if (titleEl) titleEl.textContent = (setting && setting.title) || 'Ambientazione';
  const body = $('#library-setting-body');
  if (body) body.innerHTML = librarySettingPageHtml(key);
  showView('library-setting');
}

/* Ricerca globale (punto 4 dell'integrazione FASE FINALE): le pagine delle
   ambientazioni devono essere ricercabili per titolo, testo, luoghi,
   personaggi e fazioni realmente contenuti nelle fonti — qui si cerca
   semplicemente su tutto il testo effettivamente reso in pagina (titolo,
   riassunto, etichette ed elenchi di ogni sezione), senza un indice
   separato da tenere sincronizzato a mano. */
function searchLibrarySettings(query) {
  const q = (query || '').trim().toLocaleLowerCase('it');
  if (!q) return [];
  return Object.keys(LIBRARY_SETTINGS)
    .map(key => LIBRARY_SETTINGS[key])
    .filter(setting => {
      const haystack = [setting.title, setting.summary]
        .concat((setting.sections || []).map(s => s.label))
        .concat((setting.sections || []).reduce((acc, s) => acc.concat(Array.isArray(s.body) ? s.body : [s.body]), []))
        .filter(Boolean)
        .join(' \n ')
        .toLocaleLowerCase('it');
      return haystack.includes(q);
    })
    .map(setting => ({ type: 'setting', id: setting.title, title: setting.title, settingKey: Object.keys(LIBRARY_SETTINGS).find(k => LIBRARY_SETTINGS[k] === setting) }));
}
