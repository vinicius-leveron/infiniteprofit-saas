import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultName?: string;
  saving: boolean;
  onSave: (name: string) => Promise<void> | void;
  /** Quando atualizando um projeto existente */
  isUpdate?: boolean;
}

export const SaveProjectDialog = ({
  open,
  onOpenChange,
  defaultName = "",
  saving,
  onSave,
  isUpdate,
}: Props) => {
  const [name, setName] = useState(defaultName);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (o) setName(defaultName);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isUpdate ? "Salvar alterações" : "Salvar projeto"}</DialogTitle>
          <DialogDescription>
            {isUpdate
              ? "Atualize o nome se quiser e salve as alterações."
              : "Dê um nome para identificar esse dashboard depois."}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = name.trim();
            if (!trimmed) return;
            void onSave(trimmed);
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="project-name">Nome do projeto</Label>
            <Input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Lançamento Janeiro"
              required
              maxLength={120}
              autoFocus
              className="mt-1.5"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
