// Render a kebab-case tag slug as a human-readable label.
// Tag slugs are lowercase, kebab-case (e.g. "oem-24ai", "oracle-database").

const ACRONYMS = new Set([
  'oci', 'oem', 'rac', 'asm', 'awr', 'rman', 'sql', 'jdk', 'os',
  'dbcs', 'exacs', 'zdt', 'spb', 'gi', 'crs', 'iam', 'idcs', 'fmw', 'mos',
]);

const OVERRIDES: Record<string, string> = {
  'oem-24ai': 'OEM 24ai',
  'oracle-database': 'Oracle Database',
  'oracle-ace': 'Oracle ACE',
  'gc-buffer-busy': 'gc buffer busy',
  'ora-01017': 'ORA-01017',
  '11g': '11g',
  '12c': '12c',
  '19c': '19c',
  '23ai': '23ai',
  '26ai': '26ai',
  'dbms-redefinition': 'DBMS_REDEFINITION',
  'data-guard': 'Data Guard',
  'zdt-patching': 'ZDT Patching',
  'agent-gold-image': 'Agent Gold Image',
  'grid-infrastructure': 'Grid Infrastructure',
  'wait-events': 'Wait Events',
  'online-operations': 'Online Operations',
  'goldengate': 'GoldenGate',
  'omspatcher': 'omspatcher',
  'chopt': 'chopt',
};

export function tagLabel(slug: string): string {
  const s = slug.trim().toLowerCase();
  if (OVERRIDES[s]) return OVERRIDES[s];
  return s
    .split('-')
    .map((w) =>
      ACRONYMS.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)
    )
    .join(' ');
}

export function tagSlug(input: string): string {
  return input.trim().toLowerCase();
}
