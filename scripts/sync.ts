/**
 * CLI: npm run sync -- [--dry-run] [--template <id>]
 *
 *   --dry-run   Print the diff between source and template, plus the target environments,
 *               without writing anything to Contentful.
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

async function main() {
  const { getConfig } = await import("../src/lib/config");
  const { syncTemplate, getTemplate } = await import("../src/lib/template");
  const { listTargets } = await import("../src/lib/installations");
  const { runSync } = await import("../src/lib/sync");
  const { describeError } = await import("../src/lib/cma");

  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const tIdx = args.indexOf("--template");
  const cfg = getConfig();
  const ids = tIdx >= 0 && args[tIdx + 1] ? [args[tIdx + 1]] : cfg.TEMPLATE_IDS;

  console.log(`Source: ${cfg.SOURCE_SPACE_ID}/${cfg.SOURCE_ENVIRONMENT_ID}   Mode: ${cfg.AUTO_INSTALL_MODE}   ${dryRun ? "DRY RUN (no writes)" : ""}\n`);

  for (const id of ids) {
    const template = await getTemplate(id);
    console.log(`Template ${id} — "${template.name}" — latest v${template.sys.version}`);

    if (dryRun) {
      const res = await syncTemplate(id, { dryRun: true });
      if (res.status === "dry-run" && res.classification) {
        console.log(`  Would create v${(res.fromVersion ?? 0) + 1}: ${res.classification.classification.toUpperCase()}`);
        for (const c of res.classification.changes) {
          console.log(`   ${c.kind === "breaking" ? "▲ breaking" : "+ additive"}  ${c.contentTypeId}: ${c.detail}`);
        }
        const hold = cfg.AUTO_INSTALL_MODE === "manual" || (cfg.AUTO_INSTALL_MODE === "additive-only" && res.classification.classification === "breaking");
        console.log(`  Rollout: ${hold ? "HELD (would not auto-install)" : "automatic"}`);
      } else {
        console.log(`  No changes: ${res.reason ?? res.status}`);
      }
      const targets = await listTargets(id);
      console.log(`  Target environments (${targets.length}):`);
      for (const t of targets) {
        console.log(`   - ${t.spaceId}/${t.environmentId}  installed v${t.installedVersion} (${t.installationStatus})`);
      }
    } else {
      const out = await runSync(id);
      console.log(`  Sync: ${out.sync.status}${out.sync.toVersion ? ` → v${out.sync.toVersion}` : ""} ${out.sync.classification ? `(${out.sync.classification.classification})` : ""}`);
      if (out.rollout) {
        console.log(`  Rollout: ${out.rollout.held ? "held" : "executed"}`);
        for (const r of out.rollout.results) console.log(`   - ${r.spaceId}/${r.environmentId}: ${r.outcome}${r.error ? ` (${r.error})` : ""}`);
      }
    }
    console.log();
  }
  void describeError;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
