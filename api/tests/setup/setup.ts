import type { TestProject } from "vitest/node";
import { disposeConnection, createConnection } from "./connection";
import { existsSync } from "fs";
import path from "path";
import { JsonConfig, JsonStorage } from "./json";
import { TestEnv } from "./env";

export async function setup(project: TestProject) {
  console.log(`------------------------------`)
  TestEnv.logEnvironmentVariables();
  console.log(`------------------------------`)

  const jsonStoragePath = path.join(__dirname, `..`, JsonStorage.NAME);
  const jsonStorageExists = existsSync(jsonStoragePath);
  const jsonConfigPath = path.join(__dirname, `..`, JsonConfig.NAME);
  const jsonConfigExists = existsSync(jsonConfigPath);

  const configsExist = jsonStorageExists && jsonConfigExists;
  if (configsExist) {
    console.log(`⏩ JSON server cache storage and connection config found. Skipping connection setup.\n`);
  } else {
    console.log(`⏳ JSON server cache storage and connection config not found. Starting connection setup.\n`);
    const connection = await createConnection(true);
    await disposeConnection(connection);
    console.log(`✅ Connection setup complete.`);
  }
  console.log(`Server cache storage: ${jsonStoragePath}`)
  console.log(`Connection config: ${jsonConfigPath}`)
  console.log(`------------------------------\n`)
}

export async function teardown() { }