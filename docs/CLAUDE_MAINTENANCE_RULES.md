# CLAUDE.md Maintenance Rules

**IMPORTANT**: These rules must be followed when updating CLAUDE.md in this project.

## Core Requirements

### 1. Keep Under 5,000 Tokens
- Current size: ~1,048 tokens (786 words)
- Token estimate: words / 0.75 = tokens
- Safe upper limit: ~3,750 words

### 2. Required Sections

CLAUDE.md MUST always include:

1. **Project summary & active features**
   - What the app does, current modules

2. **Tech stack**
   - Framework versions, key libraries

3. **Code style & naming conventions**
   - UI patterns, code structure rules

4. **Known bugs**
   - Track discovered issues
   - Remove when fixed

5. **Next TODOs / Upcoming Work**
   - Active work in progress
   - Planned features/improvements
   - Update at end of each session

6. **Incomplete test scenarios**
   - Edge cases to handle
   - Test coverage gaps
   - Remove when implemented

### 3. Content Management Rules

**When adding new content:**
- Update TODOs section as work progresses
- Add bugs to Known Bugs when discovered
- Remove completed items promptly

**When approaching 5,000 tokens:**
- Split less critical sections into `docs/` folder
- Example: `docs/mk2_notes.md` for future version details
- Keep CLAUDE.md focused on current, active work

**What to move to docs/:**
- Detailed API documentation
- Historical decisions/context
- Archived features
- Extensive examples
- Future version planning

**What to keep in CLAUDE.md:**
- Active features and modules
- Current conventions
- Active TODOs
- Known bugs affecting development
- Essential patterns needed for daily work

## Update Workflow

### During Development
1. Add TODOs as new work items arise
2. Track bugs immediately when discovered
3. Note incomplete test scenarios

### End of Session
1. Update "Next TODOs / Upcoming Work" with current status
2. Clean up completed items
3. Move any resolved bugs out of Known Bugs
4. Check word count: `wc -w CLAUDE.md`
5. If approaching 3,500 words, identify content to move to docs/

### Starting New Session
1. CLAUDE.md auto-loads automatically
2. Review TODOs section for context continuity
3. Load supplementary docs only if needed: `@docs/filename.md`

## Quick Reference

```bash
# Check current size
wc -w CLAUDE.md

# Estimate tokens
# tokens ≈ words / 0.75
# 786 words ≈ 1,048 tokens
```

**Token Limits:**
- Hard limit: 5,000 tokens
- Safe target: 3,500-4,000 tokens
- Current: ~1,048 tokens
