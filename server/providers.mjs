/**
 * Basisadapter des Prototyps.
 *
 * Jeder Adapter beschreibt einen Anbieter (Modell, Rhetorik, Zeitverhalten, Metrik-Profil)
 * und besitzt einen Composer, der aus dem Prompt einen eigenständigen Antworttext ableitet.
 * Die Antworten werden vom Server erzeugt und tokenweise gestreamt; Laufzeit, Tokenzahl und
 * Selbstbewertung sind echte Messwerte der Simulation.
 */

const MAX_TOPIC = 96

const LEADING_PATTERNS = [
  /^(bitte\s+)?(erkläre|erklaere|erläutere|beschreibe|analysiere|fasse|zeige|nenne|liste|gib)\s+/i,
  /^(wie|was|warum|weshalb|wieso|welche|welcher|welches|wer|wann|wo)\s+/i,
  /^(kannst du|können sie|kann man|gibt es)\s+/i,
]

/** Verdichtet den Prompt auf ein zitierfähiges Thema. */
export function extractTopic(prompt) {
  const clean = String(prompt ?? '').trim().replace(/\s+/g, ' ')
  if (!clean) return 'die vorliegende Anfrage'
  let stripped = clean
  for (const pattern of LEADING_PATTERNS) {
    const next = stripped.replace(pattern, '')
    if (next !== stripped) {
      stripped = next
      break
    }
  }
  const topic = (stripped || clean).replace(/[?!.:;\s]+$/, '')
  if (topic.length === 0) return clean.slice(0, MAX_TOPIC)
  const capped = topic.length > MAX_TOPIC ? `${topic.slice(0, MAX_TOPIC).trim()}…` : topic
  return capped.charAt(0).toUpperCase() + capped.slice(1)
}

const STOPWORDS = new Set([
  'aber', 'alle', 'allem', 'allen', 'aller', 'alles', 'also', 'andere', 'auch', 'auf', 'aus',
  'bei', 'beim', 'bin', 'bis', 'dann', 'das', 'dass', 'dem', 'den', 'denn', 'der', 'des',
  'die', 'dies', 'diese', 'diesem', 'diesen', 'dieser', 'dieses', 'doch', 'dort', 'durch',
  'ein', 'eine', 'einem', 'einen', 'einer', 'eines', 'etwa', 'für', 'gegen', 'gibt', 'haben',
  'hat', 'hier', 'ich', 'ihm', 'ihn', 'ihr', 'ihre', 'immer', 'indem', 'ist', 'jede', 'jeden',
  'kann', 'kein', 'keine', 'mit', 'muss', 'nach', 'nicht', 'noch', 'nur', 'oder', 'ohne',
  'sich', 'sie', 'sind', 'so', 'soll', 'sollen', 'über', 'und', 'unter', 'vom', 'von', 'vor',
  'war', 'was', 'wenn', 'werden', 'wie', 'wird', 'wo', 'wurde', 'zum', 'zur', 'zwischen',
])

