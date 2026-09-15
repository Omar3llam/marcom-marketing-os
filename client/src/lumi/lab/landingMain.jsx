// ============================================================
// Landing review entry — dev server only, via client/lumi-landing.html
// ------------------------------------------------------------
// Renders the page the `/` route renders, with the SAME global stylesheet and
// font files as the application entry (client/src/main.jsx), so integration
// defects with the legacy stylesheet are visible in review. It leaves out only
// what the landing does not use: Firebase auth, server state and the toaster.
// A local checkout has no Firebase configuration, so the application entry
// shows its configuration error page instead of the landing.
//
// NON-PRODUCTION. Not a route, not in vite.config.js build input, not linked.
// ============================================================
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '../../index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import LandingPage from '../../pages/LandingPage.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <LandingPage />
    </BrowserRouter>
  </StrictMode>,
);
