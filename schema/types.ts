// Polarized — tipos do esquema de dados v0.5.0
// Espelha schema/polarized.schema.json. Em caso de conflito, o JSON Schema vale.

export type ISODate = string; // RFC 3339, sempre UTC ("Z")

export type Layer =
  | "conflito" | "protesto" | "eleicao" | "economia"
  | "clima" | "sismico" | "diplomacia" | "ciber" | "militar";

export type Status = "nao_verificado" | "corroborado" | "verificado" | "disputado" | "retratado";
export type Precision = "year" | "month" | "day" | "hour" | "minute";

export interface Geometry {
  type: "Point" | "MultiPoint" | "LineString" | "Polygon" | "MultiPolygon";
  coordinates: unknown; // GeoJSON: [lon, lat]
}

export interface Place {
  iso2: string | null;
  iso3: string | null;
  name: string;
  admin1?: string | null;
  admin1Code?: string | null; // ISO 3166-2, ex.: "BR-SP"
  disputed?: string | null;   // id em Snapshot.disputed quando o lugar está num território disputado
}

export interface TimeSpan {
  start: ISODate;
  end: ISODate | null;      // null = em curso
  observedAt: ISODate;      // quando a fonte registrou
  precision: Precision;
  startKnown?: boolean;     // false = a fonte não diz quando começou (ex.: listas de sanções)
}

export interface SourceRef {
  sourceId: string;         // chave em Snapshot.sources
  ref?: string;             // id do registro na fonte
  url?: string;
  retrievedAt: ISODate;
}

export interface Text { headline: string; summary: string; body?: string }

interface Envelope {
  id: string;               // "<fonte>:<tipo>:<id>"
  schemaVersion: "0.5.0";
  layer: Layer;
  subtype: string;          // ver schema/taxonomy.json
  place: Place;
  status: Status;
  confidence: number;       // 0–1
  sources: [SourceRef, ...SourceRef[]]; // nunca vazio
  text: Record<string, Text>;            // chave = código de idioma ("pt", "en")
  links?: { label: string; url: string; publishedAt?: ISODate }[];
  tags?: string[];
  clusterKey?: string;
  relations?: Relation[];   // arcos no globo entre dois países
  reportIds?: string[];     // relatos (Report) sobre este fato, até 12
  attributes?: { programs?: { code: string; label?: string | null; issuer?: string | null; url?: string | null }[] }; // ex.: programas de sanção
  updatedAt: ISODate;
}

export interface Relation {
  type: "sanciona" | "conflito_com" | "acordo_com";
  from: string;             // ISO 3166-1 alfa-2, ou "EU" / "UN"
  to: string;
  label: string;
}

export interface Condition extends Envelope {
  kind: "condition";
  geo: Geometry | null;     // null = sem lugar no mapa (ex.: vulnerabilidade de software global)
  time: TimeSpan;
  intensity: number | null; // 0–5, calculada
  intensityBasis: string | null;
}

export interface Event extends Envelope {
  kind: "event";
  geo: Geometry | null;
  time: TimeSpan;
  intensity: number | null;
  intensityBasis: string | null;
  parentId?: string;        // condição a que pertence (bombardeio → guerra)
  magnitude?: { value: number; scale: string } | null; // escala como a fonte publica: Mww, mb, ML…
  depthKm?: number | null;
}

export interface Assertion {
  sourceId: string;
  value: number;
  observedAt: ISODate;
  method?: string;
  url?: string;
}

export interface Measure {
  id: string;
  schemaVersion: "0.5.0";
  kind: "measure";
  subject: { type: "condition" | "event" | "place"; id: string };
  metric: string;           // "deslocados_internos", "alíquota_media", …
  unit: string;
  periodStart: ISODate;
  periodEnd: ISODate;
  assertions: [Assertion, ...Assertion[]];
  spread: { low: number; high: number; relative: number };
  disputed: boolean;        // spread.relative > taxonomy.disputeThreshold
  consensus: null;          // deliberadamente nulo: o app mostra o leque, não a média
  updatedAt: ISODate;
}

export interface TrackSample {
  t: ISODate;
  lat: number;
  lon: number;
  altM?: number | null;
  speedKn?: number | null;
  headingDeg?: number | null;
}

