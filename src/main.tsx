import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { startOrderStatusChecker } from './services/orderStatusChecker';

// Start the order status checker to run every 6 hours
const statusChecker = startOrderStatusChecker(6);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Optional: Clean up on application shutdown (if applicable in your environment)
window.addEventListener('beforeunload', () => {
  if (statusChecker) {
    clearInterval(statusChecker);
  }
});
