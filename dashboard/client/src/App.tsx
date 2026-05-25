import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AppLayout } from "./components/AppLayout";
import { useSSE } from "./hooks/useSSE";
import Dashboard from "./pages/Dashboard";
import Downloads from "./pages/Downloads";
import LogsPage from "./pages/Logs";
import History from "./pages/History";
import Catalogo from "./pages/Catalogo";
import Equipamentos from "./pages/Equipamentos";
import SettingsPage from "./pages/SettingsPage";

function AppWithSSE() {
  const { connected } = useSSE();
  return (
    <AppLayout connected={connected}>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/downloads" component={Downloads} />
        <Route path="/equipamentos" component={Equipamentos} />
        <Route path="/catalogo" component={Catalogo} />
        <Route path="/logs" component={LogsPage} />
        <Route path="/history" component={History} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster position="top-right" theme="dark" />
          <AppWithSSE />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
