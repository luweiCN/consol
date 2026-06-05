export type FuzzyOption = {
  readonly name: string;
  readonly label: string;
  readonly searchText?: string;
};

export function fuzzyFilter<const T extends FuzzyOption>(options: readonly T[], query: string): readonly T[] {
  const needle = normalize(query);
  if (needle.length === 0) {
    return options;
  }

  return options
    .flatMap((option, index) => {
      const score = fuzzyScore(searchText(option), needle);
      return score === null ? [] : [{ option, index, score }];
    })
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map((entry) => entry.option);
}

function searchText(option: FuzzyOption): string {
  return `${option.name} ${option.label} ${option.searchText ?? ""}`;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function fuzzyScore(haystack: string, needle: string): number | null {
  const normalized = normalizeWithBoundaries(haystack);
  let haystackIndex = 0;
  let score = 0;
  let previousMatch = -1;

  for (const char of needle) {
    const matchIndex = normalized.text.indexOf(char, haystackIndex);
    if (matchIndex === -1) {
      return null;
    }

    score += previousMatch === -1 ? matchIndex : matchIndex - previousMatch - 1;
    if (normalized.boundaries[matchIndex]) {
      score -= 3;
    }
    if (previousMatch + 1 === matchIndex) {
      score -= 1;
    }
    previousMatch = matchIndex;
    haystackIndex = matchIndex + 1;
  }

  return score;
}

function normalizeWithBoundaries(value: string): { readonly text: string; readonly boundaries: readonly boolean[] } {
  const chars: string[] = [];
  const boundaries: boolean[] = [];
  let previous = "";
  for (const char of value) {
    if (!/[A-Za-z0-9]/.test(char)) {
      previous = char;
      continue;
    }

    chars.push(char.toLowerCase());
    boundaries.push(chars.length === 1 || !/[A-Za-z0-9]/.test(previous) || (/[a-z]/.test(previous) && /[A-Z]/.test(char)));
    previous = char;
  }

  return { text: chars.join(""), boundaries };
}
