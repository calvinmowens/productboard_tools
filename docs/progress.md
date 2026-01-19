# Development Progress

This file tracks significant changes and decisions across sessions.

## Session History

### 2026-01-15 - Token-Saving Setup Complete
- Created docs structure following Claude Code token-saving guide
- Moved PROJECT_CONTEXT.md to docs/ folder
- Set up progress.md and session_summary.md templates
- Enhanced CLAUDE.md with required sections:
  - Known Bugs
  - Next TODOs / Upcoming Work
  - Incomplete Test Scenarios
- Created CLAUDE_MAINTENANCE_RULES.md with update guidelines
- Current CLAUDE.md size: 786 words (~1,048 tokens) - well under 5k limit

### 2026-01-15 - CSV Import Enhancements

**Parent Association Refactor:**
- Replaced text input with dropdown populated from Productboard API
- Added `handleParentTypeChange` to fetch all entities of selected parent type
- Store `selectedParentId` directly instead of looking up by name

**Key Code - Parent Fetching:**
```typescript
const handleParentTypeChange = useCallback(async (type: string) => {
  setParentType(type);
  setSelectedParentId('');
  setAvailableParents([]);
  if (!type) return;
  setIsLoadingParents(true);
  try {
    const allParents: ParentEntity[] = [];
    let pageToken: string | undefined;
    do {
      const result = await listEntities({ apiToken, entityType: type, pageToken });
      if (result.success && result.data) {
        for (const entity of result.data) {
          if (entity.fields?.name) {
            allParents.push({ id: entity.id, name: entity.fields.name });
          }
        }
        pageToken = result.nextPageToken || undefined;
      } else { break; }
    } while (pageToken);
    allParents.sort((a, b) => a.name.localeCompare(b.name));
    setAvailableParents(allParents);
  } finally { setIsLoadingParents(false); }
}, [apiToken, listEntities]);
```

**V2 API Field Formatting Fixes:**
- Timeframe fields require nested structure with granularity:
  ```typescript
  fields.timeframe = { granularity: 'day', startDate: '...', endDate: '...' }
  ```
- Added `formatDateValue` helper for date normalization
- Removed labels/multiselect handling (V2 API requires pre-existing select options)

**Collapsible Steps UI:**
- Refactored Steps 2 and 3 in CSV Import to collapse when completed
- Shows summary with entity type, parent name, mapped fields
- Added "Edit" button to re-expand completed steps

**Pending Work:**
- Apply collapsible step pattern to Custom Field Migration module
- Apply collapsible step pattern to Duplicate Notes module

---

## Active Work

Collapsible steps pattern completed for CSV Import. Other modules (Custom Field Migration, Duplicate Notes) have different architecture - awaiting user confirmation to refactor.

## Known Issues

- Labels/Tags/MultiSelect fields not supported in V2 API entity creation (requires pre-existing select options)

## Upcoming TODOs

- Refactor Custom Field Migration for collapsible steps (pending user confirmation)
- Refactor Duplicate Notes for collapsible steps (pending user confirmation)

---

### 2026-01-16 - CSV Bulk Update Module Created

**Overview:**
- Renamed "CSV Import" module to "CSV Entity Import"
- Created new "CSV Bulk Update" module for updating existing features' custom field values from CSV

**CSV Bulk Update Features:**
- Upload CSV with feature UUIDs and value columns
- Map multiple value columns to custom fields
- Skip rows with blank values (empty, whitespace, `-`, `'-`)
- Format all values as numbers, remove `%` symbols
- Fast preview (no API calls, instant parsing)

**Key Code - Blank Value Detection:**
```typescript
function isBlankValue(value: string | undefined | null): boolean {
  if (value === null || value === undefined) return true;
  const trimmed = value.trim();
  return trimmed === '' || trimmed === '-' || trimmed === "'-";
}
```

**Key Code - Value Processing:**
```typescript
// Remove % symbol and format as number
const cleanedValue = value.trim().replace(/%/g, '');
const numericValue = parseFloat(cleanedValue);
if (!isNaN(numericValue)) {
  customFieldUpdates.push({
    fieldId: field.id,
    fieldType: field.type,
    value: numericValue,
  });
}
```

**API Endpoint Fix:**
- Initial attempt used `PATCH /features/:id` with `customFields` object - returned 400 error
- Fixed: Use `PUT /hierarchy-entities/custom-fields-values/value?customField.id={fieldId}&hierarchyEntity.id={featureId}`
- Same endpoint used by Custom Field Migration module

**Convex Action - updateFeatureCustomFields:**
```typescript
export const updateFeatureCustomFields = action({
  args: {
    apiToken: v.string(),
    featureId: v.string(),
    customFields: v.array(v.object({
      fieldId: v.string(),
      fieldType: v.string(),
      value: v.any(),
    })),
  },
  handler: async (_, { apiToken, featureId, customFields }) => {
    for (const field of customFields) {
      const url = `${API_BASE_URL}/hierarchy-entities/custom-fields-values/value?customField.id=${field.fieldId}&hierarchyEntity.id=${featureId}`;
      const payload = { data: { type: field.fieldType, value: field.value } };
      await fetch(url, {
        method: "PUT",
        headers: { ...getHeaders(apiToken), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }
  },
});
```

**Step Visibility Fix:**
```typescript
// Step 2 - only show after upload complete
{connectionStatus === 'connected' && csvData && currentStep !== 'upload' && (

// Step 3 - only show after UUID column selected
{connectionStatus === 'connected' && csvData && uuidColumn && currentStep !== 'upload' && currentStep !== 'configure' && (
```

**Files Modified:**
- `src/modules/csv-bulk-update/index.tsx` (NEW)
- `src/App.tsx` - Added route
- `src/pages/Home.tsx` - Added module card, renamed CSV Import
- `convex/productboard.ts` - Added `getFeature` and `updateFeatureCustomFields` actions
- `CLAUDE.md` - Updated documentation
