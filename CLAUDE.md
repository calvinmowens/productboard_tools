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

# Run linter and check TypeScript
npm run lint

# Fix linting issues automatically
npm run lint:fix

# Preview production build
npm run preview

# Prepare husky hooks (runs on npm install)
npm run prepare
```

Access the app at http://localhost:5173

### Development Workflow

**Default: Create PR, get Claude review, then merge**

1. **Create a branch** for your feature/fix
2. **Commit locally** with validated messages:
   - Pre-commit hooks (Husky) auto-run: ESLint fix, TypeScript check, commit message format validation
   - If validation fails, fix and retry `git commit`
3. **Push to GitHub** and **create a PR** (via `gh pr create` or GitHub UI)
4. **Request Claude review** in your next session:
   - Say "Review PR #123" and I'll analyze the code changes
   - I'll check against patterns in `@docs/CODE_PATTERNS.md` and `@docs/CODE_STANDARDS.md`
5. **Address feedback** if any, push fixes
6. **Merge to main** once approved

**Commit format**: `type: description` where type is `feat`, `fix`, `refactor`, `docs`, `chore`, `style`, `test`, or `perf` (max 72 chars)

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
  initiative: ['objective'],                     // Top-level, no parent
  objective: ['objective'],          // Optional parent
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

### UI and Component Standards
- **No emojis**: Don't add emojis to UI content unless explicitly requested
- **Cancel buttons**: Always bottom-right of each step
- **Color scheme**: Blue for active, green for complete
- **API docs**: Display relevant Productboard API documentation links at top of each module
- **Left-aligned content**: Previews and results use left-aligned layout

### Code Organization
- **Module structure**: Each module in `src/modules/` is self-contained with index.tsx as entry point
- **Avoid prop drilling**: Use React Context for module-level state
- **API communication**: All Productboard API calls route through Convex actions (no direct fetch)
- **Error handling**: Catch and display user-friendly error messages, avoid console logging errors
- **Type safety**: Define interfaces in `src/types.ts` for shared data structures

### Code Standards
- **No `console.log`**: Use `console.warn` or `console.error` for debugging (linter enforces this)
- **Type safety**: Prefer specific types over `any`; linter warns on untyped values
- **Code formatting**: Prettier config (`printWidth: 100`, 2-space indent, single quotes) auto-applied by linter
- **Unused variables**: Prefix with `_` to suppress warnings (e.g., `_unused`)

### Git Commit Conventions

**Format**: `type: description` where type is `feat`, `fix`, `refactor`, `docs`, `chore`, `style`, `test`, or `perf`

**Examples**:
```
feat: Add CSV company import module
fix: Resolve custom field migration pagination bug
docs: Update CLAUDE.md with development guidelines
refactor: Extract API call logic to shared utility
```

Commit message validation runs automatically via Husky—message must be properly formatted to commit.

### PR Review Process

When requesting Claude review of a PR:
- **Provide PR number** (e.g., "Review PR #123") or **PR URL**
- I'll analyze code changes against project patterns and conventions
- I'll check for: type safety, code organization, API patterns, error handling, adherence to CODE_PATTERNS.md
- I'll suggest improvements or approve if ready to merge
- You address feedback, push fixes, then request re-review if needed

**Quick PR creation**:
```bash
git push -u origin your-branch-name
gh pr create --title "your title" --body "your description"
```

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

### Deploying Convex Functions

The Vite build (`npm run build`) only builds the frontend. Convex functions must be deployed separately:

```bash
# Login to Convex (first time only)
npx convex login

# Deploy functions to production
npx convex deploy -y
```

### Important: Vite Environment Variables

Vite bakes environment variables at **build time**, not runtime. If you update `VITE_CONVEX_URL` in Vercel:
1. You must trigger a **new build** (not just redeploy)
2. Uncheck "Use existing Build Cache" when redeploying
3. Otherwise the old URL remains in the JavaScript bundle

## Productboard API Documentation

Reference links displayed in module UIs:
- Features: https://developer.productboard.com/reference/getfeatures
- Notes: https://developer.productboard.com/reference/getnotes
- Create Note: https://developer.productboard.com/reference/create_note
- Companies: https://developer.productboard.com/reference/getcompanies
- V2 Entities: https://developer.productboard.com/reference/v2getentities

## Maintaining Context for Claude Sessions

### CLAUDE.md Maintenance (Token Efficiency)

This file is auto-loaded by Claude Code—keep it under 5,000 tokens by:

1. **Quick Reference Format**: Use short bullet points, code examples, and sections
2. **Remove Outdated Info**: Delete TODO items when completed, remove old bugs
3. **Link to Docs**: For detailed specs, reference `docs/` folder instead of expanding here
   - Example: "See `@docs/api-integration-details.md` for V1/V2 endpoint specifications"
4. **Update After Major Changes**:
   - Add new module patterns to "Code Organization" section
   - Update architecture if file structure changes
   - Add newly discovered constraints or gotchas to "Key Implementation Details"
5. **Keep Sections Current**:
   - **Known Bugs**: Track only active issues (delete once fixed)
   - **Next TODOs**: Track only current sprint work (archive completed items)
   - **Incomplete Test Scenarios**: Document edge cases affecting future work

### Adding New Modules

When creating a new module:
1. Add to "Frontend Structure" diagram with brief purpose
2. Document its API version (V1/V2) in "API Version Usage"
3. Add workflow pattern to "Module Workflow Pattern" if different from standard
4. List any unique implementation details in "Key Implementation Details"
5. Commit with message: `feat: Add <module-name> module`

### Documentation Best Practices

- **This file**: Architecture, patterns, quick reference (under 5k tokens)
- **`docs/` folder**: Detailed specs, implementation guides, troubleshooting
- **Inline comments**: Only for non-obvious logic (don't comment what code does, explain why)
- **Commit messages**: Use conventional format to auto-document changes
- **Code organization**: Clear file/function names reduce need for comments

## Known Bugs

(Track bugs discovered during development here)

- None currently tracked

## Next TODOs / Upcoming Work

(Track planned features, improvements, and active work here)

- None currently tracked

## Incomplete Test Scenarios

(Track test cases that need implementation or edge cases to handle)

- None currently tracked

## Additional Documentation

For detailed guides, load these files as needed:

- **`@docs/DEVELOPMENT_GUIDE.md`**: Code organization, patterns, debugging, deployment
- **`@docs/CODE_PATTERNS.md`**: Reusable component/utility patterns with examples
- **`@docs/CODE_STANDARDS.md`**: Linting rules, TypeScript config, debugging errors
- **`@docs/PR_REVIEW_CHECKLIST.md`**: What Claude checks when reviewing PRs

---

**Note**: This file is auto-loaded by Claude Code at session start. Keep under 5,000 tokens. For detailed supplementary docs, use `docs/` folder and load manually with `@docs/filename.md`.
