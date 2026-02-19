# Code Patterns & Examples

Reusable patterns for common tasks in this project.

## Component Patterns

### Step-Based Component

Standard pattern for modules with sequential steps:

```typescript
// Step1Auth.tsx - Handles API token validation
interface Step1AuthProps {
  onNext: (token: string) => void;
  onCancel: () => void;
}

export function Step1Auth({ onNext, onCancel }: Step1AuthProps) {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const validateAction = useAction(api.productboard.validateToken);

  const handleValidate = async () => {
    try {
      setIsLoading(true);
      setError(null);
      await validateAction({ apiToken: token });
      onNext(token);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Token validation failed'
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <input
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="Enter API token"
      />
      {error && <div className="text-red-600">{error}</div>}
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel}>Cancel</button>
        <button
          onClick={handleValidate}
          disabled={!token || isLoading}
          className="bg-blue-600"
        >
          {isLoading ? 'Validating...' : 'Continue'}
        </button>
      </div>
    </div>
  );
}
```

### Module State with Context

```typescript
// context.ts
interface ModuleState {
  currentStep: number;
  apiToken: string;
  csvFile: File | null;
  fieldMappings: Record<string, string>;
}

interface ModuleContextType {
  state: ModuleState;
  setState: (updates: Partial<ModuleState>) => void;
}

export const ModuleContext = createContext<ModuleContextType | null>(null);

export function ModuleProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ModuleState>({
    currentStep: 0,
    apiToken: '',
    csvFile: null,
    fieldMappings: {},
  });

  return (
    <ModuleContext.Provider value={{ state, setState }}>
      {children}
    </ModuleContext.Provider>
  );
}

export function useModule() {
  const ctx = useContext(ModuleContext);
  if (!ctx) throw new Error('useModule must be inside ModuleProvider');
  return ctx;
}

// In component:
const { state, setState } = useModule();
setState({ currentStep: state.currentStep + 1 });
```

### CSV Upload Component

```typescript
// components/CSVUpload.tsx
interface CSVUploadProps {
  onFileSelect: (file: File, data: unknown[]) => void;
  maxColumns?: number;
}

export function CSVUpload({ onFileSelect, maxColumns = 10 }: CSVUploadProps) {
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const csv = event.target?.result as string;
        const lines = csv.split('\n');
        const headers = lines[0]?.split(',') ?? [];

        if (headers.length > maxColumns) {
          alert(`CSV has ${headers.length} columns. Max is ${maxColumns}`);
          return;
        }

        // Parse remaining rows
        const data = lines.slice(1).map((line) => {
          const values = line.split(',');
          return headers.reduce(
            (obj, header, i) => {
              obj[header] = values[i]?.trim() ?? '';
              return obj;
            },
            {} as Record<string, string>
          );
        });

        onFileSelect(file, data);
      } catch (error) {
        console.warn('CSV parsing failed:', error);
        alert('Failed to parse CSV file');
      }
    };
    reader.readAsText(file);
  };

  return (
    <input
      type="file"
      accept=".csv"
      onChange={handleFileChange}
      className="border p-2"
    />
  );
}
```

## Data Fetching Patterns

### Action with Error Handling

```typescript
// In component
const getCompaniesAction = useAction(api.productboard.getCompanies);

const fetchCompanies = async (apiToken: string) => {
  try {
    setLoading(true);
    setError(null);
    const companies = await getCompaniesAction({ apiToken });
    setCompanies(companies);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to fetch companies';
    setError(message);
    console.warn('Fetch companies error:', err);
  } finally {
    setLoading(false);
  }
};
```

### Batch Processing with Progress

```typescript
// Utility: utils/batchProcessor.ts
interface BatchResult<T> {
  successful: T[];
  failed: Array<{ item: unknown; error: string }>;
}

export async function processBatch<T>(
  items: unknown[],
  processor: (item: unknown) => Promise<T>
): Promise<BatchResult<T>> {
  const successful: T[] = [];
  const failed: Array<{ item: unknown; error: string }> = [];

  for (const item of items) {
    try {
      const result = await processor(item);
      successful.push(result);
    } catch (error) {
      failed.push({
        item,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return { successful, failed };
}

// Usage in component:
const result = await processBatch(csvRows, async (row) => {
  return await createNoteAction({ content: row.text });
});

console.warn(
  `Processed: ${result.successful.length} success, ${result.failed.length} failed`
);
```

