export type SetupStepId = "nome" | "fontes" | "revisao";

export type SetupSource = "meta" | "vturb" | "gateway";

export interface SetupDraftV2 {
  version: 2;
  step: SetupStepId;
  name: string;
  selectedExistingMetaIds: string[];
  playersText: string;
  skippedSources: SetupSource[];
}
