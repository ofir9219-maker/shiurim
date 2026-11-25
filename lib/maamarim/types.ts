// Maamarim library: data model (pure, client-safe).

/** Paragraph HTML is sanitized: only <b>, <i>, <br> and footnote markers <sup class="fn" data-n="N"> survive. */
export type Block =
  | { t: "p"; html: string }
  | { t: "quote"; text: string; label?: string; ref?: string; unresolved?: boolean }
  | { t: "h"; text: string };

export type Section = {
  id: string; // "s1", "s2" … (anchor)
  title: string;
  blocks: Block[];
  /** Enrichment for search (written by the AI that produced the maamar). */
  summary?: string;
  keywords?: string[];
};

export type Note = { n: number; html: string; section: string };

export type Ficha = {
  /** 2–4 sentences, Spanish. */
  summary_es?: string;
  /** 2–4 sentences, Hebrew. */
  summary_he?: string;
  /** Main thesis in one sentence (Hebrew or Spanish). */
  thesis?: string;
  /** Keywords in Hebrew, Spanish and common transliterations (e.g. "תשובה", "teshuvá", "arrepentimiento"). */
  keywords?: string[];
  /** Sources studied, with Sefaria refs when known. */
  sources?: { ref?: string; label: string }[];
  /** People / figures discussed (Rabbis, biblical figures). */
  people?: string[];
  /** Concepts developed. */
  concepts?: string[];
  /** Questions this maamar answers (8–20), Spanish and Hebrew mixed. */
  questions?: string[];
  /** Rav / speaker the maamar is based on. */
  rav?: string;
  /** Free notes for the reader (e.g. pending review). */
  notes?: string;
};

export type Maamar = {
  id: string;
  title: string;
  subtitle?: string;
  /** "על פי שיעור…" line. */
  source?: string;
  /** Display date (Hebrew or civil, as written). */
  date?: string;
  /** ISO date (yyyy-mm-dd) used for sorting, when known. */
  dateIso?: string;
  categoryId: string;
  tags: string[];
  ficha: Ficha;
  sections: Section[];
  notes: Note[];
  pdf?: { key: string; size: number; url?: string };
  /** Original markup as uploaded (kept so the maamar can be re-parsed / edited). */
  markup?: string;
  /** Sequence inside its category (call number). */
  seq: number;
  createdAt: string;
  updatedAt: string;
};

export type Category = { id: string; name: string; parentId: string | null; order: number; description?: string };

/** Lightweight listing row (library pages, MCP list). */
export type MaamarCard = {
  id: string; title: string; subtitle?: string; source?: string; date?: string; dateIso?: string;
  categoryId: string; categoryPath: string[]; callNumber: string; tags: string[]; summary: string;
  sections: number; words: number; hasPdf: boolean; updatedAt: string; createdAt: string;
};

export type CategoryNode = Category & { code: string; path: string[]; count: number; total: number; children: CategoryNode[] };

export type MRef = { maamarId: string; title: string; sectionId: string; sectionTitle: string; quote: string; callNumber?: string };
export type MChatEvent =
  | { type: "delta"; text: string }
  | { type: "status"; text: string }
  | { type: "done"; refs: MRef[]; cited: number[]; mode: "ai" | "noai" | "error"; memory?: string; condensed?: number };
