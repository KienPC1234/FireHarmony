import { lazy } from "react";
import { Route, Routes, Navigate } from "react-router-dom";
import { Layout } from "@/components/layout";

const HomePage = lazy(() => import("@/pages/home").then((m) => ({ default: m.HomePage })));
const CalendarPage = lazy(() => import("@/pages/calendar").then((m) => ({ default: m.CalendarPage })));
const LabPage = lazy(() => import("@/pages/lab").then((m) => ({ default: m.LabPage })));
const XrayPage = lazy(() => import("@/pages/xray").then((m) => ({ default: m.XrayPage })));
const EvidencePage = lazy(() => import("@/pages/evidence").then((m) => ({ default: m.EvidencePage })));
const InvestigatorPage = lazy(() => import("@/pages/investigator").then((m) => ({ default: m.InvestigatorPage })));
const MethodsPage = lazy(() => import("@/pages/methods").then((m) => ({ default: m.MethodsPage })));

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="lab" element={<LabPage />} />
        <Route path="xray" element={<XrayPage />} />
        <Route path="evidence" element={<EvidencePage />} />
        <Route path="investigator" element={<InvestigatorPage />} />
        <Route path="ask" element={<InvestigatorPage />} />
        <Route path="methods" element={<MethodsPage />} />
        <Route path="method" element={<MethodsPage />} />
        <Route path="about" element={<MethodsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
