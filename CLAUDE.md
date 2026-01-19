# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A multi-module React web application for Productboard administrative tasks: migrating custom field values, deleting duplicate notes, importing entities from CSV, bulk updating features from CSV, and importing notes from CSV. Uses Convex as a serverless backend to proxy Productboard API calls (avoiding CORS issues).

**Tech Stack**: React 19 + TypeScript + Vite + Tailwind CSS 4 + Convex

## Development Commands

```bash
# Install dependencies
npm install

# Initialize Convex (first time only - creates project and configures .env.local)
npx convex dev

# Start development servers (runs Vite + Convex in parallel)
npm run dev

# Start frontend only
npm run dev:frontend

# Start Convex backend only
npm run dev:backend

# Build for production
npm run build

# Run linter
npm run lint

# Preview production build
npm run preview
```

Access the app at http://localhost:5173

## Architecture

### Frontend Structure
```
src/
├── App.tsx              # Routes: /, /custom-field-migration, /duplicate-notes, /csv-import, /csv-bulk-update, /csv-note-import
├── main.tsx             # Convex provider + React entry point
├── types.ts             # Shared TypeScript interfaces
├── pages/
│   └── Home.tsx         # Module selection landing page
└── modules/             # Each module is a self-contained feature
    ├── custom-field-migration/index.tsx
    ├── duplicate-notes/index.tsx
    ├── csv-import/index.tsx
    ├── csv-bulk-update/index.tsx
    └── csv-note-import/index.tsx
```

### Backend Structure (Convex)
```
convex/
├── productboard.ts      # V1 API actions (features, notes, companies)
├── productboardV2.ts    # V2 API actions (entities, configurations)
├── migrations.ts        # Migration-specific actions and logging
└── schema.ts            # Database schema (minimal usage)
```

### API Version Usage
- **V1 API** (`productboard.ts`): Custom field migration, duplicate notes, CSV bulk update, CSV note import
  - Endpoints: `/features`, `/notes`, `/companies`, `/hierarchy-entities/custom-fields`
- **V2 API** (`productboardV2.ts`): CSV entity import
  - Endpoints: `/v2/entities`, `/v2/entities/configurations`

### Module Workflow Pattern

All five modules follow a consistent step-based workflow:
1. **Authentication**: Enter Productboard API token, validate via Convex action
2. **Configuration**: Select fields/entity types, upload CSV, map columns
3. **Preview**: Show what will change before execution
4. **Execute**: Perform operations, display results with success/failure counts

### Step UI Convention

Each step uses consistent visual states:
- **Active/Incomplete**: Blue circle with step number
- **Completed**: Green circle with white checkmark
- Steps remain visible after completion with summary information

### Convex Action Pattern

All API calls are proxied through Convex actions:
```typescript
// Frontend calls Convex action
const result = await useAction(api.productboard.getFeatures)({ apiToken });

// Convex action makes actual API call (avoids CORS)
export const getFeatures = action({
  handler: async (_, { apiToken }) => {
    const response = await fetch("https://api.productboard.com/...", {
      headers: { Authorization: `Bearer ${apiToken}` }
    });
    return await response.json();
  }
});
```

## Key Implementation Details

### Entity Parent Relationships (V2 API)

Defined in `convex/productboardV2.ts`:
```typescript
PARENT_TYPE_MAP = {
  product: [],                        // Top-level, no parent
  component: ['product'],             // Optional parent
  feature: ['product', 'component'],  // Parent REQUIRED
  subfeature: ['feature'],            // Parent REQUIRED
  initiative: [],                     // Top-level, no parent
  objective: ['initiative'],          // Optional parent
  keyResult: ['objective'],           // Optional parent
  release: ['releaseGroup'],          // Optional parent
  releaseGroup: [],                   // Top-level, no parent
}
```

**Important**: Features and subfeatures MUST have a parent when created via V2 API.

### CSV Import Field Mapping

- Limited to first 10 CSV columns displayed in UI
- Entity fields sorted: `name` first, `description` second, then alphabetical
- Parent field appears dynamically when parent type is selected
- Uses `searchEntityByName` to resolve parent names to IDs

### Custom Field Migration

Uses V1 API with pagination:
- Fetches all features (100 per page via `pageCursor`)
- Reads custom field values via `/hierarchy-entities/custom-fields-values/value`
- Updates via `PATCH /features/{id}` with `customFields` object

### Duplicate Note Detection

Groups notes by company, identifies duplicates by:
1. Content hash (first 100 chars)
2. Title similarity
3. Multiple notes from same source on same timestamp

### CSV Bulk Update

Uses V1 API to update existing features:
- CSV must have a column with feature UUIDs
- Maps value columns to custom fields
- Supports multiple value columns for batch updates
- Updates via `PATCH /features/{id}` with `customFields` object
- Validates features exist before update (preview step)

### CSV Note Import

Uses V1 API to create notes from CSV:
- Checkbox-based column mapping (not dropdown)
- Multi-select fields: Title (comma-separated), Note Text (HTML), Tags (array)
- Single-select fields: User Email, Owner
- Drag-and-drop reordering when multiple columns selected
- Note Text format: `<b>Column Header</b><br>Value<br><br>` for each mapped column
- Creates via `POST /notes` with title, content, user, owner, tags
- Failed rows exported to `failure_report.csv` for troubleshooting

## Code Conventions

- **No emojis**: Don't add emojis to UI content unless explicitly requested
- **Cancel buttons**: Always bottom-right of each step
- **Color scheme**: Blue for active, green for complete
- **API docs**: Display relevant Productboard API documentation links at top of each module
- **Left-aligned content**: Previews and results use left-aligned layout

## Environment Variables

`.env.local` (auto-generated by `npx convex dev`):
```
VITE_CONVEX_URL=https://your-deployment.convex.cloud
```

No Productboard API keys stored in env - users enter tokens in each module's UI.

## Deployment

**GitHub**: https://github.com/calvinmowens/productboard_tools

**Production URL**: https://productboardtools.vercel.app

**Hosting**: Vercel (auto-deploys on push to `main` branch)

**Convex Production URL**: https://steady-dove-51.convex.cloud

Vercel environment variable:
- `VITE_CONVEX_URL` = `https://steady-dove-51.convex.cloud`

## Productboard API Documentation

Reference links displayed in module UIs:
- Features: https://developer.productboard.com/reference/getfeatures
- Notes: https://developer.productboard.com/reference/getnotes
- Create Note: https://developer.productboard.com/reference/create_note
- Companies: https://developer.productboard.com/reference/getcompanies
- V2 Entities: https://developer.productboard.com/reference/v2getentities

## Known Bugs

(Track bugs discovered during development here)

- None currently tracked

## Next TODOs / Upcoming Work

(Track planned features, improvements, and active work here)

- None currently tracked

## Incomplete Test Scenarios

(Track test cases that need implementation or edge cases to handle)

- None currently tracked

---

**Note**: This file is auto-loaded by Claude Code at session start. Keep under 5,000 tokens. For detailed supplementary docs, use `docs/` folder and load manually with `@docs/filename.md`.
