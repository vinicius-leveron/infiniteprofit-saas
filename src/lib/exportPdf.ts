import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { toast } from "sonner";

/**
 * Captura o elemento informado e gera um PDF com layout em páginas A4.
 * - Renderiza com fundo escuro (igual à UI)
 * - Suporta múltiplas páginas com quebras automáticas
 */
export async function exportElementToPdf(
  el: HTMLElement,
  filename: string,
): Promise<void> {
  const toastId = toast.loading("Gerando PDF...");
  try {
    // Forcar fundo branco para PDF legivel
    const bgColor = "#ffffff";

    const canvas = await html2canvas(el, {
      scale: 2,
      backgroundColor: bgColor,
      useCORS: true,
      logging: false,
      windowWidth: el.scrollWidth,
      windowHeight: el.scrollHeight,
      onclone: (doc) => {
        // Aplicar tema claro agressivamente para PDF legivel
        const root = doc.documentElement;
        root.style.setProperty("--background", "255 255 255");
        root.style.setProperty("--foreground", "15 23 42");
        root.style.setProperty("--muted-foreground", "100 116 139");
        root.style.setProperty("--card", "248 250 252");
        root.style.setProperty("--border", "226 232 240");
        root.classList.add("light");
        root.classList.remove("dark");

        doc.body.style.background = "#ffffff";
        doc.body.style.color = "#0f172a";

        // Forcar cor escura em TODOS os elementos de texto
        doc.querySelectorAll("h1, h2, h3, h4, h5, h6, p, span, label, div, td, th").forEach((el) => {
          const elem = el as HTMLElement;
          const computed = getComputedStyle(elem);
          // Se o texto estiver muito claro, forcar escuro
          if (computed.color.includes("255") || computed.color.includes("rgb(255") || computed.color.includes("rgba(255")) {
            elem.style.color = "#0f172a";
          }
          // Remover text-fill-color que pode estar causando texto invisivel
          elem.style.webkitTextFillColor = "inherit";
        });

        // Cards e containers
        doc.querySelectorAll(".section-card, .kpi-card, [class*='card']").forEach((el) => {
          const elem = el as HTMLElement;
          elem.style.background = "#f8fafc";
          elem.style.borderColor = "#e2e8f0";
          elem.style.color = "#0f172a";
          elem.style.boxShadow = "0 1px 3px rgba(0,0,0,0.1)";
        });

        // Texto muted
        doc.querySelectorAll(".text-muted-foreground, [class*='muted']").forEach((el) => {
          (el as HTMLElement).style.color = "#64748b";
        });

        // Titulos com gradiente
        doc.querySelectorAll(".gradient-text-brand, [class*='gradient-text']").forEach((el) => {
          const elem = el as HTMLElement;
          elem.style.background = "none";
          elem.style.backgroundClip = "unset";
          elem.style.webkitBackgroundClip = "unset";
          elem.style.webkitTextFillColor = "#0f172a";
          elem.style.color = "#0f172a";
        });

        // Inputs, sliders, campos
        doc.querySelectorAll("input, select, textarea").forEach((el) => {
          const elem = el as HTMLElement;
          elem.style.background = "#ffffff";
          elem.style.color = "#0f172a";
          elem.style.borderColor = "#e2e8f0";
        });

        // Botoes
        doc.querySelectorAll("button, [role='button']").forEach((el) => {
          const elem = el as HTMLElement;
          const computed = getComputedStyle(elem);
          if (computed.backgroundColor.includes("255") || computed.backgroundColor === "transparent") {
            elem.style.background = "#f1f5f9";
          }
          elem.style.color = "#0f172a";
          elem.style.borderColor = "#e2e8f0";
        });

        // Icones SVG
        doc.querySelectorAll("svg").forEach((el) => {
          const elem = el as HTMLElement;
          const computed = getComputedStyle(elem);
          if (computed.color.includes("255")) {
            elem.style.color = "#64748b";
          }
        });

        // Remover opacidades que deixam texto invisivel
        doc.querySelectorAll("[style*='opacity']").forEach((el) => {
          const elem = el as HTMLElement;
          if (parseFloat(elem.style.opacity) < 0.5) {
            elem.style.opacity = "1";
          }
        });

        // Sliders/range - forcar visibilidade
        doc.querySelectorAll("[role='slider'], .slider, [class*='slider']").forEach((el) => {
          const elem = el as HTMLElement;
          elem.style.background = "#10b981";
        });

        // Badges e tags
        doc.querySelectorAll(".badge, [class*='badge']").forEach((el) => {
          const elem = el as HTMLElement;
          elem.style.color = "#0f172a";
        });

        // Tabelas
        doc.querySelectorAll("table, thead, tbody, tr").forEach((el) => {
          const elem = el as HTMLElement;
          elem.style.background = "#ffffff";
          elem.style.color = "#0f172a";
        });
        doc.querySelectorAll("th").forEach((el) => {
          const elem = el as HTMLElement;
          elem.style.color = "#64748b";
          elem.style.background = "#f8fafc";
        });
        doc.querySelectorAll("td").forEach((el) => {
          const elem = el as HTMLElement;
          elem.style.color = "#0f172a";
        });
      },
    });

    const imgData = canvas.toDataURL("image/jpeg", 0.92);

    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pdfWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = 0;

    pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight, undefined, "FAST");
    heightLeft -= pdfHeight;

    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight, undefined, "FAST");
      heightLeft -= pdfHeight;
    }

    pdf.save(filename);
    toast.success("PDF gerado", { id: toastId });
  } catch (e) {
    console.error("export pdf error", e);
    const msg = e instanceof Error ? e.message : "Erro ao gerar PDF";
    toast.error(msg, { id: toastId });
  }
}
