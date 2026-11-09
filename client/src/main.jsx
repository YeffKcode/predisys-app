import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { LiveProvider } from './auth/LiveContext';
import { ToastProvider } from './components/Toasts';
import ErrorBoundary from './components/ErrorBoundary';
import { ThemeProvider } from './theme/ThemeContext';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <LiveProvider>
              <App />
            </LiveProvider>
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);
