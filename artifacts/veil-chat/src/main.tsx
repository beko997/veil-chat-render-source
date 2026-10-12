import { createRoot } from 'react-dom/client';
import { setBaseUrl } from '@workspace/api-client-react';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.trim();
if (configuredApiBase) {
  const apiBase = /^https?:\/\//i.test(configuredApiBase)
    ? configuredApiBase
    : `https://${configuredApiBase}`;
  setBaseUrl(apiBase);
}

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
