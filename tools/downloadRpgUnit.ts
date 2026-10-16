import path from "path";

import { Octokit } from "@octokit/rest";
import { existsSync, mkdirSync, readdirSync, rmSync } from "fs";
import { writeFile } from "fs/promises";
import { RPGUnitInfo } from "../src/components/rpgUnit/info";

async function work() {
  // Ensure the dist directory exists
  const distDirectory = path.join(`.`, `dist`);
  if (!existsSync(distDirectory)) {
    mkdirSync(distDirectory);
  }

  // Remove any stale save files that don't match the current version
  for (const file of readdirSync(distDirectory)) {
    if (file.startsWith(RPGUnitInfo.LIBRARY_NAME) && file !== RPGUnitInfo.LOCAL_SAVE_FILE) {
      const stale = path.join(distDirectory, file);
      rmSync(stale);
      console.log(`Removed stale ${RPGUnitInfo.FRAMEWORK_NAME} save file: ${file}`);
    }
  }

  // Skip download if the current version is already present
  const saveFilePath = path.join(distDirectory, RPGUnitInfo.LOCAL_SAVE_FILE);
  if (existsSync(saveFilePath)) {
    console.log(`Existing ${RPGUnitInfo.FRAMEWORK_NAME} save file found: ${RPGUnitInfo.LOCAL_SAVE_FILE}`);
    return;
  }

  try {
    // Fetch the release from GitHub and download the save file asset
    const octokit = new Octokit();
    const result = await octokit.request(`GET /repos/{owner}/{repo}/releases/tags/${RPGUnitInfo.SERVER_VERSION_TAG}`, {
      owner: RPGUnitInfo.OWNER,
      repo: RPGUnitInfo.REPO,
      headers: {
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    const newAsset = result.data.assets.find((a: any) => a.name === RPGUnitInfo.GITHUB_SAVE_FILE);
    if (newAsset) {
      console.log(`New ${RPGUnitInfo.FRAMEWORK_NAME} save file found: ${newAsset.name}`);
      await downloadFile(newAsset.browser_download_url, saveFilePath);

      console.log(`Asset downloaded: ${saveFilePath}`);
      console.log(`Asset digest: ${newAsset.digest}`);
    } else {
      console.log(`Release ${RPGUnitInfo.SERVER_VERSION_TAG} found, but no asset named '${RPGUnitInfo.GITHUB_SAVE_FILE}' found.`);
      process.exit(1);
    }
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

function downloadFile(url: string, outputPath: string): Promise<void> {
  return fetch(url)
    .then(x => x.arrayBuffer())
    .then(x => writeFile(outputPath, Buffer.from(x)));
}

work();