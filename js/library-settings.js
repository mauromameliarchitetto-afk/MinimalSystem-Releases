/* Pagine editoriali delle ambientazioni in Biblioteca > "Ambientazioni e
   storie" (integrazione FASE FINALE). Contenuto interamente statico,
   convertito ESCLUSIVAMENTE dai tre testi estesi forniti dall'autore
   (ICARO_TESTO_ESTESO, EIDOS_TESTO_ESTESO, ICH_TESTO_ESTESO): titoli,
   paragrafi ed elenchi riportati integralmente, nessun evento/personaggio/
   luogo/fazione inventato qui, nessun collegamento fra le tre ambientazioni
   non presente nelle fonti. Una sola funzione di rendering per tutte e tre,
   mai tre markup duplicati.

   Schema di una sezione: { label, blocks: [...] } dove ogni blocco è
   { h } (sottotitolo), { p } (paragrafo, **grassetto** ammesso),
   { ul: [...] } (elenco) oppure { image, alt } (tavola illustrata).
   Resta accettato il vecchio { label, body } (stringa o elenco). Una
   sezione senza contenuto non viene mostrata (mai un contenitore vuoto).

   Immagini: copertina e tavole definitive in img/settings/<chiave>/, ognuna
   usata SOLO nella storia della propria cartella e collocata accanto alla
   sezione indicata dal manifesto delle immagini (nessuna galleria
   separata). Il testo alternativo è quello del manifesto. */
