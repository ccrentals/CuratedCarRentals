# Responsive Testing (Playwright)

This project includes a viewport screenshot suite for key public routes:

- `/`
- `/fleet`
- `/book`
- `/contact`

Configured device profiles:

- iPhone (`390x844`)
- Android (`360x800`)
- iPad (`768x1024`)
- Desktop (`1440x900`)

## Install browser binaries

Run once after installing dependencies:

```bash
npx playwright install chromium
```

## Run responsive checks

```bash
npm run test:e2e
```

This compares screenshots against stored baselines and fails on visual regressions.

## Update baseline snapshots

```bash
npm run test:e2e:update
```

Use this only when intentional visual changes are expected.

## Notes

- E2E runs start a local dev server on port `4173` by default.
- The development breakpoint overlay is disabled during screenshot tests.
- HTML reports are generated in `playwright-report/`.
