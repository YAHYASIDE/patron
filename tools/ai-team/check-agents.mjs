#!/usr/bin/env node
// Static check of the Patron AI team: every .claude/agents/*.md loads as a Claude Code subagent
// (frontmatter name/description/tools), names match file names, tools are known, every skill an
// agent names exists, and the hard limits are referenced. No network, no model calls.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const TEAM = [
  'patron-manager', 'market-scout', 'business-analyst', 'security-guardian', 'payment-guardian',
  'ux-designer', 'app-developer', 'qa-tester', 'automation-agent', 'customer-experience', 'release-manager',
];
const KNOWN_TOOLS = new Set([
  'Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write', 'Skill', 'WebSearch', 'WebFetch', 'Agent', 'NotebookEdit',
]);
// agents that may change files; everyone else must stay read-only
const WRITERS = new Set(['app-developer', 'qa-tester', 'automation-agent']);

/** The frontmatter between the first two `---` lines, as flat key → value (folded `>-` values joined). */
export function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return null;
  const out = {};
  let key = null;
  for (const line of m[1].split('\n')) {
    const kv = /^([a-zA-Z_-]+):\s*(.*)$/.exec(line);
    if (kv) {
      key = kv[1];
      out[key] = kv[2] === '>-' || kv[2] === '|' ? '' : kv[2];
    } else if (key && /^\s+/.test(line)) {
      out[key] = `${out[key]} ${line.trim()}`.trim();
    }
  }
  return out;
}

/** Every .claude/skills/<dir>/SKILL.md: frontmatter name equals the folder, a real description. */
export function checkSkills(root) {
  const dir = join(root, '.claude/skills');
  const problems = [];
  const skills = [];
  for (const name of readdirSync(dir)) {
    const file = join(dir, name, 'SKILL.md');
    if (!existsSync(file)) {
      problems.push(`skill ${name}: no SKILL.md`);
      continue;
    }
    const fm = frontmatter(readFileSync(file, 'utf8'));
    if (!fm) problems.push(`skill ${name}: no frontmatter`);
    else {
      if (fm.name !== name) problems.push(`skill ${name}: name "${fm.name}" does not match the folder`);
      if (!fm.description || fm.description.length < 60) problems.push(`skill ${name}: description too short`);
    }
    skills.push(name);
  }
  return { skills, problems };
}

export function checkTeam(root) {
  const dir = join(root, '.claude/agents');
  const skillsDir = join(root, '.claude/skills');
  const problems = [];
  const agents = [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.md') && !f.startsWith('_'));
  for (const name of TEAM) if (!files.includes(`${name}.md`)) problems.push(`missing agent ${name}`);
  if (!existsSync(join(dir, '_shared-rules.md'))) problems.push('missing _shared-rules.md');

  for (const file of files) {
    const text = readFileSync(join(dir, file), 'utf8');
    const fm = frontmatter(text);
    const id = file.replace(/\.md$/, '');
    if (!fm) {
      problems.push(`${file}: no frontmatter`);
      continue;
    }
    if (fm.name !== id) problems.push(`${file}: name "${fm.name}" does not match the file name`);
    if (!fm.description || fm.description.length < 40) problems.push(`${file}: description too short`);
    const tools = (fm.tools ?? '').split(',').map((t) => t.trim()).filter(Boolean);
    if (!tools.length) problems.push(`${file}: no tools (it would inherit every tool)`);
    for (const t of tools) if (!KNOWN_TOOLS.has(t)) problems.push(`${file}: unknown tool ${t}`);
    const writes = tools.some((t) => t === 'Edit' || t === 'Write');
    if (writes && !WRITERS.has(id)) problems.push(`${file}: may edit files but is meant to be read-only`);
    if (!text.includes('_shared-rules.md')) problems.push(`${file}: does not point to _shared-rules.md`);
    const skills = [...new Set(text.match(/\bpatron-[a-z]+(?:-[a-z]+)*/g) ?? [])].filter(
      (s) => !TEAM.includes(s) && !s.startsWith('patron-monorepo'),
    );
    for (const s of skills) if (!existsSync(join(skillsDir, s, 'SKILL.md'))) problems.push(`${file}: unknown skill ${s}`);
    agents.push({ name: id, tools, skills });
  }
  return { agents, problems };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = resolve(process.argv[2] ?? '.');
  const team = checkTeam(root);
  const sk = checkSkills(root);
  const { agents } = team;
  const problems = [...team.problems, ...sk.problems];
  for (const a of agents) console.log(`${a.name.padEnd(20)} tools: ${a.tools.join(', ')} | skills: ${a.skills.join(', ') || '-'}`);
  if (problems.length) {
    console.error(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  console.log(`\nOK: ${agents.length} agents, ${sk.skills.length} skills`);
}
