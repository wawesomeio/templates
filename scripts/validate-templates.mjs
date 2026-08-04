/**
 * Validates every template manifest in the repository.
 *
 * Two kinds of check live here. The schema covers the shape of one manifest; the
 * invariants below cover what a schema cannot see — whether the directory the
 * manifest names is really there, whether the entry file it will be built from
 * exists, whether two templates have claimed the same name. Both run before a
 * commit can advance any stable tag, because a manifest is a promise the CLI
 * will act on without a human in the loop.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv/dist/2020.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const schema = readJson(join(repoRoot, "template.schema.json"));
const ajv = new Ajv({ allErrors: true, strict: false });
const validateManifest = ajv.compile(schema);

const problems = [];
const seenRefs = new Map();

const templateDirs = readdirSync(repoRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(repoRoot, entry.name, "template.json")))
  .map((entry) => entry.name)
  .sort();

if (templateDirs.length === 0) {
  recordProblem("repository", "No template directories found — a template is a directory containing template.json.");
}

for (const dir of templateDirs) {
  const manifest = readJson(join(repoRoot, dir, "template.json"));

  if (!validateManifest(manifest)) {
    for (const error of validateManifest.errors) {
      recordProblem(dir, `template.json${error.instancePath} ${error.message}`);
    }
    continue;
  }

  // The name is what a user types after --template *and* the directory the CLI
  // pulls out of the archive, so the two must not be able to disagree.
  if (manifest.name !== dir) {
    recordProblem(dir, `is named "${manifest.name}" in its manifest but lives in "${dir}".`);
  }

  // The schema's pattern already forbids a slash here — git cannot hold both a
  // ref named for a template and refs nested beneath it. This only catches two
  // templates racing for the same tag.
  duplicate(seenRefs, manifest.ref, dir, "ref");

  if (!manifest.post_deploy.includes("{{url}}")) {
    recordProblem(dir, "post_deploy never interpolates {{url}}, so the user is not told where their Function is.");
  }

  requireFile(dir, "package.json");
  requireFile(dir, "wawesome-function.json");
  requireFile(dir, "README.md");

  const pkgPath = join(repoRoot, dir, "package.json");
  if (existsSync(pkgPath)) {
    const pkg = readJson(pkgPath);
    // The CLI patches this field rather than generating the manifest, so a
    // template that ships without one would be scaffolded nameless.
    if (typeof pkg.name !== "string" || pkg.name.length === 0) {
      recordProblem(dir, "package.json has no name for the CLI to patch.");
    }
    if (!pkg.devDependencies?.wawesome && !pkg.dependencies?.wawesome) {
      recordProblem(dir, "package.json does not depend on the published wawesome CLI, so `npm install && npx wawesome deploy` would not work from a clone.");
    }
  }

  const configPath = join(repoRoot, dir, "wawesome-function.json");
  if (existsSync(configPath)) {
    const config = readJson(configPath);
    for (const field of ["app", "function", "entry"]) {
      if (typeof config[field] !== "string" || config[field].length === 0) {
        recordProblem(dir, `wawesome-function.json is missing "${field}".`);
      }
    }
    if (config.entry && !existsSync(join(repoRoot, dir, config.entry))) {
      recordProblem(dir, `wawesome-function.json points at entry "${config.entry}", which does not exist.`);
    }
  }

  // A template ships as a real project, so nothing a user will read or run may
  // still be waiting for a substitution pass that does not exist. template.json
  // is exempt: its post-deploy message carries the one surviving placeholder,
  // and that one only ever reaches a console.
  for (const file of sourceFiles(dir)) {
    if (/\{\{|__[A-Z_]+__/.test(readFileSync(join(repoRoot, dir, file), "utf-8"))) {
      recordProblem(dir, `${file} still contains a placeholder token; templates ship placeholder-free.`);
    }
  }
}

if (problems.length > 0) {
  console.error(`✗ ${problems.length} problem(s) found:\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(`✓ ${templateDirs.length} template(s) valid: ${templateDirs.join(", ")}`);

function recordProblem(scope, message) {
  problems.push(`${scope}: ${message}`);
}

function requireFile(dir, file) {
  if (!existsSync(join(repoRoot, dir, file))) recordProblem(dir, `is missing ${file}.`);
}

function duplicate(seen, value, dir, label) {
  const previous = seen.get(value);
  if (previous) recordProblem(dir, `${label} "${value}" is already used by ${previous}.`);
  else seen.set(value, dir);
}

/** Every file a user would read or run, relative to the template directory. */
function sourceFiles(dir, prefix = "") {
  const skip = new Set(["node_modules", "dist", "package-lock.json", "template.json"]);
  const files = [];

  for (const entry of readdirSync(join(repoRoot, dir, prefix), { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const relative = prefix ? join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) files.push(...sourceFiles(dir, relative));
    else if (statSync(join(repoRoot, dir, relative)).size > 0) files.push(relative);
  }

  return files;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    console.error(`✗ Could not read ${path}: ${error.message}`);
    process.exit(1);
  }
}
