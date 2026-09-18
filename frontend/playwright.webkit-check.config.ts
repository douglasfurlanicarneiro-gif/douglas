import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  outputDir: '../tmp/webkit-test-results',
  projects: [
    { name: 'celular', use: { ...devices['iPhone 15'], browserName: 'webkit' } },
    { name: 'computador', use: { browserName: 'webkit', viewport: { width: 1440, height: 900 } } },
  ],
});
