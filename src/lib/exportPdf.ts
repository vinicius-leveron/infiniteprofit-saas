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
        // Aplicar tema claro para PDF
        doc.body.style.background = "#ffffff";
        doc.body.style.color = "#0f172a";
        doc.querySelectorAll(".section-card, .kpi-card").forEach((el) => {
          (el as HTMLElement).style.background = "#f8fafc";
          (el as HTMLElement).style.borderColor = "#e2e8f0";
          (el as HTMLElement).style.color = "#0f172a";
        });
        doc.querySelectorAll(".text-muted-foreground").forEach((el) => {
          (el as HTMLElement).style.color = "#64748b";
        });
        doc.querySelectorAll(".gradient-text-brand").forEach((el) => {
          (el as HTMLElement).style.background = "none";
          (el as HTMLElement).style.webkitBackgroundClip = "unset";
          (el as HTMLElement).style.webkitTextFillColor = "#0f172a";
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
