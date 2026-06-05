/** Normalize vendor/filename text for fuzzy substring matching. */
export function normalizeVendorText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\./g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(gmbh|ug|ltd|inc|bv|ag|llc|co)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const VENDOR_ALIASES: Record<string, string[]> = {
  tokenize: ["tokenize", "to25"],
};

function patternTokens(pattern: string): string[] {
  const normalized = normalizeVendorText(pattern);
  if (!normalized) return [];

  for (const [key, aliases] of Object.entries(VENDOR_ALIASES)) {
    if (normalized.includes(key) || aliases.some((a) => normalized.includes(a))) {
      return aliases.filter((a) => a.length >= 3);
    }
  }

  return normalized.split(" ").filter((t) => t.length >= 3);
}

/** Case-insensitive vendor match — handles Tokenize.it vs filename "to25100187…". */
export function matchesVendorPattern(haystack: string, pattern: string): boolean {
  const needle = pattern.trim();
  if (!needle) return true;

  const hay = haystack.toLowerCase();
  const normHay = normalizeVendorText(haystack);
  const normNeedle = normalizeVendorText(needle);

  if (normHay.includes(normNeedle)) return true;
  if (hay.includes(needle.toLowerCase())) return true;

  const tokens = patternTokens(needle);
  if (tokens.length === 0) return normHay.includes(normNeedle);

  return tokens.some((token) => {
    if (token === "to25") return /\bto25\d+/i.test(haystack);
    return normHay.includes(token);
  });
}

/** Parse supplier name from Tokenize-style filenames: to25100187 - Customer - Supplier.pdf */
export function inferSupplierFromFilename(filename: string): string | null {
  const base = (filename.split("/").pop() ?? filename).replace(/\.[^.]+$/, "").trim();
  const parts = base.split(/\s*-\s*/).map((p) => p.trim()).filter(Boolean);

  if (parts.length >= 2 && /^to\d{6,}/i.test(parts[0])) {
    return parts[parts.length - 1] ?? null;
  }

  if (/tokenize/i.test(base)) {
    return "Tokenize.it GmbH";
  }

  return null;
}