const LIBRARY_SETTINGS = {
  icaro: {
    title: 'Icaro',
    summary: 'Otto minuti e venti secondi furono gli ultimi attimi di luce.',
    cover: 'img/settings/icaro/icaro-copertina.png',
    coverAlt: 'Due figure sospese davanti a un sole eclissato, una scura e una ricostruita, tendono la mano l\'una verso l\'altra.',
    sections: [
      { label: 'Premessa', blocks: [
        { p: 'La storia è ambientata nel 161 CE, corrispondente all\'anno 3172 del vecchio calendario. Il Sole è spento da più di tre secoli e la Terra è un pianeta congelato, ricoperto da un manto di ghiaccio che all\'esterno raggiunge temperature prossime ai -140 °C. La vita umana sopravvive in nove metropoli protette, illuminate da cieli artificiali e unite da infrastrutture che attraversano un mondo oscuro.' },
        { p: 'Gli abitanti della Repubblica Pannazionale sono cresciuti sapendo che il tempo possiede un valore misurabile. Ogni esistenza viene valutata in Anni Luce, concessi, guadagnati, spesi o ceduti. La società dichiara di proteggere la vita, ma la sottopone a un calcolo continuo: efficienza, produttività e utilità collettiva stabiliscono chi merita di continuare a brillare.' },
        { p: 'Gli Icaro incarnano il vertice di questo sistema. Scienziati, tecnici e personalità ritenute indispensabili ricevono il bianco, il diritto alla continuità della coscienza e il compito di guidare l\'umanità. Sono il simbolo del sacrificio che salvò la specie e, allo stesso tempo, la prova vivente che l\'immortalità appartiene soltanto a chi viene giudicato abbastanza utile.' }
      ] },
      { label: 'La fine del Sole', blocks: [
        { p: 'Nel 2747 la stazione stellare Icaro operava intorno al Sole. Il suo compito era prelevare energia e atomi di idrogeno per sostenere la Terra, recuperare le aree ormai aride del pianeta e alimentare le principali colonie marziane. Durante il protocollo di canalizzazione energetica, uno scompenso di origine ignota interferì con il nucleo della stella. La luce impiegò otto minuti e venti secondi per raggiungere la Terra un\'ultima volta.' },
        { p: 'Nei primi mesi si interruppe ogni contatto con le colonie interstellari. La dissipazione termica colpì il pianeta mentre governi e nazioni combattevano per le ultime risorse. Russia, America e Cina occuparono territori strategici; gli insediamenti superstiti si raccolsero presso vulcani, fumarole, sorgenti termali, geyser, centrali nucleari e strutture sotterranee. Chi non raggiunse uno di questi luoghi morì entro il primo anno.' },
        { p: 'Il personale terrestre del progetto Icaro avviò un programma di salvaguardia della specie. La sfera di contenimento energetico planetaria rallentò la dispersione del calore, mentre l\'eugenetica eliminò malattie e modificò l\'organismo umano per adattarlo a un ambiente povero di ossigeno e privo di luce naturale. Le prime cupole urbane nacquero dal lavoro coordinato di tecnici, operai, scienziati e intelligenze artificiali. Le cataste di corpi congelati vennero rimosse attorno agli insediamenti che sarebbero diventati le nuove metropoli.' },
        { p: 'La Convenzione del Wyrd, redatta da Ilysia Rodano, pose fine alle guerre del primo periodo glaciale. Le nazioni cedettero il proprio potere a un governo centrale e nacque la Repubblica Pannazionale. Le armi da fuoco furono abolite, ogni religione organizzata venne estirpata e la sopravvivenza divenne il principio fondante di una tecnocrazia globale.' }
      ] },
      { label: 'La Repubblica Pannazionale', blocks: [
        { p: 'La Repubblica si fonda sull\'autogestione, sulla competizione e sul miglioramento della vita. Ogni individuo possiede una banca di Anni Luce: il tempo che gli viene riconosciuto per vivere e la moneta con cui acquista beni, servizi e possibilità. Il lavoro produce tempo; la nascita lo consuma.' },
        { p: 'Chi desidera generare una nuova vita presenta una richiesta ufficiale e cede al nascituro una parte dei propri Anni Luce. Il contratto deve garantire almeno i primi dodici anni, età in cui la Repubblica considera l\'individuo autonomo. Il parto naturale è illegale perché genera una vita priva della copertura economica prevista dal sistema.' },
        { p: 'Furto e omicidio sono considerati crimini contro l\'umanità. Sottrarre denaro, lavoro o proprietà significa sottrarre tempo, quindi accorciare materialmente la vita altrui. Lo stesso principio permette però alla Repubblica di convertire in strumenti produttivi coloro il cui contributo scende sotto la soglia stabilita.' },
        { p: 'Le città sono rette dalle corporazioni. I Core mantengono calore, acqua e ossigeno; le imprese organizzano ricerca, produzione, sicurezza e intrattenimento. Il governo tutela la vita collettiva, mentre il mercato decide quanto valga la vita del singolo.' },
        { image: 'img/settings/icaro/icaro-interno-metropoli.png', alt: 'Una città concentrica abitata si sviluppa sotto una grande cupola dal cielo artificiale.' }
      ] },
      { label: 'Il sistema Cromo', blocks: [
        { p: 'Alla nascita ogni cittadino viene analizzato dal sistema Cromo. Genetica, storia familiare e possibilità di sviluppo producono una valutazione preliminare, confermata a dodici anni. Il risultato orienta l\'accesso al lavoro e colloca l\'individuo nella scala cromatica.' },
        { ul: [
          '**Bianco — Icaro**: personalità elevate a modello sociale per meriti scientifici, tecnici o artistici. Formano un concilio e possono trasferire la propria coscienza in un nuovo corpo.',
          '**Giallo — progettisti della vita**: programmatori, agricoltori, ingegneri e architetti. Ideano gli spazi, le macchine e i processi che mantengono in funzione la società.',
          '**Amaranto — potere e impresa**: politici, dirigenti e grandi imprenditori. Il colore identifica chi ha vinto la competizione sociale e difende con aggressività il proprio ruolo.',
          '**Arancio — ordine e conservazione**: forze dell\'ordine, banchieri e medici. Proteggono il corpo, il credito e la continuità produttiva.',
          '**Verde — emozione e cura**: artisti, intrattenitori e psicoterapeuti. Ricreano ciò che la Terra ha perduto e contrastano l\'apatia della popolazione.',
          '**Blu — lavoro specializzato**: tecnici, investigatori, piloti, insegnanti, meccanici e fattorini. È la classe più numerosa e sostiene i servizi delle metropoli.',
          '**Viola — lavoro comune**: estrattori, lavoratori occasionali, baristi, alloggiatori e manodopera non specializzata. Costituiscono la base della produzione e del consumo.',
          '**Grigio — spenti**: persone che hanno superato il tempo riconosciuto, criminali in riabilitazione o individui che hanno rinunciato alla competizione. Molti vengono inviati nelle camere di produzione, chiamate congelatori.',
          '**Nero — Spegni-luce**: ricercati che hanno rifiutato di consegnarsi alla Repubblica. Fra loro compaiono Demo, Dotcom, i Senzavolto, gli Anonymous e Antoine Delacroix.',
          '**Senza colore**: nati naturali non registrati, comunità esterne, macchine e Patrioti. Vivono fuori dalla competizione ufficiale e, proprio per questo, fuori dai diritti riconosciuti agli altri cittadini.'
        ] },
        { p: 'Il Cromo può cambiare. Un individuo che rifiuta il proprio ruolo viene interpretato come autodistruttivo e avviato verso il grigio. Chi abbandona il sistema perde il colore. Ogni avanzamento sociale, ogni fallimento e ogni deviazione diventano visibili sul corpo e sugli abiti.' }
      ] },
      { label: 'Figure del mondo', blocks: [
        { image: 'img/settings/icaro/icaro-figure-del-mondo.png', alt: 'Cinque figure mostrano il bianco degli Icaro, l\'amaranto corporativo, un Patriota androide, uno Spento grigio e un sopravvissuto in tuta nera.' },
        { p: 'Gli **Icaro** sono i modelli pubblici della Repubblica. Indossano il bianco, rappresentano eccellenza scientifica, tecnica o artistica e possono trasferire la propria coscienza in un nuovo corpo. La loro figura unisce autorità politica, privilegio e promessa d\'immortalità.' },
        { p: 'I **corporativi** lavorano per le compagnie che amministrano produzione, ricerca, sicurezza e servizi urbani. Non costituiscono una singola classe cromatica: il colore continua a indicare funzione e rango. La polizia corporativa di C2 è la prima forza dell\'ordine delle città e la protezione di sedi, trasporti, dati e brevetti genera specialisti e freelancer.' },
        { p: 'I **Patrioti** sono il corpo scelto armato della Lloyd Defence e il principale programma di difesa della Repubblica. Sono androidi fortemente militarizzati, autorizzati a usare armi negate agli altri cittadini. Il sistema li considera macchine prive del diritto alla coscienza e li colloca fuori dalla competizione cromatica.' },
        { p: 'Gli **Spenti** hanno superato il tempo assegnato, hanno commesso reati oppure hanno rinunciato alla competizione. Il grigio li rende riconoscibili e molti vengono trasferiti nelle camere di riabilitazione e produzione, chiamate congelatori.' },
        { p: 'Gli **Spegni-luce** sono ricercati che non si sono consegnati alla Repubblica. Il nero comprende criminali, sabotatori e reti clandestine come Demo, Dotcom, i Senzavolto e gli Anonymous. La propaganda li presenta come scarti egoisti; le loro storie mostrano motivazioni molto diverse.' },
        { p: 'I **senza colore** comprendono nati naturali non registrati, comunità esterne e individui che rifiutano l\'autorità delle metropoli. Sono esclusi dai diritti garantiti dal Cromo. Nella stessa categoria amministrativa vengono inserite anche macchine e Patrioti, sebbene la loro condizione sia profondamente diversa.' }
      ] },
      { label: 'Vita quotidiana e cultura', blocks: [
        { p: 'La Repubblica non attribuisce valore sociale al genere o all\'orientamento sessuale. La riproduzione è separata dall\'intimità e i corpi modificati rendono instabile qualsiasi distinzione rigida fra carne, protesi e macchina. La nudità ha perso gran parte del proprio significato erotico, mentre il desiderio viene spesso vissuto attraverso ambienti virtuali e danze cerebrali.' },
        { p: 'Il lavoro costituisce la principale forma di istruzione. Le imprese vengono incentivate a formare nuove generazioni capaci di superare quelle precedenti, anche se alcune corporazioni nascondono il sapere per ridurre la concorrenza. Il lavoro minorile attraversa ogni classe: può essere un apprendistato prestigioso oppure una condanna che consuma gli anni ricevuti alla nascita.' },
        { p: 'La Repubblica organizza eventi ricreativi annunciati ventuno notti prima. Le arene videoludiche trasformano gli sfidanti in celebrità sostenute dalle donazioni; quelle clandestine permettono di scommettere Anni Luce e, talvolta, la vita. Le Immersioni fanno vivere allo spettatore emozioni e sensazioni di un\'opera come se ne fosse parte. La g-dance si pratica in assenza di gravità; la L-D usa luci applicate al corpo in stanze completamente buie. Le gare di rompighiaccio della White Hell Cup preparano al tempo stesso nuove aree per l\'estrazione del ghiaccio.' },
        { p: 'Le Falltrip stimolano artificialmente il cervello e vengono classificate in base al danno neurologico che possono causare. La cocaina nera mescola sostanze stupefacenti e metalli, prolungando gli effetti mentre avvelena lentamente l\'organismo. Nei bassifondi, il piacere, l\'energia e la memoria sono risorse scambiabili quanto il tempo.' },
        { image: 'img/settings/icaro/icaro-bassifondi.png', alt: 'Corridoi industriali umidi e affollati attraversano i livelli inferiori della metropoli.' }
      ] },
      { label: 'Corpi, abiti e armature', blocks: [
        { p: 'Il vestiario comune protegge il corpo e rende riconoscibile la classe sociale. Le fibre sono composite e riciclate; alcuni tessuti conducono energia o interagiscono con protesi e dispositivi. Gli abiti sono generalmente comodi, stratificati e poco interessati a sottolineare le forme. Carne e meccanica possono essere esposte come dichiarazione identitaria.' },
        { p: 'Il colore domina più del taglio. Un dirigente amaranto, un medico arancio e un tecnico blu possono indossare capi simili, ma la tinta comunica immediatamente funzione e rango. Gli Icaro usano il bianco come apparato scenico durante investiture e manifestazioni, trasformando ogni apparizione pubblica in una dimostrazione di purezza e autorità.' },
        { p: 'All\'esterno delle cupole la tuta è obbligatoria. Strati di aerogel isolano dal freddo senza appesantire, sistemi respiratori compensano la carenza d\'ossigeno e visori proteggono dalla notte assoluta. Le corazze in Vantablack assorbono quasi tutta la luce e rendono gli operatori difficili da distinguere sul ghiaccio.' },
        { p: 'I Patrioti appartengono a un\'altra categoria. Sono androidi militarizzati della Lloyd Defence, costruiti come armi ambulanti e privati del diritto a una coscienza riconosciuta. Le armi da fuoco sono vietate persino alle forze dell\'ordine: soltanto i Patrioti possono impiegarle.' },
        { p: 'Nei bassifondi prosperano le Anime di metallo. Alcune sono persone che hanno venduto parti del proprio corpo per acquistare protesi; altre sono automi che hanno superato il proprio termine di consumo e manifestano un\'autonomia ritenuta pericolosa. Il Telonio e la cocaina nera alimentano una dipendenza in cui il corpo diventa merce di scambio nel Mercato della carne.' }
      ] },
      { label: 'Tecnologia della sopravvivenza', blocks: [
        { p: 'Ogni metropoli vive grazie al proprio Core. Il ghiaccio fornisce acqua e ossigeno; serre illuminate da raggi ultravioletti sostengono l\'agricoltura; gli scarichi termici alimentano processi secondari. Gli alimenti multinutrizionali garantiscono il fabbisogno energetico con una sostanza dal sapore ferroso e acidulo, preferita soltanto quando il cibo vero diventa troppo costoso.' },
        { p: 'Le cupole combinano metallo, Vantablack e strati di aerogel. Le città sorgono sopra le rovine di quelle antiche: le quote inferiori inglobano reti digitali in Telonio, strutture preglaciali e condotti di calore. L\'obsolescenza controllata ha riportato valore alla meccanica non connessa, più resistente all\'hacking e utile a chi vuole sottrarsi alla sorveglianza.' },
        { p: 'I trasporti interurbani usano treni a sospensione magnetica. I rompighiaccio attraversano e incidono le superfici congelate, mentre veicoli più piccoli sfruttano superconduttori resi efficienti dalle basse temperature. Il GAN, Network Globale Anarchico, conserva le zone più oscure della comunicazione: identità criptate, propaganda, traffici e residui delle guerre informatiche.' },
        { image: 'img/settings/icaro/icaro-esterno-ghiacciato.png', alt: 'Esploratori in tute scure attraversano il ghiaccio fra rovine congelate e una cupola illuminata in lontananza.' }
      ] },
      { label: 'Le nove metropoli', blocks: [
        { h: 'C1 — La Culla delle Materie Prime' },
        { p: 'La nuova C1 nasce dopo la distruzione della città originaria. Serre termiche, agricoltura sintetica, miniere e impianti metallurgici alimentano le altre metropoli. La BlackRoot Industries controlla il Vantablack e le leghe sviluppate con la Bernard. Nelle periferie, semi e metalli grezzi sottratti agli impianti passano di mano in mano. Il motto inciso sul monumento del Primo Lavoratore recita: «Dal gelo nasce la forza».' },
        { h: 'C2 — La città dell\'ordine' },
        { p: 'Sorta presso New York, ospita circa un milione e mezzo di abitanti. Polizia corporativa, investigatori, cacciatori di taglie, giuristi e guardie carcerarie definiscono la sua identità. Dopo l\'attentato alla prima C1, la città ha trasformato la sicurezza in industria e prestigio. L\'Allure Systems Corporation rappresenta la convergenza fra protezione fisica, controllo digitale e ricatto corporativo.' },
        { h: 'C3 — La Città delle Macchine' },
        { p: 'C3 custodisce fabbriche di robotica, officine e linee per treni e rompighiaccio. La compagnia Bernard ha spostato la produzione verso automi e sistemi di incremento umano. Nei mercati mediani, tecnici e meccanici vendono riparazioni e contratti lampo; nelle quote inferiori i Teste di metallo sostituiscono la carne per inseguire l\'efficienza delle macchine.' },
        { h: 'C4 — La città dello spettacolo' },
        { p: 'Teatri a torre, accademie, gare sul ghiaccio e Immersioni rendono C4 il centro emotivo della Repubblica. Anastasia Kurer ha portato le proprie opere nei cieli artificiali delle cupole. Nelle quote alte si svolgono spettacoli privati; nelle zone mediane convivono palestre, danza e mercato artistico; nei bassifondi si producono droghe e farmaci ricavati da esperienze emotive reali.' },
        { h: 'C5 — La Città Verde' },
        { p: 'Giardini verticali e biosfere artificiali hanno riportato piante e animali in una Terra morta. Eden Bioforge e Next Tech modificano organismi perché resistano al freddo e alle radiazioni. Le serre residenziali proteggono i più ricchi, mentre tecnici agricoli e biogenetisti vivono nei livelli inferiori. La dottoressa Dawn Jordsonn studia una vibrazione luminosa dell\'individuo che potrebbe spiegare ciò che il Cromo rileva.' },
        { h: 'C6 — La Città Fantasma' },
        { p: 'Torri di rete e server emergono dal ghiaccio come monoliti. La Delos Industries di Norman Delos gestisce autenticazione e identità biometrica nelle nove metropoli. Ogni comportamento viene archiviato nei DataVault, mentre gli Anonymous rivendicano anonimato e libertà. Nelle Immersioni di C6, identità cancellate e coscienze riscritte continuano a lasciare tracce.' },
        { h: 'C7 — La Città del Movimento' },
        { p: 'C7 è una macchina logistica fatta di droni, nastri trasportatori e fabbriche verticali. Fate Alatri e la Fate Trade orientano il desiderio prima ancora di vendere prodotti; la Kirov Dynamics controlla motori, veicoli e automazione. Florens Esprit investe nelle gare e nei trasporti Akila. Sotto la produzione impeccabile, le Grotte di Scarto raccolgono componenti difettosi e persone espulse dal sistema.' },
        { h: 'C8 — La Città della Rinascita' },
        { p: 'MedSync domina la medicina rigenerativa e l\'epigenetica. Il gene CYP26B1 rallenta il deterioramento fisico e ogni cittadino riceve una mappa di potenziamento. Nelle Cliniche Grigie vengono sperimentate terapie non approvate, mentre mutazioni e dipendenze farmaceutiche alimentano il sospetto che il brainfreeze nasca proprio dalla manipolazione umana. Cleyra Arpana conduce ricerche sul miglioramento cognitivo ed emotivo.' },
        { h: 'C9 — La Città del Passato' },
        { p: 'C9 scava nelle rovine preglaciali per recuperare centrali, impianti e dati. Thomas Epos fondò Crypto Memories e il Progetto Ich per ricostruire una realtà sensoriale in cui preservare la memoria del mondo. Dopo la sua morte, Evan Wood ha trasformato quel sogno in intrattenimento immersivo. Nei Mercati del Ricordo si vendono datachip, reliquie e frammenti di esperienze appartenute ad altri.' }
      ] },
      { label: 'Ambientazioni d\'esempio', blocks: [
        { h: 'Il mercato mediano di C3' },
        { p: 'Le officine occupano ogni vano libero. Bracci meccanici attraversano le bancarelle, i tecnici contrattano ore di lavoro e i componenti smontati cambiano proprietario prima di raffreddarsi. Sopra il mercato, gli annunci della Bernard promettono corpi più efficienti. Sotto, un ingresso senza insegna conduce al Mercato della carne.' },
        { h: 'Una notte nelle Cliniche Grigie di C8' },
        { p: 'I corridoi non compaiono sulle mappe pubbliche. L\'aria odora di disinfettante e metallo caldo; dietro le pareti traslucide, pazienti senza colore attendono terapie rifiutate dalla MedSync. Ogni stanza può contenere una cura, una mutazione o la prova che il brainfreeze sia stato prodotto dal tentativo di sconfiggere la morte.' },
        { h: 'Una spedizione fuori da C9' },
        { p: 'Il rompighiaccio procede fra torri spezzate e ghiaccio nero. Le luci di segnalazione sono l\'unico segno di vita. Gli esploratori raggiungono una struttura preglaciale ancora alimentata, dove vecchi sistemi automatici continuano a svolgere un compito che nessuno ricorda. Recuperare una memoria può valere più dell\'intera spedizione; riportarla alla luce significa anche consegnarla a chi saprà venderla.' }
      ] },
      { label: 'Correnti di pensiero', blocks: [
        { p: 'L\'**Utilitarismo** giudica le azioni attraverso il benessere prodotto alla maggioranza. È il fondamento morale delle decisioni pubbliche e delle candidature degli Icaro, ma lascia aperta la domanda su chi possa misurare felicità e sofferenza.' },
        { p: 'L\'**Inflazione** interpreta lo spegnimento come un ritorno all\'impulso originario della creazione. Il vuoto non rappresenta soltanto la fine: è la possibilità di cancellare ciò che esiste e riscrivere il destino umano.' },
        { p: 'I **Reionizzati** rifiutano il Cromo e ogni percorso predeterminato. Considerano l\'individuo una superficie ancora da dipingere e cercano una luce che non dipenda dagli Icaro. La Repubblica li classifica come dissociati e sovversivi.' }
      ] },
      { label: 'Minacce e conflitti', blocks: [
        { p: 'Il brainfreeze colpisce senza distinzione e conduce ad apatia, catatonia o desiderio di morte. La Repubblica non ne conosce la causa, mentre congelatori, Cliniche Grigie e manipolazione genetica alimentano spiegazioni contrapposte.' },
        { p: 'La progressiva sostituzione del lavoro umano provoca disoccupazione, suicidi e rivolte. Le macchine non possono possedere una coscienza riconosciuta, ma alcune superano il proprio termine di consumo. Gli esseri umani, invece, possono conservare il diritto alla vita soltanto dimostrandosi più utili delle macchine che hanno costruito.' },
        { p: 'Antoine Delacroix resta il simbolo del terrore capace di spegnere una città. Gli Spegni-luce attaccano la struttura della Repubblica da prospettive diverse: criminalità, sabotaggio, anonimato, rifiuto del Cromo o semplice sopravvivenza fuori dal sistema.' }
      ] },
      { label: 'Figure rilevanti', blocks: [
        { ul: [
          '**Ilysia Rodano**: Icaro autrice della Convenzione del Wyrd.',
          '**Richard Phillips**: III Collegiale della Repubblica, originario di C2.',
          '**Anastasia Kurer**: Icaro e artista capace di trasformare i cieli artificiali.',
          '**Jacques Bernard**: guida la compagnia Bernard e la sua svolta verso robotica e automazione.',
          '**Dawn Jordsonn**: studia la vibrazione luminosa associata alla vita e al sistema Cromo.',
          '**Norman Delos**: dirige la Delos Industries e l\'infrastruttura di sorveglianza della Repubblica.',
          '**Fate Alatri**: fondatore della Fate Trade, capace di trasformare bisogni e desideri in mercato.',
          '**Florens Esprit**: magnate dei motori, delle competizioni e dei trasporti Akila.',
          '**Cleyra Arpana**: ricercatrice MedSync nel campo cognitivo ed emotivo.',
          '**Thomas Epos**: fondatore di Crypto Memories e del Progetto Ich.',
          '**Evan Wood**: successora di Epos, ha convertito il progetto in un sistema ad alto profitto.',
          '**Antoine Delacroix**: responsabile dello spegnimento di una delle undici città originarie.'
        ] }
      ] },
      { label: 'Nucleo tematico', blocks: [
        { p: 'Icaro racconta il valore attribuito alla vita quando il tempo diventa moneta, la sopravvivenza diventa dovere e l\'essere umano viene misurato attraverso la propria utilità. La domanda centrale non riguarda soltanto quanto a lungo si possa vivere, ma quale parte dell\'umanità rimanga quando ogni scelta viene giustificata dal bene collettivo.' }
      ] }
    ]
  },
  eidos: {
    title: 'Eidos',
    summary: 'Il desiderio di trovare la chiave può ricostruire il mondo oppure aprire le porte alla sua distruzione.',
    cover: 'img/settings/eidos/eidos-copertina.png',
    coverAlt: 'Una forma di vetro e acqua contiene frammenti di città, una creatura Tèras e rovine rossastre.',
    sections: [
      { label: 'Premessa', blocks: [
        { p: 'Eidos era una terra rigogliosa. Pianure, foreste, deserti, montagne e mari ospitavano popoli che avevano trovato il proprio equilibrio. Le città combattevano per ampliare i confini, ma nessuna guerra aveva ancora trasformato il mondo.' },
        { p: 'Le antiche leggende attribuivano la creazione al Demiurgo, capace di plasmare il cosmo a partire da un\'idea. Con il passare dei secoli il Dio non si manifestò e il suo ricordo si indebolì. Nuovi culti cercarono l\'origine in elementi più comprensibili: acqua, aria, fuoco, numero e infinito.' },
        { p: 'Quando la magia tornò, molti credettero che il Dio avesse risposto. L\'essere che si presentò, Aima, non venne però per salvare l\'umanità. Il suo potere e la sua violenza costrinsero città e popoli a unirsi in una Grande Guerra. Dopo anni di distruzione, gli uomini lo condussero sulla cima del monte più alto e isolato del mondo. Aima rifiutò la resa, promise di tornare e lasciò dietro di sé una pioggia di sangue.' },
        { p: 'Il cielo divenne rosso. Le pianure morirono, le acque si fecero pestilenziali e nuove paludi diffusero gas capaci di rendere l\'aria irrespirabile. Mentre il mondo cercava di ricostruirsi, l\'esercito che aveva sconfitto Aima si divise. Chorisfos ed Epizi rivendicarono entrambi la vittoria e attribuirono all\'altro la responsabilità della catastrofe.' }
      ] },
      { label: 'Un secolo dopo Aima', blocks: [
        { p: 'Sono trascorsi circa cento anni dall\'esilio del Dio. La memoria del periodo precedente alla Grande Guerra è quasi scomparsa: documenti distrutti, racconti deformati e propaganda impediscono di distinguere la storia dalla leggenda.' },
        { p: 'La guerra fra Chorisfos ed Epizi iniziò poco più di trent\'anni dopo la sconfitta di Aima. Durò circa cinquant\'anni, con tregue e riprese, e il suo nucleo principale si è fermato da vent\'anni. Lo stallo non coincide con la pace. Entrambe le fazioni cercano villaggi indipendenti da assorbire, risorse da controllare e tracce della chiave annunciata da un\'antica profezia.' },
        { p: 'Antarsia fu la prima città a ribellarsi al dominio delle due potenze. La sua distruzione generò gli Antarsi, comunità di sopravvissuti che combattono per liberare le popolazioni ancora soggette. Le rovine sorgono vicino alla Grande Palude di Tèime, sotto una coltre di fumo rossastro che non si dissolve.' },
        { p: 'Gli Eporiani rimangono ai margini del conflitto. La loro isola, distante dalla fonte del gas, conserva un ecosistema più stabile e una posizione commerciale privilegiata. Finanziano l\'una o l\'altra fazione quando conviene, senza consegnare a nessuna il controllo delle proprie rotte.' }
      ] },
      { label: 'Un mondo diviso dal gas', blocks: [
        { p: 'Fuori dagli insediamenti protetti l\'aria richiede antidoti, filtri o armature. La contaminazione stabilisce confini più rigidi delle mura: determina quanto a lungo una squadra può viaggiare, quali rotte possono essere aperte e quante persone possano lasciare una città.' },
        { p: 'La Palude di Tèime rappresenta il centro visibile della trasformazione. Da essa provengono gas e nebbie rossastre; intorno alle sue acque si incontrano rovine, creature mutate e territori che nessuna fazione controlla pienamente. Il mondo prebellico sopravvive soltanto in tracce difficili da interpretare.' },
        { p: 'Le città dei Chorisfos si sviluppano nel sottosuolo. Quelle degli Epizi crescono in altezza sotto scudi e sistemi di filtraggio. Lechta si espande dall\'isola verso piattaforme galleggianti. Erissa, rifugio degli Antarsi, non è mai stata localizzata dai nemici.' },
        { image: 'img/settings/eidos/eidos-chorisfos-finale.png', alt: 'Soldato Chorisfos con armatura, equipaggiamento e scudo energetico' }
      ] },
      { label: 'Chorisfos', blocks: [
        { h: 'Governo e organizzazione' },
        { p: 'I Chorisfos vivono in città sotterranee scavate per centinaia di metri. Apologeti, la capitale, è una sola megastruttura verticale composta da enormi anelli sovrapposti intorno a un vuoto centrale. Ogni anello è suddiviso in settori destinati a governo, addestramento, produzione, coltivazione, allevamento e crescita dei bambini. Collegamenti verticali, ponti e condotti uniscono le diverse quote; gli anelli più profondi custodiscono le funzioni maggiormente protette.' },
        { p: 'L\'Alto Concilio riunisce le maggiori cariche militari e viene rinnovato ogni dieci anni. I concili locali possono decidere soltanto nelle emergenze; per il resto eseguono le direttive della capitale. Amos Krusciov ricopre la funzione di capo di Stato.' },
        { p: 'La classe militare domina l\'intera società. I cittadini non possono viaggiare fra le città e le comunicazioni avvengono attraverso frequenze radio dedicate. Soltanto i soldati autorizzati ricevono l\'antidoto necessario per uscire.' },
        { image: 'img/settings/eidos/eidos-apologeti.png', alt: 'Una cavità verticale contiene enormi anelli abitati sovrapposti, ripartiti fra governo, addestramento, produzione, coltivazione, allevamento e crescita dei bambini.' },
        { h: 'Cultura e vita quotidiana' },
        { p: 'Ogni livello della città corrisponde a un ramo produttivo e ogni persona viene assegnata in base alle capacità. L\'arte è vietata perché potrebbe generare coscienza individuale e ribellione. Chi viene scoperto a praticarla rischia la morte.' },
        { p: 'I bambini vivono con i genitori fino ai tre anni. Successivamente vengono trasferiti al Periphto, dove crescono e vengono osservati. Chi manifesta magia o attitudine al combattimento può entrare nella classe militare; gli altri vengono distribuiti nei livelli produttivi già a sette anni. La lettura e la scrittura vengono insegnate in modo uniforme, mentre l\'istruzione avanzata appartiene all\'esercito.' },
        { p: 'La propaganda attribuisce agli Epizi la nascita dei Tèras, presentati come il risultato di tecnologia e sperimentazione senza limiti.' },
        { h: 'Vestiario e armature' },
        { p: 'Gli abiti civili sono standardizzati. Ogni cittadino riceve annualmente pantaloni e maglia prodotti con derivati agricoli. I colori neutri cambiano da un livello all\'altro e identificano la funzione più della persona. La temperatura costante elimina la necessità di stagioni o cambi d\'abito.' },
        { p: 'L\'armatura militare progettata da Robert Epos utilizza gemme inserite in slot che aumentano con il grado. Una gemma può curare, due potenziano o rendono elementale l\'attacco, due generano uno scudo difensivo e una incrementa velocità, resistenza o difesa. Le gemme sono limitate e soltanto una può essere reintegrata fra un avamposto e l\'altro.' },
        { p: 'Ogni soldato impara inizialmente a usare la spada, ma può specializzarsi e portare in missione un massimo di due armi. Le squadre proteggono un medico autorizzato a somministrare di nuovo l\'antidoto dopo ventiquattro ore.' },
        { h: 'Economia e tecnologia' },
        { p: 'Campi e allevamenti occupano i livelli inferiori. L\'energia proviene da geotermia, movimento e combustione; acqua piovana e corsi sotterranei vengono filtrati. Una cava controllata dalla fazione fornisce le gemme, mentre il commercio con gli Eporiani scambia cibo e utensili con metalli.' },
        { p: 'I mezzi trasportano squadre di otto o dieci persone con pilota e copilota. Due batterie offrono circa quattro ore di autonomia ciascuna e possono essere ricaricate un numero limitato di volte; esaurite le batterie, le gemme diventano l\'ultima risorsa. La fazione non possiede trasporto aereo.' },
        { image: 'img/settings/eidos/eidos-epizi-finale.png', alt: 'Soldato Epizi con armatura organica e fucile tecnologico' }
      ] },
      { label: 'Epizi', blocks: [
        { h: 'Governo e organizzazione' },
        { p: 'Le città Epizi si sviluppano verticalmente per ridurre il consumo di suolo. Scudi difensivi proteggono il perimetro e gli impianti filtrano l\'aria contaminata. Epimno è la capitale, sede del Presidente Thomas Eichorst e del Parlamento da lui nominato.' },
        { p: 'Il Presidente rimane in carica fino alla morte. La popolazione lo considera severo ma giusto, mentre le sue scelte tendono al dispotismo. Denaro e conoscenza determinano il potere. Le città dell\'anello esterno svolgono funzioni difensive, quelle interne concentrano ricerca e produzione.' },
        { p: 'I cittadini possono chiedere il trasferimento, ma il Parlamento autorizza il viaggio soltanto quando viene raggiunta una quantità sufficiente di persone. La mobilità individuale diventa quindi una pratica amministrativa e collettiva.' },
        { image: 'img/settings/eidos/eidos-epimno.png', alt: 'Torri e passerelle di una città verticale salgono sotto uno scudo trasparente circondato da impianti di filtraggio.' },
        { h: 'Cultura e vita quotidiana' },
        { p: 'Gli Epizi possiedono un\'istruzione più ampia e una maggiore libertà apparente. La storia viene però ridotta a brevi leggende e l\'espressione pubblica rimane sorvegliata. Le professioni possono essere scelte, mentre l\'accesso all\'esercito richiede compatibilità con gli armamenti.' },
        { p: 'La magia è proibita. Chi la manifesta viene isolato e sottoposto a esperimenti per comprenderla ed eliminarla. La fazione considera i Tèras una risposta del mondo all\'abuso magico dei Chorisfos.' },
        { h: 'Vestiario e armature' },
        { p: 'Il vestiario civile varia con gusto e ricchezza. Le classi agiate indossano capi estrosi, tecnologici e volutamente eccessivi. Materiali avanzati e forme difficili da realizzare diventano una dimostrazione di accesso alla ricerca e alla produzione.' },
        { p: 'Le armature militari derivano dalle essenze dei Tèras. Il gene della creatura usata nella realizzazione modifica forza, resistenza e stile di combattimento. Sensori sul volto connettono il soldato alla tuta; armi ed equipaggiamenti ne diventano parti integrate.' },
        { p: 'Quando l\'energia dell\'armatura termina, il sistema assorbe la forza vitale di chi la indossa. Un uso ripetuto consuma memoria e coscienza fino a trasformare il soldato in un essere vuoto o a ucciderlo. Ogni armatura è adattata a un solo individuo e deve essere restituita negli avamposti. All\'esterno non può essere rimossa, perché costituisce anche la protezione dal gas.' },
        { p: 'Karl Rottluff ha corrotto la formula medica di Robert Epos attraverso esperimenti su Tèras ed esseri umani. Alcuni soldati d\'élite possono assumere la forma di un mostro, perdendo progressivamente memoria e identità.' },
        { h: 'Economia e tecnologia' },
        { p: 'Agricoltura, allevamento e industria vengono distribuiti fra città specializzate. Organismi geneticamente modificati aumentano il nutrimento riducendo il suolo necessario. La fissione nucleare alimenta i centri urbani; vasche artificiali permettono alla vegetazione di migliorare l\'ambiente interno.' },
        { p: 'La cava di Minote fornisce l\'energia necessaria alle armature. Gli Eporiani ricevono tecnologia in cambio di metalli. I mezzi Epizi usano energia solare, cilindri di biomassa e controllo geomagnetico. Cargo e laboratori mobili contengono dormitori, apparecchi medici e camere di sospensione per le tute. Sistemi di pianificazione mostrano mappe e simulazioni tridimensionali delle missioni.' }
      ] },
      { label: 'Eporiani', blocks: [
        { h: 'Lechta e il governo dei mercanti' },
        { p: 'Lechta sorge alle pendici di un vulcano su un\'isola calda e luminosa. Le architetture regolari possiedono aperture ridotte; tende sospese coprono le vie e proteggono commercianti e visitatori dal Sole. Quando la terra non fu più sufficiente, la città si estese su piattaforme galleggianti che oggi costituiscono gran parte del suo territorio.' },
        { p: 'La stessa famiglia reale governa da secoli. Il palazzo occupa la zona più antica e il re ascolta soltanto le famiglie mercantili più importanti. Il potere nasce quindi dall\'unione fra dinastia, rotte e disponibilità di risorse.' },
        { image: 'img/settings/eidos/eidos-lechta.png', alt: 'Una città portuale coperta da tende si estende su piattaforme galleggianti ai piedi di un vulcano.' },
        { h: 'Cultura, abiti e difesa' },
        { p: 'Gli Eporiani sono la popolazione più libera e acculturata. Conoscenze astronomiche e geografiche sostengono la navigazione, e la loro mappa del mondo potrebbe essere la più completa esistente. Il vestiario usa tessuti adatti al caldo, forme ampie, turbanti e copricapi che schermano il Sole.' },
        { p: 'Il loro esercito non domina la società. I combattenti sono soprattutto lancieri con armature in cuoio e metallo; le guardie reali portano mantelli neri. I Tèras dell\'isola sono stati addomesticati e vengono usati come cavalcature. Si racconta che il re possieda creature capaci di volare e sputare fuoco, ma nessuno lo ha dimostrato.' },
        { p: 'La flotta e la conoscenza del mare rendono gli Eporiani difficili da affrontare in uno scontro navale. Pesca, allevamenti locali ed estrazione mineraria dal vulcano sostengono un\'economia basata sul baratto. La distanza dalla Palude di Tèime ha preservato l\'isola dalla contaminazione più grave.' },
        { image: 'img/settings/eidos/eidos-antarsi-finale.png', alt: 'Guerriero Antarsi con mantellina e armi d\'osso' }
      ] },
      { label: 'Antarsi', blocks: [
        { h: 'Un popolo senza patria visibile' },
        { p: 'Gli Antarsi discendono dalle popolazioni che si opposero a Chorisfos ed Epizi. Dopo la distruzione di Antarsia, i sopravvissuti raggiunsero un luogo ignoto e fondarono Erissa. Nessun nemico ha mai visto la città o identificato chi la governa.' },
        { p: 'La fazione riunisce etnie diverse, anziani capaci di ricordare frammenti anteriori alla guerra e guerrieri determinati a liberare le città soggette. Attaccano convogli, recuperano materiali dai caduti e infiltrano i sistemi avversari. Le altre popolazioni li descrivono come ladri; gli Antarsi considerano ogni razzia una restituzione.' },
        { image: 'img/settings/eidos/eidos-antarsia.png', alt: 'Monumenti spezzati emergono dalla palude mentre due esploratori attraversano le rovine sotto una coltre rossastra.' },
        { h: 'Costumi e armature' },
        { p: 'Pelli e ossa di Tèras diventano abiti, archi, impugnature e protezioni. I soldati usano armature leggere composte da indumenti di pelle, una mantellina sul busto e un elmo rivestito di stoffa che nasconde gran parte del volto.' },
        { p: 'Le loro tecnologie uniscono parti abbandonate dalle due fazioni maggiori. Un\'armatura può contenere componenti Chorisfos ed Epizi adattati senza possederne completamente nessuna tradizione. L\'aspetto irregolare racconta scarsità, recupero e capacità di trasformare le armi del dominio in strumenti di resistenza.' }
      ] },
      { label: 'Religioni dell\'archè', blocks: [
        { p: 'I **Jalaisti** considerano l\'acqua il principio della vita e la sostanza capace di assumere ogni caratteristica. Pioggia, fertilità e corpo confermano per loro un\'unica origine.' },
        { p: 'I **Pavanisti** vedono nell\'aria il respiro del singolo e del cosmo. Rarefazione e condensazione spiegano la trasformazione della materia e collegano caldo, freddo, acqua e fuoco.' },
        { p: 'Gli **Igniti** venerano il fuoco come scambio e divenire. Vita e morte appartengono allo stesso movimento, e la guerra diventa forza capace di giudicare e trasformare. È il culto più diffuso fra i Chorisfos.' },
        { p: 'Gli **Arithmi** leggono il mondo attraverso numero, geometria e consonanza. Pari, dispari e Uno formano un universo ordinato; la musica purifica perché manifesta rapporti semplici. Il culto è particolarmente diffuso fra gli Epizi.' },
        { p: 'I seguaci dell\'**Àpeiron** considerano l\'infinito un principio ingenerato e indistruttibile, materia indeterminata da cui le cose emergono e a cui ritornano.' },
        { p: 'Questi culti non cancellano il ricordo del Demiurgo o di Aima. Lo frammentano in interpretazioni incompatibili, ciascuna capace di trasformare la ricerca della chiave in una missione religiosa.' }
      ] },
      { label: 'Tèras e natura mutata', blocks: [
        { p: 'Gas e pioggia hanno trasformato flora e fauna. Molte specie antiche sono scomparse; altre sono cresciute, mutate o diventate più aggressive. Le città allevano animali adattati e organismi creati in laboratorio, ma nessuna fazione possiede un catalogo completo del mondo vivente.' },
        { p: 'I Tèras comparvero dopo la sconfitta di Aima. I Chorisfos li considerano prodotti della corruzione tecnologica Epizi; gli Epizi li attribuiscono all\'abuso della magia; gli Eporiani hanno scelto di conviverci. La creatura osservata rimane la stessa, ma il significato cambia con chi la guarda.' },
        { image: 'img/settings/eidos/eidos-teras-terrestri.png', alt: 'Creature corazzate, predatori a sei arti e piccoli organismi fungini abitano un terreno contaminato.' },
        { image: 'img/settings/eidos/eidos-teras-aerei-acquatici.png', alt: 'Organismi traslucidi planano sopra il mare mentre una grande creatura anfibia attraversa rovine sommerse.' }
      ] },
      { label: 'Ambientazioni d\'esempio', blocks: [
        { h: 'Un anello di Apologeti' },
        { p: 'Il corridoio segue la curvatura dell\'anello e collega dormitori, officine e mense affacciandosi sul vuoto centrale della megastruttura. Ascensori e passerelle conducono agli anelli superiori e inferiori, tanto lontani da sembrare parti di un\'altra città. Il colore neutro delle uniformi cambia quando si attraversa un nuovo settore. I bambini del Periphto marciano dall\'altro lato di una grata; un simbolo inciso di nascosto sul muro costituisce un atto d\'arte e quindi una condanna.' },
        { h: 'Un laboratorio mobile Epizi' },
        { p: 'Il veicolo rimane sospeso pochi centimetri sopra il terreno contaminato. Le camere delle armature emettono luce attraverso involucri traslucidi; ogni tuta sembra respirare anche senza il proprio soldato. Nel laboratorio medico, i dati di un\'essenza di Tèras vengono confrontati con il profilo di un nuovo candidato.' },
        { h: 'Il mercato coperto di Lechta' },
        { p: 'Tende sovrapposte trasformano il Sole in fasce di colore. Spezie, metalli vulcanici, mappe e tessuti passano fra mercanti provenienti da popoli in guerra. Oltre le bancarelle, le piattaforme galleggianti si muovono con il mare e una cavalcatura Tèras attende accanto a una lancia cerimoniale.' },
        { h: 'Le rovine di Antarsia' },
        { p: 'Il deserto sostituisce i campi che circondavano la città. Il fumo rosso nasconde torri spezzate e monumenti corrosi. Ogni oggetto recuperato può contenere una memoria della ribellione, una traccia di Erissa o una falsa pista lasciata dagli Antarsi per proteggere la propria casa.' }
      ] },
      { label: 'La chiave', blocks: [
        { p: 'La profezia promette un potere capace di ricostruire il mondo oppure di distruggerlo. Chorisfos ed Epizi la cercano per legittimare il proprio dominio; gli Antarsi potrebbero usarla per spezzarlo; gli Eporiani possono conoscere rotte e mappe che gli altri ignorano.' },
        { p: 'La natura della chiave resta indefinita nelle testimonianze. Può essere legata alla magia risvegliata da Aima, alla tecnologia precedente alla guerra, alle religioni dell\'archè o a una memoria cancellata. La sua assenza mantiene in movimento eserciti, scienziati e credenti.' }
      ] },
      { label: 'Conflitti', blocks: [
        { p: 'Chorisfos ed Epizi dipendono da ciò che condannano nell\'altro. I primi usano gemme e magia dentro armature tecnologiche; i secondi trasformano l\'essenza dei Tèras in un potere che consuma l\'identità. Entrambi dichiarano di proteggere l\'umanità mentre controllano spostamenti, conoscenza e corpi.' },
        { p: 'Gli Antarsi combattono per la libertà con materiali rubati alle potenze che vogliono distruggere. Gli Eporiani conservano la neutralità grazie al commercio con ogni parte. Villaggi sconosciuti e comunità isolate restano il territorio conteso in cui una guerra ferma da vent\'anni può ricominciare.' }
      ] },
      { label: 'Figure rilevanti', blocks: [
        { ul: [
          '**Aima**: il Dio che riportò la magia e lasciò la pioggia di sangue.',
          '**Il Demiurgo**: creatore del mondo secondo le leggende più antiche.',
          '**Amos Krusciov**: capo di Stato dei Chorisfos.',
          '**Thomas Eichorst**: Presidente a vita degli Epizi.',
          '**Robert Epos**: scienziato Chorisfos, creatore delle armature a gemme e di una formula medica originaria.',
          '**Karl Rottluff**: scienziato Epizi che ha trasformato quella formula in uno strumento di mutazione militare.',
          '**Il sovrano di Lechta**: erede della dinastia che governa gli Eporiani.',
          '**La guida sconosciuta di Erissa**: autorità di cui gli Antarsi rifiutano di parlare.'
        ] }
      ] },
      { label: 'Nucleo tematico', blocks: [
        { p: 'Eidos racconta un mondo in cui ogni potere si presenta come ricostruzione. Fede, magia, scienza, disciplina e libertà offrono risposte diverse alla stessa catastrofe. La chiave mette alla prova quelle risposte: chi desidera rifare il mondo deve prima dimostrare di non volerlo piegare alla propria paura.' }
      ] }
    ]
  },
  ich: {
    title: 'Ich',
    summary: 'Ciò che ogni essere cerca si annida in un labirinto che vede la luce soltanto nei sogni.',
    cover: 'img/settings/ich/ich-copertina.png',
    coverAlt: 'Un viandante si avvicina a un grande labirinto dorato intrecciato con radici, boschi e corsi d\'acqua.',
    sections: [
      { label: 'Premessa', blocks: [
        { p: 'Erdegis è un mondo ciclico. Le sue popolazioni vivono in un presente di espansioni, commerci e conflitti, ma ogni gesto sembra appartenere anche a qualcosa che è già accaduto o deve ancora accadere. Città votate all\'alchimia e alla tecnica occupano nuovi territori; clan tribali custodiscono conoscenze che esistono soltanto dentro la terra in cui sono nate. Entrambi cercano l\'Ich, senza sapere se sia un luogo, una sostanza, una memoria o un potere divino.' },
        { p: 'Gli abitanti di Erdegis si definiscono **reveries**, il nome che gli Asi diedero ai propri figli. Parlano il Data-L, o Datael, mescolandolo a termini della lingua degli Asi che pochi sono ancora capaci di comprendere. Fra questi emergono i Voluspà, interpreti di idiomi perduti, sogni e visioni del tempo.' },
        { p: 'La società conosce forme medievali e rinascimentali, accompagnate da scoperte anacronistiche. Alchimia, osservazione della natura e primi saperi scientifici convivono con culti, simboli runici e conoscenze tramandate oralmente. Le Stad cercano di dominare il mondo attraverso tecnica e commercio; le Stam lo abitano come una parte del proprio corpo.' }
      ] },
      { label: 'I tre cicli di Erdegis', blocks: [
        { h: 'Il Ciclo degli Asi' },
        { p: 'All\'inizio esistevano il ghiaccio e il buio. Gli Aesir, o Asi, abbandonarono quel mondo attraversando il grande vuoto e unirono le luci del manto oscuro per creare Erdegis. Natura, Sole ed esseri viventi avrebbero dovuto formare un unico sistema, ma il mondo risultò immobile e alcuni Asi iniziarono a scomparire.' },
        { p: 'Per correggere ciò che avevano creato, gli Asi generarono i reveries. Askr ed Embla permisero loro di vivere in più mondi e più tempi, rendendoli potenzialmente eterni. Recisero però i ricordi, perché il passaggio del tempo non li rendesse simili agli Asi e non trasmettesse loro il male che questi portavano con sé.' },
        { h: 'Il Ciclo Argenteo' },
        { p: 'Durante il Ciclo Argenteo gli Asi vissero insieme ai reveries e si fusero con loro. Nacquero le prime società, i culti e le leggende delle regioni. Le tradizioni descrivono nove pilastri o dimore capaci di sostenere il mondo e custodire il legame con Askr, Embla, Hel, Fenris, Sol, Jormungand, Freyja e Lodur.' },
        { p: 'Alla fine del ciclo il cielo mutò dal colore argenteo all\'azzurro violaceo. I reveries cambiarono con esso e il mondo divenne più fertile. I racconti lasciati dai Voluspà parlano di un filo oscuro, simile a una radice, che attraversa la carne e scrive il destino. Soltanto l\'Ich saprebbe interpretarlo.' },
        { h: 'Il Ciclo Aureo' },
        { p: 'L\'epoca attuale è un periodo di crescita demografica, rotte commerciali, colonizzazione e tensione. Le capitali stringono alleanze; le città reprimono le tribù; i clan proteggono terre che nessuna mappa urbana conosce davvero. Per alcuni il Ciclo Aureo rappresenta il massimo splendore dei reveries, per altri l\'attesa di un nuovo cambiamento del cielo.' },
        { p: 'La ricerca dell\'Ich attraversa ogni società. Può assumere la forma di un tesoro, di una verità, di un potere o della chiave che permette di modificare il proprio destino. Nessuno ha mai dimostrato di averlo trovato.' }
      ] },
      { label: 'Geografia del mondo', blocks: [
        { p: 'Erdegis comprende quattro continenti principali e numerose isole.' },
        { p: '**Magna**, a nord-est, è il continente più esteso. Skjioldland occupa il nord con campi, frutteti e rotte agricole; Kynhjarta si apre in vallate fiorite e boschi attraversati dalla rete del Kynwird; il Monte Nero divide le Stad dalle popolazioni tribali; Bhorkyn vive fra alberi mozzi e nebbie; Skry y Kalter si raccoglie intorno al Nido dell\'Aquila, una vetta che supera le nuvole senza raggiungere il Sole.' },
        { p: '**Ourobera**, a ovest, è il continente delle piogge. Le Stad hanno occupato le coste settentrionali e meridionali, mentre gli Urobri resistono nella Palude Nera. Il terreno cambia da coste rocciose e aride a foreste di mangrovie e acque illuminate.' },
        { p: '**Vanargand**, a sud-ovest, contiene due mondi opposti. Il nord è caldo, desertico e dominato dai Foa Vanar con le famiglie Tevel; il sud è freddo, boscoso e montuoso, territorio degli Ulf Vanar.' },
        { p: '**Restan**, a sud-est, è diviso in due isole principali. Le terre maggiori appartengono ai clan tribali del patto Fjorbinda; l\'isola minore ospita popolazioni cittadine. Molte zone rimangono sconosciute e alcune isole sono considerate sacre.' },
        { image: 'img/settings/ich/ich-regioni.png', alt: 'Quattro paesaggi mostrano una palude bioluminescente, un\'oasi desertica, un fiordo innevato e una costa verde percorsa da navi.' }
      ] },
      { label: 'Stad e Stam', blocks: [
        { p: 'Le **Stad** sono città fondate da gruppi che si allontanarono dal rapporto sciamanico con la natura. Estraggono minerali, organizzano coltivazioni, costruiscono e accumulano conoscenza. Possono essere monarchie ereditarie, città governate da Jarl e consiglieri oppure sistemi in cui il potere viene assegnato attraverso il voto.' },
        { image: 'img/settings/ich/ich-vestiario-stad.png', alt: 'Quattro abitanti delle città mostrano abiti sartoriali, armature standardizzate, tessuti importati e strumenti artigiani.' },
        { p: 'Le **Stam** sono clan legati a un territorio preciso. La loro conoscenza non è separabile dal luogo: sentieri, animali, stagioni, piante, acque e pericoli formano un sapere tramandato fra generazioni. Un clan non occupa semplicemente una regione; ne rappresenta una parte vivente.' },
        { image: 'img/settings/ich/ich-vestiario-stam.png', alt: 'Quattro figure tribali indossano fibre vegetali, equipaggiamento da montagna, materiali di palude e protezioni per il gelo.' },
        { p: 'Entrambe le strutture riconoscono figure di governo. Hersir e Hersar guidano o amministrano molte Stam; Jarl, sovrani, baroni e consiglieri governano le Stad. Il titolo non produce la stessa autorità in ogni territorio: alcuni capi ereditano il ruolo, altri devono dimostrare continuamente di meritarlo.' }
      ] },
      { label: 'Figure del mondo', blocks: [
        { h: 'Kyn' },
        { image: 'img/settings/ich/ich-kyn.webp', alt: 'Kyn dal volto scuro e dalla superficie a scaglie, con un occhio luminoso viola.' },
        { p: 'I **Kyn**, “primordiali”, sono reveries del Ciclo Argenteo che sembravano portare il cielo negli occhi. Le leggende attribuiscono loro la capacità di definire e modificare il proprio destino, un potere superiore a quello degli stessi Asi. Sono associati alla natura e alla ricerca dell\'Ich.' },
        { h: 'Voluspà' },
        { image: 'img/settings/ich/ich-voluspa.webp', alt: 'Voluspà dai capelli biondi raccolti, con pitture facciali e abiti degli Skry i Kalter ornati di pelliccia e piume.' },
        { p: 'I **Voluspà** percepiscono luoghi ed eventi mai osservati. Attraverso trance e rituali visitano possibilità del tempo e interpretano il sapere degli Asi. Quando nascono uomini possono presentare deformazioni accompagnate da capacità divinatorie ancora più evidenti.' },
        { h: 'Bannsith' },
        { image: 'img/settings/ich/ich-bannsith.webp', alt: 'Bannsith dai capelli biondo cenere e dagli occhi bianchi, con abiti delle Stad verdi e avorio ricamati in oro.' },
        { p: 'Le **Bannsith** e i **Fearsith** vedono echi e spettri. Le prime manifestano spesso ciocche bianche e riescono più facilmente a parlare con i morti; nei secondi le ciocche tendono al rosso. Possono diventare guide religiose oppure vivere perseguitati dalle presenze che percepiscono.' },
        { h: 'Skéra' },
        { image: 'img/settings/ich/ich-skera.webp', alt: 'Skéra dall\'aspetto androide, con placche sul volto, occhi luminosi blu e abiti scuri bordati d\'oro.' },
        { p: 'Gli **Skera** governano i Bifrost, oggetti capaci di attraversare i mondi. Usano parole della lingua degli Asi, mostrano apatia verso i culti di Erdegis e vengono associati a Lodur. Il folklore li considera annunciatori di morte.' },
        { h: 'Aratare' },
        { p: 'Gli **Aratare** sono figure nere, umane o bestiali, legate a Hel e ai corvi. Le storie raccontano che arrivino per recidere il filo fra anima e corpo quando un reveries ha completato il proprio ciclo. Medici e studiosi dei cadaveri di alcune Stad indossano maschere a becco per confondersi con loro.' }
      ] },
      { label: 'Rune, corpo e memoria', blocks: [
        { p: 'Le rune conservano significati che attraversano popoli differenti. Mannaz rappresenta l\'interdipendenza e l\'eredità degli Asi; Gebo il dono e la reciprocità; Ansuz la voce e la coscienza; Othala l\'eredità; Uruz l\'energia primordiale; Perth il mistero delle dimore; Nauthiz il bisogno; Inguz fertilità e generosità; Eihwaz il patto fra Asi e reveries. Algiz protegge, Fehu richiama ricchezza e bestiame, Wunjo rappresenta Askr e la luce, Jera il raccolto, Kano la conoscenza, Teiwaz il cielo nero.' },
        { p: 'Nelle Stam i simboli vengono tatuati e assumono un significato diverso in base alla posizione. Gli **Enata** raccontano esperienza, origine, famiglia e relazioni; gli **Etua** proteggono nella vita e in battaglia. I segni di passaggio all\'età adulta, le alleanze e le perdite diventano un archivio visibile sul corpo.' }
      ] },
      { label: 'Società di Magna', blocks: [
        { h: 'Skjioldland — i Cervi di Skjold' },
        { p: 'Skjioldland occupa terre agricole rinomate per vino, ortaggi e prodotti da tavola. La casata Skjold governa dalla capitale Skjioldstad. Il Culto dei Tre Sussurri interpreta il tempo attraverso triadi: alba, zenit e tramonto; fuoco, terra e cielo; passato, presente e futuro; infanzia, maturità e vecchiaia. Accanto a esso sopravvive il Culto di Sol.' },
        { p: 'La festa del raccolto distribuisce parte dei prodotti alla corte e parte alla popolazione. Durante la Festa dei Mercati una processione scalza attraversa il territorio da est a ovest in tre giorni. Il Torneo mette in scena forza, prestigio e alleanze.' },
        { p: 'Il rosso carminio e il rosso bruno identificano la nobiltà; il verde appartiene soprattutto a commercianti, esploratori e druidi. Il nero è raro e richiede pigmenti provenienti da Vanargand. Abiti, mantelli e insegne mostrano quindi non soltanto ricchezza, ma accesso alle rotte e ai materiali lontani.' },
        { h: 'Kynhjarta — le radici dei Kynwird' },
        { p: 'Kynhjarta è una regione di boschi, campi fioriti e strade coperte dagli alberi. Al centro si trova il Kynwird, l\'albero che dà nome al grande clan delle radici. Gli abitanti preservano lo hjiarta, fiore azzurro-violaceo nato, secondo la leggenda, dal dono di uno Skera accolto e sfamato dal clan. Il fiore rappresenta ospitalità e cura dello straniero.' },
        { p: 'La società discende dal racconto delle tre figlie del wird: Urdr cercava risposte nei sogni, Skuld costruiva case e strade, Verdandi interpretava le parole degli Asi. I Kynwird leggono ogni relazione come parte di una rete: un gesto produce echi nel passato e nel futuro.' },
        { p: 'Non fabbricano armi né armature e non le portano con sé. La protezione deriva dal legame con il territorio e dalla capacità di attraversarlo. Il vestiario usa fibre, pellicce leggere e colori della vegetazione; fiori, radici e simboli del clan diventano ornamenti e segni di appartenenza.' },
        { image: 'img/settings/ich/ich-kynhjarta.png', alt: 'Tre paesaggi mostrano colline fiorite, una strada sotto un intreccio di alberi e un bosco antico attraversato dal sole.' },
        { h: 'Bhorkyn — la città della luce e i figli di Bhor' },
        { p: 'Stadgull è la capitale delle Stad di Bhorkyn, centro di miniere, forgia, artigianato e conio. Il cerchio solare della casata richiama Sol, la purezza e la ricchezza. Armi e armature sono strumenti efficienti e oggetti estetici, capaci di mostrare il rango del proprietario.' },
        { p: 'Le case più ricche sono spoglie all\'esterno e colme di arazzi, trofei e oggetti esotici all\'interno. Le abitazioni popolari espongono strutture lignee, tetti molto inclinati e una bicromia fra giallo senape e grigio. Cappelle e templi emergono dallo skyline.' },
        { p: 'La regione include anche i Bhorkyn tribali, comprati dal loro vecchio Hersir Bodran Arbjorn in cambio della pace e trasformati nella forza armata delle Stad. Il tradimento del patto con i Fjorbinda ha lasciato una frattura mai sanata. Le loro dotazioni sono controllate e il loro ruolo di esecutori rende visibile una libertà perduta.' },
        { p: 'Le feste principali comprendono il giorno di Sol, la Giostra del Conio e la Pira dei Sette Giorni. Il lusso delle armature, i mantelli e i metalli lavorati devono convivere con boschi radi, alberi mozzati e una nebbia che cancella i confini.' },
        { h: 'Skry y Kalter — il clan Skrykru' },
        { p: 'Gli Skrykru vivono presso il Nido dell\'Aquila e costruiscono torri e villaggi per proteggere la montagna sacra. La loro cultura considera il miglioramento di sé una forma di avvicinamento al Sole. Tecnica e artigianato nascono dall\'osservazione della roccia, del volo e del vento.' },
        { p: 'L\'**Arn**, aquila sacra, rappresenta l\'ideale del clan. Le leggende raccontano che un esemplare capace di raggiungere il Sole trasformi il proprio piumaggio da bruno a bianco. Gli Skrykru proteggono questi animali a costo della vita.' },
        { p: 'Gli archi, chiamati boga, cambiano in base alla funzione. Quelli da sentinella privilegiano velocità e media distanza; quelli da inseguitore raggiungono bersagli lontani perdendo potenza; quelli da guerriero richiedono forza e un adattamento personale. Punte di metallo o osso, comprese le punte nere rotanti, completano un armamento costruito per il territorio verticale.' },
        { image: 'img/settings/ich/ich-societa-magna-ourobera.png', alt: 'Quattro figure rappresentano un Kynwird ornato di fiori, un fabbro Bhorkyn in armatura, un arciere Skrykru e un Urobri della Palude Nera.' }
      ] },
      { label: 'Società di Ourobera', blocks: [
        { h: 'Urobri — la Palude Nera' },
        { p: 'Gli Urobri furono respinti nelle paludi durante l\'invasione delle Stad. Malattie, insetti e veleni decimarono il clan; i sopravvissuti svilupparono resistenza e trasformarono la palude in una difesa. Mangrovie, palafitte, siti di pesca e raccolta conducono al Grundfridir, dove alla fine del ciclo annuale la vegetazione si illumina di ciano e luci simili a lucciole emergono dall\'acqua.' },
        { p: 'Le droghe rituali accompagnano meditazione, vita quotidiana e visioni dei Voluspà. Alcune alleggeriscono il corpo e rilassano i muscoli; altre ampliano la respirazione ma, con l\'abuso, riempiono i polmoni di un liquido corrosivo.' },
        { p: 'Le armi Urobri comprendono lame ondulate e pugnali intrisi di veleno. Il Dente di Aesir, custodito dall\'Hersir Siggy Scagliamanto, sarebbe capace di trasmettere la voce degli Asi e di estrarre i mali dal corpo attraverso un rito.' },
        { p: 'Gli abiti usano lembi tinti di nero, mantelle ampie, gonne e sacche per droghe e talismani. Colori fangosi, capelli simili ad alghe e tessuti irregolari permettono di confondersi con la vegetazione. Fuori dalla palude, il volto e le armi vengono nascosti con maggiore attenzione.' },
        { h: 'Kraken — i corsari dell\'ovest' },
        { p: 'La famiglia Kraken proviene da Magna e ha consolidato il proprio potere unendosi ai Tevel di Vanargand. Controlla rotte commerciali e traffici marittimi, compresa la schiavitù. Il simbolo del mostro degli abissi rappresenta l\'esplorazione di ciò che rimane nascosto.' },
        { p: 'Ogni Nauta porta almeno una spada, spesso curva, e le balestre fanno parte dell\'arsenale di bordo. Gli equipaggi imparano gioco d\'azzardo e bluff fin dall\'infanzia; i banchetti precedono le traversate più importanti.' },
        { p: 'Il vestiario privilegia movimento e resistenza all\'acqua: camicie larghe, gilet senza maniche, pantaloni per uomini e donne, stivali alti in cuoio. Le importazioni da Vanargand aggiungono colori e tessuti che mostrano il successo di una nave e l\'estensione delle sue rotte.' }
      ] },
      { label: 'Società di Vanargand', blocks: [
        { h: 'Foa Vanar — il nord desertico' },
        { p: 'I Foa Vanar vivono fra oasi, tendopoli e regge costruite per esibire ricchezza. Hunder Refar governa insieme a consiglieri, Hersar e famiglie Tevel. Il lupo del deserto o la volpe rappresentano un popolo che ha abbandonato parte delle radici tribali per il lusso e le alleanze con le Stad.' },
        { p: 'Fili metallici luminosi decorano simboli e abiti. Le pitture facciali a forma di zanna sopravvivono soprattutto fra esploratori e abitanti lontani dalla corte. I discendenti di unioni fra tribali e cittadini possono mostrare orecchie leggermente appuntite e vengono chiamati fennec o figli degli Asi.' },
        { p: 'La filosofia Flar sostiene che il volto sia una menzogna e che gli Asi abbiano dato vita ai reveries per un proprio tornaconto. Maschera, verità e inganno non sono opposti stabili, ma strumenti con cui attraversare il mondo.' },
        { h: 'Ulf Vanar — il sud del gelo' },
        { p: 'Gli Ulf Vanar abitano montagne, boschi e coste innevate. Harald Blodtonn guida un popolo di cacciatori, allevatori, pescatori e razziatori. I metalupi, ritenuti discendenti di Fenris, crescono accanto agli uomini e vengono affidati agli Hersar come segno di fiducia.' },
        { p: 'Le loro città controllano porti, costruiscono biremi rapide e organizzano la Caccia Selvaggia. Gli Skàld accompagnano i viaggi narrando storie; rune e simboli dei nove lupi vengono incisi su troni, armi, scudi e corpi.' },
        { p: 'Spade a uno o due tagli, lance semplici o spinate e scudi formano l\'armamento. Le lame più importanti ricevono un nome e conservano iscrizioni dell\'artigiano. I guerrieri che consegnano parte del bottino all\'Hersir ricevono un bracciale che li riconosce come Zanne.' },
        { p: 'Pelli e lana proteggono dal freddo. Bacche di montagna tingono i tessuti di blu violaceo, verde scuro, marrone e giallo. Rune appese al collo raccolgono l\'energia del simbolo; pellicce, intrecci e metallo dichiarano lignaggio e imprese.' },
        { image: 'img/settings/ich/ich-societa-vanargand-restan.png', alt: 'Un corsaro Kraken, una guerriera Foa Vanar, un cacciatore Ulf Vanar e una guardiana Fjorbinda mostrano equipaggiamenti di quattro culture.' }
      ] },
      { label: 'Società di Restan', blocks: [
        { h: 'Fjorbinda — il patto dei nodi' },
        { p: 'Tre clan custodiscono un patto nato quando erano quattro. Il simbolo del Fjorbinda conserva ancora quattro nodi, perché l\'assenza dei Bhorkyn non venga dimenticata. Il tradimento del Ciclo Argenteo ha spezzato l\'equilibrio e il popolo attende qualcuno capace di completarlo.' },
        { p: 'Il territorio attraversa foreste di grandi animali, zone centrali abitate da predatori agili e coste dove la pesca sostiene gli insediamenti. Il klover, fiore normalmente composto da tre foglie, diventa un segno raro quando ne manifesta una quarta.' },
        { p: 'Il vestiario varia da stracci e pelli lavorate a interi busti ricavati da animali di grossa taglia. Alcuni abitanti si muovono quasi nudi durante la caccia. Dopo il passaggio all\'età adulta, i capelli vengono annodati o intrecciati e diventano una memoria visibile del legame con il clan.' }
      ] },
      { label: 'Ambientazioni d\'esempio', blocks: [
        { h: 'Il sentiero coperto del Kynwird' },
        { p: 'Le chiome chiudono il cielo e trasformano le strade in corridoi verdi. Ogni bivio porta un nastro, un fiore o un\'incisione lasciata da chi è passato prima. Il viaggiatore crede di avanzare verso il cuore dell\'albero; la rete sembra invece ricondurlo a un gesto compiuto giorni o anni prima.' },
        { h: 'Il Grundfridir al termine del ciclo' },
        { p: 'La Palude Nera smette per una notte di apparire ostile. Funghi e piante liberano luce ciano, le acque riflettono corpi e mangrovie, i Voluspà respirano le sostanze rituali e ascoltano voci che gli altri percepiscono soltanto come sibili. Ogni rivelazione può essere una memoria, una possibilità o il desiderio della persona che la cerca.' },
        { h: 'Il mercato interno di Stadgull' },
        { p: 'Le facciate rimangono austere, ma dietro le porte si aprono botteghe di metallo, arazzi e armi ornate. Il conio passa dalle mani dei mercanti a quelle degli artigiani; i Bhorkyn tribali sorvegliano senza confondersi con la folla. La ricchezza della città poggia sulla luce delle forge e su un patto che nessuno ha davvero perdonato.' },
        { h: 'Una nave Kraken prima della traversata' },
        { p: 'Il ponte ospita dadi, carte e coppe. I Nauti scommettono prima che il mare decida per loro, mentre spade curve e balestre vengono assicurate alle paratie. I tessuti colorati di Vanargand ricordano le rotte già percorse; il simbolo dell\'abisso promette che la nave ne troverà di nuove.' }
      ] },
      { label: 'Il labirinto dell\'Ich', blocks: [
        { p: 'Lodur lasciò ai primi reveries un disegno privo di spiegazione: un labirinto capace, secondo le sue parole, di condurre a qualcosa di più sacro degli Asi, più raro del gull e più oscuro della morte. La figura attraversa racconti, sogni e simboli senza offrire un accesso certo.' },
        { p: 'Per le Stad può essere una struttura da decifrare; per le Stam un percorso da vivere; per i Voluspà una forma del tempo; per gli Skera una soglia fra mondi. Ogni interpretazione rivela soprattutto il desiderio di chi cerca. L\'Ich rimane il centro vuoto che mette in movimento Erdegis.' }
      ] },
      { label: 'Conflitti del Ciclo Aureo', blocks: [
        { p: 'Le Stad avanzano in territori che considerano inutilizzati; le Stam difendono paesaggi che per loro possiedono memoria, volontà e legami. Le alleanze commerciali possono produrre ricchezza o trasformarsi in sudditanza, come avvenuto a Bhorkyn.' },
        { p: 'La frattura del patto Fjorbinda, l\'invasione di Ourobera, l\'ostilità fra Skrykru e Bhorkyn e la divisione dei Vanar mostrano un mondo in cui ogni confine conserva un tradimento. I Kynjager cacciano chi manifesta poteri legati ai Kyn; i Mordersort eliminano avversari e spie per conto del potere; corsari e mercanti trasformano il mare in una rete di scambi e prigionia.' },
        { p: 'Ogni conflitto torna alla stessa domanda: il destino è una strada incisa dagli Asi oppure una rete che i reveries possono ancora modificare?' }
      ] },
      { label: 'Figure rilevanti', blocks: [
        { ul: [
          '**Varhena Kynwyrd**: Voluspà e voce del Ciclo Argenteo.',
          '**Skuld Hjiarta**: guida attuale dei Kynwird dopo la morte di Varhena.',
          '**Ecbert Skjold e Aslaog Sigurd**: sovrani di Skjioldland.',
          '**Aurelio Solgull I**: fondatore della dinastia di Stadgull.',
          '**Asgull Bauclaire e Agnes Skold**: sovrani di Bhorkyn; Aurum Bauclaire ne è l\'erede.',
          '**Bodran Arbjorn**: Hersir che cedette i Bhorkyn tribali in cambio della pace.',
          '**Siggy Scagliamanto**: Hersir Urobri e custode del Dente di Aesir.',
          '**Hjalmar e Ragnar an Kraken**: figure fondatrici della potenza corsara.',
          '**Hunder Refar**: Hersir dei Foa Vanar.',
          '**Harald Blodtonn**: Hersir degli Ulf Vanar.'
        ] }
      ] },
      { label: 'Nucleo tematico', blocks: [
        { p: 'Ich racconta il rapporto fra destino, memoria e identità. I reveries vivono senza ricordare l\'origine del patto che li ha resi eterni, mentre ogni cultura costruisce una risposta diversa alla stessa mancanza. La ricerca dell\'Ich unisce il mondo perché nessun popolo possiede da solo ciò che serve per comprenderlo.' }
      ] }
    ]
  }
};

