export interface ParsedItem {
  original: string;
  /** The item name with quantity, unit, organic words and parentheticals removed. */
  name: string;
  quantity?: number;
  /** Weight units are lb, oz, g, kg; also "dozen" or a count word like "bunch". */
  unit?: string;
  /** true if the text says "organic", false if it says "conventional", otherwise undefined. */
  organic?: boolean;
  note?: string;
}

const WEIGHT_TO_LB: Record<string, number> = { lb: 1, oz: 1 / 16, g: 1 / 453.592, kg: 2.20462 };

const UNIT_ALIASES: Record<string, string> = {
  lb: "lb",
  lbs: "lb",
  pound: "lb",
  pounds: "lb",
  "#": "lb",
  oz: "oz",
  ounce: "oz",
  ounces: "oz",
  g: "g",
  gram: "g",
  grams: "g",
  kg: "kg",
  kilo: "kg",
  kilos: "kg",
  kilogram: "kg",
  kilograms: "kg",
  dozen: "dozen",
  doz: "dozen",
  bunch: "bunch",
  bunches: "bunch",
  bag: "bag",
  bags: "bag",
  can: "can",
  cans: "can",
  jar: "jar",
  jars: "jar",
  box: "box",
  boxes: "box",
  pack: "pack",
  packs: "pack",
  package: "pack",
  packages: "pack",
  pkg: "pack",
  head: "head",
  heads: "head",
  clove: "clove",
  cloves: "clove",
  bottle: "bottle",
  bottles: "bottle",
  carton: "carton",
  cartons: "carton",
  container: "container",
  containers: "container",
  loaf: "loaf",
  loaves: "loaf",
  stalk: "stalk",
  stalks: "stalk",
  piece: "piece",
  pieces: "piece",
  each: "each",
  ea: "each",
  ct: "each",
  count: "each",
  gallon: "gallon",
  gallons: "gallon",
  gal: "gallon",
  quart: "quart",
  quarts: "quart",
  qt: "quart",
  pint: "pint",
  pints: "pint",
  pt: "pint",
  liter: "liter",
  liters: "liter",
  l: "liter",
};

const UNICODE_FRACTIONS: Record<string, number> = {
  "½": 0.5,
  "¼": 0.25,
  "¾": 0.75,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
};
const NUM = String.raw`(?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|\.\d+|[½¼¾⅓⅔])`;

export function parseNumber(text: string): number | undefined {
  const t = text.trim();
  if (t in UNICODE_FRACTIONS) return UNICODE_FRACTIONS[t];
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = /^(\d+)\/(\d+)$/.exec(t);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

export function isWeightUnit(unit: string | undefined): boolean {
  return unit !== undefined && unit in WEIGHT_TO_LB;
}

export function toPounds(quantity: number, unit: string): number {
  return quantity * (WEIGHT_TO_LB[unit] ?? 1);
}

const LEADING = new RegExp(String.raw`^\s*(${NUM})(\s*)(x\s+)?([A-Za-z#]+)?\.?\s*(.*)$`, "i");
const TRAILING = new RegExp(String.raw`^(.*\S)\s*[,;\-–]\s*(${NUM})\s*([A-Za-z#]+)?\.?\s*$`, "i");
const PAREN_QTY = new RegExp(String.raw`^\(?\s*(${NUM})\s*([A-Za-z#]+)?\.?\s*\)?$`, "i");

/** Splits "<quantity> <unit?> <rest>" off the front of text. Returns undefined if none. */
function takeLeading(text: string) {
  const m = LEADING.exec(text);
  if (!m) return undefined;
  const quantity = parseNumber(m[1]!);
  if (quantity === undefined) return undefined;
  const glued = m[2] === "" && !m[3];
  const word = m[4]?.toLowerCase();
  const unit = word ? UNIT_ALIASES[word] : undefined;
  // "7up" is a name, but "2lb" is a quantity: a word glued to the number must be a unit.
  if (glued && word && !unit) return undefined;
  // If the word after the number is not a unit ("3 carrots"), it belongs to the name.
  const rest = unit ? (m[5] ?? "") : `${m[4] ?? ""} ${m[5] ?? ""}`.trim();
  return { quantity, unit, rest };
}

/** Parses a free-text quantity such as "2", "1.5 lb" or "3 bunches". */
export function parseQuantityPhrase(text: string): { quantity?: number; unit?: string } {
  const lead = takeLeading(text);
  if (lead && lead.rest === "") return { quantity: lead.quantity, unit: lead.unit };
  const m = PAREN_QTY.exec(text.trim());
  if (m) {
    const quantity = parseNumber(m[1]!);
    const unit = m[2] ? UNIT_ALIASES[m[2].toLowerCase()] : undefined;
    if (quantity !== undefined && (unit || !m[2])) return { quantity, unit };
  }
  return {};
}

export function parseListItem(text: string): ParsedItem {
  const original = text;
  let working = text.trim();
  const notes: string[] = [];
  let quantity: number | undefined;
  let unit: string | undefined;

  // Parentheticals: "(2 lb)" is a quantity, anything else is a note.
  working = working.replace(/\(([^)]*)\)/g, (_all, inner: string) => {
    const q = parseQuantityPhrase(inner);
    if (q.quantity !== undefined && quantity === undefined) {
      quantity = q.quantity;
      unit = q.unit;
    } else if (inner.trim()) {
      notes.push(inner.trim());
    }
    return " ";
  });
  working = working.replace(/\s+/g, " ").trim();

  const lead = takeLeading(working);
  if (lead && quantity === undefined) {
    quantity = lead.quantity;
    unit = lead.unit;
    working = lead.rest;
  } else if (lead && lead.rest !== "") {
    working = lead.rest;
  } else if (quantity === undefined) {
    const tail = TRAILING.exec(working);
    if (tail) {
      const q = parseNumber(tail[2]!);
      const u = tail[3] ? UNIT_ALIASES[tail[3].toLowerCase()] : undefined;
      if (q !== undefined && (u || !tail[3])) {
        quantity = q;
        unit = u;
        working = tail[1]!;
      }
    }
  }

  let organic: boolean | undefined;
  working = working.replace(/\b(organic|conventional)\b/gi, (word) => {
    organic = word.toLowerCase() === "organic";
    return " ";
  });
  const name = working
    .replace(/^\s*of\s+/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:-]+|[\s,;:-]+$/g, "");

  return {
    original,
    name,
    quantity,
    unit,
    organic,
    note: notes.length ? notes.join("; ") : undefined,
  };
}

/** Key for remembered matches: same words in any case or plural form map to the same entry. */
export function matchKey(
  parsed: Pick<ParsedItem, "name" | "organic">,
  tokenize: (s: string) => string[],
): string {
  const words = tokenize(parsed.name).join(" ");
  return parsed.organic === true ? `${words}|organic` : words;
}
