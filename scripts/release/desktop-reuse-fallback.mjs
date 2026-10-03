import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { constants } from "node:fs";
import { copyFile, link, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

export const DESKTOP_REUSE_PATHS = [
  "downloads/AWH-macOS-arm64.zip",
  "downloads/AWH-macOS-x64.zip",
  "downloads/AWH-Windows-x64.zip",
  "downloads/SHA256SUMS.txt",
];

const SHA40 = /^[0-9a-f]{40}$/;
const SHA64 = /^[0-9a-f]{64}$/;
const RELEASE_ID = /^[A-Za-z0-9._-]{1,80}$/;

async function sha256File(path) {
  const hash = createHash("sha256");
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

async function inspectFile(path, entry) {
  let info;
  try { info = await lstat(path); }
  catch (error) {
    if (error?.code === "ENOENT") return "MISSING";
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size !== entry.sizeBytes) return "CORRUPT";
  return (await sha256File(path)) === entry.sha256 ? "VERIFIED" : "CORRUPT";
}

function markerPath(releaseSha, markerRoot) {
  if (!SHA40.test(releaseSha)) throw new Error("Desktop reuse fallback release SHA is invalid");
  return join(markerRoot, `awh-desktop-reuse-fallback-${releaseSha}.json`);
}

function baseEntry(baseManifest, path) {
  const matches = Array.isArray(baseManifest?.files) ? baseManifest.files.filter(item => item?.path === path) : [];
  if (matches.length !== 1) throw new Error(`Verified desktop recovery source is missing or ambiguous: ${path}`);
  const entry = matches[0];
  if (!SHA64.test(entry.sha256 ?? "") || !Number.isInteger(entry.sizeBytes) || entry.sizeBytes < 1) throw new Error(`Verified desktop recovery source metadata is invalid: ${path}`);
  return { path, sha256: entry.sha256, sizeBytes: entry.sizeBytes };
}

export async function prepareDesktopReuseFallbacks({ input, baseManifest, releaseSha, paths, webRoot = "/var/www/awh-web", markerRoot = tmpdir() }) {
  if (!Array.isArray(paths) || paths.some(path => !DESKTOP_REUSE_PATHS.includes(path))) throw new Error("Desktop reuse fallback paths are invalid");
  if (!RELEASE_ID.test(baseManifest?.releaseId ?? "")) throw new Error("Verified desktop recovery release identity is invalid");
  const marker = markerPath(releaseSha, markerRoot);
  await rm(marker, { force: true });
  if (paths.length === 0) return [];

  const resolvedWebRoot = resolve(webRoot);
  const releasesRoot = await realpath(join(resolvedWebRoot, "releases"));
  const currentRoot = await realpath(join(resolvedWebRoot, "current"));
  if (!currentRoot.startsWith(`${releasesRoot}${sep}`)) throw new Error("Verified desktop recovery release path is invalid");
  let currentManifest;
  try { currentManifest = JSON.parse(await readFile(join(currentRoot, "release.json"), "utf8")); }
  catch { throw new Error("Verified desktop recovery release manifest is unavailable"); }
  const identityMatches =
    currentManifest?.schemaVersion === baseManifest.schemaVersion &&
    currentManifest?.releaseId === baseManifest.releaseId &&
    currentManifest?.sourceSha === baseManifest.sourceSha &&
    currentManifest?.sourceState === baseManifest.sourceState &&
    currentManifest?.product === baseManifest.product &&
    (!SHA64.test(baseManifest.webBundleSha256 ?? "") || currentManifest?.webBundleSha256 === baseManifest.webBundleSha256);
  if (!identityMatches) throw new Error("Verified desktop recovery release is no longer current");
  const sourceRoot = currentRoot;
  const storeRoot = resolve(resolvedWebRoot, "desktop-artifacts");
  const outputRoot = resolve(input);
  const fallback = [];

  for (const path of [...new Set(paths)]) {
    const entry = baseEntry(baseManifest, path);
    const storeObject = join(storeRoot, `${entry.sha256}-${basename(path)}`);
    const storeState = await inspectFile(storeObject, entry);
    if (storeState === "VERIFIED") continue;
    if (storeState === "CORRUPT") throw new Error(`Desktop artifact store object is inconsistent: ${path}`);

    const source = join(sourceRoot, path);
    if (await inspectFile(source, entry) !== "VERIFIED") throw new Error(`Verified desktop recovery source is unavailable: ${path}`);
    const destination = join(outputRoot, path);
    const existing = await inspectFile(destination, entry);
    if (existing === "CORRUPT") throw new Error(`Desktop reuse fallback output is inconsistent: ${path}`);
    if (existing === "MISSING") {
      await mkdir(dirname(destination), { recursive: true });
      try { await link(source, destination); }
      catch (error) {
        if (error?.code !== "EXDEV") throw error;
        await copyFile(source, destination, constants.COPYFILE_EXCL);
      }
      if (await inspectFile(destination, entry) !== "VERIFIED") throw new Error(`Desktop reuse fallback could not be materialized: ${path}`);
    }
    fallback.push(path);
  }

  if (fallback.length > 0) {
    await mkdir(markerRoot, { recursive: true });
    const temp = `${marker}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify({ schemaVersion: 1, releaseSha, paths: fallback })}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temp, marker);
  }
  return fallback;
}

export async function consumeDesktopReuseFallbacks({ releaseSha, markerRoot = tmpdir() }) {
  const marker = markerPath(releaseSha, markerRoot);
  let raw;
  try { raw = await readFile(marker, "utf8"); }
  catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  await rm(marker, { force: true });
  let document;
  try { document = JSON.parse(raw); }
  catch { throw new Error("Desktop reuse fallback marker is invalid"); }
  if (document?.schemaVersion !== 1 || document?.releaseSha !== releaseSha || !Array.isArray(document?.paths) || document.paths.some(path => !DESKTOP_REUSE_PATHS.includes(path)) || new Set(document.paths).size !== document.paths.length) throw new Error("Desktop reuse fallback marker is invalid");
  return document.paths;
}
