const { createDefaultPreset } = require("ts-jest");

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
module.exports = {
  testEnvironment: "node",
  transform: {
    ...tsJestTransformCfg,
  },
  moduleNameMapper: {
    "^vscode$": "<rootDir>/__mocks__/vscode",
    "^vscode-rpgle/language/parser$": "<rootDir>/__mocks__/parser",
    "^ansi-colors$": "<rootDir>/__mocks__/ansiColors",
    "^table$": "<rootDir>/__mocks__/table"
  },
};