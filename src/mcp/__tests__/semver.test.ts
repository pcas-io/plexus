import { describe, test, expect } from 'vitest';
import { parseSkillVersion, compareSkillVersions } from '../semver.js';

describe('parseSkillVersion', () => {
  test('parses v1 as [1, 0, 0]', () => {
    expect(parseSkillVersion('v1')).toEqual([1, 0, 0]);
  });

  test('parses v0.1 as [0, 1, 0]', () => {
    expect(parseSkillVersion('v0.1')).toEqual([0, 1, 0]);
  });

  test('parses v1.2.3 as [1, 2, 3]', () => {
    expect(parseSkillVersion('v1.2.3')).toEqual([1, 2, 3]);
  });

  test('parses bare 1.2.3 (no v prefix) as [1, 2, 3]', () => {
    expect(parseSkillVersion('1.2.3')).toEqual([1, 2, 3]);
  });

  test('parses v2.0 as [2, 0, 0]', () => {
    expect(parseSkillVersion('v2.0')).toEqual([2, 0, 0]);
  });

  test('returns null for garbage input', () => {
    expect(parseSkillVersion('foo')).toBeNull();
    expect(parseSkillVersion('')).toBeNull();
    expect(parseSkillVersion('v.')).toBeNull();
  });

  test('rejects versions with more than 3 segments', () => {
    expect(parseSkillVersion('v1.2.3.4')).toBeNull();
  });
});

describe('compareSkillVersions', () => {
  test('v2 > v1', () => {
    expect(compareSkillVersions('v2', 'v1')).toBeGreaterThan(0);
  });

  test('v1.2 > v1.1', () => {
    expect(compareSkillVersions('v1.2', 'v1.1')).toBeGreaterThan(0);
  });

  test('v1.0.0 == v1', () => {
    expect(compareSkillVersions('v1.0.0', 'v1')).toBe(0);
  });

  test('v0.1 < v1', () => {
    expect(compareSkillVersions('v0.1', 'v1')).toBeLessThan(0);
  });

  test('two unparseable versions compare as equal', () => {
    expect(compareSkillVersions('foo', 'bar')).toBe(0);
  });

  test('a valid version beats an unparseable one', () => {
    expect(compareSkillVersions('v1', 'foo')).toBeGreaterThan(0);
    expect(compareSkillVersions('foo', 'v1')).toBeLessThan(0);
  });
});
