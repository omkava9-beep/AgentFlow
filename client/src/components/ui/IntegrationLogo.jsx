import {
  siDiscord, siGithub, siJira, siLinear, siGooglesheets, siNotion, siAirtable, siStripe, siHubspot, siRss, siModelcontextprotocol,
} from 'simple-icons';
import {
  Globe, Mail, Database, Webhook, Sparkles, BookOpen, Wrench, Hash, MessageSquare, Users, Plug,
} from 'lucide-react';
import { cx } from './cx';

// Brand marks from simple-icons (CC0). Brands simple-icons doesn't carry
// (Slack, Teams, Twilio) get a lucide glyph on their brand colour instead.
const BRANDS = {
  discord: siDiscord,
  github: siGithub,
  jira: siJira,
  linear: siLinear,
  sheets: siGooglesheets,
  'google-sheets': siGooglesheets,
  notion: siNotion,
  airtable: siAirtable,
  stripe: siStripe,
  hubspot: siHubspot,
  crm: siHubspot,
  rss: siRss,
  mcp: siModelcontextprotocol,
};

const GLYPH_ON_BRAND = {
  slack: { icon: Hash, color: '#4A154B' },
  teams: { icon: Users, color: '#5059C9' },
  twilio: { icon: MessageSquare, color: '#F22F46' },
  sms: { icon: MessageSquare, color: '#F22F46' },
};

// Generic capabilities: neutral tile, lucide icon.
const GENERIC = {
  http: Globe,
  webhook: Webhook,
  'outbound-webhook': Webhook,
  email: Mail,
  smtp: Mail,
  mail: Mail,
  database: Database,
  ai: Sparkles,
  llm: Sparkles,
  knowledge: BookOpen,
  'knowledge-base': BookOpen,
  builtin: Wrench,
  sparkles: Wrench,
  globe: Globe,
  table: Database,
};

const SIZES = { xs: ['h-4 w-4 rounded', 'h-2.5 w-2.5'], sm: ['h-5 w-5 rounded', 'h-3 w-3'], md: ['h-7 w-7 rounded-md', 'h-4 w-4'], lg: ['h-9 w-9 rounded-lg', 'h-5 w-5'], xl: ['h-11 w-11 rounded-lg', 'h-6 w-6'] };

/**
 * The mark for an integration id (or its manifest `icon`). Brand tiles use the
 * brand colour with a white glyph so they read in both themes; generic
 * capabilities (HTTP, email, database) use a neutral tile.
 */
export default function IntegrationLogo({ id, name, size = 'md', className = '' }) {
  const [box, glyph] = SIZES[size] || SIZES.md;
  const brand = BRANDS[id];
  if (brand) {
    const hex = `#${brand.hex}`;
    return (
      <span className={cx('inline-flex shrink-0 items-center justify-center', box, className)} style={{ backgroundColor: hex }} title={name}>
        <svg viewBox="0 0 24 24" className={glyph} fill={isVeryLight(brand.hex) ? '#111' : '#fff'} aria-hidden="true"><path d={brand.path} /></svg>
      </span>
    );
  }
  const onBrand = GLYPH_ON_BRAND[id];
  if (onBrand) {
    const Icon = onBrand.icon;
    return (
      <span className={cx('inline-flex shrink-0 items-center justify-center text-white', box, className)} style={{ backgroundColor: onBrand.color }} title={name}>
        <Icon className={glyph} strokeWidth={2.25} aria-hidden="true" />
      </span>
    );
  }
  const Icon = GENERIC[id] || Plug;
  return (
    <span className={cx('inline-flex shrink-0 items-center justify-center border border-default bg-bg-subtle text-muted', box, className)} title={name}>
      <Icon className={glyph} aria-hidden="true" />
    </span>
  );
}

function isVeryLight(hex) {
  const n = parseInt(hex, 16);
  const r = (n >> 16) & 255; const g = (n >> 8) & 255; const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 200;
}
