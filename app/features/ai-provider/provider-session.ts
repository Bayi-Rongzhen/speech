import { ProviderConnectionSchema, type ProviderConnection } from '../../lib/schemas/ai-provider';

const SESSION_KEY = 'jiangqingchu.ai-provider.session.v1';

export function loadSessionProvider(): ProviderConnection | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    return raw ? ProviderConnectionSchema.parse(JSON.parse(raw)) : null;
  } catch {
    window.sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function saveSessionProvider(provider: ProviderConnection) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(ProviderConnectionSchema.parse(provider)));
}

export function clearSessionProvider() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(SESSION_KEY);
}
