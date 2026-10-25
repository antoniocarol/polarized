// Polarized — tipos do esquema de dados v0.3.0
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
}

export interface TimeSpan {
  start: ISODate;
  end: ISODate | null;      // null = em curso
  observedAt: ISODate;      // quando a fonte registrou
  precision: Precision;
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
  schemaVersion: "0.3.0";
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
  updatedAt: ISODate;
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
  schemaVersion: "0.3.0";
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
  schemaVersion: "0.3.0";
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
  schemaVersion: "0.3.0";
  kind: "analysis";
  analysisType: "precedente" | "impacto" | "checagem" | "contexto";
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

export type Entity = Condition | Event | Measure | Track | Analysis;

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
}

export interface Ingest {
  sourceId: string;
  status: "ok" | "falhou" | "sem_credencial" | "desativada" | "fixture" | "bloqueada_licenca";
  count: number;
  fetchedAt: ISODate;
  error: string | null;
  ms?: number;
}

export interface Snapshot {
  schemaVersion: "0.3.0";
  generatedAt: ISODate;
  window: { from: ISODate; to: ISODate };
  dataClass: "example" | "live" | "mixed";
  sources: Record<string, Source>;
  ingest: Ingest[];           // estado de cada fonte nesta execução
  policy?: Record<string, unknown>;
  entities: Entity[];
}
