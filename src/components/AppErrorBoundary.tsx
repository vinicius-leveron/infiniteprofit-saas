import { Component, type ErrorInfo, type ReactNode } from "react";
import { CircleAlert, LifeBuoy, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { publicConfig } from "@/lib/publicConfig";
import { reportClientError } from "@/lib/clientMonitoring";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    reportClientError(error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4">
        <section
          className="w-full max-w-lg rounded-2xl border border-destructive/25 bg-card p-6 text-center shadow-sm md:p-8"
          role="alert"
        >
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <CircleAlert className="h-6 w-6" />
          </span>
          <h1 className="mt-5 text-2xl font-semibold">Esta tela encontrou um problema</h1>
          <p className="mt-2 text-sm leading-5 text-muted-foreground">
            O incidente foi registrado sem enviar seus dados, tokens ou arquivos. Recarregue
            a plataforma; se continuar, fale com o suporte.
          </p>
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <Button className="min-h-11 gap-2" onClick={() => window.location.reload()}>
              <RotateCcw className="h-4 w-4" />
              Recarregar
            </Button>
            <Button asChild variant="outline" className="min-h-11 gap-2">
              <a href={`mailto:${publicConfig.supportEmail}`}>
                <LifeBuoy className="h-4 w-4" />
                Falar com suporte
              </a>
            </Button>
          </div>
        </section>
      </main>
    );
  }
}