/* Il testo delle ambientazioni è dati statici (non input utente):
   **parola** diventa grassetto dopo escapeHtml, come formatRuleBody nel
   manuale delle regole. */
function librarySettingInlineHtml(text) {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function librarySettingListHtml(items) {
  return `<ul style="margin:4px 0 0;padding-left:18px;">${items.map(li => `<li>${librarySettingInlineHtml(li)}</li>`).join('')}</ul>`;
}

function librarySettingBlockHtml(block) {
  if (!block) return '';
  if (block.image) {
    return `<figure class="setting-figure"><img src="${escapeHtml(block.image)}" alt="${escapeHtml(block.alt || '')}" loading="lazy" decoding="async"></figure>`;
  }
  if (block.h) return `<div class="setting-subheading">${librarySettingInlineHtml(block.h)}</div>`;
  if (Array.isArray(block.ul) && block.ul.length) return librarySettingListHtml(block.ul);
  if (block.p) return `<p style="margin:6px 0 0;white-space:pre-wrap;">${librarySettingInlineHtml(block.p)}</p>`;
  return '';
}

function librarySettingSectionHtml(section) {
  if (!section) return '';
  let content = '';
  if (Array.isArray(section.blocks)) content = section.blocks.map(librarySettingBlockHtml).join('');
  else if (Array.isArray(section.body)) content = section.body.length ? librarySettingListHtml(section.body) : '';
  else if (section.body) content = `<p style="margin:4px 0 0;white-space:pre-wrap;">${librarySettingInlineHtml(section.body)}</p>`;
  if (!content) return '';
  return `<section class="setting-section"><div class="section-title" style="margin-top:14px;"><span class="dot neutral"></span>${escapeHtml(section.label)}</div>${content}</section>`;
}

function librarySettingPageHtml(key) {
  const setting = LIBRARY_SETTINGS[key];
  if (!setting) {
    return '<p class="helper-text" style="margin:0;">Questa ambientazione non è ancora disponibile.</p>';
  }
  const coverHtml = setting.cover
    ? `<figure class="setting-figure setting-cover"><img src="${escapeHtml(setting.cover)}" alt="${escapeHtml(setting.coverAlt || '')}" decoding="async"></figure>`
    : '';
  // La frase della copertina è una citazione: centrata, in corsivo e fra
  // virgolette, subito prima della prima sezione ("Premessa").
  const summaryHtml = setting.summary ? `<p class="setting-quote">“${escapeHtml(setting.summary)}”</p>` : '';
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
   riassunto, etichette, sottotitoli, paragrafi ed elenchi di ogni
   sezione), senza un indice
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
        .concat((setting.sections || []).reduce((acc, s) => acc.concat((s.blocks || []).reduce((b, bl) => b.concat(bl.h || [], bl.p || [], bl.ul || []), [])), []))
        .filter(Boolean)
        .join(' \n ')
        .replace(/\*\*/g, '')
        .toLocaleLowerCase('it');
      return haystack.includes(q);
    })
    .map(setting => ({ type: 'setting', id: setting.title, title: setting.title, settingKey: Object.keys(LIBRARY_SETTINGS).find(k => LIBRARY_SETTINGS[k] === setting) }));
}
