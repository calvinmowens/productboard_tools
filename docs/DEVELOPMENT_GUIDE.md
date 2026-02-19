# Development Guide

Comprehensive guide for maintaining code quality and development workflow efficiency.

## Code Quality Standards

### TypeScript & ESLint Rules

The project enforces strict type safety and code clarity:

#### ESLint Rules
- **no-console**: Warns on console.log, allows warn/error (debugging via console.warn)
- **no-debugger**: Errors on debugger statements (prevent accidental commits)
- **@typescript-eslint/no-unused-vars**: Warns on unused vars (ignore with `_` prefix)
- **@typescript-eslint/explicit-function-return-types**: Warns on missing return types (improves readability)
- **@typescript-eslint/no-explicit-any**: Warns on `any` type (enforce type safety)
- **no-var**: Requires `const`/`let` (avoids hoisting issues)
- **prefer-const**: Warns on `let` when `const` works (immutability by default)
- **prefer-arrow-callback**: Recommends arrow functions (cleaner syntax)
- **react-hooks/rules-of-hooks**: Enforces hook call order (prevents bugs)
- **react-hooks/exhaustive-deps**: Checks useEffect dependencies (prevents stale closures)

### Pre-commit Validation

When you commit, Husky automatically runs:
1. **ESLint fixes**: Auto-corrects style issues
2. **TypeScript check**: Validates all types compile correctly

If validation fails, the commit is blocked. Fix issues with `npm run lint:fix` and try again.

### Commit Message Format

Enforce via `.husky/commit-msg` hook. Messages must follow conventional commits:

```
<type>: <description>
<blank line>
<optional body explaining why, not what>
<optional blank line>
<optional footer: Fixes #123>
```

**Valid types**:
- `feat` - New feature or module
- `fix` - Bug fix
- `refactor` - Code restructuring (no behavior change)
- `docs` - Documentation (CLAUDE.md, README, docs/)
- `chore` - Dependencies, config, CI/CD
- `style` - Formatting (usually auto-fixed by linter)
- `test` - Test additions/fixes
- `perf` - Performance optimization

**Examples**:
```
feat: Add CSV company import module

Implements company bulk import from CSV with error reporting.
Reuses V1 API endpoint used by other modules.
Fixes #42

---

fix: Resolve custom field migration pagination

Pagination cursor wasn't advancing on large datasets, causing
infinite loops. Now correctly increments via pageCursor parameter.

---

docs: Update architecture section in CLAUDE.md
```

## Code Organization Patterns

### Module Structure

Each module in `src/modules/` follows this structure:

```
modules/csv-import/
├── index.tsx                 # Main component (routes here)
├── useStep1Auth.ts          # Custom hooks for each step
├── useStep2Config.ts
├── components/
│   ├── Step1Auth.tsx        # Step-specific UI
│   ├── Step2Config.tsx
│   ├── Step3Preview.tsx
│   └── shared/
│       ├── CSVUpload.tsx     # Reusable components
│       └── StepProgress.tsx
└── utils/
    ├── csvParser.ts         # Step-specific utilities
    └── validation.ts
```

**Pattern**:
- Index.tsx manages state and orchestrates steps
- Hooks (useStepX) contain step logic to avoid bloat
- Components folder contains UI elements (one file = one component)
- Utils folder contains pure functions and helpers

### State Management

**Module-level state**: Use React Context if multiple components need access:

```typescript
// context.ts
interface ModuleContextType { step: number; /* ... */ }
export const ModuleContext = createContext<ModuleContextType | null>(null);

export const useModuleState = () => {
  const ctx = useContext(ModuleContext);
  if (!ctx) throw new Error('useModuleState must be inside ModuleProvider');
  return ctx;
};

// index.tsx
<ModuleProvider><ModuleUI /></ModuleProvider>
```

**Local component state**: Use `useState` within the component (simpler)

**Avoid prop drilling**: If data needs to pass through 3+ levels, use Context instead.

### API Communication

**All API calls go through Convex actions**:

```typescript
// Wrong: Don't fetch directly
const response = await fetch('https://api.productboard.com/features', {
  headers: { Authorization: `Bearer ${token}` }
});

// Correct: Use Convex action
const features = await useAction(api.productboard.getFeatures)({ apiToken });
```

