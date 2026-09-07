import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";

/** Base sources are bundled into consumers. Include transitive dependents
 * before restarting Electron; runtime-only changes still rebuild just itself. */
export async function affectedPluginRoots(sourceRoots, changedRoots) {
  const packages = [];
  for (const sourceRoot of sourceRoots) {
    for (const entry of await fs.readdir(sourceRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const root = resolve(sourceRoot, entry.name);
      const manifest = JSON.parse(await fs.readFile(join(root, "termco-plugin.json"), "utf8"));
      const pkg = JSON.parse(await fs.readFile(join(root, "package.json"), "utf8"));
      packages.push({ root, name: pkg.name, dependencies: { ...pkg.dependencies, ...manifest.dependencies } });
    }
  }
  const affected = new Set(changedRoots.map((root) => resolve(root)));
  let expanded = true;
  while (expanded) {
    expanded = false;
    const names = new Set(packages.filter((pkg) => affected.has(pkg.root)).map((pkg) => pkg.name));
    for (const pkg of packages) {
      if (!affected.has(pkg.root) && Object.keys(pkg.dependencies).some((name) => names.has(name))) {
        affected.add(pkg.root);
        expanded = true;
      }
    }
  }
  return [...affected];
}
