import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const createMigrationLog = mutation({
  args: {
    sourceFieldId: v.string(),
    sourceFieldName: v.string(),
    targetFieldId: v.string(),
    targetFieldName: v.string(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("migrationLogs", {
      ...args,
      featuresProcessed: 0,
      featuresUpdated: 0,
      featuresSkipped: 0,
      featuresFailed: 0,
      status: "running",
      startedAt: Date.now(),
      details: [],
    });
    return id;
  },
});

export const updateMigrationLog = mutation({
  args: {
    id: v.id("migrationLogs"),
    featuresProcessed: v.optional(v.number()),
    featuresUpdated: v.optional(v.number()),
    featuresSkipped: v.optional(v.number()),
    featuresFailed: v.optional(v.number()),
    status: v.optional(v.union(v.literal("running"), v.literal("completed"), v.literal("failed"))),
    completedAt: v.optional(v.number()),
    details: v.optional(v.array(v.object({
      featureId: v.string(),
      featureName: v.string(),
      sourceValue: v.any(),
      targetValue: v.any(),
      action: v.string(),
      success: v.boolean(),
      error: v.optional(v.string()),
    }))),
  },
  handler: async (ctx, { id, ...updates }) => {
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Migration log not found");

    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, v]) => v !== undefined)
    );

    await ctx.db.patch(id, filteredUpdates);
  },
});

export const getMigrationLog = query({
  args: { id: v.id("migrationLogs") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const listMigrationLogs = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("migrationLogs").order("desc").take(20);
  },
});
