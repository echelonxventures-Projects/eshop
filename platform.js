import config from './platform-config.json';

const contextKey = 'marketly-platform-context';

export class PlatformContext {
  constructor(definition = config) {
    this.definition = definition;
    const stored = JSON.parse(localStorage.getItem(contextKey) || '{}');
    this.state = {
      tenant: stored.tenant || definition.platform.defaultTenant,
      universe: stored.universe || definition.platform.defaultUniverse,
      locale: stored.locale || definition.platform.defaultLocale,
      currency: stored.currency || definition.platform.defaultCurrency
    };
    this.listeners = new Set();
    this.normalize();
  }

  normalize() {
    const tenant = this.tenant;
    if (!tenant.locales.includes(this.state.locale)) this.state.locale = tenant.locales[0];
    if (!tenant.universes.includes(this.state.universe)) this.state.universe = tenant.universes[0];
    const allowedCurrencies = tenant.id === 'us' ? ['USD','EUR','GBP','INR','JPY'] : tenant.id === 'gb' ? ['GBP','EUR','USD'] : ['INR','USD','GBP','EUR'];
    if (!allowedCurrencies.includes(this.state.currency)) this.state.currency = tenant.defaultCurrency;
  }

  get tenant() { return this.definition.tenants.find(item => item.id === this.state.tenant) || this.definition.tenants[0]; }
  get universe() { return this.definition.universes.find(item => item.id === this.state.universe) || this.definition.universes[0]; }
  get locale() { return this.definition.locales.find(item => item.id === this.state.locale) || this.definition.locales[0]; }
  get currency() { return this.definition.currencies.find(item => item.id === this.state.currency) || this.definition.currencies[0]; }
  get context() { return {...this.state, tenant:this.tenant, universe:this.universe, locale:this.locale, currency:this.currency}; }

  set(key, value) {
    if (!(key in this.state)) return;
    this.state[key] = value;
    this.normalize();
    localStorage.setItem(contextKey, JSON.stringify(this.state));
    this.listeners.forEach(listener => listener(this.context));
  }

  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  t(key) { return this.locale.translations[key] || key; }
  formatMoney(usdValue) {
    const converted = usdValue * this.currency.rateFromUsd;
    return new Intl.NumberFormat(this.currency.locale, {style:'currency', currency:this.currency.id, maximumFractionDigits:this.currency.id === 'JPY' || this.currency.id === 'INR' ? 0 : 2}).format(converted);
  }
  currencyOptions() {
    const allowed = this.tenant.id === 'us' ? ['USD','EUR','GBP','INR','JPY'] : this.tenant.id === 'gb' ? ['GBP','EUR','USD'] : ['INR','USD','GBP','EUR'];
    return this.definition.currencies.filter(currency => allowed.includes(currency.id));
  }
}

export const platformConfig = config;
