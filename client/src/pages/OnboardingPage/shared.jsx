import { cn } from '@/lib/utils.js';

export const INDUSTRIES = ['E-commerce', 'SaaS', 'Real Estate', 'Healthcare', 'F&B', 'Fashion', 'Education', 'Finance', 'Other'];

export const MARKETS = [
  'Egypt', 'Saudi Arabia', 'UAE', 'Kuwait', 'Qatar', 'Bahrain', 'Oman',
  'Jordan', 'Lebanon', 'Iraq', 'Libya', 'Tunisia', 'Algeria', 'Morocco',
  'Palestine', 'Yemen', 'Sudan',
  'USA', 'UK', 'Europe', 'Global',
];

export const DIALECT_MAP = {
  'Egypt':        'Egyptian Arabic (عامية مصرية)',
  'Saudi Arabia': 'Gulf Arabic / Najdi (خليجي نجدي)',
  'UAE':          'Gulf Arabic / Emirati (خليجي إماراتي)',
  'Kuwait':       'Gulf Arabic / Kuwaiti (خليجي كويتي)',
  'Qatar':        'Gulf Arabic / Qatari (خليجي قطري)',
  'Bahrain':      'Gulf Arabic / Bahraini (خليجي بحريني)',
  'Oman':         'Gulf Arabic / Omani (خليجي عماني)',
  'Jordan':       'Levantine Arabic / Jordanian (شامي أردني)',
  'Lebanon':      'Levantine Arabic / Lebanese (شامي لبناني)',
  'Iraq':         'Iraqi Arabic (عامية عراقية)',
  'Libya':        'Libyan Arabic (عامية ليبية)',
  'Tunisia':      'Tunisian Arabic (دارجة تونسية)',
  'Algeria':      'Algerian Arabic (دارجة جزائرية)',
  'Morocco':      'Moroccan Darija (دارجة مغربية)',
  'Palestine':    'Levantine Arabic / Palestinian (شامي فلسطيني)',
  'Yemen':        'Yemeni Arabic (عامية يمنية)',
  'Sudan':        'Sudanese Arabic (عامية سودانية)',
  'USA':          'American English',
  'UK':           'British English',
  'Europe':       'European English',
  'Global':       'Modern Standard Arabic / English',
};

export const LANGUAGES = ['Arabic', 'English', 'Arabic + English (bilingual)'];

export const TONES = [
  { id: 'bold',    title: 'Bold & Direct',         desc: 'Punchy, confident, conversion-first.' },
  { id: 'warm',    title: 'Warm & Human',          desc: 'Conversational, empathetic, story-led.' },
  { id: 'premium', title: 'Premium & Polished',    desc: 'Considered, restrained, design-led.' },
  { id: 'gen-z',   title: 'Playful & Gen-Z',       desc: 'Meme-aware, fast, native to short-form.' },
  { id: 'edu',     title: 'Educational & Trusted', desc: 'Authoritative, citation-friendly, calm.' },
];

export const GOALS = ['Generate Leads', 'Build Awareness', 'Drive Sales', 'Grow Following', 'Launch Product', 'Retain Customers'];

export const PLATFORMS = [
  { id: 'meta',     label: 'Meta Ads',     icon: '📘' },
  { id: 'google',   label: 'Google Ads',   icon: '🔍' },
  { id: 'tiktok',   label: 'TikTok Ads',   icon: '🎵' },
  { id: 'linkedin', label: 'LinkedIn Ads', icon: '💼' },
  { id: 'snapchat', label: 'Snapchat Ads', icon: '👻' },
  { id: 'twitter',  label: 'X / Twitter',  icon: '🐦' },
];

export const inputCls =
  'w-full rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm text-white/90 placeholder:text-white/30 focus:border-lumi-gold/60 focus:bg-white/[0.07] focus:outline-none focus:ring-1 focus:ring-lumi-gold/20 transition-all duration-150';

export function Section({ title, children }) {
  return (
    <div>
      <h2 className="mb-4 sm:mb-5 font-mono text-xs font-semibold uppercase tracking-widest text-white/35">{title}</h2>
      <div className="space-y-3 sm:space-y-4">{children}</div>
    </div>
  );
}

export function Field({ label, primary = false, children }) {
  return (
    <label className="block">
      <span className={cn(
        'mb-1.5 block',
        primary
          ? 'text-sm font-semibold text-white/80'
          : 'font-mono text-xs font-medium uppercase tracking-wide text-white/40',
      )}>
        {label}
      </span>
      {children}
    </label>
  );
}
