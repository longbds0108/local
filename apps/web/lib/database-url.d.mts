type Found = { name: string; url: string } | undefined;
export function findPostgresUrl(env?: Record<string, string | undefined>): Found;
export function findDirectPostgresUrl(env?: Record<string, string | undefined>): Found;
