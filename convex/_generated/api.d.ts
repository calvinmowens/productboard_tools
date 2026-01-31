/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as migrations from "../migrations.js";
import type * as productboard from "../productboard.js";
import type * as productboardV2 from "../productboardV2.js";
import type * as usageStats from "../usageStats.js";
import type * as utils_errorSanitizer from "../utils/errorSanitizer.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  migrations: typeof migrations;
  productboard: typeof productboard;
  productboardV2: typeof productboardV2;
  usageStats: typeof usageStats;
  "utils/errorSanitizer": typeof utils_errorSanitizer;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