**Why**: Avoids CORS issues, centralizes auth, easier to test/mock.

### Error Handling

**Pattern for user-facing errors**:

```typescript
try {
  const result = await someAction(params);
  setSuccess('Operation completed');
} catch (error) {
  // User-friendly message, not stack trace
  setError(
    error instanceof Error
      ? error.message
      : 'An unexpected error occurred'
  );

  // Log technical details only for debugging
  console.warn('Operation failed:', error);
}
```

**Rules**:
- Always show user-friendly error messages
- Only use console.warn/error for debugging (not console.log)
- Don't expose API responses directly to users
- Catch all action calls (they can fail)

## Adding Features

### Feature Checklist

1. **Plan the feature** (what data flows where)
2. **Update CLAUDE.md** with new patterns/conventions if any
3. **Create code** following module structure above
4. **Test manually** (no automated tests yet)
5. **Commit with feat: message** following conventions
6. **Update CLAUDE.md Known Bugs/TODOs** if needed

### Module Workflow Pattern

The standard 4-step pattern (see CLAUDE.md) works for most features:

1. **Auth Step**: Validate API token
2. **Config Step**: Select options, upload/map data
3. **Preview Step**: Show what will change
4. **Execute Step**: Run operation, display results

If your feature needs a different pattern, document it in CLAUDE.md.

## Debugging & Testing

### Running Locally

```bash
npm run dev          # Start both frontend + Convex
npm run dev:frontend # Frontend only (if Convex already running)
npm run build        # Validate types and frontend
npm run lint:fix     # Auto-fix code style issues
```

### Debugging Tips

- **Frontend**: Browser DevTools (F12), check Console tab
- **Convex actions**: Run `npm run dev:backend`, check terminal output
- **API calls**: Add `console.warn('Debug:', data)` in Convex actions
- **Types**: Run `npm run build` to catch TypeScript errors early
- **ESLint**: Run `npm run lint` before committing

### Manual Testing

No automated tests yet. When testing features:

1. **Happy path**: Normal usage with valid data
2. **Edge cases**: Empty CSV, special characters, large datasets
3. **Error cases**: Invalid token, network failure, API errors
4. **UI**: Check on different screen sizes (Tailwind responsive)

Document unexpected behavior in CLAUDE.md Known Bugs section with:
- What happened
- Steps to reproduce
- Expected behavior
- Current behavior

## Performance Considerations

### Token Efficiency (For Claude Sessions)

1. **CLAUDE.md**: Keep under 5k tokens
   - Delete completed TODOs
   - Link to docs/ for detailed specs
   - Use examples instead of prose

2. **Code clarity**: Clear function/variable names reduce explanation needed

3. **Commit messages**: Conventional format is self-documenting

4. **File organization**: Obvious structure (api/ utils/ components/) reduces search time

### Runtime Performance

- **Large CSV imports**: Features handle 100+ features/notes gracefully
- **API calls**: Convex caches results in development
- **Re-renders**: Use `useCallback`/`useMemo` only if actual performance issue (not premature optimization)

## Deployment

### Production Checklist

1. **npm run build** succeeds (TypeScript + Vite)
2. **npm run lint** passes (no warnings)
3. **Manual testing** on preview build
4. **Commit** with proper message format
5. **Push to main** - Vercel auto-deploys frontend
6. **Run npx convex deploy -y** - Deploy backend separately

### Environment Variables

Vite environment variables bake at build time:
- `.env.local` used in development
- Vercel "Environment Variables" for production
- Must re-run build if VITE_* vars change
- Current: `VITE_CONVEX_URL` points to Convex deployment

## Troubleshooting

### Build fails with TypeScript errors

```bash
npm run build  # See full error
npm run lint:fix  # Fix auto-fixable issues
```

### Linter blocks commit

```bash
npm run lint:fix  # Auto-fix style
git add .         # Re-stage fixed files
git commit        # Try again
```

### Commit message rejected

Check message format: must start with `type: description`
```bash
git commit -m "feat: Add new module"  # Correct
```

### Convex backend not responding

```bash
npm run dev:backend  # Check if running
# or restart: Ctrl+C, then npm run dev:backend
```

### Vite/React not hot-reloading

```bash
npm run dev:frontend  # Restart frontend
# Ensure you're editing in src/ (not public/)
```
