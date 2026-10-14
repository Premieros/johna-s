import type pg from 'pg';
export interface ReviewedIndex { name: string; table: string; sql: string; }
export const indexes: ReviewedIndex[];
export const expectedProject: string;
export const securityCatalog: string;
export function validateTarget(url: string, env?: Record<string, string | undefined>, apply?: boolean): 'owned-local-ci' | 'johnas-production';
export function applyReviewedIndexes(db: pg.Client, selected?: ReviewedIndex[]): Promise<{ built: string[] }>;
