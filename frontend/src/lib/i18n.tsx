/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import i18next, { type TOptions } from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";
import { vi } from "@/locales/vi";
import { en } from "@/locales/en";

export type Lang = "vi" | "en";

const initialLang: Lang = (() => {
  try {
    const saved = localStorage.getItem("firms-lang");
    return saved === "en" ? "en" : "vi";
  } catch {
    return "vi";
  }
})();

// Initialize i18next singleton
if (!i18next.isInitialized) {
  i18next.use(initReactI18next).init({
    resources: {
      vi: { translation: vi },
      en: { translation: en },
    },
    lng: initialLang,
    fallbackLng: "vi",
    interpolation: {
      escapeValue: false,
    },
  });
}

interface LangContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, options?: TOptions) => string;
}

const LangContext = createContext<LangContextValue>({
  lang: initialLang,
  setLang: () => undefined,
  t: (k) => k,
});

export function LangProvider({ children }: { children: ReactNode }) {
  const { t: translate } = useTranslation();
  const [lang, setLangState] = useState<Lang>(() => (i18next.language === "en" ? "en" : "vi"));

  useEffect(() => {
    const handleLangChange = (lng: string) => {
      const normalized: Lang = lng === "en" ? "en" : "vi";
      setLangState(normalized);
      try {
        localStorage.setItem("firms-lang", normalized);
      } catch {
        // Ignore localStorage error
      }
      document.documentElement.lang = normalized;
    };

    i18next.on("languageChanged", handleLangChange);
    document.documentElement.lang = lang;
    return () => {
      i18next.off("languageChanged", handleLangChange);
    };
  }, [lang]);

  const setLang = (nextLang: Lang) => {
    i18next.changeLanguage(nextLang);
  };

  const t = (k: string, opts?: TOptions): string => {
    const res = translate(k, opts ?? {});
    return typeof res === "string" ? res : String(res ?? k);
  };

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  const ctx = useContext(LangContext);
  const { t } = useTranslation();
  return {
    lang: ctx.lang,
    setLang: ctx.setLang,
    t: ctx.t || t,
  };
}
