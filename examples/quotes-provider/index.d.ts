import type { ProviderCapability, ProviderFactory } from '@anokye-labs/kbexplorer-core';

/** The provider-contract API version this package was authored against. */
export declare const apiVersion: string;

/** Capabilities this provider needs the host engine to support. */
export declare const capabilities: ProviderCapability[];

/** Default export: the provider factory (see `defineProvider`). */
declare const provider: ProviderFactory;
export default provider;