export function keywords(text, limit = 12) {
  const counts = new Map()
  for (const raw of String(text ?? '').toLowerCase().split(/[^a-zäöüß0-9-]+/)) {
    const token = raw.replace(/^-+|-+$/g, '')
    if (token.length < 4 || STOPWORDS.has(token)) continue
    counts.set(token, (counts.get(token) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([token]) => token)
}

function sentencesOf(text) {
  return String(text ?? '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Erste n Sätze eines Textes — Basis für die gewichtete Synthese. */
export function leadSentences(text, count) {
  return sentencesOf(text).slice(0, count).join(' ')
}

/* ------------------------------------------------------------------ */
/* Composer: je Persona eine eigene Argumentationsfigur                */
/* ------------------------------------------------------------------ */

const composers = {
  struktur(topic) {
    return [
      `Kurzdefinition: ${topic} beschreibt einen Vorgang, bei dem mehrere Modelle dieselbe Anfrage gleichzeitig beantworten und ihre Ausgaben anschließend über einen Gewichtungsvektor zusammengeführt werden.`,
      `Struktur: Drei Ebenen bestimmen das Ergebnis. Erstens der Prompt als Suchraum, zweitens die Gewichte als Einflussgröße, drittens die Kollapsregel als Form der Zusammenführung.`,
      `Beobachtung: Mit jedem zusätzlichen Modell steigt die Abdeckung, zugleich wächst die Streuung der Aussagen. Ab etwa vier Modellen übersteigt der Zusatznutzen häufig die Redundanz.`,
      `Messgrößen: Laufzeit, Tokenzahl und Selbstbewertung je Modell sind belastbare Indikatoren. Sie ersetzen keine fachliche Prüfung, machen Abweichungen aber sichtbar.`,
      `Empfehlung: Einzelgewichte oberhalb von 0,40 halten das Ergebnis nachvollziehbar. Darunterliegende Beiträge wirken als Randnotiz und sollten als solche ausgewiesen werden.`,
      `Nächster Schritt: Superposition starten, Gewichte justieren, Kollaps auslösen und das Protokoll gegen die Rohantworten prüfen.`,
    ]
  },
  abwaegend(topic) {
    return [
      `Zunächst ist festzuhalten, dass „${topic}“ mehrdeutig bleibt, solange der Verwendungszweck offen ist. Die Antwort hängt stärker an der Entscheidungssituation als an der Technik.`,
      `Für die parallele Befragung mehrerer Modelle spricht einiges: unterschiedliche Trainingsstände erzeugen unterschiedliche Blindstellen, die sich gegenseitig sichtbar machen.`,
      `Zugleich ist Vorsicht angebracht. Eine gewichtete Zusammenführung erzeugt den Eindruck von Sicherheit auch dort, wo Modelle lediglich übereinstimmend falsch liegen. Übereinstimmung ist kein Beweis.`,
      `Ein belastbares Vorgehen trennt daher drei Dinge: die Rohantworten, die Gewichtungsentscheidung und das finale Artefakt. Überprüfbar müssen die ersten beiden bleiben.`,
      `Grenzen der Aussage: Der Prototyp simuliert die Anbieterantworten. Aussagen über reale Modellqualität lassen sich daraus nicht ableiten, wohl aber über Ablauf, Protokollierung und Nachvollziehbarkeit.`,
      `Empfehlung: Die Kollapsregel dokumentieren, Gewichte versionieren und strittige Aussagen einzeln ausweisen, statt sie zu glätten.`,
    ]
  },
  kompakt(topic) {
    return [
      `Kern: ${topic} ist effizient lösbar, wenn mehrere Modelle parallel antworten und ein Gewichtungsvektor über das Ergebnis entscheidet.`,
      `Umsetzung: ein Adapter je Anbieter, ein gemeinsamer Transportkanal, serverseitige Schlüsselablage. Kein Modellzugriff aus dem Browser.`,
      `Tempo: Begrenzend wirkt selten die Inferenz, sondern die Zusammenführung. Ein Kollaps auf dem Server kostet wenige Millisekunden.`,
      `Aufwand: Der Prototyp benötigt keine Anbieterkonten. Die Adapter arbeiten mit gemessenen Simulationsströmen und lassen sich später gegen echte Endpunkte tauschen.`,
      `Risiko: Zu breite Gewichtsstreuung erzeugt weiche, nicht überprüfbare Aussagen. Drei klare Positionen sind besser als fünf undeutliche.`,
    ]
  },
  explorativ(topic, keywordsFound) {
    const field = keywordsFound.length > 0 ? keywordsFound.slice(0, 4).join(', ') : 'Prompt, Gewicht, Kollaps'
    return [
      `Denkansatz: Überlagern sich Antworten, verhält sich das System wie ein Feld und nicht wie eine Liste. Das Ergebnis entsteht erst durch die Messung, also durch den Kollaps.`,
      `Leitbegriffe aus der Anfrage: ${field}. Sie bilden die Achsen, entlang derer sich die Modelle unterscheiden lassen.`,
      `Variante A: Gewichtung manuell durch Fachanwender. Nachvollziehbar, aber langsam und personenabhängig.`,
      `Variante B: Gewichtung automatisch aus Metriken wie Laufzeit, Selbstbewertung und Quellenlage. Schneller, dafür erklärungsbedürftig.`,
      `Technisch: Jede Ausgabe bleibt als eigener Kanal erhalten. Der Kollaps verändert sie nicht, er wählt aus und verschmilzt — der Ursprung jeder Passage bleibt zuordenbar.`,
      `Offene Frage: Soll das Ergebnis die beste Einzelantwort sein oder eine neue Synthese? Dieser Prototyp entscheidet sich für eine gewichtete Synthese mit Herkunftsnachweis.`,
    ]
  },
}

export function composeResponse(provider, prompt) {
  const topic = extractTopic(prompt)
  const composer = composers[provider.style] ?? composers.struktur
  return composer(topic, keywords(prompt)).join('\n\n')
}

/** Personas für neu angelegte Adapter. */
export const PERSONA_PRESETS = {
  struktur: {
    persona: 'strukturgebend',
    style: 'struktur',
    summary: 'Verdichtet die Anfrage zu Definition, Struktur und Handlungsschritten.',
    confidence: 0.87,
    cadence: [36, 72],
    verbosity: 1.0,
  },
  abwaegend: {
    persona: 'abwägend',
    style: 'abwaegend',
    summary: 'Prüft Voraussetzungen, benennt Grenzen und formuliert eine Empfehlung.',
    confidence: 0.82,
    cadence: [44, 88],
    verbosity: 1.15,
  },
  kompakt: {
    persona: 'kompakt',
    style: 'kompakt',
    summary: 'Antwortet in kurzen Blöcken zu Kern, Umsetzung, Tempo und Risiko.',
    confidence: 0.78,
    cadence: [26, 54],
    verbosity: 0.8,
  },
  explorativ: {
    persona: 'explorativ',
    style: 'explorativ',
    summary: 'Eröffnet Denkansätze, Varianten und offene Fragen zum Thema.',
    confidence: 0.74,
    cadence: [48, 96],
    verbosity: 1.1,
  },
}

export const BASE_PROVIDERS = [
  {
    id: 'openai',
    label: 'OpenAI',
    vendor: 'OpenAI',
    model: 'gpt-4o',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    accent: '#10a37f',
    glyph: 'OA',
    persona: 'strukturgebend',
    style: 'struktur',
    summary: 'Verdichtet die Anfrage zu Definition, Struktur und Handlungsschritten.',
    capabilities: ['Verdichtung', 'Strukturierung', 'Werkzeugaufrufe'],
    confidence: 0.87,
    latencyBase: 380,
    cadence: [34, 70],
    verbosity: 1.0,
    enabled: true,
    builtIn: true,
    weightDefault: 34,
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    vendor: 'Anthropic',
    model: 'claude-3-7-sonnet',
    endpoint: 'https://api.anthropic.com/v1/messages',
    accent: '#d97757',
    glyph: 'AN',
    persona: 'abwägend',
    style: 'abwaegend',
    summary: 'Prüft Voraussetzungen, benennt Grenzen und formuliert eine Empfehlung.',
    capabilities: ['Abwägung', 'Grenzen aufzeigen', 'Langkontext'],
    confidence: 0.83,
    latencyBase: 520,
    cadence: [44, 92],
    verbosity: 1.15,
    enabled: true,
    builtIn: true,
    weightDefault: 27,
  },
  {
    id: 'mistral',
    label: 'Mistral',
    vendor: 'Mistral AI',
    model: 'mistral-large-2411',
    endpoint: 'https://api.mistral.ai/v1/chat/completions',
    accent: '#ff7000',
    glyph: 'MI',
    persona: 'kompakt',
    style: 'kompakt',
    summary: 'Antwortet in kurzen Blöcken zu Kern, Umsetzung, Tempo und Risiko.',
    capabilities: ['Kompaktheit', 'Mehrsprachigkeit', 'Effizienz'],
    confidence: 0.79,
    latencyBase: 300,
    cadence: [24, 52],
    verbosity: 0.82,
    enabled: true,
    builtIn: true,
    weightDefault: 22,
  },
  {
    id: 'llama',
    label: 'Llama',
    vendor: 'Meta',
    model: 'llama-3.3-70b-instruct',
    endpoint: 'https://api.together.xyz/v1/chat/completions',
    accent: '#5b7cfa',
    glyph: 'LL',
    persona: 'explorativ',
    style: 'explorativ',
    summary: 'Eröffnet Denkansätze, Varianten und offene Fragen zum Thema.',
    capabilities: ['Offenheit', 'Variantenbildung', 'Selbsthosting'],
    confidence: 0.75,
    latencyBase: 440,
    cadence: [48, 96],
    verbosity: 1.12,
    enabled: true,
    builtIn: true,
    weightDefault: 17,
  },
]

export const ADAPTER_ACCENTS = ['#4fe3d0', '#f2c14e', '#e2557b', '#8b7cf6', '#4fb0e3', '#b4e34f']
