import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Compass, Sparkles, X } from "lucide-react";
import { useLang } from "@/lib/i18n";
import {
  destroyActiveTour,
  resolveTourPage,
  saveTourGlobalOptOut,
  saveTourPageStatus,
  shouldPromptTour,
  startPageTour,
  TOUR_START_EVENT,
  type TourPageId,
} from "@/lib/tour";

export function TourController() {
  const { lang, t } = useLang();
  const location = useLocation();
  const pageId: TourPageId = resolveTourPage(location.pathname);

  const [promptVisible, setPromptVisible] = useState(false);

  useEffect(() => {
    destroyActiveTour();
    setPromptVisible(false);

    if (!shouldPromptTour(pageId)) return;

    const timer = window.setTimeout(() => {
      if (shouldPromptTour(pageId)) {
        setPromptVisible(true);
      }
    }, 650);

    return () => {
      window.clearTimeout(timer);
    };
  }, [pageId]);

  useEffect(() => {
    const handleStart = () => {
      setPromptVisible(false);
      window.setTimeout(() => {
        startPageTour(pageId, lang);
      }, 60);
    };

    window.addEventListener(TOUR_START_EVENT, handleStart);
    return () => {
      window.removeEventListener(TOUR_START_EVENT, handleStart);
    };
  }, [pageId, lang]);

  if (!promptVisible) return null;

  const pageLabel = t(`tour.page_${pageId}`);

  const handleAccept = () => {
    setPromptVisible(false);
    saveTourPageStatus(pageId, "accepted");
    window.setTimeout(() => {
      startPageTour(pageId, lang);
    }, 80);
  };

  const handleDismissPage = () => {
    setPromptVisible(false);
    saveTourPageStatus(pageId, "dismissed");
  };

  const handleNeverAsk = () => {
    setPromptVisible(false);
    saveTourGlobalOptOut(true);
  };

  return (
    <div
      role="dialog"
      aria-label={t("tour.prompt_title", { page: pageLabel })}
      className="fixed bottom-4 right-4 z-[1500] w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-cyan-500/40 bg-[#0B1220]/95 p-4 shadow-2xl backdrop-blur-xl animate-in slide-in-from-bottom-3 duration-200"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/15 text-cyan-300">
            <Compass className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 space-y-1">
            <h3 className="text-sm font-bold text-white leading-snug">
              {t("tour.prompt_title", { page: pageLabel })}
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              {t("tour.prompt_desc")}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDismissPage}
          aria-label={t("tour.btn_skip")}
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition shrink-0"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={handleNeverAsk}
          className="text-[11px] font-medium text-slate-200 hover:text-white underline underline-offset-2 transition"
        >
          {t("tour.btn_never")}
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDismissPage}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 hover:text-white transition"
          >
            {t("tour.btn_skip")}
          </button>
          <button
            type="button"
            onClick={handleAccept}
            className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-800 hover:bg-cyan-900 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm transition"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{t("tour.btn_start")}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
