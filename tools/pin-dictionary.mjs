// Resolve and fully verify a SudachiDict release before replacing the canonical
// runtime manifest. Every listed artifact is downloaded, hashed, and its exact
// dictionary member is streamed through `tar`; a partial verification never
// writes dictionary-releases.json.

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "dictionary-releases.json");
const requested = process.argv[2];

async function githubRelease() {
  const endpoint = requested
    ? `https://api.github.com/repos/WorksApplications/SudachiDict/releases/tags/v${requested}`
    : "https://api.github.com/repos/WorksApplications/SudachiDict/releases/latest";
  const response = await fetch(endpoint, { headers: { accept: "application/vnd.github+json", "user-agent": "kashiyomi-pin-dictionary", ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) } });
  if (!response.ok) throw new Error(`GitHub release metadata returned HTTP ${response.status}`);
  return response.json();
}

async function pypiCore(version) {
  const response = await fetch(`https://pypi.org/pypi/SudachiDict-core/${version}/json`);
  if (!response.ok) throw new Error(`PyPI Core metadata returned HTTP ${response.status}`);
  const body = await response.json();
  const wheel = body.urls?.find((candidate) => candidate.packagetype === "bdist_wheel");
  if (!wheel?.url) throw new Error(`PyPI has no Core wheel for ${version}`);
  return wheel;
}

function meter(hash) {
  let bytes = 0;
  const stream = new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; hash.update(chunk); callback(null, chunk); } });
  return { stream, bytes: () => bytes };
}

async function download(url, target) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`${url} returned HTTP ${response.status}`);
  if (!response.url.startsWith("https://")) throw new Error(`${url} downgraded away from HTTPS`);
  const hash = createHash("sha256");
  const measured = meter(hash);
  await pipeline(Readable.fromWeb(response.body), measured.stream, createWriteStream(target));
  return { bytes: measured.bytes(), sha256: hash.digest("hex") };
}

async function extract(archive, member, target) {
  const child = spawn("tar", ["-xOf", archive, member], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const errors = [];
  child.stderr.on("data", (chunk) => errors.push(chunk));
  const hash = createHash("sha256");
  const measured = meter(hash);
  await pipeline(child.stdout, measured.stream, createWriteStream(target));
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  if (code !== 0) throw new Error(`could not extract ${member}: ${Buffer.concat(errors).toString("utf8").trim()}`);
  return { bytes: measured.bytes(), sha256: hash.digest("hex") };
}

const work = await mkdtemp(path.join(tmpdir(), "kashiyomi-pin-"));
try {
  const github = await githubRelease();
  const version = String(github.tag_name ?? "").replace(/^v/u, "");
  if (!/^\d{8}$/u.test(version)) throw new Error(`invalid release tag ${github.tag_name}`);
  const coreWheel = await pypiCore(version);
  const fullName = `sudachidict_full-${version}-py3-none-any.whl`;
  const fullAsset = github.assets?.find((asset) => asset.name === fullName);
  if (!fullAsset?.browser_download_url) throw new Error(`${fullName} missing from ${github.tag_name}`);
  const cloudfront = "https://d2ej7fkh96fzlu.cloudfront.net/sudachidict";
  const definitions = {
    core: [
      { url: `${cloudfront}/sudachi-dictionary-${version}-core.zip`, member: `sudachi-dictionary-${version}/system_core.dic` },
      { url: coreWheel.url.replace("https://files.pythonhosted.org", "https://pypi.tuna.tsinghua.edu.cn"), member: "sudachidict_core/resources/system.dic" },
      { url: coreWheel.url, member: "sudachidict_core/resources/system.dic" },
    ],
    full: [
      { url: `${cloudfront}/sudachi-dictionary-${version}-full.zip`, member: `sudachi-dictionary-${version}/system_full.dic` },
      { url: fullAsset.browser_download_url, member: "sudachidict_full/resources/system.dic" },
    ],
  };
  const editions = {};
  for (const [edition, sources] of Object.entries(definitions)) {
    const verified = [];
    for (const [index, source] of sources.entries()) {
      const archive = path.join(work, `${edition}-${index}.archive`);
      const dictionary = path.join(work, `${edition}-${index}.dic`);
      process.stdout.write(`${edition} source ${index + 1}/${sources.length}: ${new URL(source.url).host}\n`);
      const archiveInfo = await download(source.url, archive);
      const dictionaryInfo = await extract(archive, source.member, dictionary);
      verified.push({ ...source, archiveBytes: archiveInfo.bytes, archiveSha256: archiveInfo.sha256, dictionaryBytes: dictionaryInfo.bytes, dictionarySha256: dictionaryInfo.sha256 });
    }
    const first = verified[0];
    if (!first || verified.some((item) => item.dictionaryBytes !== first.dictionaryBytes || item.dictionarySha256 !== first.dictionarySha256)) {
      throw new Error(`${edition} artifacts do not contain an identical dictionary`);
    }
    editions[edition] = {
      version,
      dictionaryBytes: first.dictionaryBytes,
      dictionarySha256: first.dictionarySha256,
      sources: verified.map(({ url, archiveBytes, archiveSha256, member }) => ({ url, archiveBytes, archiveSha256, member })),
    };
    process.stdout.write(`${edition}: ${first.dictionaryBytes} bytes ${first.dictionarySha256}\n`);
  }
  const manifest = { schemaVersion: 1, editions };
  const temporary = `${OUT}.new`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(temporary, OUT);
  const size = (await stat(OUT)).size;
  console.log(`wrote ${path.relative(process.cwd(), OUT)} (${size} bytes)`);
} finally {
  await rm(work, { recursive: true, force: true });
}
