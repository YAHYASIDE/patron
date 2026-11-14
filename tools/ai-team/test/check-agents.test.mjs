import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkSkills, checkTeam, frontmatter, TEAM } from '../check-agents.mjs';

const repo = resolve(import.meta.dirname, '../../..');

test('the real team loads: 11 agents, no problems', () => {
  const { agents, problems } = checkTeam(repo);
  assert.deepEqual(problems, []);
  assert.deepEqual(agents.map((a) => a.name).sort(), [...TEAM].sort());
});

test('only the three builders may edit files; the manager may dispatch agents', () => {
  const { agents } = checkTeam(repo);
  const writers = agents.filter((a) => a.tools.includes('Edit') || a.tools.includes('Write')).map((a) => a.name);
  assert.deepEqual(writers.sort(), ['app-developer', 'automation-agent', 'qa-tester']);
  assert.ok(agents.find((a) => a.name === 'patron-manager').tools.includes('Agent'));
  assert.ok(agents.find((a) => a.name === 'market-scout').skills.includes('patron-market-intelligence'));
});

test('frontmatter joins folded values', () => {
  const fm = frontmatter('---\nname: x\ndescription: >-\n  one\n  two\ntools: Read\n---\nbody');
  assert.equal(fm.description, 'one two');
  assert.equal(fm.tools, 'Read');
});

test('a broken team is reported', () => {
  const root = mkdtempSync(join(tmpdir(), 'team-'));
  cpSync(join(repo, '.claude'), join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, '.claude/agents/ux-designer.md'), '---\nname: ux\ndescription: short\ntools: Read, Write, Teleport\n---\nUses patron-nonexistent.');
  mkdirSync(join(root, '.claude/agents/x'), { recursive: true });
  const { problems } = checkTeam(root);
  const text = problems.join('\n');
  for (const want of ['does not match', 'description too short', 'unknown tool Teleport', 'meant to be read-only', 'unknown skill patron-nonexistent', 'does not point to _shared-rules.md']) {
    assert.ok(text.includes(want), `expected "${want}" in:\n${text}`);
  }
});

test('every skill loads: folder name = frontmatter name, real description', () => {
  const { skills, problems } = checkSkills(repo);
  assert.deepEqual(problems, []);
  for (const s of ['patron-skill', 'patron-market-intelligence', 'patron-ai-team', 'patron-discovery']) assert.ok(skills.includes(s), s);
});

test('a broken skill is reported', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-'));
  mkdirSync(join(root, '.claude/skills/x-skill'), { recursive: true });
  mkdirSync(join(root, '.claude/skills/empty'), { recursive: true });
  writeFileSync(join(root, '.claude/skills/x-skill/SKILL.md'), '---\nname: other\ndescription: short\n---\n');
  const text = checkSkills(root).problems.join('\n');
  for (const want of ['does not match the folder', 'description too short', 'empty: no SKILL.md']) assert.ok(text.includes(want), want);
});
