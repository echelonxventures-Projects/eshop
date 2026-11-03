/**
 * Payment connector contract.
 * Implementations are loaded by configuration from service_connectors.adapter_module.
 * Secrets are referenced by name and injected at runtime; they are never stored in config JSON.
 */
export async function createIntent() {
  throw new Error('A payment adapter must implement createIntent');
}
