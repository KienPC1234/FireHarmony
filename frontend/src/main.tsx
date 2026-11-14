import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ErrorBoundary } from "./components/error-boundary";
import { LangProvider } from "./lib/i18n";
import { ResearchContextProvider } from "./lib/researchContext";
import "katex/dist/katex.min.css";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <LangProvider>
        <BrowserRouter>
          <ResearchContextProvider>
            <App />
          </ResearchContextProvider>
        </BrowserRouter>
      </LangProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
