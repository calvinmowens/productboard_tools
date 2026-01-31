import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  usageStats: defineTable({
    moduleId: v.string(),
    count: v.number(),
  }).index("by_moduleId", ["moduleId"]),

  migrationLogs: defineTable({
    sourceFieldId: v.string(),
    sourceFieldName: v.string(),
    targetFieldId: v.string(),
    targetFieldName: v.string(),
    featuresProcessed: v.number(),
    featuresUpdated: v.number(),
    featuresSkipped: v.number(),
    featuresFailed: v.number(),
    status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed")),
    startedAt: v.number(),
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
  }),
});
