import {
  BarChart3, Bell, BookOpen, Bot, Briefcase, CalendarClock, ClipboardList, Cog, CreditCard, FileText, Gauge, GitBranch, Headphones, KeyRound,
  LayoutTemplate, LifeBuoy, Mail, Megaphone, Newspaper, Rocket, ScrollText, ShoppingCart, Siren, Smile, TrendingDown, Undo2, UserPlus, Users,
} from 'lucide-react';

/**
 * The catalogue's categories (server/src/templates/catalog.js), in gallery
 * order, each with a tile tone so a card's category reads before its title.
 */
export const CATEGORIES = [
  { value: 'Revenue & billing', short: 'Revenue', icon: CreditCard, tile: 'bg-success-subtle text-success-subtle-fg' },
  { value: 'Customer support', short: 'Support', icon: Headphones, tile: 'bg-info-subtle text-info-subtle-fg' },
  { value: 'Sales & marketing', short: 'Sales', icon: Megaphone, tile: 'bg-accent-subtle text-accent-subtle-fg' },
  { value: 'Engineering & DevOps', short: 'Engineering', icon: GitBranch, tile: 'bg-warning-subtle text-warning-subtle-fg' },
  { value: 'Operations', short: 'Operations', icon: Cog, tile: 'bg-bg-subtle text-muted' },
  { value: 'People & HR', short: 'People', icon: Users, tile: 'bg-danger-subtle text-danger-subtle-fg' },
  { value: 'AI & knowledge', short: 'AI', icon: Bot, tile: 'bg-accent-subtle text-accent-subtle-fg' },
];

export const categoryMeta = (value) =>
  CATEGORIES.find((c) => c.value === value) || { value: value || 'Other', short: value || 'Other', icon: Briefcase, tile: 'bg-bg-subtle text-muted' };

// Only the lucide names the catalogue uses, imported explicitly so the bundle
// doesn't carry all ~1,500 icons. Unknown names fall back to the category icon.
const ICONS = {
  BarChart3, Bell, BookOpen, CalendarClock, ClipboardList, CreditCard, FileText, Gauge, Github: GitBranch, KeyRound, LifeBuoy, Mail,
  Newspaper, Rocket, ScrollText, ShoppingCart, Siren, Smile, TrendingDown, Undo2, UserPlus, Users,
};

export function templateIcon(template) {
  return ICONS[template.icon] || categoryMeta(template.category).icon || LayoutTemplate;
}

export const DIFFICULTY = {
  starter: { label: 'Starter', tone: 'success' },
  intermediate: { label: 'Intermediate', tone: 'info' },
  advanced: { label: 'Advanced', tone: 'warning' },
};

/** 'stripe.payment_failed' → { integration: 'stripe', label: 'payment failed' }. */
export function describeTemplateTrigger(template, names = new Map()) {
  const t = template.trigger || { type: template.triggerType };
  if (!t?.type || t.type === 'manual') return 'Run manually';
  if (t.type === 'webhook') return 'Incoming webhook';
  if (t.type === 'schedule') return t.cronExpression ? `Schedule · ${t.cronExpression}` : 'Schedule';
  if (t.type === 'event' && t.eventName) {
    const [integration, ...rest] = t.eventName.split('.');
    return `${names.get(integration) || integration} · ${rest.join('.').replace(/_/g, ' ')}`;
  }
  return 'Event';
}

/** Integrations to show on a card: what it needs, falling back to what it uses. */
export function templateIntegrations(template) {
  const ids = template.requiredIntegrations?.length ? template.requiredIntegrations : template.integrationsUsed || [];
  return [...new Set(ids.filter((id) => id && id !== 'builtin'))];
}
