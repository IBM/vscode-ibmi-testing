import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, 'tests'), '');
  Object.assign(process.env, env);

  return {
    test: {
      globalSetup: ['./tests/setup/setup.ts'],
      coverage: {
        include: [
          '**/*.ts'
        ],
        exclude: [
          'api/tests/setup'
        ],
        reporter: ['text', 'json', 'json-summary'],
        reportOnFailure: true
      }
    }
  };
});