/**
 * Minimal semver-ish comparator for skill versions.
 *
 * Skills in plexus carry a user- or Skill-Forge-assigned version string
 * in `attributes.version`. The format observed in the Skill Forge
 * project is loose: `v0.1`, `v1`, `v1.2.0`, sometimes without the `v`
 * prefix. We need just enough to pick "the newest" when multiple active
 * skills share a name.
 *
 * Not a full semver implementation — we ignore pre-release tags,
 * build metadata, and everything else. A 3-tuple of integers is all
 * the skill library needs.
 */

export type SkillVersion = readonly [number, number, number];

/** Parses a loose version string to a [major, minor, patch] tuple. Returns null on failure. */
export function parseSkillVersion(raw: string): SkillVersion | null {
  if (!raw) return null;
  const stripped = raw.trim().replace(/^v/i, '');
  if (stripped.length === 0) return null;
  const parts = stripped.split('.');
  if (parts.length > 3) return null;
  const nums: number[] = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    nums.push(parseInt(p, 10));
  }
  while (nums.length < 3) nums.push(0);
  return [nums[0]!, nums[1]!, nums[2]!] as const;
}

/**
 * Returns >0 if a > b, <0 if a < b, 0 if equal.
 * Unparseable versions sort below parseable ones; two unparseable strings
 * are treated as equal (stable sort handles the rest).
 */
export function compareSkillVersions(a: string, b: string): number {
  const va = parseSkillVersion(a);
  const vb = parseSkillVersion(b);
  if (va === null && vb === null) return 0;
  if (va === null) return -1;
  if (vb === null) return 1;
  for (let i = 0; i < 3; i++) {
    if (va[i]! !== vb[i]!) return va[i]! - vb[i]!;
  }
  return 0;
}
