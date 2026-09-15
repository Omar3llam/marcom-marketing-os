// Phase 3 closure — the Primitive Lab renders every example without a contract refusal,
// labels its fixtures as illustrative, and stays outside the application.
import fs from 'node:fs';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { localDir } from '../../../design-system/foundation/resolve.js';
import { LumiLab } from '../lab/LumiLab.jsx';

const clientDir = localDir('../../../', import.meta.url);
const renderLab = () => render(<MemoryRouter><LumiLab /></MemoryRouter>);

describe('LUMI Primitive Lab', () => {
  it('renders every section with the real parts and no refusal', () => {
    renderLab();
    for (const title of ['Decision Spine', 'Typography', 'Surfaces', 'Verdicts', 'Controls', 'States', 'Evidence and measurements', 'Actions', 'Environments']) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
    }
  });

  it('labels its fixtures as illustrative', () => {
    renderLab();
    expect(screen.getByText(/Illustrative example — every name, id, time and figure/)).toBeInTheDocument();
  });

  it('shows the current SCALE assessment beside the stored KILL decision, disagreement in words only', () => {
    const { container } = renderLab();
    const decision = container.querySelector('#decision');
    const [now, stored] = decision.querySelectorAll('[data-lumi-spine]');
    expect(within(now).getByText('SCALE')).toBeInTheDocument();
    expect(within(stored).getByText('KILL')).toBeInTheDocument();
    expect(now).toHaveTextContent('This differs from the decision recorded earlier: KILL.');
    expect(within(now).queryByRole('button')).toBeNull();
    expect(decision.textContent).not.toMatch(/[→←⇒⇐]/);
    expect(decision.querySelector('s, del, strike')).toBeNull();
  });

  it('is not reachable from the application and not built into it', () => {
    const html = fs.readFileSync(`${clientDir}lumi-lab.html`, 'utf8');
    expect(html).toContain('/src/lumi/lab/main.jsx');
    expect(fs.readFileSync(`${clientDir}index.html`, 'utf8')).not.toMatch(/lumi-lab|lumi\/lab/);
    const viteConfig = fs.readFileSync(`${clientDir}vite.config.js`, 'utf8');
    expect(viteConfig).not.toMatch(/lumi-lab/);
    expect(viteConfig).not.toMatch(/rollupOptions:\s*\{[^}]*input/);
  });
});
