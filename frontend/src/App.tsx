import { lazy } from "react";
import { Route, Routes } from "react-router-dom";
import { Layout } from "@/components/layout";

const HomePage = lazy(() => import("@/pages/home").then((m) => ({ default: m.HomePage })));
const CalendarPage = lazy(() => import("@/pages/calendar").then((m) => ({ default: m.CalendarPage })));
const MethodPage = lazy(() => import("@/pages/method").then((m) => ({ default: m.MethodPage })));
const AboutPage = lazy(() => import("@/pages/about").then((m) => ({ default: m.AboutPage })));
const AskPage = lazy(() => import("@/pages/ask").then((m) => ({ default: m.AskPage })));

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="method" element={<MethodPage />} />
        <Route path="about" element={<AboutPage />} />
          <Route path="ask" element={<AskPage />} />
        <Route path="*" element={<p>Not found. Go <a href="/">home</a>.</p>} />
      </Route>
    </Routes>
  );
}
