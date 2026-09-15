// ============================================================
// LUMI Primitive Lab — entry (dev server only, via client/lumi-lab.html)
// ------------------------------------------------------------
// Loads only the tokens and the three locked families at the weights the type
// roles use. It deliberately does NOT load client/src/index.css, so nothing of
// the legacy stylesheet can make a primitive look right by accident.
// ============================================================
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '../../../design-system/foundation/generated/tokens.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { LumiLab } from './LumiLab.jsx';

createRoot(document.getElementById('lab-root')).render(
  <StrictMode>
    <MemoryRouter>
      <LumiLab />
    </MemoryRouter>
  </StrictMode>,
);
