# Custom Field Migration Tool

A web application to migrate values between Productboard custom fields. Built with Vite, React, Tailwind CSS, and Convex.

## Features

- API token authentication with Productboard
- Dynamic loading of custom fields from your Productboard workspace
- Field mapping with source/target dropdowns
- Preview changes before executing
- Option to only copy to empty target fields
- Progress tracking during migration
- Execution results with success/failure counts

## Setup

### Prerequisites

- Node.js 18+
- A Convex account (free at https://convex.dev)

### Installation

1. Install dependencies:
   ```bash
   cd productboard_tools
   npm install
   ```

2. Initialize Convex (first time only):
   ```bash
   npx convex dev
   ```
   - This will prompt you to log in to Convex
   - Create a new project when prompted
   - The `.env.local` file will be automatically updated with your Convex URL

3. Run the development server:
   ```bash
   npm run dev
   ```

   This runs both Vite (frontend) and Convex (backend) in parallel.

4. Open http://localhost:5173 in your browser

## Usage

1. Enter your Productboard API token and click "Connect"
2. Select the source field (copy FROM)
3. Select the target field (copy TO)
4. Optionally configure:
   - "Only copy to empty target fields" - skip features that already have a target value
   - "Preview changes before executing" - see what will be changed
5. Click "Load Preview" to see a preview of changes
6. Click "Execute Migration" to perform the migration

## Project Structure

```
productboard_tools/
├── convex/                  # Convex backend
│   ├── schema.ts           # Database schema
│   ├── productboard.ts     # Productboard API actions
│   └── migrations.ts       # Migration log mutations/queries
├── src/
│   ├── App.tsx             # Main application component
│   ├── types.ts            # TypeScript type definitions
│   ├── main.tsx            # React entry point
│   └── index.css           # Tailwind CSS imports
├── .env.local              # Convex URL (auto-generated)
└── package.json
```

## API Integration

The app uses Convex actions to proxy requests to the Productboard API, avoiding CORS issues. Key endpoints used:

- `GET /custom-fields` - List all custom fields
- `GET /features` - List all features (paginated)
- `GET /hierarchy-entities/custom-fields-values/value` - Get custom field value
- `PUT /hierarchy-entities/custom-fields-values/value` - Set custom field value
