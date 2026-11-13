/** Capability order is the approved full-sol-medium-v3 vocabulary, excluding unknown. */
export const CAPABILITY_COUNT = 10;
export const UNKNOWN = -1;
export const NONE = 0;
export const USE = 1;
export const READ = 3;
export const MUTATE = 7;
export const ALL_CAPABILITIES = 0x3fffffff;

declare const decisionBrand: unique symbol;
/** -1 is unknown; otherwise ten three-bit fields encode 0 / use / read / mutate. */
export type Decision = number & { readonly [decisionBrand]: true };

// filesystem, network, processes, execution, credentials, software,
// configuration, devices, remote_resources, system.
