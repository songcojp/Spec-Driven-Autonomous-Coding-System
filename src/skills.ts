import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

export type ProjectSkill = {
  slug: string;
  name: string;
  description: string;
  path: string;
};

export type SkillDiscoveryOptions = {
  root?: string;
  skillsDir?: string;
};

export function listProjectSkills(options: SkillDiscoveryOptions = {}): ProjectSkill[] {
  const root = options.root ?? process.cwd();
  const skillsDir = options.skillsDir ?? join(root, ".agents", "skills");
  if (!existsSync(skillsDir)) return [];

  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readProjectSkill(join(skillsDir, entry.name), entry.name))
    .filter((skill): skill is ProjectSkill => Boolean(skill))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

export function countProjectSkills(options: SkillDiscoveryOptions = {}): number {
  return listProjectSkills(options).length;
}

export function readProjectSkill(skillDir: string, fallbackSlug: string = basename(skillDir)): ProjectSkill | undefined {
  const skillPath = join(skillDir, "SKILL.md");
  if (!existsSync(skillPath)) return undefined;

  const content = readFileSync(skillPath, "utf8");
  const frontmatter = parseFrontmatter(content);
  return {
    slug: fallbackSlug,
    name: frontmatter.name ?? fallbackSlug,
    description: frontmatter.description ?? firstHeadingOrDescription(content) ?? "",
    path: skillPath,
  };
}

function parseFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith("---")) return {};
  const end = content.indexOf("\n---", 3);
  if (end === -1) return {};

  const metadata: Record<string, string> = {};
  for (const line of content.slice(3, end).split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    metadata[match[1]] = unquote(match[2].trim());
  }
  return metadata;
}

function firstHeadingOrDescription(content: string): string | undefined {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) return trimmed.slice(2).trim();
  }
  return undefined;
}

function unquote(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