## Type Patterns

### API Response Types

```typescript
// types.ts - Define shared types
export interface Feature {
  id: string;
  name: string;
  customFields?: Record<string, string | number | boolean>;
}

export interface Company {
  id: string;
  name: string;
  email?: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  companyId?: string;
  userId?: string;
  tags?: string[];
}

// Convex action returns proper type:
export const getFeatures = action({
  handler: async (_, { apiToken }): Promise<Feature[]> => {
    const response = await fetch('...');
    return response.json();
  },
});
```

### Form Data Types

```typescript
// Specific types for form state
interface FieldMapping {
  csvColumn: string;
  entityField: string;
  isRequired: boolean;
}

interface ImportConfig {
  entityType: 'feature' | 'company' | 'note';
  fieldMappings: FieldMapping[];
  parentId?: string;
}
```

## Utility Patterns

### Debounced Search

```typescript
// utils/search.ts
export function useDebounce<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debouncedValue;
}

// Usage:
const [search, setSearch] = useState('');
const debouncedSearch = useDebounce(search, 300);

useEffect(() => {
  if (debouncedSearch) {
    searchEntities(debouncedSearch);
  }
}, [debouncedSearch]);
```

### Safe JSON Parse

```typescript
// utils/json.ts
export function safeJsonParse<T>(
  json: string,
  fallback: T
): T {
  try {
    return JSON.parse(json);
  } catch {
    console.warn('JSON parse failed, using fallback');
    return fallback;
  }
}
```

## Convex Action Patterns

### Validation in Action

```typescript
// convex/productboard.ts
export const createNote = action({
  handler: async (
    _,
    {
      apiToken,
      title,
      content,
      companyId,
    }: {
      apiToken: string;
      title: string;
      content: string;
      companyId?: string;
    }
  ): Promise<Note> => {
    // Validate inputs
    if (!apiToken) throw new Error('API token required');
    if (!title?.trim()) throw new Error('Title required');
    if (!content?.trim()) throw new Error('Content required');

    // Make API call
    const response = await fetch('https://api.productboard.com/notes', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title,
        content,
        ...(companyId && { companyId }),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error: ${error}`);
    }

    return response.json();
  },
});
```

### Pagination Pattern

```typescript
// convex/productboard.ts
export const getAllFeatures = action({
  handler: async (
    _,
    { apiToken }: { apiToken: string }
  ): Promise<Feature[]> => {
    const allFeatures: Feature[] = [];
    let pageCursor: string | null = null;

    while (true) {
      const params = new URLSearchParams();
      if (pageCursor) params.append('pageCursor', pageCursor);

      const response = await fetch(
        `https://api.productboard.com/features?${params}`,
        {
          headers: { Authorization: `Bearer ${apiToken}` },
        }
      );

      if (!response.ok) throw new Error('Failed to fetch features');

      const data = (await response.json()) as {
        data: Feature[];
        pageCursor?: string;
      };

      allFeatures.push(...data.data);

      // Stop if no more pages
      if (!data.pageCursor) break;
      pageCursor = data.pageCursor;
    }

    return allFeatures;
  },
});
```

## Testing Patterns

Since automated testing isn't set up, use these manual test cases:

### Test Checklist Template

```markdown
## Feature: [Feature Name]

### Happy Path
- [ ] Valid inputs produce expected output
- [ ] Results display correctly on all screen sizes
- [ ] Cancel button works at each step

### Edge Cases
- [ ] Empty CSV file
- [ ] CSV with 1000+ rows (performance)
- [ ] Special characters in names (é, ñ, 中文)
- [ ] Very long field values
- [ ] Missing required columns

### Error Cases
- [ ] Invalid API token shows error
- [ ] Network timeout handled gracefully
- [ ] Duplicate entries detected correctly
- [ ] Failed rows exported to CSV
```
