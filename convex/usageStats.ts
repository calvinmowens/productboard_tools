import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Get all usage stats
export const getAll = query({
  args: {},
  handler: async (ctx) => {
    const stats = await ctx.db.query("usageStats").collect();
    // Convert to a map of moduleId -> count
    const statsMap: Record<string, number> = {};
    for (const stat of stats) {
      statsMap[stat.moduleId] = stat.count;
    }
    return statsMap;
  },
});

// Increment usage count for a module
export const increment = mutation({
  args: { moduleId: v.string() },
  handler: async (ctx, { moduleId }) => {
    const existing = await ctx.db
      .query("usageStats")
      .withIndex("by_moduleId", (q) => q.eq("moduleId", moduleId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { count: existing.count + 1 });
      return existing.count + 1;
    } else {
      await ctx.db.insert("usageStats", { moduleId, count: 1 });
      return 1;
    }
  },
});
