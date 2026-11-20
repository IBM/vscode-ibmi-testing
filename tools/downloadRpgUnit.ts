import path from "path";

import { Octokit } from "@octokit/rest";
import { existsSync, mkdirSync, statSync } from "fs";
import { writeFile } from "fs/promises";
import { LOCAL_SAVE_FILE, OWNER, REPO, GITHUB_SAVE_FILE, SERVER_VERSION_TAG } from "../src/components/rpgUnit/version";

async function work() {
  const distDirectory = path.join(`.`, `dist`);
  if (!existsSync(distDirectory)) {
    mkdirSync(distDirectory);
  }

  const saveFilePath = path.join(distDirectory, LOCAL_SAVE_FILE);
  if (exists(saveFilePath)) {
    console.log(`Existing RPGUnit save file found: ${LOCAL_SAVE_FILE}`);
    return;
  }

  try {
    const githubToken = process.env.GITHUB_TOKEN;
    const octokit = new Octokit({
      auth: githubToken,
      log: {
        debug: () => { },
        info: () => { },
        warn: () => { },
        error: () => { }
      }
    });

    if (githubToken) {
      try {
        const result = await octokit.rest.users.getAuthenticated();
        console.log(`Authenticated as:`, result.data.login);
      } catch (error) {
        console.log(`GitHub authentication failed: ${error}`);
      }
    } else {
      console.log(`No GitHub token provided`)
    }

    try {
      const result = await octokit.rest.rateLimit.get();
      console.log("GitHub API rate limits:");
      console.log(`  • Limit: ${result.data.resources.core.limit}`);
      console.log(`  • Used: ${result.data.resources.core.used}`);
      console.log(`  • Remaining: ${result.data.resources.core.remaining}`);
    } catch (error) {
      console.log("Not authenticated or invalid GitHub token");
    }

    const result = await octokit.request(`GET /repos/{owner}/{repo}/releases/tags/${SERVER_VERSION_TAG}`, {
      owner: OWNER,
      repo: REPO,
      headers: {
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    const newAsset = result.data.assets.find((a: any) => a.name === GITHUB_SAVE_FILE);
    if (newAsset) {
      console.log(`New RPGUnit save file found: ${newAsset.name}`);
      await downloadFile(newAsset.browser_download_url, saveFilePath);

      console.log(`Asset downloaded: ${saveFilePath}`);
      console.log(`Asset digest: ${newAsset.digest}`);
    } else {
      console.log(`Release ${SERVER_VERSION_TAG} found, but no asset named '${GITHUB_SAVE_FILE}' found.`);
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

function exists(localPath: string): boolean {
  try {
    statSync(localPath);
    return true;
  } catch (e) {
    return false;
  }
}

work();