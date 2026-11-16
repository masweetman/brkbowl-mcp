/** Shared text helpers for matching grocery names. */

const STOP_WORDS = new Set(["a", "an", "the", "of", "and", "or", "with", "for", "fresh", "some"]);

export function singular(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ie")) return `${word.slice(0, -2)}y`;
  if (word.endsWith("oes")) return word.slice(0, -2);
  if (/(?:x|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (/(?:ss|us|is)$/.test(word)) return word;
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

/** Lowercase, strip accents and punctuation, singularize. Keeps stop words (callers filter). */
export function tokenize(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map(singular);
}

export function queryTokens(text: string): string[] {
  return tokenize(text).filter((t) => !STOP_WORDS.has(t));
}

// Pairs of phrases that mean the same thing in a grocery list. Matched on normalized tokens.
const SYNONYMS: [string, string][] = [
  ["scallion", "green onion"],
  ["cilantro", "coriander"],
  ["garbanzo", "chickpea"],
  ["zucchini", "courgette"],
  ["eggplant", "aubergine"],
  ["arugula", "rocket"],
  ["bell pepper", "sweet pepper"],
  ["yogurt", "yoghurt"],
  ["powdered sugar", "confectioner sugar"],
  ["baking soda", "bicarbonate of soda"],
  ["ground beef", "beef mince"],
  ["shrimp", "prawn"],
  ["cookie", "biscuit"],
  ["soda", "soft drink"],
];

function containsPhrase(tokens: string[], phrase: string[]): number {
  for (let i = 0; i + phrase.length <= tokens.length; i++) {
    if (phrase.every((p, j) => tokens[i + j] === p)) return i;
  }
  return -1;
}

/** The original token list plus variants with a synonym swapped in. */
export function expandQuery(tokens: string[]): string[][] {
  const variants: string[][] = [tokens];
  for (const [a, b] of SYNONYMS) {
    const pa = tokenize(a);
    const pb = tokenize(b);
    for (const [from, to] of [
      [pa, pb],
      [pb, pa],
    ] as const) {
      const at = containsPhrase(tokens, [...from]);
      if (at >= 0)
        variants.push([...tokens.slice(0, at), ...to, ...tokens.slice(at + from.length)]);
    }
  }
  return variants;
}
