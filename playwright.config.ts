import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir:"tests/e2e", workers:1, timeout:process.env.CLORIX_TEST_ORIGIN?90000:60000, retries:0,
  expect:{timeout:process.env.CLORIX_TEST_ORIGIN?15000:5000},
  reporter:[["list"],["json",{outputFile:"artifacts/private/browser-results.json"}]],
  use:{
    baseURL:process.env.CLORIX_TEST_ORIGIN??"http://localhost:3000",
    headless:true, viewport:{width:1440,height:1000},
    channel:process.env.CI?"chromium":"chrome",
    trace:"off", screenshot:"off", video:"off",
  },
});
