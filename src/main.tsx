import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { BudgetDatabaseProvider } from './context/BudgetDatabaseContext';
import { CasebookProvider } from './context/CasebookContext';
import { parseInitialYearFromUrl } from './utils/urlState';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BudgetDatabaseProvider initialYear={parseInitialYearFromUrl(2026)}>
      <CasebookProvider>
        <App />
      </CasebookProvider>
    </BudgetDatabaseProvider>
  </React.StrictMode>
);
