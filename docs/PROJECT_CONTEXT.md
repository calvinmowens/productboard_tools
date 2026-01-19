# Productboard Scripts App - Project Context

## Overview
A multi-module web application for Productboard administrative tasks. Built with React + Vite + Tailwind CSS, using Convex as a backend to proxy API calls (avoiding CORS issues).

## Tech Stack
- **Frontend**: React 18, TypeScript, Tailwind CSS
- **Build**: Vite
- **Backend**: Convex (serverless functions for API proxying)
- **Routing**: React Router v6

## Project Structure
```
src/
├── App.tsx              # Main app with routes
├── main.tsx             # Entry point
├── types.ts             # Shared TypeScript types
├── pages/
│   └── Home.tsx         # Module selection tiles
└── modules/
    ├── custom-field-migration/index.tsx  # Migrate CF values
    ├── duplicate-notes/index.tsx         # Delete duplicate notes
    └── csv-import/index.tsx              # Import entities from CSV

convex/
├── productboard.ts      # V1 API actions (notes, companies, features)
├── productboardV2.ts    # V2 API actions (entities, configurations)
├── migrations.ts        # Migration-specific actions
└── schema.ts            # Database schema (minimal use)
```

## Modules

### 1. Custom Field Migration (`/custom-field-migration`)
Migrates values from one custom field to another across features.
- Uses V1 API: `GET /features`, `PATCH /features/{id}`
- Step-based workflow: Auth → Field Mappings → Preview → Execute

### 2. Delete Duplicate Notes (`/duplicate-notes`)
Finds and deletes duplicate notes attached to companies.
- Uses V1 API: `GET /notes`, `GET /companies`, `DELETE /notes/{id}`
- Groups notes by company, identifies duplicates by content hash
- Preview shows: timestamp, title, content, company name, source

### 3. CSV Import (`/csv-import`)
Imports entities from CSV files using V2 API.
- Uses V2 API: `GET /v2/entities/configurations`, `POST /v2/entities`
- Workflow: Auth → Upload CSV → Select Entity Type → Select Parent Type → Map Columns → Preview → Execute → Handle Duplicates
- Supports: products, components, features, subfeatures, initiatives, objectives, keyResults, releases, releaseGroups

## API Documentation Links
Each module displays relevant API docs at the top:
- Features: https://developer.productboard.com/reference/getfeatures
- Notes: https://developer.productboard.com/reference/getnotes
- Companies: https://developer.productboard.com/reference/getcompanies
- V2 Entities: https://developer.productboard.com/reference/v2getentities

## Key Patterns

### Step Headers
All modules use consistent step header styling:
- Active/incomplete: Blue circle with step number
- Completed: Green circle with white checkmark
- Step remains visible after completion with summary info

### Entity Parent Relationships (V2 API)
Defined in `convex/productboardV2.ts`:
```typescript
PARENT_TYPE_MAP = {
  product: [],
  component: ['product'],
  feature: ['product', 'component'],      // Parent REQUIRED
  subfeature: ['feature'],                 // Parent REQUIRED
  initiative: [],
  objective: ['initiative'],
  keyResult: ['objective'],
  release: ['releaseGroup'],
  releaseGroup: [],
}
```

### CSV Import Column Mapping
- Limited to first 10 columns displayed
- Fields sorted: name first, description second, then alphabetical
- Parent field appears when parent type is selected

## Running the App
```bash
# Terminal 1: Start Convex backend
npx convex dev

# Terminal 2: Start Vite dev server
npm run dev
```

## Environment
Requires Productboard API key (entered in each module's UI).
API calls are proxied through Convex actions to avoid CORS.

## UI Conventions
- No emojis in content unless user requests
- Cancel buttons in bottom-right of each step
- Blue/green color scheme for progress indicators
- Left-aligned content in previews
