export interface ValueSetEntry {
  system: string;
  code: string;
  display: string;
  version: string;
}

export interface ValueSet {
  url: string;
  version: string;
  entries: ValueSetEntry[];
}

export interface LookupResult {
  found: boolean;
  display?: string;
  system?: string;
  version?: string;
  /** true when the code is usable only under its local namespace */
  localOnly?: boolean;
}

/**
 * In-memory value-set client. Lookups are exact and version-pinned;
 * misses return { found: false } so callers handle unmapped codes explicitly.
 */
export class TerminologyClient {
  private readonly sets = new Map<string, ValueSet>();

  register(set: ValueSet): void {
    this.sets.set(`${set.url}|${set.version}`, set);
  }

  lookup(url: string, version: string, code: string): LookupResult {
    const set = this.sets.get(`${url}|${version}`);
    if (!set) return { found: false };
    const entry = set.entries.find((e) => e.code === code);
    if (!entry) return { found: false };
    return {
      found: true,
      display: entry.display,
      system: entry.system,
      version: set.version,
      ...(entry.system.startsWith('local:')
        ? { localOnly: true as const }
        : {}),
    };
  }
}
