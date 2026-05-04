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
    // Background da app (mesmo do tema dark)
    const bgColor = getComputedStyle(document.body).backgroundColor || "#0f172a";

    const canvas = await html2canvas(el, {
      scale: 2,
      backgroundColor: bgColor,
      useCORS: true,
      logging: false,
      windowWidth: el.scrollWidth,
      windowHeight: el.scrollHeight,
      onclone: (doc) => {
        // garante background visível na clonagem
        doc.body.style.background = bgColor;
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
