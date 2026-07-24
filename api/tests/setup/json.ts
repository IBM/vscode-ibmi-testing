import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { Config } from "vscode-ibmi/src/api/configuration/config/VirtualConfig";
import { BaseStorage } from "vscode-ibmi/src/api/configuration/storage/BaseStorage";

class JSONMap extends Map<string, any> {
  private readonly filePath: string;

  constructor(filePath: string) {
    if (existsSync(filePath)) {
      const fileContent = readFileSync(filePath).toString(`utf-8`);
      const parsedFileContent = JSON.parse(fileContent);
      super(Object.entries(parsedFileContent));
    }
    else {
      super();
    }

    this.filePath = filePath;
  }

  save() {
    return writeFileSync(this.filePath, JSON.stringify(Object.fromEntries(this), null, 2));
  }
}

export class JsonStorage extends BaseStorage {
  public static readonly NAME = `.storage.json`;
  private readonly config: JSONMap;

  constructor() {
    const jsonMap = new JSONMap(path.join(__dirname, `..`, JsonStorage.NAME));
    super(jsonMap);
    this.config = jsonMap;
  }

  public save() {
    this.config.save();
  }
}

export class JsonConfig extends Config {
  public static readonly NAME = `.config.json`;
  private readonly config: JSONMap = new JSONMap(path.join(__dirname, `..`, JsonConfig.NAME));

  get<T>(key: string): T | undefined {
    return this.config.get(key) as T | undefined;
  }

  async set(key: string, value: any): Promise<void> {
    this.config.set(key, value);
  }

  public save() {
    this.config.save();
  }
}