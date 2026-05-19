# Testing Setup — Phase 7

## Required Dependencies

Run the following command to install testing dependencies:

```bash
npm install --save-dev \
  vitest \
  @vitest/ui \
  @testing-library/react \
  @testing-library/jest-dom \
  @testing-library/user-event \
  jsdom \
  msw \
  @vitest/coverage-v8
```

## Files Created

1. **vitest.config.ts** — Vitest configuration
2. **src/tests/setup.ts** — Global test setup
3. **src/tests/mocks/handlers.ts** — MSW API handlers
4. **src/tests/mocks/server.ts** — MSW server configuration
5. **src/pages/v2/DecisionViewV2.test.tsx** — DecisionViewV2 unit tests

## Available Scripts

After installation, the following npm scripts are available:

- `npm run test` — Run all tests once
- `npm run test:watch` — Run tests in watch mode (re-runs on file changes)
- `npm run test:ui` — Open Vitest UI in browser
- `npm run test:coverage` — Generate coverage report

## Running Tests

```bash
# Install dependencies first
cd client
npm install

# Run tests
npm run test

# Or run in watch mode during development
npm run test:watch
```

## Test Structure

```
client/src/
├── tests/
│   ├── setup.ts              # Global test configuration
│   └── mocks/
│       ├── handlers.ts       # MSW request handlers
│       └── server.ts         # MSW server setup
└── pages/v2/
    ├── DecisionViewV2.tsx
    └── DecisionViewV2.test.tsx  # Component tests
```

## What's Tested

### DecisionViewV2 Test Suite

1. **Loading State**
   - Shows loading spinner while fetching
   - Displays "Loading decision feed..." message

2. **Success State**
   - Renders feed header with campaign/alert counts
   - Renders DecisionTrustCluster for each alert
   - Shows execute button for READY alerts

3. **Empty State**
   - Shows "No Decisions Pending" when no alerts
   - Displays call-to-action message

4. **Error State**
   - Shows error view when API fails
   - Displays retry button
   - Retries API call on button click

5. **Execution Flow**
   - Calls execute API when button clicked
   - Prevents duplicate execution (Set-based deduplication)

6. **Telemetry Tracking**
   - Tracks render time on mount/unmount
   - Logs route_render event

## Mock Service Worker (MSW)

MSW intercepts API requests during tests and returns mock responses:

- `GET /api/lumi/feed` → Returns mock campaign feed
- `POST /api/execute/meta` → Returns success response
- `POST /api/execute/meta/error` → Returns error (for error testing)

## Next Steps

After dependencies are installed, you can:

1. Run tests: `npm run test`
2. Add tests for other components (hooks, views, selectors)
3. Increase coverage target (currently no minimum threshold)
4. Add CI integration (GitHub Actions workflow)
