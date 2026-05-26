// ============================================================
// MARCOM / Lumi — Onboarding Step 4: Ad Channels
// ============================================================

import { Facebook, Camera, Search, Linkedin, Ghost } from 'lucide-react';
import { CHANNELS } from '../constants.js';
import { BigHeader, Lede, CheckBox } from '../shared.jsx';

const CHANNEL_ICONS = {
  meta: Facebook,
  tiktok: Camera,
  google: Search,
  linkedin: Linkedin,
  snap: Ghost,
};

export function ChannelsStep({ form, set }) {
  const toggleChannel = (id) => {
    set('channels', {
      ...form.channels,
      [id]: !form.channels[id],
    });
  };

  return (
    <div>
      <BigHeader className="mb-3">Where do you run ads?</BigHeader>
      <Lede className="mb-8">
        Select the platforms you want Lumi to monitor. You can connect more later.
      </Lede>

      <div className="space-y-3">
        {CHANNELS.map((channel) => {
          const Icon = CHANNEL_ICONS[channel.id];
          return (
            <div key={channel.id} className="relative">
              <CheckBox
                id={`channel-${channel.id}`}
                checked={form.channels[channel.id] || false}
                onChange={() => toggleChannel(channel.id)}
                label={
                  <div className="flex items-center gap-2">
                    {Icon && <Icon className="h-4 w-4" />}
                    <span>{channel.label}</span>
                    {channel.primary && (
                      <span className="ml-1 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded bg-lumi-gold/20 text-lumi-gold">
                        Primary
                      </span>
                    )}
                  </div>
                }
                sub={channel.sub}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-5 p-4 rounded-lg bg-gray-50 border border-gray-200">
        <div className="text-xs font-medium text-gray-700 mb-1">
          Don't worry —
        </div>
        <div className="text-xs text-gray-600 leading-relaxed">
          You'll connect your actual ad accounts in the next step after onboarding.
          This just tells Lumi which platforms to prepare for.
        </div>
      </div>
    </div>
  );
}
