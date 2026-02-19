# PR Review Checklist

When requesting Claude review of a PR, I'll check against these criteria.

## Code Quality

- ✅ No `console.log` statements (should be `console.warn`/`console.error`)
- ✅ No `debugger;` statements
- ✅ Unused variables prefixed with `_` or removed
- ✅ No `any` types (use specific types or generics)
- ✅ Function return types defined (especially async functions)
- ✅ TypeScript compiles without errors

## Architecture & Patterns

- ✅ Follows module structure from `@docs/CODE_PATTERNS.md`
- ✅ API calls routed through Convex actions (no direct fetch)
- ✅ React Context used instead of prop drilling (if needed)
- ✅ Types defined in `src/types.ts` for shared data
- ✅ Error messages user-friendly (not stack traces)

## Code Organization

- ✅ Clear function/variable names (reduces need for comments)
- ✅ Related code grouped together
- ✅ No repeated code (extract to utilities if 3+ similar blocks)
- ✅ Component props have interface types

## Testing & Safety

- ✅ Happy path tested (or noted if needs manual testing)
- ✅ Error cases handled (invalid input, network failure, API error)
- ✅ Edge cases considered (empty CSV, very large dataset, special characters)
- ✅ No CORS, injection, or XSS vulnerabilities

## Documentation

- ✅ CLAUDE.md updated if new patterns/conventions added
- ✅ Commit message follows conventional format
- ✅ Comments explain "why", not "what" (code should be self-documenting)
- ✅ Module docs updated in `docs/` if applicable

## UI/UX (if applicable)

- ✅ Responsive design (mobile-friendly)
- ✅ No emojis in UI (unless explicitly requested)
- ✅ Error states displayed clearly
- ✅ Loading states shown (if async operations)
- ✅ Cancel buttons positioned correctly (bottom-right per convention)

## Feedback Format

I'll provide feedback as:
- **Approved**: Ready to merge
- **Suggestions**: Nice-to-haves (optional improvements)
- **Required Changes**: Block merge until fixed

Example feedback:
```
✅ Approved with suggestions:
- Consider extracting CSV parsing logic to utils/ for reuse
- Error message could be more specific: "Missing 'name' column" instead of "Invalid CSV"
- Other than that, looks good to merge!
```

## Quick Review Request

Just mention the PR:
```
Review PR #42
```

Or provide the full URL:
```
Review https://github.com/calvinmowens/productboard_tools/pull/42
```

I'll fetch the PR diff and provide detailed feedback.