export interface Track {
  id: string;
  schemaVersion: "0.5.0";
  kind: "track";
  layer: "militar";
  subtype: "aeronave" | "navio" | "comboio";
  asset: {
    callsign?: string | null;
    name?: string | null;     // nome do navio
    icao24?: string | null;   // ADS-B
    mmsi?: string | null;     // AIS
    imo?: string | null;
    model?: string | null;
    class?: string | null;
    operator?: string | null;
    flag?: string | null;     // ISO 3166-1 alfa-2
  };
  classification: { military: boolean; rule: string; confidence: number }; // heurística: pipeline/data/military.json
  samples: [TrackSample, ...TrackSample[]];
  firstSeen: ISODate;
  lastSeen: ISODate;
  trackStatus: "live" | "stale" | "lost";
  sampleRateSec: number;
  releaseDelayMinutes: number;
  status: Status;
  sources: [SourceRef, ...SourceRef[]];
  updatedAt: ISODate;
}

export interface SupportRef { entityId?: string; precedent?: number; sourceId?: string; url?: string }

export interface Analysis {
  id: string;                 // "plz:analysis:<fato>-<tipo>[-<região>]"
  schemaVersion: "0.5.0";
  kind: "analysis";
  analysisType: "precedente" | "impacto" | "checagem" | "contexto" | "mercado" | "panorama";
  scope?: { type: "fato" | "pais" | "mundo" | "serie"; iso2?: string | null };
  subjectIds: [string, ...string[]];
  layer: Layer;
  question: string;
  region?: { iso2: string | null; name: string } | null;
  text: Record<string, { headline: string; summary: string }>;
  points: { type: "fato" | "analise"; text: string; supportedBy: [SupportRef, ...SupportRef[]] }[];
  precedents?: { case: string; place: string; period: string; outcome: "funcionou" | "falhou" | "misto" | "inconclusivo";
    why: string; conditions: string[]; origin: "conhecimento_do_modelo" | "fonte"; sourceUrl?: string | null; verified: boolean }[];
  conditions?: { condition: string; metHere: "sim" | "nao" | "parcial" | "incerto"; why: string }[];
  impacts?: { domain: string; region: string; direction: "aumenta" | "diminui" | "misto" | "incerto"; chain: string[];
    horizon: "dias" | "meses" | "anos"; magnitude: { value: number; unit: string; basis: string } | null }[];
  claims?: { speaker: string; quote: string; class: "fato_verificavel" | "promessa" | "opiniao";
    verdict: "confere" | "nao_confere" | "impreciso" | "sem_dados" | "nao_se_aplica"; why: string; supportedBy: SupportRef[] }[];
  moves?: { date: string; changePct: number; explained: boolean;   // mercado: um item por dia, variação conferida com a série
    drivers: { text: string; supportedBy: SupportRef[] }[] }[];
  watch?: string[];                                               // o que acompanhar
  counterpoint: { text: string; supportedBy: SupportRef[] };   // obrigatório
  limits: string;
  method: { provider: string; model: string; promptVersion: string; generatedAt: ISODate; effort?: string | null };
  crossCheck?: { provider: string; model: string; agreement: number; divergent: string[] } | null;
  review: { status: "pendente" | "aprovada" | "rejeitada"; reviewer: string | null; at: ISODate | null; note: string | null };
  guards: { rule: string; passed: boolean; detail: string }[];
  status: Status;
  confidence: number;
  sources: [SourceRef, ...SourceRef[]];
  updatedAt: ISODate;
  // Não existe campo de probabilidade. Isso é deliberado; ver SCHEMA.md §5.
}

// Manchete de um veículo. Guardamos só título, link e o resumo do próprio veículo.
export interface Report {
  id: string;                 // "<fonte>:rep:<hash da url>"
  schemaVersion: "0.5.0";
  kind: "report";
  sourceId: string;           // rss | bluesky | x
  outlet: string;             // chave em Snapshot.outlets
  url: string;
  title: string;
  excerpt?: string | null;
  summaryPt?: string | null;  // manchete em português, quando o modelo classificou
  lang: string;
  publishedAt: ISODate;
  place: Place | null;
  geo?: Geometry;
  layer: Layer | null;
  subtype: string | null;
  storyKey: string;           // relatos do mesmo fato compartilham a chave
  topic?: string | null;
  classifiedBy: "modelo" | "palavras-chave" | "fonte";
  relatedIds?: string[];      // fatos do snapshot sobre o mesmo assunto
  status: Status;
  confidence: number;
  sources: [SourceRef, ...SourceRef[]];
  updatedAt: ISODate;
}

