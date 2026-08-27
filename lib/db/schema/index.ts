/**
 * Niramoy — the complete database schema.
 *
 * Import tables from here, never from the individual domain files, so that a
 * repository's imports read as one coherent surface.
 */

export * from "./enums";
export * from "./identity";
export * from "./directory";
export * from "./scheduling";
export * from "./clinical";
export * from "./ai";
export * from "./platform";
