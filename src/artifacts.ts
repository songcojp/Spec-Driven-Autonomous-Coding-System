import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { BootstrapError } from "./errors.ts";

export const ARTIFACT_DIRECTORIES = ["memory", "specs", "reports", "runs"] as const;

export function ensureArtifactDirectories(artifactRoot: string): string[] {
  const createdPaths = ARTIFACT_DIRECTORIES.map((dir) => join(artifactRoot, dir));

  try {
    mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
    for (const path of createdPaths) {
      mkdirSync(path, { recursive: true, mode: 0o700 });
    }
  } catch (error) {
    throw new BootstrapError("artifact-directories", "Failed to create .autobuild artifact directories", {
      artifactRoot,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  return createdPaths;
}