// Fechamento diário de bolsa, câmbio ou commodity.
export interface Series {
  id: string;                 // "<fonte>:ser:<símbolo>"
  schemaVersion: "0.5.0";
  kind: "series";
  layer: "economia";
  subtype: "indice_bolsa" | "cambio" | "commodity";
  instrument: { symbol: string; name: string; exchange?: string | null; currency: string; unit?: string | null; note?: string | null };
  place: Place | null;
  geo: Geometry;
  points: { d: string; close: number; changePct: number | null }[]; // d = AAAA-MM-DD
  last: { d: string; close: number; changePct: number | null };
  status: Status;
  confidence: number;
  sources: [SourceRef, ...SourceRef[]];
  updatedAt: ISODate;
}

export interface Outlet {
  id: string;
  name: string;
  country: string | null;     // null = internacional
  region?: string;
  lang?: string;
  type: "agencia" | "emissora_publica" | "privada" | "sem_fins_lucrativos" | "estatal" | "organismo_internacional" | "oficial";
  funding?: string;           // quem paga — financiamento estatal aparece marcado no app
  feeds: { kind: "rss" | "bluesky" | "x"; url?: string; handle?: string; username?: string }[];
  criteria: string[];         // por que entrou na lista (schema/outlets.json)
  note?: string;
  verifyFeed?: boolean;
}

export type Entity = Condition | Event | Measure | Track | Analysis | Report | Series;

export interface Source {
  id: string;
  name: string;
  shortName?: string;   // até 16 caracteres, para linhas de medida
  org: string;
  endpoint?: string;    // URL que o adaptador consulta
  env?: string[];       // variáveis de ambiente com credenciais
  url: string;
  access: "aberto" | "chave_api" | "restrito";
  license: string;
  redistribution: "permitida" | "com_atribuicao" | "proibida" | "verificar";
  attributionRequired: boolean;
  reliability: "primaria" | "agregador" | "imprensa" | "colaborativa" | "curadoria";
  cadence: string;
  latencyHours: number;
  layers: Layer[];
  licenseCheckedAt: ISODate | null;
  note?: string;
}

export interface Ingest {
  sourceId: string;
  status: "ok" | "falhou" | "sem_credencial" | "desativada" | "fixture" | "bloqueada_licenca";
  count: number;
  fetchedAt: ISODate;
  error: string | null;
  rejected?: number;          // entidades descartadas pela validação
  ms?: number;
}

export interface Snapshot {
  schemaVersion: "0.5.0";
  generatedAt: ISODate;
  window: { from: ISODate; to: ISODate };
  dataClass: "example" | "live" | "mixed";
  sources: Record<string, Source>;
  outlets?: Record<string, Outlet>;
  disputed?: Record<string, DisputedArea>;   // territórios citados pelas entidades
  ingest: Ingest[];           // estado de cada fonte nesta execução
  policy?: Record<string, unknown>;
  entities: Entity[];
}

// Território disputado (pipeline/data/disputed.json). Nome e fronteira seguem a ONU.
export interface DisputedArea {
  id: string;
  un: string;                 // como a ONU se refere ao lugar
  claims: { by: string; name: string; status?: "administra" | "reivindica" | "ocupa" | "onu" }[]; // by: ISO 3166-1 ou nome
  text: Record<string, { headline?: string; summary: string }>;
}

// text/<idioma>.json: traduções do conteúdo, sobrepostas pelo app. Os caminhos são
// relativos à entidade ("text.headline", "points.0.text"; "_tl" = título de relato traduzido).
export interface TextOverlay {
  lang: string;
  source: "pt";
  generatedAt: ISODate;
  entities: Record<string, Record<string, string>>;
  admin1: Record<string, string>;                      // ISO 3166-2 -> nome do estado no idioma
  outlets: Record<string, { funding?: string; note?: string }>;
  disputed: Record<string, Record<string, string>>;   // headline, summary, claims.N.name
}
