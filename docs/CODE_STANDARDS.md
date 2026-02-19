# Code Standards & Linting Rules

Quick reference for enforced code quality standards.

## ESLint Configuration (eslint.config.js)

### Core Rules

| Rule | Level | Why | Example |
|------|-------|-----|---------|
| `no-console` | warn | Prevents debug code in commits | ❌ `console.log(x)` ✅ `console.warn(x)` |
| `no-debugger` | error | Blocks debugger statements | ❌ `debugger;` |
| `no-unused-vars` | warn | Cleans up dead code | ❌ `const x = 5; // unused` → Use `const _x` to ignore |
| `no-var` | error | Modern JS conventions | ❌ `var x = 5;` ✅ `const x = 5;` |
| `prefer-const` | warn | Immutability by default | ❌ `let x = 5; // never changes` ✅ `const x = 5;` |

### TypeScript Rules

| Rule | Level | Why | Example |
|------|-------|-----|---------|
| `explicit-function-return-types` | warn | Improves code readability | ❌ `function f(x) { return x * 2; }` ✅ `function f(x: number): number { return x * 2; }` |
| `no-explicit-any` | warn | Enforces type safety | ❌ `const x: any = data;` ✅ `const x: Data = data as Data;` |
| `no-unused-vars` | warn | With TypeScript-specific checks | ❌ `function f(unused: string) {}` ✅ `function f(_unused: string) {}` |

### React/Hooks Rules

| Rule | Level | Why | Example |
|------|-------|-----|---------|
| `react-hooks/rules-of-hooks` | error | Prevents hook call bugs | ❌ `if (x) { useState(); }` ✅ `useState();` at top level |
| `react-hooks/exhaustive-deps` | warn | Prevents stale closures | ❌ `useEffect(() => { log(x); }, [])` ✅ `useEffect(() => { log(x); }, [x])` |
| `react-refresh/only-export-components` | warn | Vite HMR compatibility | ❌ `export const helper = () => {}; export default Component;` ✅ Only default export in `.tsx` |

## TypeScript Configuration

### Key Settings (tsconfig.app.json)

- **strict**: `true` - All type checking enabled
- **noImplicitAny**: `true` - Catch missing type annotations
- **esModuleInterop**: `true` - Simplified imports
- **skipLibCheck**: `true` - Skip type checking in node_modules (faster)

### Common TypeScript Patterns

**Avoid `any`** - Use generic types or `unknown` instead:
```typescript
// ❌ Bad
function process(data: any) { }

// ✅ Good - Generic type
function process<T>(data: T): T { }

// ✅ Good - Union type
function process(data: string | number) { }

// ✅ Good - Unknown with type guard
function process(data: unknown) {
  if (typeof data === 'string') { }
}
```

**Always define function return types**:
```typescript
// ❌ Bad
export async function fetchData(url: string) {
  return fetch(url).then(r => r.json());
}

// ✅ Good
export async function fetchData(url: string): Promise<unknown> {
  return fetch(url).then(r => r.json());
}
```

**Use interfaces for component props**:
```typescript
// ✅ Good
interface ButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export function Button({ label, onClick, disabled }: ButtonProps) {
  return <button onClick={onClick} disabled={disabled}>{label}</button>;
}
```

## Prettier Formatting

File: `.prettierrc.json`

| Setting | Value | Notes |
|---------|-------|-------|
| `semi` | `true` | Require semicolons |
| `singleQuote` | `true` | Use single quotes instead of double |
| `trailingComma` | `es5` | Trailing commas where valid in ES5 (objects, arrays) |
| `printWidth` | `100` | Line wrap at 100 chars (readable on most screens) |
| `tabWidth` | `2` | Use 2-space indentation |
| `useTabs` | `false` | Use spaces, not tabs |
| `arrowParens` | `always` | Always include parens: `(x) => x` not `x => x` |

**Auto-fix**: Run `npm run lint:fix` before committing.

## Pre-commit Hook Validation

File: `.husky/pre-commit` → runs `lint-staged`

When you commit:
1. **ESLint auto-fix** on changed `.ts`/`.tsx` files
2. **TypeScript type check** on all files (catches compile errors)

If either fails:
- Fix the error
- Re-stage files: `git add .`
- Retry commit: `git commit`

**Example error**:
```
❌ TypeScript error: Type 'string' is not assignable to type 'number'
Fix the type mismatch, then git add and commit again
```

## Commit Message Validation

File: `.husky/commit-msg`

**Format**: `<type>: <description>` (max 72 chars)

Valid types:
- `feat` - New feature
- `fix` - Bug fix
- `refactor` - Code restructuring
- `docs` - Documentation
- `chore` - Dependency/config
- `style` - Formatting
- `test` - Tests
- `perf` - Performance

**Examples**:
```
✅ feat: Add CSV import module
✅ fix: Resolve pagination cursor bug
✅ docs: Update CLAUDE.md conventions
❌ add feature                          (missing type)
❌ Added a really cool new feature      (not lowercase, exceeds 72 chars)
```

## Ignoring Rules (When Necessary)

### ESLint Disable Comments

Use sparingly - explain why:

```typescript
// ❌ Don't do this
// eslint-disable-next-line
const data: any = response.json();

// ✅ Do this - explain the reason
// API returns untyped response, cast after validation
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const data: any = response.json();
```

### Unused Variable Prefix

Prefix with underscore:

```typescript
// ❌ ESLint warns
function process(unused: string, used: number) { }

// ✅ No warning
function process(_unused: string, used: number) { }
```

### Type Assertion as Workaround

Last resort for type safety:

```typescript
// ❌ Don't use unknown
const x = response.json() as unknown;

// ✅ Assert to specific type
interface ApiResponse { id: string; name: string; }
const x = response.json() as ApiResponse;

// Then validate if from external API:
if ('id' in x && 'name' in x) {
  // safe to use x as ApiResponse
}
```

## Running Checks Locally

```bash
# Check for linting errors
npm run lint

# Auto-fix linting errors
npm run lint:fix

# Validate TypeScript compiles
npm run build

# Run both linter and TypeScript check
npm run build && npm run lint
```

## Debugging Failed Checks

### ESLint Error: "no-explicit-any"

```
❌ Unexpected any
```

**Fix**: Replace with specific type or use generic:
```typescript
// ❌ Before
const data: any = fetchData();

// ✅ After
interface Data { id: string; }
const data: Data = await fetchData();
```

### TypeScript Error: "Type X is not assignable to Y"

```
❌ Type 'string' is not assignable to type 'number'
```

**Fix**: Use correct type in function call:
```typescript
// ❌ Before
setCount("5");

// ✅ After
setCount(5);
```

### ESLint Error: "exhaustive-deps"

```
❌ React Hook useEffect has missing dependencies
```

**Fix**: Add missing variable to dependency array:
```typescript
// ❌ Before
useEffect(() => {
  if (x) console.log(x);
}, []);

// ✅ After
useEffect(() => {
  if (x) console.log(x);
}, [x]);
```

## Guidelines for New Code

1. **Write TypeScript first** - Let types guide the implementation
2. **Run lint:fix** - Before committing, auto-fix style
3. **Build before commit** - Catches TypeScript errors early
4. **Follow patterns** - See `docs/CODE_PATTERNS.md` for examples
5. **Document why, not what** - Code should be clear; comments explain design decisions
