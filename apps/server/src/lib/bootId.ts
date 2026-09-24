/**
 * Identifies this server process. Generated once at startup and sent to clients
 * with DJ_STATE, so a reconnecting client can tell whether it is talking to the
 * same process (its clock offset estimate is still valid) or a restarted one
 * (the estimate must be thrown away and re-measured).
 */
export const SERVER_BOOT_ID: string = crypto.randomUUID();
